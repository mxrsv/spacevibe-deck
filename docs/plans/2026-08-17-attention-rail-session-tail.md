# Attention Rail — Session Tail + Quiet Dim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the owner-approved attention-first rail treatment (every row shows the
agent's newest turn; quiet rows dim) into Deck Electron, backed by the tier-3
`session_tail` IPC the rail spec already designed, plus an owner-tuned `--sidebar-bg`
derive retune.

**Architecture:** Three seams move. (1) The pure rail model
(`src/ui/agent-rail-model.ts`) accepts a `paneId → tail` map and prefers it over the
custom-name fallback; the renderer draws the message line on every row and marks quiet
rows for CSS dimming. (2) A new Electron main-process module resolves each agent pane to
its session file through the existing resume scanners, reads the file backwards, and
returns the newest assistant turn over a new flat `session_tail` channel; a
window-scoped renderer store refreshes tails when a pane's `changedAt` moves — never on
a timer. (3) `deriveChromeColors` gets one owner-picked constant change for the sidebar
surface.

**Tech Stack:** Preact + signals (renderer), Electron ipcMain/ipcRenderer (invoke
bridge), Vitest, plain CSS on the DL token system.

**Spec:** `docs/specs/2026-08-16-agent-status-rail-design.md` — tier 3 design in §5
("Tier 3 — the message line") and §10 (verification). This plan supersedes two frozen
decisions, both on the owner's explicit ask (2026-08-17, gallery review session):

- **§2.6's "a message line is exceptional (asked/failed only)" is superseded.** The
  approved treatment is the gallery hybrid: every row spends a second line on its
  newest turn (variant A) AND quiet rows take the archived row's faint treatment
  (variant B). Approved from rendered specimens in `src/gallery/sections/attention-direction.tsx`.
- **§10's sequencing gate ("tier 1 native pass before tier 3 starts") is waived by the
  owner.** The tier-1 rail has been in the owner's daily native use since 2026-08-16
  and the treatment was eye-reviewed in the gallery on 2026-08-17. The native
  eye-review still happens — as this plan's Task 8 gate, before the docs close.

## Global Constraints

- **R1:** every string, comment, commit message and doc line is English.
- **R6:** IPC payloads stay flat — `invoke("session_tail", { requests })`, mirroring
  `resume_lookup`; `scripts/electron-ipc-contract.test.ts` scans handlers vs invokes
  automatically and must stay green.
- **R2:** chrome styling cites DL rules in comments; DL amendments land in Task 9, in
  the same plan as the code they govern.
- **Electron only.** No Tauri work. On Tauri (and in the browser gallery) the rail
  degrades to today's behavior: `message` falls back to the custom tab name.
- **Shared dirty checkout:** other sessions work in this tree. Every commit stages
  explicit paths (`git commit -- <paths>`), never `git add .` / `git commit -a`.
- **No new dependencies.**
- **Verification gauntlet (spec §10):** `npm test && npm run build && npm run generate:menu:check`,
  plus `npm run electron:build` for every task that touches `electron/`.
- **Docs are committed only after the owner approves their content (D14).**

## File Structure

