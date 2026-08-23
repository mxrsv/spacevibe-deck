# New task launcher — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-08-23
Spec: [2026-08-23-new-task-launcher-design.md](../specs/2026-08-23-new-task-launcher-design.md) `decided`
Status: `planned` — nothing in this plan is built yet.

**Goal:** make `New` mean *start a task* — one prompt-first composer on the Open Board and one
non-modal Quick Launch popover, sharing a single immutable draft and a single launch contract
that materializes exactly one agent pane and sends the first prompt exactly once.

**Architecture:** a pure `src/launcher/` core (draft, validation, runtime catalog, command
composition) with a window-scoped signal store; two presentations that share field components
but no modal behaviour; and one new `TabManager` method that owns materialize → readiness →
prompt-send so pane ids never leave the terminal layer.

**Tech stack:** Preact + `@preact/signals`, existing `TabManager` materialization seam,
existing `injectIntoPane` / `submitAllowed` prompt gate, existing `worktree_add` IPC, one new
Electron-only flat channel for directory creation.

## Global constraints

- **English only** in strings, comments, docs and commit messages (R1).
- **Electron target.** Tauri stays feature-frozen; every new host call degrades to
  "capability absent" through the `available` flag pattern in `src/host/worktree-host.ts`.
- **Immutability (C1).** Every draft update returns a new object; never mutate in place.
- **R5.** Renderer state uses Preact signals; the launcher store is window-scoped.
- **R6.** IPC payload shape is a contract — flat keys, and
  `scripts/electron-ipc-contract.test.ts` must be extended in the same task that adds a channel.
- **R4.** `TabManager` is a load-bearing seam; it gains exactly one method and no caller
  outside it ever sees a pane id.
- **DL is executable policy (R2).** New chrome cites numbered rules; the new section is §32.
- **No invented CLI flags or model names.** Every flag and every seeded model value must be
  quoted from that CLI's own `--help` on the implementer's machine, the same rule
  `BuiltinAgent.defaultCommand` already follows.
- **Path-scope every commit.** This checkout is shared with concurrent sessions that leave
  files staged. `git add .` followed by a bare `git commit` sweeps their work into this one, so
  every recipe below names its paths on BOTH lines — `git add <paths>` (new files must be
  staged; `--` alone cannot see an untracked file) and `git commit … -- <paths>` (which is what
  keeps a peer's already-staged file out of this commit).
- **Gallery is the visual baseline, not a task.** `src/gallery/sections/board-section.tsx` and
  `new-task-launcher-section.css` already carry the owner-approved treatment (2026-08-23).
  Production CSS is promoted from that file; the gallery specimens stay.

---

## Decisions this plan takes that the spec left open

### T-A. The prompt is sent through `injectIntoPane`, and readiness is polled BEFORE it

`AgentLauncher`'s existing readiness gate is **shell** readiness (OSC 133;B, see
[`electron/shell-integration.ts`](../../electron/shell-integration.ts)). It fires the moment
the interactive shell prints a prompt — that is, *before* the agent binary has been typed, let
alone booted. Spec §8 step 6 and step 8 are therefore two different gates, and the second one
does not exist today.

The second gate is built from the Prompt Board's machinery, which already answers exactly this
question per pane:

- [`submitAllowed`](../../src/prompts/inject.ts) — the pane runs the expected agent
  (`info.kind === "agent" && info.agent === expected`), is `phase: "idle"`, and carries no
  latched attention;
- [`freshPaneInfo`](../../src/terminal/pane-info.ts) — an uncached `pty_info` read;
- [`injectIntoPane`](../../src/terminal/tab-manager.ts) — paste, then re-check, then `\r`.

**Trap, and the reason this decision is written down:** `injectIntoPane` pastes
**unconditionally** and gates only the `\r`. Calling it while the pane is still a bare shell
would paste the task prompt into that shell, which spec §8 forbids in as many words. So the
controller polls `freshPaneInfo` + `paneAttention` until a `submitAllowed`-shaped predicate
passes, and only then calls `injectIntoPane`. Its internal gate becomes the *second* check, not
the first.

### T-B. `"pasted"` is terminal — the prompt is never retried

`injectIntoPane` answers `"sent" | "pasted" | "failed" | "busy" | "no-target"`. `"pasted"`
means the text reached the agent's composer but the gate closed between paste and `\r`. The
text is already in the agent's input. **Retrying would duplicate it**, so `"pasted"` ends the
attempt with a visible message ("the prompt is waiting in the pane — press Enter to send") and
the draft is NOT cleared. This is how spec §8's "exactly once" is honoured on the failure path.

### T-C. Readiness timeout is 90s, and a timeout leaves the tab standing