| File                                                                           | Role                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/ui/agent-rail-model.ts` (modify)                                          | pure model: tails in, `message` precedence                 |
| `src/ui/agent-rail-model.test.ts` (modify)                                     | model precedence tests                                     |
| `src/ui/agent-rail.tsx` (modify)                                               | render message line on every row; `data-quiet`; leaf tails |
| `src/styles/04a-agent-rail.css`, `src/styles/04b-agent-rail-rows.css` (modify) | quiet-dim + tail tones (DL-27.15)                          |
| `electron/resume/head.ts` (modify)                                             | `CandidateSession.filePath?`, `tailBytes()`                |
| `electron/resume/claude.ts`, `electron/resume/codex.ts` (modify)               | set `filePath` on candidates                               |
| `electron/resume/session-tail.ts` (create)                                     | resolve pane → file, backwards read, turn extraction       |
| `electron/resume/session-tail.test.ts` (create)                                | parser + resolution tests                                  |
| `electron/ipc/channels.ts`, `electron/ipc/register-services.ts` (modify)       | `session_tail` channel                                     |
| `src/host/session-tail-host.ts` (create)                                       | renderer facade over the bridge                            |
| `src/terminal/session-tail-store.ts` (create)                                  | `paneTails` signal + revision-driven sync                  |
| `src/terminal/session-tail-store.test.ts` (create)                             | sync trigger tests                                         |
| `src/ui/app.tsx` (modify)                                                      | install the sync once per window                           |
| `src/lib/derive-colors.ts`, `src/lib/derive-colors.test.ts` (modify)           | sidebar mix retune (owner-picked value)                    |
| `src/gallery/sections/attention-direction.tsx` (modify)                        | trim to the promoted variant                               |
| `docs/DESIGN-LANGUAGE.md`, `AGENTS.md`, `docs/CONTEXT.md` (modify)             | Task 9                                                     |

---

### Task 1: Model — tails enter `buildAgentRail`

**Files:**

- Modify: `src/ui/agent-rail-model.ts`
- Test: `src/ui/agent-rail-model.test.ts`

**Interfaces:**

- Produces: `AgentRailInput.tails?: ReadonlyMap<number, string>` (paneId → newest
  turn). `RailPaneRow.message` and `RailTabRow.message` prefer the tail; the
  custom-name fallback (`messageOf`) remains when no tail exists.

- [ ] **Step 1: Write the failing tests** (extend the existing suite with its own
      builders — the file already constructs `TabView` fixtures; follow its local helpers)

```ts
describe("session tails", () => {
  it("prefers a pane's tail over the custom-name fallback", () => {
    // one agent pane, paneId 101, tab customName "review"
    const view = buildAgentRail({
      ...baseInput(),
      tails: new Map([[101, "Permission needed: prisma migrate dev"]]),
    });
    const row = view.stream[0].rows[0];
    expect(row.message).toBe("Permission needed: prisma migrate dev");
    expect(row.panes[0].message).toBe("Permission needed: prisma migrate dev");
  });

  it("keeps the custom-name fallback when no tail exists", () => {
    const view = buildAgentRail({ ...baseInput(), tails: new Map() });
    expect(view.stream[0].rows[0].message).toBe("review");
  });

  it("keeps working without the tails input at all", () => {
    const view = buildAgentRail(baseInput());
    expect(view.stream[0].rows[0].message).toBe("review");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/ui/agent-rail-model.test.ts`
      → FAIL (`tails` unknown / message mismatch).

- [ ] **Step 3: Implement.** In `agent-rail-model.ts`:
  - `AgentRailInput` gains `readonly tails?: ReadonlyMap<number, string>`.
  - The pane-row builder sets
    `message: input.tails?.get(pane.paneId) ?? fallbackMessage` (the current per-pane
    message expression becomes the fallback).
  - `RailTabRow.message`: `voice`'s tail when present, else the current
    `messageOf(railTab)` result. Keep the function pure; no clock, no IO.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rail): thread session tails through the rail model" \
  -- src/ui/agent-rail-model.ts src/ui/agent-rail-model.test.ts
```

---

### Task 2: Renderer — message line on every row, quiet rows marked

**Files:**

- Modify: `src/ui/agent-rail.tsx`

**Interfaces:**

- Consumes: `RailTabRow.message` / `RailPaneRow.message` from Task 1.
- Produces: `data-quiet="true"` on `.asr-row--tab` and `.asr-leaf--flat` for states
  `working | done | idle`; `<span class="asr-row__msg">` rendered whenever
  `message !== ""` (all states); flat leaves render
  `<span class="asr-leaf__msg">{pane.message}</span>` under the same condition.

- [ ] **Step 1: Change the render conditions.** In `TabItem`:
  - Replace the `actionableMessage` gate: `const showMessage = row.message !== "";`
    and render `{showMessage && <MessageLine text={row.message} />}`.
  - Add `data-quiet={row.state !== "asked" && row.state !== "failed"}` to the
    `.asr-row--tab` div.
  - In the flat-leaf branch, add `data-quiet` the same way (from `pane.state`) and,
    after the mark, render
    `{pane.message !== "" && <span class="asr-leaf__msg">{pane.message}</span>}`.
  - Keep `title` composition unchanged — the full sentence already travels there.

- [ ] **Step 2: Run the rail component tests** — `npx vitest run src/ui/agent-rail`
      (fix any assertion that counted on the asked/failed-only message line; update those
      assertions to the new contract, do not weaken unrelated ones).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(rail): message line on every row, quiet rows marked" \
  -- src/ui/agent-rail.tsx src/ui/agent-rail.test.tsx
```

---

### Task 3: CSS — the quiet dim and tail tones (DL-27.15 values)

**Files:**

- Modify: `src/styles/04b-agent-rail-rows.css` (rows), `src/styles/04a-agent-rail.css`
  (only if `.asr-leaf__msg` fits better beside `.asr-row__msg` there — follow where
  `.asr-row__msg` lives today, which is `04a`)

**Interfaces:**

- Consumes: `data-quiet` from Task 2.
- Produces: the owner-approved values from the gallery hybrid — quiet name
  `--text-faint` at weight 480, quiet glyph opacity 0.45, quiet tail `--text-faint`,
  loud tail stays `--text-muted`.

- [ ] **Step 1: Add the rules** (comments cite DL-27.15, added in Task 9):

```css
/* DL-27.15: a quiet row (working/done/idle) takes the archived row's faint
   treatment — the derived tone ladder is too tight for a one-step dim to
   read (primary 207 → muted 183 measured on tokyo-night, 2026-08-17). The
   state mark keeps full colour: state is meaning, not emphasis. */
.asr-row--tab[data-quiet="true"] .asr-row__name strong {
  color: var(--text-faint);
  font-weight: 480;
}

.asr-row--tab[data-quiet="true"] .asr-chip__logo {
  opacity: 0.45;
}

.asr-row--tab[data-quiet="true"] .asr-row__msg {
  color: var(--text-faint);
}

.asr-leaf--flat[data-quiet="true"] .asr-leaf__agent {
  color: var(--text-faint);
  font-weight: 480;
}

.asr-leaf--flat[data-quiet="true"] .asr-leaf__logo {
  opacity: 0.45;
}

/* The leaf's own turn line: same shape as .asr-row__msg, full width under
   the leaf's flex row (DL-27.4 trimming contract — layout, never slicing). */
.asr-leaf__msg {
  flex-basis: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font: 450 var(--type-meta) / 1.35 var(--ui-font);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asr-leaf--flat[data-quiet="true"] .asr-leaf__msg {
  color: var(--text-faint);
}
```

`.asr-leaf` is `display: flex` — add `flex-wrap: wrap` to `.asr-leaf--flat` so the
message line wraps under the name row instead of stretching it.

- [ ] **Step 2: Look at it.** `npm run prototype:gallery` → navigation section (the
      real rail on seeded stores). The seeded tabs have custom names, so rows show
      fallback lines; quiet rows must visibly dim. Screenshot for the record.

- [ ] **Step 3: Run the style-adjacent suites** — `npx vitest run src/ui` → PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(rail): quiet-dim treatment and per-leaf tail line (DL-27.15)" \
  -- src/styles/04a-agent-rail.css src/styles/04b-agent-rail-rows.css
```

---

### Task 4: Electron — tail extraction (`session-tail.ts`)

**Files:**

- Modify: `electron/resume/head.ts`, `electron/resume/claude.ts`,
  `electron/resume/codex.ts`
- Create: `electron/resume/session-tail.ts`
- Test: `electron/resume/session-tail.test.ts`

**Interfaces:**

- Consumes: `CandidateSession`, `SCANNERS`-style per-agent candidate scans,
  `ResumeRequest` / `validateResumeRequests` from `electron/resume/resolve.ts`.
- Produces:
  - `CandidateSession.filePath?: string` (absolute path of the session file; set by
    the claude and codex scanners where the path is already in hand — additive,
    optional, no other scanner changes).
  - `tailBytes(filePath: string, cap: number): Buffer | null` in `head.ts` — the
    mirror of `headBytes`, reading the LAST `cap` bytes (lstat-guarded identically).
  - `resolveSessionTails(home: string, requests: readonly (ResumeRequest | null)[]): (string | null)[]`
    — positional, never throws, one tail (≤ 160 chars, single line) or null per entry.

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import { claudeTailFromLines, codexTailFromLines } from "./session-tail";

describe("claudeTailFromLines", () => {
  it("returns the newest assistant text, skipping tool-use-only turns", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: "run the tests" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Running the vitest suite — 214 of 2619" },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
    ];
    expect(claudeTailFromLines(lines)).toBe(
      "Running the vitest suite — 214 of 2619",
    );
  });

  it("answers null on empty or unparseable input", () => {
    expect(claudeTailFromLines([])).toBeNull();
    expect(claudeTailFromLines(["not json", "{}"])).toBeNull();
  });

  it("caps at 160 chars and collapses newlines to one line", () => {
    const long = "a".repeat(200) + "\nsecond line";
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: long }] },
      }),
    ];
    const tail = claudeTailFromLines(lines);
    expect(tail).toHaveLength(160);
    expect(tail).not.toContain("\n");
  });
});

describe("codexTailFromLines", () => {
  it("walks past trailing event records to the newest assistant message", () => {
    const lines = [
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Plan ready — approve the R4 fork?" },
          ],
        },
      }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
    ];
    expect(codexTailFromLines(lines)).toBe("Plan ready — approve the R4 fork?");
  });
});
```

- [ ] **Step 2: Run to verify failure** —
      `npx vitest run electron/resume/session-tail.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `session-tail.ts`.** Shape:

```ts
const TAIL_WINDOW_BYTES = 64 * 1024;
const TAIL_MAX_CHARS = 160;

function oneLine(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat.slice(0, TAIL_MAX_CHARS);
}

export function claudeTailFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      if (node?.type !== "assistant") continue;
      const content = node.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          const line = oneLine(part.text);
          if (line !== null) return line;
        }
      }
    } catch {
      /* an unparseable line is just skipped */
    }
  }
  return null;
}

export function codexTailFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      const payload = node?.payload ?? node;
      if (payload?.type !== "message" || payload?.role !== "assistant")
        continue;
      const content = payload.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part?.text === "string") {
          const line = oneLine(part.text);
          if (line !== null) return line;
        }
      }
    } catch {
      /* skip */
    }
  }
  return null;
}
```

`resolveSessionTails` mirrors `resolveResume`'s structure (same request validation,
same per-agent candidate cache, same cwd matching via the exported helpers — export
`cwdMatches` from `resolve.ts` or duplicate the 8-line predicate with a comment
naming its source): pick the best candidate exactly as `resolveOne` does, but
instead of returning the id, read `candidate.filePath` with
`tailBytes(filePath, TAIL_WINDOW_BYTES)`, split on `\n`, drop the first (possibly
clipped) line, and dispatch to `claudeTailFromLines` / `codexTailFromLines` by
agent. Agents without a parser (`gemini`, `agy`, `opencode` for now, declared
agents) answer `null` — the renderer keeps its fallback. Never throw; every failure
answers `null` positionally.