A fresh agent that emits no OSC 9;4 and little output can legitimately sit at
`phase: "unknown"` — `agent-activity.ts` says so directly. The poll therefore has a ceiling:
`TASK_PROMPT_READY_TIMEOUT_MS = 90_000`, polled every 500ms. On timeout the tab stays visible,
the launcher reports `prompt-not-sent`, and the draft keeps the prompt (spec §8: "retains a
recoverable copy of the task prompt").

### T-D. `TabManager` gains one method: `launchTask`

`materialize` returns a boolean and deliberately does not hand out pane ids. Rather than
leaking them to `App` so it can poll and inject, `TabManager` gains
`launchTask(intent, prompt)` which owns the whole sequence. This is the **tab-materialization
seam**, fork-listed in `AGENTS.md` — T1 records it.

### T-E. Quick Launch is the `promptsOpen` genre, not the `Modal` genre

The precedent already exists: [`promptsOpen`](../../src/chrome/events.ts) is documented as
"a pane-level popover anchored to a chrome button, not a surface that covers the terminal grid,
so it neither blocks other actions nor needs a tier" and is deliberately **outside**
`openOverlayRanks()`. Quick Launch takes exactly that shape — no scrim, no blur, no focus trap,
no overlay rank — which is also what spec §4.2 demands.

### T-F. Quick Launch closes when the browser surface is active

A `WebContentsView` paints over the DOM, so a popover raised over an open browser tab is
invisible. `agentQuickPickerOpen` was added to `panelObscured()` for exactly this reason
(2026-08-16). Quick Launch takes the **other** precedent — the Prompt Board's — because it is
not a modal: its trigger reports unavailable and an open popover closes while the browser
surface holds the stage. One reason string, `"the browser is covering the pane"`, matching
`promptsUnavailable()`.

### T-G. Model values are seeded from `--help` and extended in Settings

Measured on this machine, 2026-08-23, from each CLI's own `--help`:

| Agent | Model flag | Effort flag | Effort values stated by `--help` |
| --- | --- | --- | --- |
| `claude` | `--model <model>` | `--effort <level>` | `low, medium, high, xhigh, max` |
| `agy` | `--model` | `--effort` | `low, medium, high` |
| `codex` | `-m, --model <MODEL>` | none | — |
| `opencode` | `-m, --model provider/model` | none | — |
| `gemini` | `-m, --model` | none | — |
| `cursor-agent` | `--model <model>` | none | — |

**No CLI enumerates its model list in `--help`.** Only prose examples exist: claude names the
aliases `fable`, `opus`, `sonnet`; cursor-agent names `gpt-5`, `sonnet-4-thinking`. So:

- the catalog ships **flags** (verified above) and a **seed** of only those quoted aliases;
- an agent with no quoted aliases seeds empty;
- users add model values per agent in Settings → Agents (new `agentModels` field);
- an agent with no models and no effort flag renders **no** runtime select at all (DL-19.7
  omit-don't-disable), rather than an empty control.

**The gallery's `AGENT_MODELS` values are fiction** — `claude-opus-4-6`, `gpt-5.6 Sol`,
`GPT-5.6 Terra` — invented for the mock. They are the visual baseline for the *control*, never
a data source. Do not copy them into `src/launcher/`.

### T-H. Composition strips before it appends, and must survive `commandProblem`

The base is the agent's default command from Settings (`defaultLaunchProfiles` → the profile's
command, else `BuiltinAgent.defaultCommand`, else the bare binary). Composition removes any
existing occurrence of that agent's own model/effort flag and its value from the base, then
appends the selected pair. The result is re-validated with
[`commandProblem`](../../src/lib/launch-profile.ts); a failure is a visible error, never a
silent drop.

`COMMAND_SAFE` has no quotes and no brackets by design, so **a model value needing quoting is
unrepresentable** — cursor-agent's `'claude-opus-4-8[context=1m,effort=high]'` form cannot be
launched from this field and must be declared as a launch profile or a custom agent instead.
State that in the Settings help text.

### T-I. Three new settings fields, all drop-not-repair

- `agentModels: Readonly<Record<string, readonly string[]>>` — user-declared model values per
  agent, merged over the catalog seed.
- `agentRuntimeDefaults: Readonly<Record<string, { model: string | null; effort: string | null }>>`
  — spec §7's "default model and reasoning effort where the agent supports them".
- `quickLaunchPromptExpanded: boolean` — spec §4.2's remembered preference, Quick Launch only.

Each validates by dropping anything malformed, the discipline `validateLaunchProfiles` and
`validateCustomAgents` already use.

### T-J. `Create workspace…` needs one new IPC channel

There is no mkdir channel: `electron/ipc/channels.ts` has `worktreeAdd` and `dirsExist` and
nothing that creates a plain directory. `create_directory` is added as an Electron-only flat
channel beside `worktree_add`, with the same argv-not-shell discipline, and the R6 contract
test is extended in the same task.

### T-K. The Open Board reverses its own 2026-08-16 contract

`openWorkspace()` currently opens on one click, and the code says so in a long comment. Under
this spec a recents row **fills the Workspace field and returns focus to the composer**. The
comment block explaining one-click-opens must be rewritten, not left standing, and the drift
row "One click on the open board opens the workspace" in `AGENTS.md` becomes **false**.

`⌘Enter` is composer-local, not a registry action — it fires only while the prompt field has
focus, so it needs no `action-registry.ts` entry, no keymap and no menu regeneration. `⌘T`
keeps its `new-tab` action; only `newTab()`'s body changes.

---

## File structure

**New — pure core (no signals, no host, no DOM):**

| File | Responsibility |
| --- | --- |
| `src/launcher/new-task-draft.ts` | the draft type, immutable updates, validation problems |
| `src/launcher/runtime-catalog.ts` | per-agent model/effort capability + composite options |
| `src/launcher/compose-launch-command.ts` | base command + runtime values → one command line |
| `src/terminal/task-prompt-send.ts` | the readiness predicate and the send outcome type |

**New — state and presentation:**

| File | Responsibility |
| --- | --- |
| `src/launcher/launcher-store.ts` | window-scoped draft signal + entry-point intent |
| `src/launcher/launcher-fields.tsx` | shared workspace / agent / runtime toolbar + prompt field |
| `src/launcher/quick-launch.tsx` | the non-modal anchored popover |
| `src/open-board/board-composer.tsx` | the Open Board composer body |
| `src/open-board/create-workspace-form.tsx` | the `Create workspace…` subview |
| `src/styles/18-new-task-launcher.css` | promoted from the gallery sheet |

**Modified:** `src/open-board/open-board.tsx`, `open-board-home.tsx`, `use-worktree-form.ts`,
`src/terminal/tab-manager.ts`, `tab-manager-types.ts`, `src/chrome/events.ts`,
`src/ui/app.tsx`, `src/settings/settings-schema.ts`, `src/ui/settings/sections/*` (agents),
`electron/ipc/channels.ts`, `electron/main.ts`, `electron/preload.ts`,
`scripts/electron-ipc-contract.test.ts`, `src/styles.css`, `docs/DESIGN-LANGUAGE.md`,
`AGENTS.md`, `docs/CONTEXT.md`.

**Not deleted:** `src/ui/agent-quick-picker.tsx` and its test stay in the tree and keep
building. Spec §11: it is superseded only after every contextual entry point uses Quick Launch,
and it is not deleted during this work — the revert is re-mounting one component.

---

## Task table

| # | Phase | Task | Files |
| --- | --- | --- | --- |
| T1 | P0 | Fork-queue entries in `AGENTS.md` | `AGENTS.md` |
| T2 | P0 | The draft model and its validation | `src/launcher/new-task-draft.ts` (+ test) |
| T3 | P0 | The runtime catalog | `src/launcher/runtime-catalog.ts` (+ test) |
| T4 | P0 | Command composition | `src/launcher/compose-launch-command.ts` (+ test) |
| T5 | P0 | The window-scoped draft store | `src/launcher/launcher-store.ts` (+ test) |
| T6 | P0 | `TabManager.launchTask` + readiness | `src/terminal/task-prompt-send.ts`, `tab-manager.ts`, `tab-manager-types.ts` (+ tests) |
| T7 | P0 | Shared launcher fields | `src/launcher/launcher-fields.tsx` (+ test) |
| T8 | P0 | Open Board composer body | `src/open-board/board-composer.tsx` (+ test) |
| T9 | P0 | Open Board rewire: select, don't launch | `src/open-board/open-board.tsx`, `open-board-home.tsx` (+ tests) |
| T10 | P0 | `App` wiring of the launch contract | `src/ui/app.tsx` (+ test) |
| T11 | P1 | Quick Launch popover | `src/launcher/quick-launch.tsx`, `src/chrome/events.ts` (+ tests) |
| T12 | P1 | Entry-point rewires (`⌘T`, strip `+`, rail `+`, full-composer handoff) | `tab-manager.ts`, `src/ui/agent-rail.tsx`, `src/ui/app.tsx` (+ tests) |
| T13 | P1 | `create_directory` IPC channel | `electron/ipc/channels.ts`, `electron/main.ts`, `electron/preload.ts`, `src/host/*`, `scripts/electron-ipc-contract.test.ts` (+ tests) |
| T14 | P1 | Workspace subviews return instead of opening | `src/open-board/create-workspace-form.tsx`, `use-worktree-form.ts`, `open-board.tsx` (+ tests) |
| T15 | P1 | Settings fields for models, runtime defaults, prompt memory | `src/settings/settings-schema.ts` (+ test) |
| T16 | P1 | Settings → Agents: identities vs commands, model/effort defaults | `src/ui/settings/sections/agents-*.tsx` (+ tests) |
| T17 | P2 | DL §32 and the production stylesheet | `docs/DESIGN-LANGUAGE.md`, `src/styles/18-new-task-launcher.css`, `src/styles.css` (+ design-language test) |
| T18 | P2 | Keyboard, focus, pending and error coverage | launcher files (+ tests) |
| T19 | P2 | Retire the superseded mounts | `src/ui/app.tsx`, `tab-manager.ts` (+ tests) |
| T20 | P2 | Docs: `AGENTS.md` bullet + drift rows, `docs/CONTEXT.md` | `AGENTS.md`, `docs/CONTEXT.md` |

---

## P0 — shared contract

### Task 1: Fork-queue entries

**Files:**
- Modify: `AGENTS.md` — the `## Forks` open queue.

This work touches four fork-listed categories at once and must be recorded before any code.

- [ ] **Step 1: Add one open-queue entry naming all four**

Append to the open queue, above the most recent entry:

```markdown
- **The task launcher owns materialization, adds a DL section, one IPC channel and three
  settings fields (2026-08-23, owner-approved by the spec's `approved behavior and Gallery
  treatment` status).** Four fork-listed categories: **tab materialization** — `TabManager`
  gains `launchTask`, which owns materialize → agent-readiness poll → one `injectIntoPane`,
  because `materialize` returns a boolean and pane ids must not leave the terminal layer;
  **a rule in `docs/DESIGN-LANGUAGE.md`** — §32 is new, the non-modal anchored launcher genre,
  which is the `promptsOpen` precedent rather than DL §29's modal shell; **IPC** —
  `create_directory` joins `CHANNELS` as an Electron-only flat channel beside `worktree_add`;
  and **settings schema** — `agentModels`, `agentRuntimeDefaults` and
  `quickLaunchPromptExpanded`. Chosen over handing pane ids to `App` (which would put the
  readiness poll outside the seam that owns panes) and over making Quick Launch a `Modal`
  variant (spec §4.2 forbids the scrim, blur and focus trap outright). NOT touched: PTY
  ownership, process classification, the window coordinator, layout, close/quit coordination,
  the keymap, or any sibling repo.
```

- [ ] **Step 2: Show the owner the entry, then commit (D14)**

`AGENTS.md` is a living document, so it is not committed before the owner has read the wording —
the same gate Task 20 runs. Paste the entry, get an ack, then:

```bash
git add AGENTS.md
git commit -m "docs(agents): record the task launcher fork queue entry" -- AGENTS.md
```

---

### Task 2: The draft model and its validation

**Files:**
- Create: `src/launcher/new-task-draft.ts`
- Test: `src/launcher/new-task-draft.test.ts`

**Interfaces:**
- Consumes: `AgentRuntimeCapability` from Task 3 (type-only; write Task 3 first if the
  implementer prefers, the two are independent otherwise).
- Produces:

```ts
export interface NewTaskDraft {
  readonly prompt: string;
  readonly workspacePath: string | null;
  readonly agentId: string | null;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
  readonly promptExpanded: boolean;
}

export const EMPTY_DRAFT: NewTaskDraft;

export function withPrompt(draft: NewTaskDraft, prompt: string): NewTaskDraft;
export function withWorkspace(draft: NewTaskDraft, path: string | null): NewTaskDraft;
export function withPromptExpanded(draft: NewTaskDraft, expanded: boolean): NewTaskDraft;
/** Selecting an agent RESETS model/effort to that agent's defaults — spec §3.5. */
export function withAgent(
  draft: NewTaskDraft,
  agentId: string | null,
  capability: AgentRuntimeCapability | null,
): NewTaskDraft;
export function withRuntime(
  draft: NewTaskDraft,
  modelId: string | null,
  effort: string | null,
): NewTaskDraft;

export type DraftProblem =
  | "no-workspace"
  | "no-agent"
  | "agent-unavailable"
  | "no-runnable-agent"
  | "empty-prompt";

export interface DraftContext {
  /** Agent ids that are enabled AND whose binary was found. */
  readonly runnableAgentIds: readonly string[];
  /** Agent ids enabled but not on $PATH — spec §7's `Not installed` rows. */
  readonly unavailableAgentIds: readonly string[];
}

/** Blocks `Start task`. */
export function startTaskProblem(draft: NewTaskDraft, context: DraftContext): DraftProblem | null;
/** Blocks `Open agent` / `Open agent first` — identical but ignores the prompt. */
export function openAgentProblem(draft: NewTaskDraft, context: DraftContext): DraftProblem | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  openAgentProblem,
  startTaskProblem,
  withAgent,
  withPrompt,
  withRuntime,
  withWorkspace,
  type DraftContext,
} from "./new-task-draft";

const RUNNABLE: DraftContext = { runnableAgentIds: ["claude"], unavailableAgentIds: [] };

describe("new-task-draft", () => {
  it("never mutates the draft it was given", () => {
    const next = withPrompt(EMPTY_DRAFT, "ship it");
    expect(next).not.toBe(EMPTY_DRAFT);
    expect(EMPTY_DRAFT.prompt).toBe("");
    expect(next.prompt).toBe("ship it");
  });

  it("resets model and effort when the agent changes", () => {
    const started = withRuntime(
      withAgent(EMPTY_DRAFT, "claude", null),
      "opus",
      "high",
    );
    const moved = withAgent(started, "codex", {
      agentId: "codex",
      modelFlag: "--model",
      models: [],
      effortFlag: null,
      efforts: [],
      defaultModel: null,
      defaultEffort: null,
    });
    expect(moved.modelId).toBeNull();
    expect(moved.reasoningEffort).toBeNull();
  });

  it("blocks Start task on an empty prompt but not Open agent", () => {
    const draft = withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "claude", null);
    expect(startTaskProblem(draft, RUNNABLE)).toBe("empty-prompt");
    expect(openAgentProblem(draft, RUNNABLE)).toBeNull();
  });

  it("blocks a whitespace-only prompt", () => {
    const draft = withPrompt(
      withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "claude", null),
      "   \n  ",
    );
    expect(startTaskProblem(draft, RUNNABLE)).toBe("empty-prompt");
  });

  it("refuses an agent that is enabled but not installed", () => {
    const draft = withPrompt(
      withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "codex", null),
      "ship it",
    );
    expect(
      startTaskProblem(draft, { runnableAgentIds: ["claude"], unavailableAgentIds: ["codex"] }),
    ).toBe("agent-unavailable");
  });

  it("reports no-runnable-agent when nothing can launch", () => {
    const draft = withPrompt(withWorkspace(EMPTY_DRAFT, "/repo"), "ship it");
    expect(
      startTaskProblem(draft, { runnableAgentIds: [], unavailableAgentIds: ["claude"] }),
    ).toBe("no-runnable-agent");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/launcher/new-task-draft.test.ts
```

Expected: FAIL — `Failed to resolve import "./new-task-draft"`.

- [ ] **Step 3: Implement**

Every updater is `{ ...draft, field: value }`. `startTaskProblem` checks in this order —
`no-runnable-agent` (context has nothing runnable), `no-workspace`, `no-agent`,
`agent-unavailable`, then `empty-prompt` — so the most structural problem is always the one
reported. `openAgentProblem` is the same chain with the prompt check dropped.

- [ ] **Step 4: Run the tests and the typecheck**

```bash
npx vitest run src/launcher/new-task-draft.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/launcher/new-task-draft.ts src/launcher/new-task-draft.test.ts
git commit -m "feat(launcher): add the immutable new-task draft and its validation" -- src/launcher/new-task-draft.ts src/launcher/new-task-draft.test.ts
```

---

### Task 3: The runtime catalog

**Files:**
- Create: `src/launcher/runtime-catalog.ts`
- Test: `src/launcher/runtime-catalog.test.ts`

**Interfaces:**

```ts
export interface RuntimeValue {
  readonly value: string;
  readonly label: string;
}

export interface AgentRuntimeCapability {
  readonly agentId: string;
  /** e.g. "--model"; null when the CLI takes no model flag. */
  readonly modelFlag: string | null;
  /** Seed values quoted from the CLI's own --help; may be empty. */
  readonly models: readonly RuntimeValue[];
  /** e.g. "--effort"; null when the CLI documents none. */
  readonly effortFlag: string | null;
  readonly efforts: readonly RuntimeValue[];
  readonly defaultModel: string | null;
  readonly defaultEffort: string | null;
}

export const AGENT_RUNTIMES: readonly AgentRuntimeCapability[];

export function runtimeFor(agentId: string | null): AgentRuntimeCapability | null;

/** The catalog seed merged with the user's declared models for that agent. */
export function modelsFor(
  agentId: string,
  declared: Readonly<Record<string, readonly string[]>>,
): readonly RuntimeValue[];

export interface RuntimeOption {
  /** `${model}::${effort}` — "" for either half when the agent has none. */
  readonly value: string;
  /** e.g. "Opus · High", or "Opus" when the agent has no effort flag. */
  readonly label: string;
  readonly model: string | null;
  readonly effort: string | null;
}

/** The composite select's options: models × efforts, model-only, or empty. */
export function runtimeOptions(
  capability: AgentRuntimeCapability | null,
  declared: Readonly<Record<string, readonly string[]>>,
): readonly RuntimeOption[];

export function runtimeKey(model: string | null, effort: string | null): string;
export function parseRuntimeKey(key: string): { model: string | null; effort: string | null };

/**
 * The Settings default overriding the catalog seed — spec §3.5 and §7. Returns
 * the capability unchanged when there is no stored default, and never accepts
 * a stored value the capability does not list.
 */
export function mergeRuntimeDefaults(
  capability: AgentRuntimeCapability | null,
  stored: { readonly model: string | null; readonly effort: string | null } | undefined,
): AgentRuntimeCapability | null;
```

- [ ] **Step 1: Re-verify every flag against the installed CLIs**

Do not trust the table in T-G; re-run it, because the CLIs update.

```bash
for a in claude codex opencode agy gemini cursor-agent; do
  echo "##### $a"
  "$a" --help 2>&1 | grep -iE '^\s*(-m,|--model|--effort)' | head -6
done
```

Record what this prints in the module's doc comment, with the date. A flag that does not
appear is `null` — never guessed.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import {
  AGENT_RUNTIMES,
  mergeRuntimeDefaults,
  modelsFor,
  parseRuntimeKey,
  runtimeFor,
  runtimeKey,
  runtimeOptions,
} from "./runtime-catalog";

describe("runtime-catalog", () => {
  it("describes every built-in agent exactly once", () => {
    const ids = AGENT_RUNTIMES.map((entry) => entry.agentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const agent of BUILTIN_AGENTS) {
      expect(ids).toContain(agent.id);
    }
  });

  it("gives claude both flags and agy both flags", () => {
    expect(runtimeFor("claude")?.modelFlag).toBe("--model");
    expect(runtimeFor("claude")?.effortFlag).toBe("--effort");
    expect(runtimeFor("agy")?.effortFlag).toBe("--effort");
  });

  it("gives codex, opencode, gemini and cursor-agent no effort flag", () => {
    for (const id of ["codex", "opencode", "gemini", "cursor-agent"]) {
      expect(runtimeFor(id)?.effortFlag).toBeNull();
    }
  });

  it("merges declared models over the seed without duplicating", () => {
    const merged = modelsFor("claude", { claude: ["opus", "my-custom-alias"] });
    const values = merged.map((entry) => entry.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("my-custom-alias");
  });

  it("produces model × effort options for an agent with both", () => {
    const options = runtimeOptions(runtimeFor("claude"), { claude: ["opus"] });
    expect(options.some((option) => option.label === "opus · high")).toBe(true);
  });

  it("produces model-only options for an agent with no effort flag", () => {
    const options = runtimeOptions(runtimeFor("codex"), { codex: ["gpt-5"] });
    expect(options).toHaveLength(1);
    expect(options[0].effort).toBeNull();
  });

  it("produces nothing for an agent with no models and no efforts", () => {
    expect(runtimeOptions(runtimeFor("codex"), {})).toEqual([]);
  });

  it("lets a stored default override the catalog seed", () => {
    const merged = mergeRuntimeDefaults(runtimeFor("claude"), {
      model: "sonnet",
      effort: "low",
    });
    expect(merged?.defaultModel).toBe("sonnet");
    expect(merged?.defaultEffort).toBe("low");
  });

  it("ignores a stored default the capability does not list", () => {
    const merged = mergeRuntimeDefaults(runtimeFor("agy"), {
      model: null,
      effort: "max",
    });
    expect(merged?.defaultEffort).not.toBe("max");
  });

  it("round-trips a runtime key", () => {
    expect(parseRuntimeKey(runtimeKey("opus", "high"))).toEqual({
      model: "opus",
      effort: "high",
    });
    expect(parseRuntimeKey(runtimeKey(null, null))).toEqual({ model: null, effort: null });
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run src/launcher/runtime-catalog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement, seeding models only from quoted `--help` prose**

`claude` seeds the aliases its `--help` names (`fable`, `opus`, `sonnet`); `cursor-agent` seeds
the examples its `--help` names; every other agent seeds `models: []`. The doc comment states
that an empty seed is not an oversight and points at Settings → Agents.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/launcher/runtime-catalog.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/launcher/runtime-catalog.ts src/launcher/runtime-catalog.test.ts
git commit -m "feat(launcher): add the per-agent model and reasoning-effort catalog" -- src/launcher/runtime-catalog.ts src/launcher/runtime-catalog.test.ts
```

---

### Task 4: Command composition

**Files:**
- Create: `src/launcher/compose-launch-command.ts`
- Test: `src/launcher/compose-launch-command.test.ts`

**Interfaces:**
- Consumes: `AgentRuntimeCapability` (Task 3), `commandProblem` and `LaunchProfile`
  (`src/lib/launch-profile.ts`), `resolveAgentCommand` (`src/lib/agent-catalog.ts`).
- Produces:

```ts
export interface ComposeInput {
  readonly agentId: string;
  readonly capability: AgentRuntimeCapability | null;
  /** The agent's default command from Settings, or null to derive from the catalog. */
  readonly baseCommand: string | null;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
}

export type ComposeResult =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly reason: string };

export function composeLaunchCommand(input: ComposeInput): ComposeResult;

/** Exported for the test and for Settings' help text. */
export function stripFlag(command: string, flag: string | null): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { composeLaunchCommand, stripFlag } from "./compose-launch-command";
import { runtimeFor } from "./runtime-catalog";

const CLAUDE = runtimeFor("claude");

describe("compose-launch-command", () => {
  it("appends model and effort to the agent's default command", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --dangerously-skip-permissions",
      modelId: "opus",
      reasoningEffort: "high",
    });
    expect(result).toEqual({
      ok: true,
      command: "claude --dangerously-skip-permissions --model opus --effort high",
    });
  });

  it("replaces a model flag the base command already carries", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --model sonnet --dangerously-skip-permissions",
      modelId: "opus",
      reasoningEffort: null,
    });
    expect(result).toEqual({
      ok: true,
      command: "claude --dangerously-skip-permissions --model opus",
    });
  });

  it("leaves the base untouched when nothing is selected", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --dangerously-skip-permissions",
      modelId: null,
      reasoningEffort: null,
    });
    expect(result).toEqual({ ok: true, command: "claude --dangerously-skip-permissions" });
  });

  it("drops an effort the agent has no flag for rather than inventing one", () => {
    const result = composeLaunchCommand({
      agentId: "codex",
      capability: runtimeFor("codex"),
      baseCommand: "codex",
      modelId: "gpt-5",
      reasoningEffort: "high",
    });
    expect(result).toEqual({ ok: true, command: "codex --model gpt-5" });
  });

  it("refuses an effort the agent's capability does not list", () => {
    const result = composeLaunchCommand({
      agentId: "agy",
      capability: runtimeFor("agy"),
      baseCommand: "agy --dangerously-skip-permissions",
      modelId: null,
      // agy's --help documents low|medium|high; "max" is a stale draft value
      // carried over from claude, and spec §8 step 3 says it must be refused.
      reasoningEffort: "max",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a model value the shell guard would reject", () => {
    const result = composeLaunchCommand({
      agentId: "cursor-agent",
      capability: runtimeFor("cursor-agent"),
      baseCommand: "cursor-agent --force",
      modelId: "claude-opus-4-8[context=1m]",
      reasoningEffort: null,
    });
    expect(result.ok).toBe(false);
  });

  it("strips a flag and its value only when the flag matches whole", () => {
    expect(stripFlag("claude --model opus --effort high", "--model")).toBe(
      "claude --effort high",
    );
    expect(stripFlag("claude --model-picker on", "--model")).toBe("claude --model-picker on");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/launcher/compose-launch-command.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Tokenize on whitespace. `stripFlag` removes a token equal to the flag plus the token after it;
a token that merely starts with the flag is left alone. Append `flag value` pairs only when
both the flag and the value exist. Run `commandProblem` on the result and return
`{ ok: false, reason }` with its message when it refuses.

**Spec §8 step 3 lives here, not in the draft.** Before composing, refuse a non-null
`reasoningEffort` that is absent from a non-empty `capability.efforts`, and a non-null
`modelId` absent from a non-empty merged model list. A stale draft value — `max` carried from
claude into agy, a model the user has since deleted from `agentModels` — is a `ok: false`
with a reason naming the agent, never a silently dropped flag. The capability's list being
EMPTY is not a refusal: it means the agent enumerates nothing, and T-G says the user's own
declared values are legitimate there.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/launcher/compose-launch-command.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/launcher/compose-launch-command.ts src/launcher/compose-launch-command.test.ts
git commit -m "feat(launcher): compose a launch command from the base plus runtime values" -- src/launcher/compose-launch-command.ts src/launcher/compose-launch-command.test.ts
```

---

### Task 5: The window-scoped draft store

**Files:**
- Create: `src/launcher/launcher-store.ts`
- Test: `src/launcher/launcher-store.test.ts`

**Interfaces:**

```ts
import { signal } from "@preact/signals";
import type { NewTaskDraft } from "./new-task-draft";

/** Where the launcher was raised from — decides the surface and the prefill. */
export type LauncherEntry =
  | { readonly surface: "board" }
  | { readonly surface: "quick"; readonly workspacePath: string | null };

export const newTaskDraft: import("@preact/signals").Signal<NewTaskDraft>;
export const quickLaunchOpen: import("@preact/signals").Signal<boolean>;
/** Non-null only while Quick Launch was raised for a specific project. */
export const quickLaunchWorkspace: import("@preact/signals").Signal<string | null>;

export function updateDraft(next: NewTaskDraft): void;
export function clearDraft(): void;
/**
 * Prefill a workspace WITHOUT overwriting an explicit agent choice — spec §4.1.
 * `seedAgentId` is the workspace's remembered agent already resolved against
 * the runnable list by the caller (Task 9); it is applied only while
 * `draft.agentId` is still null.
 */
export function prefillWorkspace(path: string | null, seedAgentId?: string | null): void;
export function openQuickLaunch(workspacePath: string | null): void;
export function closeQuickLaunch(): void;
/** Quick Launch → Open Board with the whole draft intact — spec §4.2. */
export function transferToBoard(): void;
export function resetLauncherStore(): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  closeQuickLaunch,
  newTaskDraft,
  openQuickLaunch,
  prefillWorkspace,
  quickLaunchOpen,
  quickLaunchWorkspace,
  resetLauncherStore,
  updateDraft,
} from "./launcher-store";
import { withAgent, withPrompt } from "./new-task-draft";

beforeEach(() => resetLauncherStore());

describe("launcher-store", () => {
  it("keeps the draft across closing and reopening quick launch", () => {
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    openQuickLaunch("/repo");
    closeQuickLaunch();
    openQuickLaunch(null);
    expect(newTaskDraft.value.prompt).toBe("ship it");
  });

  it("clears the pinned workspace when quick launch closes", () => {
    openQuickLaunch("/repo");
    expect(quickLaunchWorkspace.value).toBe("/repo");
    closeQuickLaunch();
    expect(quickLaunchOpen.value).toBe(false);
    expect(quickLaunchWorkspace.value).toBeNull();
  });

  it("prefills a workspace without touching an explicit agent choice", () => {
    updateDraft(withAgent(newTaskDraft.value, "codex", null));
    prefillWorkspace("/repo");
    expect(newTaskDraft.value.workspacePath).toBe("/repo");
    expect(newTaskDraft.value.agentId).toBe("codex");
  });

  it("clearDraft empties everything", () => {
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    clearDraft();
    expect(newTaskDraft.value.prompt).toBe("");
    expect(newTaskDraft.value.workspacePath).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/launcher/launcher-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Module-level signals (R5), window-scoped by construction. Every write assigns a new object.
`resetLauncherStore` exists for the tests and for the store's own teardown, matching
`resetSessionTailStore`'s precedent.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/launcher/launcher-store.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/launcher/launcher-store.ts src/launcher/launcher-store.test.ts
git commit -m "feat(launcher): add the window-scoped new-task draft store" -- src/launcher/launcher-store.ts src/launcher/launcher-store.test.ts
```

---

### Task 6: `TabManager.launchTask` and the readiness gate

**Files:**
- Create: `src/terminal/task-prompt-send.ts`
- Test: `src/terminal/task-prompt-send.test.ts`
- Modify: `src/terminal/tab-manager.ts` (beside `openQuickAgent`, ~line 860)
- Modify: `src/terminal/tab-manager-types.ts` (~line 170, beside `injectIntoPane`)
- Test: `src/terminal/tab-manager.launch-task.test.ts`

**Interfaces:**
- Consumes: `submitAllowed` + `SubmitGateInput` (`src/prompts/inject.ts`), `freshPaneInfo`
  (`src/terminal/pane-info.ts`), `MaterializeIntent` and `injectIntoPane` (this module).
- Produces:

```ts
// task-prompt-send.ts
export const TASK_PROMPT_READY_TIMEOUT_MS = 90_000;
export const TASK_PROMPT_POLL_MS = 500;

/** The gate that must open BEFORE any paste — see plan decision T-A. */
export function promptReadyToSend(input: SubmitGateInput): boolean;

export type LaunchTaskOutcome =
  | "started"          // tab up, no prompt asked for
  | "sent"             // tab up, prompt delivered and submitted
  | "prompt-pending"   // pasted but not submitted — TERMINAL, never retried (T-B)
  | "prompt-not-sent"  // readiness never arrived within the timeout
  | "prompt-failed"    // paste itself failed
  | "spawn-failed";    // the tab never materialized
```

```ts
// tab-manager-types.ts
launchTask(
  intent: MaterializeIntent,
  prompt: string | null,
): Promise<LaunchTaskOutcome>;
```

- [ ] **Step 1: Write the failing test for the predicate**

```ts
import { describe, expect, it } from "vitest";
import { promptReadyToSend } from "./task-prompt-send";

const IDLE = { phase: "idle", attention: "none", revision: 1 } as const;

describe("promptReadyToSend", () => {
  it("refuses a pane that is still a bare shell", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: { kind: "shell", agent: null, cwd: "/repo" } as never,
        attention: IDLE as never,
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane running a different agent", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: { kind: "agent", agent: "codex", cwd: "/repo" } as never,
        attention: IDLE as never,
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane that is still working", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: { kind: "agent", agent: "claude", cwd: "/repo" } as never,
        attention: { phase: "working", attention: "none", revision: 1 } as never,
        alive: true,
      }),
    ).toBe(false);
  });

  it("accepts an idle pane running the expected agent", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: { kind: "agent", agent: "claude", cwd: "/repo" } as never,
        attention: IDLE as never,
        alive: true,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/terminal/task-prompt-send.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the predicate**

`promptReadyToSend` delegates to `submitAllowed` unchanged. It exists as its own name because
the two calls answer different questions at different moments — *may I paste at all* versus
*may I press Enter* — and a future divergence must not silently change the Prompt Board.

- [ ] **Step 4: Run it green, then write the failing `launchTask` tests**

Build them on the harness already in `src/terminal/tab-manager.pane-actions.test.ts` — it
constructs a manager over a fake `PtyClient` and can drive `pty_info` answers, which is exactly
what the readiness poll consumes. Read that file first; do not build a second harness.

Five cases, each of which must assert on the **fake `PtyClient`'s `writePty` calls**, because
"never pasted" is the property that matters and only the write log proves it:

1. `materialize` fails (spawn rejects) → resolves `"spawn-failed"`, and `writePty` was never
   called with the prompt text.
2. `prompt` is `null` → resolves `"started"`; the poll never runs (assert `pty_info` was
   requested zero extra times) and `writePty` never carries the prompt.
3. `pty_info` answers `kind: "shell"` for the first two polls and then
   `kind: "agent", agent: "claude"` with an idle attention snapshot → resolves `"sent"`, and
   the prompt write happens only after the third answer. Drive the clock with
   `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync(TASK_PROMPT_POLL_MS)`.
4. `pty_info` answers `kind: "shell"` forever → advance past
   `TASK_PROMPT_READY_TIMEOUT_MS`, resolve `"prompt-not-sent"`, assert the prompt text was
   never written, and assert the tab is still in `manager.tabViews()`.
5. `injectIntoPane` is stubbed to resolve `"pasted"` → resolves `"prompt-pending"` and
   `injectIntoPane` was called exactly once (decision T-B: never retried).

- [ ] **Step 5: Implement `launchTask` in `tab-manager.ts`**

Placed beside `openQuickAgent`. Sequence, matching spec §8:

1. `await materialize(intent)`; `false` → `"spawn-failed"`.
2. `prompt === null` → `"started"`.
3. Read the pane id from the tab just materialized (`tabs[tabs.length - 1].manager.paneIds()[0]`)
   — this id never leaves the closure.
4. Poll every `TASK_PROMPT_POLL_MS` up to `TASK_PROMPT_READY_TIMEOUT_MS`:
   `freshPaneInfo([paneId], pty, agentProcessMatchers(settings.value.customAgents))` plus
   `paneAttention(paneId)` plus an aliveness check, fed to `promptReadyToSend`.
5. Timeout → `"prompt-not-sent"`. **No paste has happened.**
6. Gate open → `injectIntoPane(paneId, prompt, { autoSend: true, expectedAgent: intent.agent })`
   ONCE. Map `"sent"` → `"sent"`, `"pasted"` → `"prompt-pending"`, everything else →
   `"prompt-failed"`.

Add `launchTask` to `tab-manager-types.ts` and to the returned object (~line 2112, beside
`injectIntoPane`).

- [ ] **Step 6: Run the terminal suites**

```bash
npx vitest run src/terminal/task-prompt-send.test.ts src/terminal/tab-manager.launch-task.test.ts src/terminal/tab-manager.pane-actions.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/terminal/task-prompt-send.ts src/terminal/task-prompt-send.test.ts src/terminal/tab-manager.ts src/terminal/tab-manager-types.ts src/terminal/tab-manager.launch-task.test.ts
git commit -m "feat(terminal): launchTask materializes a pane and sends the first prompt once" -- src/terminal/task-prompt-send.ts src/terminal/task-prompt-send.test.ts src/terminal/tab-manager.ts src/terminal/tab-manager-types.ts src/terminal/tab-manager.launch-task.test.ts
```

---

### Task 7: Shared launcher fields

**Files:**
- Create: `src/launcher/launcher-fields.tsx`
- Test: `src/launcher/launcher-fields.test.tsx`

Ported from the approved gallery mock's `LauncherFields` / `PromptField` / `WorkspaceSelect` /
`AgentSelect` / `RuntimeSelect` (`src/gallery/sections/board-section.tsx:288-368`), with the
fiction replaced by real data: the agent list from `agentOptions(detected, customAgents,
disabledAgents)`, the runtime options from `runtimeOptions`, the workspace list from
`workspacesData.value.recents`.

**Interfaces:**

```ts
export interface LauncherFieldsProps {
  readonly idPrefix: string;
  readonly compact: boolean;
  readonly draft: NewTaskDraft;
  /** `AgentOption` is the existing type from `src/lib/agent-catalog.ts`. */
  readonly agents: readonly AgentOption[];
  readonly recents: readonly RecentWorkspace[];
  readonly declaredModels: Readonly<Record<string, readonly string[]>>;
  /**
   * `settings.agentRuntimeDefaults`. The SETTINGS default wins over the
   * catalog seed (spec §3.5, §7), so this component merges the two before it
   * calls `withAgent` — `withAgent` itself only ever sees one finished
   * capability, which is what keeps `new-task-draft.ts` free of the settings
   * store. `mergeRuntimeDefaults(capability, agentRuntimeDefaults[agentId])`
   * lives in `runtime-catalog.ts` beside `runtimeFor`.
   */
  readonly agentRuntimeDefaults: Readonly<
    Record<string, { readonly model: string | null; readonly effort: string | null }>
  >;
  readonly canCreateWorktree: boolean;
  readonly pending: LauncherPending | null;
  readonly problem: DraftProblem | null;
  onDraftChange(next: NewTaskDraft): void;
  onPickFolder(): void;
  onCreateWorkspace(): void;
  onCreateWorktree(): void;
  onManageAgents(): void;
}

export type LauncherPending =
  | "picking-folder"
  | "creating-workspace"
  | "creating-worktree"
  | "opening-agent"
  | "sending-prompt";
```

Rules the tests assert (spec §4.1, §9, §10):

- no `Workspace` / `Agent` / `Model` / `Effort` label text is rendered — identity is the folder
  icon + name and the agent logo + name;
- the runtime select is absent entirely when `runtimeOptions` is empty (DL-19.7);
- an `agent-unavailable` problem renders `Manage agents…` and disables both launch actions;
- errors carry `role="alert"` when the user must act.

- [ ] **Step 1: Write the failing component tests** covering the four rules above.
- [ ] **Step 2: Run and watch them fail.**

```bash
npx vitest run src/launcher/launcher-fields.test.tsx
```

- [ ] **Step 3: Implement, porting the markup from the gallery mock.**
- [ ] **Step 4: Run green.**

```bash
npx vitest run src/launcher/launcher-fields.test.tsx && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/launcher/launcher-fields.tsx src/launcher/launcher-fields.test.tsx
git commit -m "feat(launcher): add the shared prompt composer and context toolbar" -- src/launcher/launcher-fields.tsx src/launcher/launcher-fields.test.tsx
```

---

### Task 8: The Open Board composer body

**Files:**
- Create: `src/open-board/board-composer.tsx`
- Test: `src/open-board/board-composer.test.tsx`

The composer is `LauncherFields` at `compact={false}` with `Recent Workspaces` below it, plus
the two actions: `Start task` (primary, requires a non-empty prompt) and `Open agent first`
(secondary, no prompt sent). The prompt is always visible — the collapse control is Quick
Launch's only.

Tests assert:

- `Start task` is disabled while the prompt is empty and enabled once it is not;
- clicking a recents row calls `onSelectWorkspace` and never `onStartTask`;
- `⌘Enter` inside the prompt field calls `onStartTask` once;
- `Open agent first` calls `onOpenAgent` with the draft's prompt ignored.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/open-board/board-composer.tsx src/open-board/board-composer.test.tsx
git commit -m "feat(open-board): add the prompt-first task composer" -- src/open-board/board-composer.tsx src/open-board/board-composer.test.tsx
```

---

### Task 9: Open Board rewire — select, don't launch

**Files:**
- Modify: `src/open-board/open-board.tsx` — `openWorkspace()`, `pickFolder()`,
  `submitWorktree()`, `OpenBoardProps`
- Modify: `src/open-board/open-board-home.tsx` — the composer takes the top of the reading order
- Test: `src/open-board/open-board.views.test.tsx`, `open-board.worktree-flow.test.tsx`,
  `open-board.removal.test.tsx`

This is the reversal recorded in decision T-K.

- [ ] **Step 1: Invert the existing assertions**

`open-board.views.test.tsx` currently asserts that a row click calls `onOpen`. Change it to
assert the row click calls `onSelectWorkspace` and that `onStartTask` is NOT called. Add three:
the liveness guard still fires (`missing` still blocks selection with the notice); selecting a
row whose `lastAgent` is runnable seeds that agent into the draft; and selecting a row whose
`lastAgent` is not runnable seeds the first runnable one instead of leaving the field empty.

- [ ] **Step 2: Run and watch them fail.**

```bash
npx vitest run src/open-board/
```

- [ ] **Step 3: Rewrite `openWorkspace` as `selectWorkspace`, and seed the agent from it**

Keep the `dirs_exist` liveness await — a dead folder must still be refused at selection time,
so the composer never carries a path that cannot spawn. Delete the `presets` /
`resolveAgentChoice` resolution from this path: the agent now comes from the draft, and the
long comment block explaining one-click-opens is replaced by one explaining that a row fills
the field.

**Spec §7's "last-used runnable agent for the selected workspace is preferred" lives here.**
Selecting a workspace seeds `draft.agentId` through the existing
[`agentForWorkspace`](../../src/lib/workspace-recents.ts) helper, resolved against the runnable
list: a remembered agent that is disabled or off `$PATH` falls to the first runnable one, and
because selection is now a step BEFORE launch, that substitution is **visible in the toolbar
before the user can press anything** — which is the half the 2026-08-16 one-click flow could
not offer and why it fell back silently. A workspace the user has never opened seeds the
`defaultAgent` setting, else the first runnable agent.

The seed must not overwrite a deliberate choice: if the user already picked an agent in this
draft, selecting a workspace leaves it alone (spec §4.1, "it does not silently overwrite an
explicit agent selection"). Track that with a draft field-level rule in `prefillWorkspace` —
seed only while `draft.agentId` is still `null`.

`OpenBoardProps` becomes:

```ts
onStartTask(draft: NewTaskDraft): Promise<LaunchTaskOutcome>;
onOpenAgent(draft: NewTaskDraft): Promise<LaunchTaskOutcome>;
```

`onOpen(workspace, preset, agent)` is removed. `onResumeSession` is untouched.

- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/open-board/
git commit -m "feat(open-board): a recents row fills the workspace field instead of launching" -- src/open-board/
```

---

### Task 10: `App` wiring

**Files:**
- Modify: `src/ui/app.tsx` — the `<OpenBoard>` mount
- Test: `src/ui/app.test.tsx`

- [ ] **Step 1: Write the failing tests** — (a) `onStartTask` reaches
  `tabsRef.current.launchTask` with the composed command and the draft's prompt; (b) a
  `"prompt-pending"` outcome leaves the draft intact while surfacing a message; (c) a
  successful launch calls `recordWorkspaceOpen` with the workspace and the agent that actually
  launched; (d) a `"spawn-failed"` launch does NOT call it.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement**

`App` builds the `MaterializeIntent` — `layout: BUILT_IN_PRESET.layout`, `cwds: [workspacePath]`,
`agent: draft.agentId`, `workspacePath`, and `launchCommand` from `composeLaunchCommand` — then
calls `launchTask`. `"sent"` and `"started"` clear the draft and close the surface; every other
outcome keeps both and reports through the board's existing `notice` line.

**Re-point the recents write.** `recordWorkspaceOpen(workspace, preset.id, agent)` sits at
[`src/ui/app.tsx:964`](../../src/ui/app.tsx) inside the `onOpen` handler Task 9 deletes. Move
the call into this handler, on a successful outcome only, carrying the workspace and the agent
that launched. Dropping it would leave recents ordering, the `describeCombo` hover line and the
next selection's agent seed all frozen at whatever they were before this work — a silent
staleness with no failing test unless one is written, which is why Step 1 asks for cases (c)
and (d).

- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/ui/app.test.tsx
git commit -m "feat(app): wire the Open Board composer to launchTask" -- src/ui/app.tsx src/ui/app.test.tsx
```

---

## P1 — Quick Launch, subviews, Settings

### Task 11: The Quick Launch popover

**Files:**
- Create: `src/launcher/quick-launch.tsx`
- Test: `src/launcher/quick-launch.test.tsx`
- Modify: `src/chrome/events.ts` — re-export the store's `quickLaunchOpen` in the doc comment
  block beside `promptsOpen`, so the genre is documented in one place

Built on decision T-E: **not** `Modal`. No scrim, no `backdrop-filter`, no focus trap, not in
`openOverlayRanks()`.

Tests assert:

- a pointer press outside the panel does NOT close it (spec §4.2: the terminal stays usable);
- `Esc` closes it — a document-level capture listener, the `Modal` fix from 2026-08-19, but
  local to this component;
- pressing the trigger again closes it;
- collapsed → the primary action reads `Open agent` and no prompt is sent;
- expanded → the primary action reads `Start task`;
- the expanded/collapsed choice writes `quickLaunchPromptExpanded` and survives a close/reopen;
- `Open full composer` calls `transferToBoard` and the draft arrives whole.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/launcher/quick-launch.tsx src/launcher/quick-launch.test.tsx src/chrome/events.ts
git commit -m "feat(launcher): add the non-modal Quick Launch popover" -- src/launcher/quick-launch.tsx src/launcher/quick-launch.test.tsx src/chrome/events.ts
```

---

### Task 12: Entry-point rewires

**Files:**
- Modify: `src/terminal/tab-manager.ts` — `newTab()` (~line 744)
- Modify: `src/ui/agent-rail.tsx` — the project header `+`
- Modify: `src/ui/app.tsx` — mount `QuickLaunch`, add `quickLaunchUnavailable()`
- Test: `src/terminal/tab-manager.tab-lifecycle.test.ts`, `src/ui/agent-rail.test.tsx`,
  `src/ui/app.test.tsx`

Per spec §5:

| Entry point | Raises | Workspace prefill |
| --- | --- | --- |
| `⌘T` / strip `+` | Quick Launch | active tab's workspace |
| rail project header `+` | Quick Launch | that project's workspace |
| `New` / cold start | Open Board | active, else most recent |

`newTab()` sets `quickLaunchWorkspace` to `null` then `quickLaunchOpen` to `true` — the same
clear-first discipline the existing body uses, and for the same reason. `agentQuickPickerOpen`
is left in place but no longer raised.

`quickLaunchUnavailable()` in `App` mirrors `promptsUnavailable()` and adds the browser case
from decision T-F: while the browser surface holds the stage, the trigger reports unavailable
and an open popover closes.

- [ ] **Step 1: Write the failing tests** — one per entry point, asserting the prefill.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/terminal/tab-manager.ts src/ui/agent-rail.tsx src/ui/app.tsx
git commit -m "feat(launcher): route every contextual entry point to Quick Launch" -- src/terminal/tab-manager.ts src/ui/agent-rail.tsx src/ui/app.tsx
```

---

### Task 13: The `create_directory` channel

**Files:**
- Modify: `electron/ipc/channels.ts` — `createDirectory: "create_directory"` beside `worktreeAdd`
- Modify: `electron/main.ts` — the handler
- Modify: `electron/preload.ts` — the bridge entry
- Create: `src/host/workspace-create-host.ts` — the facade with an `available` flag
- Modify: `scripts/electron-ipc-contract.test.ts`
- Test: `src/host/workspace-create-host.test.ts`

Payload is flat (R6): `{ parent: string, name: string }` → `{ path: string }`.

Main-process rules, mirroring `worktree_add`:

- reject a `name` containing a path separator, `..`, or a leading `.`;
- reject a `parent` that does not exist or is not a directory;
- `fs.mkdir` with `recursive: false` so an existing directory is an error, not a silent success;
- never build a shell string.

- [ ] **Step 1: Write the failing contract and facade tests.**
- [ ] **Step 2: Run and watch them fail.**

```bash
npx vitest run scripts/electron-ipc-contract.test.ts src/host/workspace-create-host.test.ts
```

- [ ] **Step 3: Implement all four halves.**
- [ ] **Step 4: Run green + both typechecks.**

```bash
npx vitest run scripts/electron-ipc-contract.test.ts src/host/workspace-create-host.test.ts \
  && npx tsc --noEmit && npx tsc -p tsconfig.electron.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/channels.ts electron/main.ts electron/preload.ts src/host/workspace-create-host.ts src/host/workspace-create-host.test.ts scripts/electron-ipc-contract.test.ts
git commit -m "feat(electron): add the create_directory channel for the workspace subview" -- electron/ipc/channels.ts electron/main.ts electron/preload.ts src/host/workspace-create-host.ts src/host/workspace-create-host.test.ts scripts/electron-ipc-contract.test.ts
```

---

### Task 14: Workspace subviews return instead of opening

**Files:**
- Create: `src/open-board/create-workspace-form.tsx`
- Test: `src/open-board/create-workspace-form.test.tsx`
- Modify: `src/open-board/use-worktree-form.ts`, `src/open-board/open-board.tsx`
- Test: `src/open-board/open-board.worktree-flow.test.tsx`

Spec §6. `submitWorktree` currently calls `openWorkspace(path)` — "open now". It becomes
"select and return": fill the draft's workspace, go back to the parent surface, keep the prompt
and the agent.

- [ ] **Step 1: Invert the worktree-flow assertion** — success must NOT call the launch path.
- [ ] **Step 2: Write the create-workspace-form tests** — parent + name validation, an inline
  error on failure that keeps the subview up, success returning to the parent surface.
- [ ] **Step 3: Run and watch them fail.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run green + typecheck.**
- [ ] **Step 6: Commit**

```bash
git add src/open-board/
git commit -m "feat(open-board): workspace subviews select the directory and return" -- src/open-board/
```

---

### Task 15: Settings fields

**Files:**
- Modify: `src/settings/settings-schema.ts` (fields ~line 100, defaults ~line 190,
  validation ~line 450)
- Test: `src/settings/settings-schema.test.ts`

The three fields from decision T-I, each with a drop-not-repair validator following
`validateRailOrder` / `validateDefaultLaunchProfiles`.

- [ ] **Step 1: Write the failing tests** — a malformed `agentModels` entry is dropped rather
  than repaired; an `agentRuntimeDefaults` entry naming an agent with no runtime capability is
  dropped; `quickLaunchPromptExpanded` defaults to `true`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/settings/settings-schema.ts src/settings/settings-schema.test.ts
git commit -m "feat(settings): add agent model, runtime default and prompt-memory fields" -- src/settings/settings-schema.ts src/settings/settings-schema.test.ts
```

---

### Task 16: Settings → Agents clarity

**Files:**
- Modify: the agents section under `src/ui/settings/sections/`
- Test: the matching section test

Spec §7. Two groups whose copy states the difference outright:

- **`Add agent`** declares a new CLI identity (a binary Deck can run).
- **`Add command`** saves another way to launch an identity that already exists.

Each installed row gains the model list editor (`agentModels`) and the default model/effort
selects (`agentRuntimeDefaults`), shown only for an agent whose catalog entry has the matching
flag. Help text states the `COMMAND_SAFE` limit from decision T-H: a model value needing quotes
or brackets must be declared as a launch command or a custom agent instead.

- [ ] **Step 1: Write the failing tests** — the two group headings exist with distinct copy; an
  agent with `effortFlag: null` renders no effort control; an `Available to install` row offers
  no default-model control.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add src/ui/settings/
git commit -m "feat(settings): separate agent identities from saved commands and add runtime defaults" -- src/ui/settings/
```

---

## P2 — cleanup and hardening

### Task 17: DL §32 and the production stylesheet

**Files:**
- Modify: `docs/DESIGN-LANGUAGE.md` — append `## 32. The task launcher`
- Create: `src/styles/18-new-task-launcher.css` (promoted from
  `src/gallery/sections/new-task-launcher-section.css`)
- Modify: `src/styles.css`
- Test: `scripts/design-language.test.ts`

§32 takes the next free number — §31 is the current highest and this rulebook appends rather
than filling a gap (§22 stays reserved). Rules to write:

- **DL-32.1** the composer is the focal artifact of the Open Board: strongest scale, central
  position, prompt always visible;
- **DL-32.2** the context toolbar prints identity, never field labels — folder icon + name,
  agent logo + name;
- **DL-32.3** model and effort are ONE composite `menu` control showing only its current value;
- **DL-32.4** Quick Launch is a raised chrome tool, not a dialog: no scrim, no blur, no focus
  trap, no overlay rank — the `promptsOpen` genre, explicitly not DL §29's;
- **DL-32.5** a launcher control with nothing to offer is omitted, not disabled (DL-19.7
  applied to the runtime select).

- [ ] **Step 1: Write the DL rules and the failing gate assertions.**
- [ ] **Step 2: Run and watch them fail.**

```bash
npx vitest run scripts/design-language.test.ts
```

- [ ] **Step 3: Promote the gallery CSS**

Copy the sheet, rename `nt-` selectors only if a collision exists, register it in
`src/styles.css`. The gallery keeps its own copy — R7 runs app → gallery, never the reverse.

- [ ] **Step 4: Run green + `npm run build`.**
- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN-LANGUAGE.md src/styles/18-new-task-launcher.css src/styles.css scripts/design-language.test.ts
git commit -m "feat(design-language): add section 32 for the task launcher" -- docs/DESIGN-LANGUAGE.md src/styles/18-new-task-launcher.css src/styles.css scripts/design-language.test.ts
```

---

### Task 18: Keyboard, focus, pending and errors

**Files:** the launcher files, plus their tests.

Spec §9, one test each:

- [ ] `⌘Enter` starts a task from the prompt field, and does nothing while the prompt is empty.
- [ ] `Esc` in a subview returns to the parent launcher; the next `Esc` closes a cancellable
      surface. On the Open Board at cold start (`canCancel: false`) the second `Esc` does nothing.
- [ ] A pending launch disables the competing launch action and leaves the draft intact.
- [ ] Closing a launcher returns focus to its trigger when that trigger still exists.
- [ ] The native folder picker and a Settings round-trip restore focus to the field that
      launched them, and the draft survives both (spec §4.3).
- [ ] Every error that needs user action carries `role="alert"`.
- [ ] **Commit**

```bash
git add src/launcher/ src/open-board/
git commit -m "feat(launcher): complete the keyboard, focus and error contract" -- src/launcher/ src/open-board/
```

---

### Task 19: Retire the superseded mounts

**Files:** `src/ui/app.tsx`, `src/terminal/tab-manager.ts`, plus tests.

Spec §11: `AgentQuickPicker` is superseded **only after** every contextual entry point uses
Quick Launch — which Task 12 delivered. Its mount is removed; the component, its test and
`agentQuickPickerOpen` stay in the tree and keep building, so the revert is re-mounting one
component. `openQuickAgent` stays: it is still the shortest path from a picked agent to a pane
and `launchTask` builds on the same `materialize`.

- [ ] **Step 1: Write the failing test** — `⌘T` raises Quick Launch and `AgentQuickPicker` is
      not in the tree.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Remove the mount only.**
- [ ] **Step 4: Run green; confirm `agent-quick-picker.test.tsx` still passes untouched.**
- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/terminal/tab-manager.ts
git commit -m "refactor(launcher): unmount AgentQuickPicker now Quick Launch owns every entry point" -- src/ui/app.tsx src/terminal/tab-manager.ts
```

---

### Task 20: Documentation

**Files:** `AGENTS.md`, `docs/CONTEXT.md`.

- [ ] **Step 1: Add the `## Current direction` bullet** stating what shipped, which host it
      runs on, and the exact evidence class reached — the honesty discipline every other bullet
      follows.
- [ ] **Step 2: Add the drift rows**

| Claim | Intent | Status |
| --- | --- | --- |
| The task launcher composes and sends a first prompt | `building` | unverified until a native `electron:dev` pass |
| One click on the open board opens the workspace | `current` | **false** — reversed by this work (decision T-K) |
| A launcher can select a non-default launch command | `current` | **false** — spec §13 puts it out of scope |

- [ ] **Step 3: Add a `docs/CONTEXT.md` section** with the anchors and intent labels D6 requires.
- [ ] **Step 4: Run the doc gates**

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

- [ ] **Step 5: Ask the owner to review before committing docs (D14), then commit.**

```bash
git add AGENTS.md docs/CONTEXT.md
git commit -m "docs(context): record the new task launcher" -- AGENTS.md docs/CONTEXT.md
```

---

## Verification

Run before claiming any task complete (W4 — paste the output, do not summarize it):

```bash
npx tsc --noEmit
npx tsc -p tsconfig.electron.json --noEmit
npm test
npm run build
npm run lint
npm run generate:menu:check
```

`generate:menu:check` is included even though decision T-K expects no registry change — it is
the cheap proof that expectation held.

**Evidence class this work can reach without the owner:** suite, typecheck, build, lint, and a
gallery pass. **Owed and to be named in `AGENTS.md`'s drift table:** a native
`npm run electron:dev` pass — nothing here has spawned a real agent, waited for a real
readiness gate or sent a real first prompt — and the owner's eye review of the running app.
Windows remains Gate C. Tauri gets the renderer halves for free and the Electron-only halves
not at all; say which, rather than implying both.

**Concurrent-session hazard:** this checkout is shared. Attribute any failing test against a
pristine `HEAD` worktree before treating it as this work's (see the workspace's own note on
concurrent sessions).

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| §3.1 Task | T2, T6, T8 |
| §3.2 Workspace | T9, T13, T14 |
| §3.3 Agent | T2, T7, T16 |
| §3.4 Launch command | T4, T16 |
| §3.5 Model and effort | T3, T4, T15, T16 |
| §4.1 Open Board composer | T7, T8, T9, T10 |
| §4.2 Quick Launch | T11, T12 |
| §4.3 Shared draft | T5, T11, T14, T18 |
| §5 Entry-point mapping | T12 |
| §6 Workspace subviews | T13, T14 |
| §7 Agent selection and Settings | T2, T15, T16 |
| §8 Launch and materialization | T6, T10 |
| §9 Feedback, focus, keyboard | T18 |
| §10 Visual direction | T17 (Gallery already approved) |
| §11 Architecture boundary | T2–T7, T11, T19 |
| §12 Priority order | the P0/P1/P2 grouping above |
| §13 Out of scope | nothing implements it; T20 records the two losses as drift |
| §14 Acceptance criteria | T18 and the verification block |