In `head.ts`, add `filePath?: string` to `CandidateSession` and implement
`tailBytes` (lstat → not a symlink → open → read the final `min(cap, size)` bytes).
In `claude.ts` and `codex.ts`, set `filePath` where each candidate is built — both
scanners already hold the absolute path they are reading.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Full electron gate** — `npm run electron:build` → PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(electron): session-tail extraction over the resume scanners" \
  -- electron/resume/session-tail.ts electron/resume/session-tail.test.ts \
     electron/resume/head.ts electron/resume/claude.ts electron/resume/codex.ts \
     electron/resume/resolve.ts
```

---

### Task 5: IPC — the `session_tail` channel

**Files:**

- Modify: `electron/ipc/channels.ts`, `electron/ipc/register-services.ts`
- Create: `src/host/session-tail-host.ts`

**Interfaces:**

- Consumes: `resolveSessionTails` (Task 4), `validateResumeRequests`.
- Produces: renderer-callable
  `sessionTails(requests: readonly ResumeRequest[]): Promise<readonly (string | null)[]>`.

- [ ] **Step 1: Channel + handler.** `channels.ts`, beside `resumeLookup` (same
      Electron-only comment block applies):

```ts
  // Tier 3 of the agent rail (spec §5): newest agent turn per pane.
  // Electron-only, like the block above.
  sessionTail: "session_tail",
```

`register-services.ts`, beside the `resumeLookup` handler:

```ts
ipcMain.handle(CHANNELS.sessionTail, (_event, { requests }) =>
  resolveSessionTails(app.getPath("home"), validateResumeRequests(requests)),
);
```

- [ ] **Step 2: Renderer facade.** `src/host/session-tail-host.ts`, mirroring
      `resume-host.ts`:

```ts
/**
 * Renderer facade for the main process's `session_tail` channel. Electron-
 * only, like `resumeLookup` — no Tauri counterpart exists.
 */
import { invoke } from "./bridge";
import type { ResumeRequest } from "../lib/agent-resume";

/** One tail (or null) per request, positional. Defensive like resumeLookup. */
export async function sessionTails(
  requests: readonly ResumeRequest[],
): Promise<readonly (string | null)[]> {
  const raw = await invoke<unknown>("session_tail", { requests });
  if (!Array.isArray(raw)) {
    return requests.map(() => null);
  }
  return raw.map((entry) => (typeof entry === "string" ? entry : null));
}
```

- [ ] **Step 3: Contract gates** — `npx vitest run scripts/electron-ipc-contract.test.ts electron/wire-contract.test.ts`
      → PASS (the scanner pairs the new handler with the new invoke; fix any wire-contract
      fixture it asks for).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ipc): flat session_tail channel (R6)" \
  -- electron/ipc/channels.ts electron/ipc/register-services.ts \
     src/host/session-tail-host.ts
```

---

### Task 6: Renderer store — revision-driven tail sync

**Files:**

- Create: `src/terminal/session-tail-store.ts`
- Test: `src/terminal/session-tail-store.test.ts`
- Modify: `src/ui/app.tsx` (one call), `src/ui/agent-rail.tsx` (one input line)

**Interfaces:**

- Consumes: `tabViews` signal, `PaneView.changedAt`, `sessionTails` (Task 5),
  `available as electronHostAvailable` (`src/host/worktree-host`).
- Produces: `paneTails: Signal<ReadonlyMap<number, string>>` and
  `installSessionTailSync(): () => void`.

- [ ] **Step 1: Write the failing tests** (mock `session-tail-host`; drive `tabViews`
      the way the tabs-store suites already do; remember `useSignalEffect` settles on
      animation frames — await a frame, not a microtask, per the repo's own testing note):

```ts
it("fetches tails for agent panes when a pane's changedAt moves", async () => {
  // seed one tab, agent pane 101, changedAt t0 → install → expect one batch
  // call with [{ agent: "claude", cwd: tab.workspacePath, lastSeenAt: t0 }]
});

it("does not refetch when nothing changed", async () => {});

it("keeps the last known tail when a later answer is null", async () => {});

it("is inert without the Electron host", async () => {});
```

- [ ] **Step 2: Run to verify failure** — module missing.

- [ ] **Step 3: Implement.** Window-scoped module store (R5). Core:

```ts
export const paneTails = signal<ReadonlyMap<number, string>>(new Map());

const DEBOUNCE_MS = 300;

/** Fingerprint of what would change a tail: each agent pane's changedAt. */
function fingerprintOf(tabs: readonly TabView[]): string {
  return tabs
    .flatMap((tab) =>
      tab.panes
        .filter((pane) => pane.agent !== null)
        .map((pane) => `${pane.paneId}:${pane.changedAt}`),
    )
    .join("|");
}
```

`installSessionTailSync()` subscribes to `tabViews` (`effect`), compares the
fingerprint, debounces `DEBOUNCE_MS`, then builds one positional request batch —
**only for panes with `hasRun === true`**: a freshly opened pane that has never run
anything would otherwise match a RECENT OLD session in the same cwd and wear
yesterday's sentence as if the agent had just said it. Requests carry
(`agent`, `cwd: tab.workspacePath`, `lastSeenAt: pane.changedAt || Date.now()`);
`workspacePath` is a known approximation — a pane spawned in a subdirectory or
another worktree drifts from it, `cwdMatches` fails exact-match silently, and that
pane's tail stays null (accepted for v1, recorded in Open questions). It then
calls `sessionTails`, and merges answers into a NEW map (C1) — a `null` answer keeps
the previous tail rather than erasing it. Guard the whole install on
`electronHostAvailable`; return the dispose function. In-flight dedup: one request
at a time, latest fingerprint wins.

- [ ] **Step 4: Wire it.** `app.tsx`: `useEffect(() => installSessionTailSync(), [])`
      beside the other one-time installs. `agent-rail.tsx`: add
      `tails: paneTails.value` to the `buildAgentRail` input.

- [ ] **Step 5: Run to verify pass** — store suite, then `npx vitest run src/ui src/terminal` → PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rail): revision-driven session-tail store wired into the rail" \
  -- src/terminal/session-tail-store.ts src/terminal/session-tail-store.test.ts \
     src/ui/app.tsx src/ui/agent-rail.tsx
```

---

### Task 7: Sidebar surface retune (owner pick — eye gate)

**Files:**

- Modify: `src/lib/derive-colors.ts`, `src/lib/derive-colors.test.ts`

**Interfaces:**

- Consumes: `deriveChromeColors`'s dark-sidebar mix
  (`mixHex(bg, "#000000", dark ? 0.24 : 0.05)`).
- Produces: one new dark-mix constant, owner-picked.

- [ ] **Step 1: Offer the candidates.** In the gallery (scratch block in the tokens
      section, or three inline swatches — promote-then-clear), render the sidebar surface
      at dark mixes **0.24 (current), 0.16, 0.10** under tokyo-night and one light theme.
      Screenshot; the owner picks by eye. Do not proceed on a guess. **Keeping 0.24 is a
      valid outcome:** the gallery specimen the owner liked was painted with the CURRENT
      token — the perceived difference came from the gallery's darker ground — so this
      task exists to let the eye decide, not to force a change.
- [ ] **Step 2: Apply the pick** in `deriveChromeColors` (the one constant), update
      `derive-colors.test.ts` expectations, and confirm `checkChromeTextContrast` still
      answers `ok` for every built-in theme (the existing test sweep covers this).
- [ ] **Step 3: Run** — `npx vitest run src/lib/derive-colors.test.ts src/settings` → PASS.
- [ ] **Step 4: Remove the scratch swatches** from the gallery (the pick now lives in
      the shipped constant).
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(chrome): retune the sidebar surface mix (owner-picked)" \
  -- src/lib/derive-colors.ts src/lib/derive-colors.test.ts
```

---

### Task 8: Native pass + owner eye review (gate)

**Files:** none (verification task).

- [ ] **Step 1: Full gauntlet** — `npm test && npm run build && npm run generate:menu:check && npm run electron:build`
      → all PASS; paste the tails.
- [ ] **Step 2: Native run** — `npm run electron:dev` with real claude and codex panes
      in this repo. **This run is the owner's**, or the executor must set a throwaway
      `userData` first: a headed dev run writes the owner's real `workspaces.json`
      otherwise (known trap, memory `electron-dev-userdata-not-isolated`). Verify:
      tails appear on quiet rows within a turn's end; a claude row and a codex row both
      show a real sentence; gemini/agy/custom rows show the fallback; the quiet dim
      reads at a glance; the sidebar wears the retuned surface.
- [ ] **Step 3: Owner eye review** of the running rail (DL §9.6). Any taste correction
      loops back to Task 3/7 values before Task 9 writes them into the DL.

---

### Task 9: Rules and docs

**Files:**

- Modify: `docs/DESIGN-LANGUAGE.md`, `AGENTS.md`, `docs/CONTEXT.md`,
  `src/gallery/sections/attention-direction.tsx`

- [ ] **Step 1: DL amendments** (§27):
  - New **DL-27.15**: every rail row spends its second line on the agent's newest
    turn when one exists; a quiet row (working/done/idle) takes the archived row's
    faint treatment (name `--text-faint` weight 480, glyph 0.45, tail faint); the
    state mark keeps full colour. Record the measured reason (tone ladder too tight
    for a one-step dim).
  - Amend **DL-27.11**: the "a message line is exceptional" sentence is superseded by
    DL-27.15 (2026-08-17, owner-approved from gallery specimens).
  - Ledger rows for both.
- [ ] **Step 2: AGENTS.md** — update the "rail row shows the agent's newest turn"
      ledger row (built; native evidence per Task 8), note the §10 gate waiver and the
      treatment fork resolution (2026-08-17), and the sidebar mix change.
- [ ] **Step 3: docs/CONTEXT.md** — completion entry with the Task 8 evidence (D9).
- [ ] **Step 4: Trim the gallery proposal section** to the promoted hybrid (the
      treatment-direction-review precedent: keep the record, drop the losing variants
      from the registry surface).
- [ ] **Step 5: Docs compliance** —
      `bash ~/.claude/scripts/docs-compliance.sh && bash ~/.claude/scripts/docs-anchors.sh`
      → paste output.
- [ ] **Step 6: Owner approves the doc diffs, THEN commit (D14)**

```bash
git commit -m "docs(rail): DL-27.15, ledger and context for the attention rail" \
  -- docs/DESIGN-LANGUAGE.md AGENTS.md docs/CONTEXT.md \
     src/gallery/sections/attention-direction.tsx src/gallery/sections/attention-direction.css
```

---

## Open questions (non-blocking)

| Question                                                                                                                             | Owner          | When                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------- |
| opencode transcript format — add a third parser?                                                                                     | implementation | during Task 4; ship without it if unclear                  |
| Should a `failed` pane's tail show the error line instead of the last assistant text?                                                | owner          | after Task 8's native look                                 |
| Tail refresh while an agent is mid-turn streams partial sentences — acceptable?                                                      | owner          | after Task 8 (debounce + changedAt should mostly avoid it) |
| Pane cwd drift (subdir/worktree ≠ `workspacePath`) leaves those tails null — use the live pane cwd instead if a cheap source exists? | implementation | during Task 6; else stays a recorded v1 limit              |
