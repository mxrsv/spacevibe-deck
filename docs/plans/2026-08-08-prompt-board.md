# Prompt Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Prompt Board specced in [`docs/specs/2026-08-08-prompt-board-design.md`](../specs/2026-08-08-prompt-board-design.md) — a chrome popover of reusable prompt templates that pastes a template (plus optional skill/subagent reference lines) into the agent session running in the focused pane.

**Architecture:** Four layers, bottom up. (1) A pure template catalog in `src/prompts/` plus one new `Settings` field, validated with the same drop-not-repair discipline as `customAgents`. (2) A read-only Rust scanner (`prompt_assets.rs`) that walks known asset directories and answers one command; no shell, no PTY, no new crates. (3) An injection path: `Pane.pasteText` rides xterm's bracketed-paste route, `pane-lifecycle` gains a per-pane FIFO write queue so "paste frame, then `\r`" is structural rather than timed, and a pure triple-gate predicate decides whether `\r` is ever enqueued. (4) A chrome popover anchored to a new icon button, made of DL §12 rows plus a new DL §13.

**Tech Stack:** Preact + `@preact/signals`, xterm.js 6, Vitest (jsdom for component tests), Tauri 2 + Rust (serde, serde_json — both already present), CSS in `src/styles.css`.

## Global Constraints

- **Zero new dependencies** — npm and cargo alike. No YAML crate, no TOML crate, no icon library (DL-1.1, DL-11.3). Anything that changes what ships in the app bundle is a fork (AGENTS.md) — stop and ask instead.
- **English only** for every string, comment and doc in this repo (R1).
- **Menu code is generated** — edit `src/terminal/action-registry.ts`, then run `npm run generate:menu`. Never hand-edit `src-tauri/src/menu_registry.rs` (R3).
- **Chrome UI follows `docs/DESIGN-LANGUAGE.md`** (R2). This plan adds §13; adding anything beyond it is a fork.
- **Do not touch the R4 seams** — PTY, window coordinator, tab materialize, layout engine, close coordinator. The write queue lives in `src/terminal/pane-lifecycle.ts` (frontend), not in `src-tauri`.
- **Detection is read-only.** No shell is ever spawned by this feature. Symlinks are skipped, reads are head-bounded at 16 KiB, results capped at 200 per kind.
- Constants, verbatim from the spec: `TEMPLATE_LABEL_MAX = 48`, `TEMPLATE_BODY_MAX = 20_000`, description clamp 256 chars, head read 16 KiB, per-kind cap 200.
- Reference-line phrasing table (spec §7), verbatim:

  | CLI    | skill                   | subagent                        |
  | ------ | ----------------------- | ------------------------------- |
  | claude | `Use the <name> skill.` | `Use the <name> subagent.`      |
  | codex  | `Use the <name> skill.` | `Delegate to the <name> agent.` |

- Restore Defaults dialog copy, verbatim: `"Theme, font, colors, behavior, declared agents and prompt templates all go back to their defaults. This can't be undone."`
- Verification commands for this repo (npm, **not** pnpm): `npm test` · `npm run build` (tsc + vite build) · `npm run generate:menu:check` · `cargo test` in `src-tauri`. There is no `lint` script.

## Decisions this plan makes (spec §14 open questions, plus gaps found while reading the code)

| Question                                                  | Resolution                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact `toggle-prompts` key binding                        | macOS `⌘⇧P` (`{ key: "p", meta: true, shift: true }`), Windows `Ctrl+Shift+P`. Verified free in both `MACOS_KEYMAP` and `WINDOWS_KEYMAP` — no `p` binding exists on either. `CharKeyBinding` is mandatory, not a style choice: the action gets a macOS menu item, and the RULE above `CharKeyBinding` in `action-registry.ts` requires it. |
| Do Codex agent `.toml` files carry a usable `description` | Yes — verified on disk 2026-08-08: `~/.codex/agents/plan-reviewer.toml` opens with `name = "…"` then `description = "…"` as top-level keys. The scanner still uses the **file stem** as the name (spec §8) and treats the description as optional.                                                                                         |
| `TabManager.activePaneId()`                               | **Added** — spec §11's "Changed" list omits it, but §7's target capture needs the focused pane's id and `TabManager` only exposes `activePaneCwd()`. One line, delegating to `activeManager()?.activePaneId()`.                                                                                                                            |
| Chrome button vs. open overlays                           | `scope: "pane"` only gates the keyboard/menu path (`overlayBlocksAction`). A button `onClick` is a direct call and bypasses it entirely. The button is therefore **disabled** while the board, Settings, PresetEditor or SavePresetDialog is open, and an already-open popover closes when one of them opens.                              |
| "Popover closes when the target pane dies"                | Mechanism, not just behaviour: a `useSignalEffect` reading `tabViews` (bumped by `syncViews` on every layout change, poll and exit) re-checks `paneId ∈ allPaneIds()` and calls `onClose()`. The inject path re-checks liveness independently (gate 3).                                                                                    |
| Where the popover mounts                                  | Inside `ChromeActions`, in a `.prompts-anchor` wrapper next to its trigger. `DesktopChrome` renders `toolbar` (sidebar layout) **or** `topTabs` → `TabBar` → `ChromeActions` (top layout), never both, so exactly one instance exists. CSS anchoring (`position: absolute` in a `position: relative` wrapper) — no rect math.              |
| `PromptAssetKind` home                                    | Declared in `snippet-format.ts` (pure) and imported by `prompt-assets-client.ts` (which imports `@tauri-apps/api/core`). Keeps the dependency direction pure → impure, matching `process-info.ts` → `pty-client.ts`.                                                                                                                       |

## File structure

**Created**

| File                                       | Responsibility                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/prompts/prompt-templates.ts`          | Pure: `PromptTemplate`, size constants, id generation, per-entry validation               |
| `src/prompts/prompt-templates.test.ts`     | Its unit tests                                                                            |
| `src/prompts/snippet-format.ts`            | Pure: `PromptAssetKind`, the per-CLI reference-line table, `composePromptText`            |
| `src/prompts/snippet-format.test.ts`       | Its unit tests                                                                            |
| `src/prompts/prompt-assets-client.ts`      | `list_prompt_assets` invoke wrapper + in-memory fake                                      |
| `src/prompts/prompt-assets-client.test.ts` | Its unit tests                                                                            |
| `src/prompts/inject.ts`                    | Target capture + the pure triple-gate predicate + outcome type                            |
| `src/prompts/inject.test.ts`               | Its unit tests                                                                            |
| `src/prompts/prompt-popover.tsx`           | The popover surface (DL §12 + §13)                                                        |
| `src/prompts/prompt-popover.test.tsx`      | Its component tests                                                                       |
| `src/ui/controls/commit-textarea.tsx`      | `CommitTextarea` — DL-13.5 multi-line sibling of `CommitInput`                            |
| `src/ui/controls/commit-textarea.test.tsx` | Its component tests                                                                       |
| `src-tauri/src/prompt_assets.rs`           | Read-only scanner + the `list_prompt_assets` command (unit tests inline, repo convention) |

**Modified**

| File                                              | Change                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/settings/settings-schema.ts`                 | `+promptTemplates` field, default, `validatePromptTemplates`                               |
| `src/settings/settings-schema.test.ts`            | Validation cases                                                                           |
| `src/ui/settings/sections/reset-section.tsx`      | Dialog copy + row description                                                              |
| `src/ui/settings/sections/reset-section.test.tsx` | Copy assertion                                                                             |
| `src/chrome/events.ts`                            | `+promptsOpen` signal                                                                      |
| `src/terminal/pane.ts`                            | `+pasteText(text)`                                                                         |
| `src/terminal/pane-lifecycle.ts`                  | Per-pane FIFO write queue; `onData` routes through it; `+enqueueWrite`                     |
| `src/terminal/pane-lifecycle.test.ts`             | Ordering + drop-on-exit tests                                                              |
| `src/terminal/terminal-manager.ts`                | `+pasteIntoPane(id, text)`, `+submitPane(id)`                                              |
| `src/terminal/tab-manager.ts`                     | `+activePaneId()`, `+paneAttention(id)`, `+injectIntoPane(...)`, `toggle-prompts` dispatch |
| `src/terminal/tab-manager.test.ts`                | Gate integration tests                                                                     |
| `src/terminal/action-registry.ts`                 | `+toggle-prompts` row, macOS + Windows bindings                                            |
| `src/ui/chrome-actions.tsx`                       | `+` prompts button, anchor wrapper, popover slot                                           |
| `src/ui/tab-bar.tsx`                              | Forwards the new `ChromeActions` props                                                     |
| `src/ui/app.tsx`                                  | Wires capture / inject / close, disables the button under overlays                         |
| `src/styles.css`                                  | `.prompts-anchor`, `.prompt-popover`, editor + picker rules                                |
| `src-tauri/src/lib.rs`                            | `mod prompt_assets;` + handler registration                                                |
| `src-tauri/src/menu_registry.rs`                  | **Generated** — via `npm run generate:menu`, never by hand                                 |
| `docs/DESIGN-LANGUAGE.md`                         | New §13                                                                                    |

---

### Task 1: Template catalog + settings field + reset copy

**Files:**

- Create: `src/prompts/prompt-templates.ts`
- Create: `src/prompts/prompt-templates.test.ts`
- Modify: `src/settings/settings-schema.ts` (Settings interface ~line 20-37, `DEFAULT_SETTINGS` ~line 57-70, add `validatePromptTemplates` beside `validateCustomAgents` ~line 143, wire into `validateSettings` ~line 210)
- Modify: `src/settings/settings-schema.test.ts`
- Modify: `src/ui/settings/sections/reset-section.tsx:29` and `:50`
- Modify: `src/ui/settings/sections/reset-section.test.tsx`

**Interfaces:**

- Consumes: nothing (first task).
- Produces:
  - `interface PromptTemplate { readonly id: string; readonly label: string; readonly body: string; readonly autoSend: boolean }`
  - `TEMPLATE_ID_PREFIX: "tpl:"`, `TEMPLATE_LABEL_MAX: 48`, `TEMPLATE_BODY_MAX: 20_000`
  - `createPromptTemplateId(label: string, existing: readonly PromptTemplate[]): string`
  - `isValidPromptTemplate(value: unknown): value is PromptTemplate`
  - `Settings.promptTemplates: readonly PromptTemplate[]` (default `[]`)

- [ ] **Step 1: Write the failing tests for the pure catalog**

Create `src/prompts/prompt-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createPromptTemplateId,
  isValidPromptTemplate,
  TEMPLATE_BODY_MAX,
  TEMPLATE_LABEL_MAX,
  type PromptTemplate,
} from "./prompt-templates";

const template = (patch: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "tpl:fix-bug",
  label: "fix bug",
  body: "Fix the failing test.",
  autoSend: false,
  ...patch,
});

describe("createPromptTemplateId", () => {
  it("slugifies the label", () => {
    expect(createPromptTemplateId("Fix Bug", [])).toBe("tpl:fix-bug");
  });

  it("appends a numeric suffix rather than colliding", () => {
    const existing = [template({ id: "tpl:fix-bug" })];
    expect(createPromptTemplateId("fix bug", existing)).toBe("tpl:fix-bug-2");
  });

  it("falls back for a label with nothing sluggable in it", () => {
    expect(createPromptTemplateId("!!!", [])).toBe("tpl:prompt");
  });
});

describe("isValidPromptTemplate", () => {
  it("accepts a well-formed template", () => {
    expect(isValidPromptTemplate(template())).toBe(true);
  });

  it("rejects an id without the tpl: prefix", () => {
    expect(isValidPromptTemplate(template({ id: "fix-bug" }))).toBe(false);
    expect(isValidPromptTemplate(template({ id: "tpl:" }))).toBe(false);
  });

  it("rejects an empty or over-long label", () => {
    expect(isValidPromptTemplate(template({ label: "   " }))).toBe(false);
    expect(
      isValidPromptTemplate(
        template({ label: "x".repeat(TEMPLATE_LABEL_MAX + 1) }),
      ),
    ).toBe(false);
  });

  it("rejects an empty or over-long body", () => {
    expect(isValidPromptTemplate(template({ body: "" }))).toBe(false);
    expect(
      isValidPromptTemplate(
        template({ body: "x".repeat(TEMPLATE_BODY_MAX + 1) }),
      ),
    ).toBe(false);
  });

  it("rejects a non-boolean autoSend and a non-object", () => {
    expect(isValidPromptTemplate({ ...template(), autoSend: "yes" })).toBe(
      false,
    );
    expect(isValidPromptTemplate(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/prompts/prompt-templates.test.ts`
Expected: FAIL — `Failed to resolve import "./prompt-templates"`.

- [ ] **Step 3: Write `src/prompts/prompt-templates.ts`**

```ts
/**
 * The prompt template catalog: what the Prompt Board can paste, and how a new
 * template gets its id. Pure — no signals, no Tauri, no DOM.
 *
 * Mirrors the split in `lib/agent-catalog.ts`: the type, the size limits and
 * the id generator live here, while the settings store's array-level
 * validation sits beside `validateCustomAgents` in `settings-schema.ts`. Ids
 * are minted once from the label and frozen across renames — a template's
 * identity must not move when its display name does.
 */

export interface PromptTemplate {
  /** Stable `tpl:<slug>` id. Generated once from the label, never re-derived. */
  readonly id: string;
  readonly label: string;
  /** Multi-line prompt body, injected verbatim (plus composer lines). */
  readonly body: string;
  /** Submit after paste — subject to the triple gate, never unconditional. */
  readonly autoSend: boolean;
}

export const TEMPLATE_ID_PREFIX = "tpl:";

/** Long enough to name a prompt, short enough to stay one row. */
export const TEMPLATE_LABEL_MAX = 48;

/**
 * Upper bound on a body. Not a UI nicety: the whole body is pasted into a live
 * PTY in one bracketed-paste frame, and an unbounded blob would be pasted into
 * an agent's composer with no way to interrupt it.
 */
export const TEMPLATE_BODY_MAX = 20_000;

const FALLBACK_SLUG = "prompt";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A stable id for a new template, unique among `existing`. Same shape as
 * `createCustomAgentId`: slug, then a numeric suffix on collision.
 */
export function createPromptTemplateId(
  label: string,
  existing: readonly PromptTemplate[],
): string {
  const base = slugify(label) || FALLBACK_SLUG;
  const taken = new Set(existing.map((entry) => entry.id));
  const first = `${TEMPLATE_ID_PREFIX}${base}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${TEMPLATE_ID_PREFIX}${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Whether one stored template is well-formed. Shared with the popover so what
 * the form accepts and what survives a reload cannot drift apart — the same
 * contract `isValidCustomAgent` holds for declared agents.
 */
export function isValidPromptTemplate(value: unknown): value is PromptTemplate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    !entry.id.startsWith(TEMPLATE_ID_PREFIX) ||
    entry.id.length <= TEMPLATE_ID_PREFIX.length
  ) {
    return false;
  }
  if (
    typeof entry.label !== "string" ||
    entry.label.trim() === "" ||
    entry.label.length > TEMPLATE_LABEL_MAX
  ) {
    return false;
  }
  if (
    typeof entry.body !== "string" ||
    entry.body.trim() === "" ||
    entry.body.length > TEMPLATE_BODY_MAX
  ) {
    return false;
  }
  return typeof entry.autoSend === "boolean";
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/prompts/prompt-templates.test.ts`
Expected: PASS (12 assertions across 8 tests).

- [ ] **Step 5: Write the failing settings-schema tests**

Append to `src/settings/settings-schema.test.ts` (inside the existing top-level `describe`, or as a new one — match the file's existing style):

```ts
describe("promptTemplates validation", () => {
  const good = {
    id: "tpl:fix-bug",
    label: "fix bug",
    body: "Fix the failing test.",
    autoSend: false,
  };

  it("defaults to none", () => {
    expect(validateSettings({}).promptTemplates).toEqual([]);
  });

  it("keeps well-formed entries", () => {
    expect(
      validateSettings({ promptTemplates: [good] }).promptTemplates,
    ).toEqual([good]);
  });

  it("drops a malformed entry rather than repairing it", () => {
    const raw = {
      promptTemplates: [good, { id: "tpl:x" }, { label: "no id" }],
    };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });

  it("falls back to none for a malformed array", () => {
    expect(
      validateSettings({ promptTemplates: "nope" }).promptTemplates,
    ).toEqual([]);
  });

  it("dedupes repeated ids, first wins", () => {
    const second = { ...good, label: "other" };
    expect(
      validateSettings({ promptTemplates: [good, second] }).promptTemplates,
    ).toEqual([good]);
  });

  it("keeps only the four known fields", () => {
    const raw = { promptTemplates: [{ ...good, extra: "dropped" }] };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: FAIL — `promptTemplates` is `undefined` on the validated object.

- [ ] **Step 7: Add the field to `settings-schema.ts`**

Import at the top, beside the existing `agent-catalog` import:

```ts
import {
  isValidPromptTemplate,
  type PromptTemplate,
} from "../prompts/prompt-templates";
```

Add to the `Settings` interface, after `customAgents`:

```ts
  /** Reusable prompt bodies the user declared for the Prompt Board. */
  promptTemplates: readonly PromptTemplate[];
```

Add to `DEFAULT_SETTINGS`, after `customAgents: []`:

```ts
  promptTemplates: [],
```

Add beside `validateCustomAgents`:

```ts
/**
 * Same drop-not-repair discipline as `validateCustomAgents` above, for the
 * same reason: a half-understood template is not guessed at, because its body
 * gets pasted verbatim into a live agent session. A malformed array falls back
 * to none declared, and a duplicate id is dropped (the first wins) so the
 * popover's row keys stay unique.
 */
function validatePromptTemplates(raw: unknown): readonly PromptTemplate[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_SETTINGS.promptTemplates;
  }
  const seen = new Set<string>();
  const result: PromptTemplate[] = [];
  for (const entry of raw) {
    if (!isValidPromptTemplate(entry) || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push({
      id: entry.id,
      label: entry.label,
      body: entry.body,
      autoSend: entry.autoSend,
    });
  }
  return result;
}
```

Wire it into `validateSettings`, after the `customAgents` line:

```ts
    promptTemplates: validatePromptTemplates(source.promptTemplates),
```

- [ ] **Step 8: Run the settings tests and watch them pass**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Update the Restore Defaults copy (test first)**

In `src/ui/settings/sections/reset-section.test.tsx`, assert the new sentence. If the existing test only checks that `ask` was called, extend it:

```ts
expect(ask).toHaveBeenCalledWith(
  "Theme, font, colors, behavior, declared agents and prompt templates all go back to their defaults. This can't be undone.",
  expect.objectContaining({ title: "Restore Defaults" }),
);
```

Run: `npx vitest run src/ui/settings/sections/reset-section.test.tsx`
Expected: FAIL on the old sentence.

Then edit `src/ui/settings/sections/reset-section.tsx`:

- Line 29 string becomes the sentence above.
- Line 50 `desc="theme, font, colors, behavior"` becomes `desc="theme, font, colors, behavior, agents, prompts"`.
- Extend the doc comment above `handleReset` with one sentence:

```ts
   * Templates and declared agents live in the same settings object, so this
   * wipes them too — it always did for agents; the sentence now says so.
   * Preserving data through a reset is a separate task (spec §4).
```

Run: `npx vitest run src/ui/settings/sections/reset-section.test.tsx`
Expected: PASS.

- [ ] **Step 10: Full suite + commit**

```bash
npm test
git add src/prompts/prompt-templates.ts src/prompts/prompt-templates.test.ts \
  src/settings/settings-schema.ts src/settings/settings-schema.test.ts \
  src/ui/settings/sections/reset-section.tsx src/ui/settings/sections/reset-section.test.tsx
git commit -m "feat(prompts): add prompt template catalog and settings field"
```

---

### Task 2: Reference-line formatter

**Files:**

- Create: `src/prompts/snippet-format.ts`
- Create: `src/prompts/snippet-format.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type PromptAssetKind = "skill" | "subagent"`
  - `type PromptAgentId = "claude" | "codex"`
  - `isPromptAgentId(value: string | null): value is PromptAgentId`
  - `formatAssetReference(agent: string | null, kind: PromptAssetKind, name: string): string | null`
  - `interface PromptAssetPick { readonly kind: PromptAssetKind; readonly name: string }`
  - `composePromptText(body: string, agent: string | null, picks: readonly PromptAssetPick[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/prompts/snippet-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  composePromptText,
  formatAssetReference,
  isPromptAgentId,
} from "./snippet-format";

describe("formatAssetReference", () => {
  it("phrases each cell of the per-CLI table", () => {
    expect(
      formatAssetReference("claude", "skill", "superpowers:brainstorming"),
    ).toBe("Use the superpowers:brainstorming skill.");
    expect(formatAssetReference("claude", "subagent", "plan-reviewer")).toBe(
      "Use the plan-reviewer subagent.",
    );
    expect(formatAssetReference("codex", "skill", "audit-5-layers")).toBe(
      "Use the audit-5-layers skill.",
    );
    expect(formatAssetReference("codex", "subagent", "plan-reviewer")).toBe(
      "Delegate to the plan-reviewer agent.",
    );
  });

  it("has no phrasing for an unverified CLI or an empty name", () => {
    expect(formatAssetReference("gemini", "skill", "x")).toBeNull();
    expect(formatAssetReference(null, "skill", "x")).toBeNull();
    expect(formatAssetReference("claude", "skill", "  ")).toBeNull();
  });
});

describe("composePromptText", () => {
  it("returns the body untouched when nothing is picked", () => {
    expect(composePromptText("Fix it.\n", "claude", [])).toBe("Fix it.\n");
  });

  it("appends one line per pick, in order", () => {
    expect(
      composePromptText("Fix it.", "claude", [
        { kind: "skill", name: "code-review" },
        { kind: "subagent", name: "plan-reviewer" },
      ]),
    ).toBe(
      "Fix it.\nUse the code-review skill.\nUse the plan-reviewer subagent.",
    );
  });

  it("trims only the body's trailing whitespace before appending", () => {
    expect(
      composePromptText("Fix it.\n\n", "claude", [
        { kind: "skill", name: "code-review" },
      ]),
    ).toBe("Fix it.\nUse the code-review skill.");
  });

  it("drops picks an unverified CLI has no phrasing for", () => {
    expect(
      composePromptText("Fix it.", "gemini", [{ kind: "skill", name: "x" }]),
    ).toBe("Fix it.");
  });
});

describe("isPromptAgentId", () => {
  it("recognises exactly the two verified CLIs", () => {
    expect(isPromptAgentId("claude")).toBe(true);
    expect(isPromptAgentId("codex")).toBe(true);
    expect(isPromptAgentId("agy")).toBe(false);
    expect(isPromptAgentId(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/prompts/snippet-format.test.ts`
Expected: FAIL — `Failed to resolve import "./snippet-format"`.

- [ ] **Step 3: Write `src/prompts/snippet-format.ts`**

```ts
/**
 * How a picked skill / subagent becomes one line of prompt text, per CLI.
 * Pure — no signals, no Tauri, no DOM.
 *
 * One table, because the two CLIs address a subagent differently ("subagent"
 * vs "agent") and a wrong verb is a prompt the agent silently ignores. Only
 * the CLIs whose asset layouts were verified on disk have phrasing; anything
 * else composes to the body alone rather than to a guess.
 */

export type PromptAssetKind = "skill" | "subagent";

/** The CLIs whose asset layouts were verified on disk (spec §5). */
export type PromptAgentId = "claude" | "codex";

export interface PromptAssetPick {
  readonly kind: PromptAssetKind;
  readonly name: string;
}

const REFERENCE_PHRASES: Readonly<
  Record<
    PromptAgentId,
    Readonly<Record<PromptAssetKind, (name: string) => string>>
  >
> = {
  claude: {
    skill: (name) => `Use the ${name} skill.`,
    subagent: (name) => `Use the ${name} subagent.`,
  },
  codex: {
    skill: (name) => `Use the ${name} skill.`,
    subagent: (name) => `Delegate to the ${name} agent.`,
  },
};

export function isPromptAgentId(value: string | null): value is PromptAgentId {
  return value === "claude" || value === "codex";
}

/** One reference line, or null when there is no verified phrasing for it. */
export function formatAssetReference(
  agent: string | null,
  kind: PromptAssetKind,
  name: string,
): string | null {
  if (!isPromptAgentId(agent)) {
    return null;
  }
  const trimmed = name.trim();
  return trimmed === "" ? null : REFERENCE_PHRASES[agent][kind](trimmed);
}

/**
 * The text actually pasted: the body verbatim, then one line per pick. With
 * nothing picked the body is returned untouched — a template that ends in a
 * deliberate blank line keeps it.
 */
export function composePromptText(
  body: string,
  agent: string | null,
  picks: readonly PromptAssetPick[],
): string {
  const lines = picks
    .map((pick) => formatAssetReference(agent, pick.kind, pick.name))
    .filter((line): line is string => line !== null);
  return lines.length === 0 ? body : [body.trimEnd(), ...lines].join("\n");
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/prompts/snippet-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/snippet-format.ts src/prompts/snippet-format.test.ts
git commit -m "feat(prompts): add per-CLI reference-line formatter"
```

---

### Task 3: Rust descriptor parsing

**Files:**

- Create: `src-tauri/src/prompt_assets.rs` (parsing half only; the command lands in Task 4)

**Interfaces:**

- Consumes: nothing.
- Produces (crate-internal):
  - `enum AssetKind { Skill, Subagent }`, `enum AssetSource { Global, Project, Plugin }` (both `Serialize`, lowercase)
  - `struct PromptAsset { kind, name, description, source }` (`Serialize`, camelCase)
  - `struct PromptAssets { skills: Vec<PromptAsset>, subagents: Vec<PromptAsset> }`
  - `fn parse_frontmatter(head: &str) -> (Option<String>, Option<String>)`
  - `fn parse_toml_description(head: &str) -> Option<String>`
  - `fn clamp_description(value: Option<String>) -> String`
  - `fn read_head(path: &Path) -> Option<String>`

- [ ] **Step 1: Write the module with its failing tests**

Create `src-tauri/src/prompt_assets.rs` containing **only** the test module below plus the type declarations, so the first `cargo test` fails on missing functions:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_frontmatter_scalars() {
        let head = "---\nname: code-review\ndescription: Parallel code review.\n---\n# Body\n";
        assert_eq!(
            parse_frontmatter(head),
            (
                Some("code-review".to_string()),
                Some("Parallel code review.".to_string())
            )
        );
    }

    #[test]
    fn unquotes_a_quoted_scalar() {
        let head = "---\nname: brainstorming\ndescription: \"You MUST use this first.\"\n---\n";
        assert_eq!(
            parse_frontmatter(head).1,
            Some("You MUST use this first.".to_string())
        );
    }

    #[test]
    fn joins_a_folded_scalar_into_one_line() {
        let head = "---\nname: dataviz\ndescription: >\n  Use this whenever you\n  build a chart.\ntools: Read\n---\n";
        assert_eq!(
            parse_frontmatter(head),
            (
                Some("dataviz".to_string()),
                Some("Use this whenever you build a chart.".to_string())
            )
        );
    }

    #[test]
    fn ignores_a_file_with_no_frontmatter_block() {
        assert_eq!(parse_frontmatter("# Just a heading\n"), (None, None));
    }

    #[test]
    fn stops_at_the_closing_fence() {
        let head = "---\nname: a\n---\ndescription: not frontmatter\n";
        assert_eq!(parse_frontmatter(head).1, None);
    }

    #[test]
    fn reads_a_top_level_toml_description() {
        let head = "name = \"plan-reviewer\"\ndescription = \"Reviews plans.\"\nmodel = \"inherit\"\n";
        assert_eq!(
            parse_toml_description(head),
            Some("Reviews plans.".to_string())
        );
    }

    #[test]
    fn ignores_a_description_inside_a_table_or_a_multiline_block() {
        assert_eq!(
            parse_toml_description("[nested]\ndescription = \"not mine\"\n"),
            None
        );
        assert_eq!(
            parse_toml_description("developer_instructions = \"\"\"\ndescription = \"not mine\"\n"),
            None
        );
    }

    #[test]
    fn clamps_and_flattens_a_description() {
        let long = "a ".repeat(400);
        let clamped = clamp_description(Some(long));
        assert_eq!(clamped.chars().count(), DESCRIPTION_MAX);
        assert_eq!(clamp_description(Some("a\n  b\n".into())), "a b");
        assert_eq!(clamp_description(None), "");
    }

    #[test]
    fn read_head_stops_at_the_byte_cap_and_skips_symlinks() {
        let dir = std::env::temp_dir().join("deck-prompt-assets-read-head");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.md");
        std::fs::write(&big, "x".repeat(HEAD_BYTES + 500)).unwrap();
        assert_eq!(read_head(&big).unwrap().len(), HEAD_BYTES);

        #[cfg(unix)]
        {
            let link = dir.join("link.md");
            std::os::unix::fs::symlink(&big, &link).unwrap();
            assert!(read_head(&link).is_none());
        }
        assert!(read_head(&dir.join("missing.md")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test prompt_assets`
Expected: FAIL — `cannot find function 'parse_frontmatter' in this scope` (module not yet declared in `lib.rs`, so add `mod prompt_assets;` first — see Task 4 Step 5; declaring it early is fine and keeps `cargo test` runnable).

- [ ] **Step 3: Implement the parsing half**

Prepend to `src-tauri/src/prompt_assets.rs`:

```rust
//! Read-only scan of the skills / subagents an agent CLI has on disk.
//!
//! No shell, no PTY, no new crates: this walks a handful of known directories,
//! reads the head of each descriptor file and returns what it found. It is not
//! one of the R4 load-bearing seams. A missing directory, an unreadable file or
//! an unknown agent is an empty list, never an error — the Prompt Board still
//! pastes templates when detection finds nothing.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Bytes read from any descriptor file. Frontmatter sits at the top, so a
/// multi-megabyte SKILL.md must never be pulled into memory to find it.
const HEAD_BYTES: usize = 16 * 1024;

/// Upper bound per kind — a pathological plugin cache cannot flood the picker.
const RESULT_CAP: usize = 200;

/// Descriptions land in a `<select>` option; past this they are noise.
const DESCRIPTION_MAX: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Skill,
    Subagent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetSource {
    Global,
    Project,
    Plugin,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAsset {
    pub kind: AssetKind,
    /// Qualified exactly as the CLI would address it (`plugin:skill` included).
    pub name: String,
    pub description: String,
    pub source: AssetSource,
}

#[derive(Debug, Default, Eq, PartialEq, Serialize)]
pub struct PromptAssets {
    pub skills: Vec<PromptAsset>,
    pub subagents: Vec<PromptAsset>,
}

/// Strip one layer of matching single/double quotes, if present.
fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        return &value[1..value.len() - 1];
    }
    value
}

fn assign(
    is_name: bool,
    value: String,
    name: &mut Option<String>,
    description: &mut Option<String>,
) {
    if is_name {
        name.get_or_insert(value);
    } else {
        description.get_or_insert(value);
    }
}

/// The `name:` / `description:` of a YAML frontmatter block.
///
/// Deliberately not a YAML parser (zero new dependencies): every SKILL.md and
/// agent `.md` verified on disk 2026-08-08 carries these two as plain,
/// quoted, or folded/literal (`>`, `|`) scalars, and a folded scalar's
/// indented continuation lines are joined with single spaces. Anything else in
/// the block is skipped rather than guessed at.
pub(crate) fn parse_frontmatter(head: &str) -> (Option<String>, Option<String>) {
    let mut lines = head.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    // Which field a folded/literal block is collecting, and what it has so far.
    let mut folding: Option<(bool, String)> = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if folding.is_some() && (indented || line.trim().is_empty()) {
            let piece = line.trim();
            if !piece.is_empty() {
                let (_, joined) = folding.as_mut().expect("checked just above");
                if !joined.is_empty() {
                    joined.push(' ');
                }
                joined.push_str(piece);
            }
            continue;
        }
        if let Some((is_name, joined)) = folding.take() {
            assign(is_name, joined, &mut name, &mut description);
        }
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let is_name = match key.trim() {
            "name" => true,
            "description" => false,
            _ => continue,
        };
        let value = rest.trim();
        if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            folding = Some((is_name, String::new()));
            continue;
        }
        assign(is_name, unquote(value).to_string(), &mut name, &mut description);
    }
    if let Some((is_name, joined)) = folding {
        assign(is_name, joined, &mut name, &mut description);
    }
    (name, description)
}

/// A top-level `description = "..."` in a Codex agent `.toml`.
///
/// Scanning stops at the first table header or multi-line (`"""`) value: a
/// `description` below either is not the agent's own. Not a TOML parser, for
/// the same zero-dependency reason as `parse_frontmatter`.
pub(crate) fn parse_toml_description(head: &str) -> Option<String> {
    for line in head.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') || trimmed.contains("\"\"\"") {
            break;
        }
        let Some((key, rest)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "description" {
            continue;
        }
        let value = unquote(rest.trim());
        return if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        };
    }
    None
}

/// One line, collapsed whitespace, clamped to `DESCRIPTION_MAX` characters
/// (not bytes — clamping mid-codepoint would panic on a UTF-8 boundary).
pub(crate) fn clamp_description(value: Option<String>) -> String {
    let text = value.unwrap_or_default();
    let flattened = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() <= DESCRIPTION_MAX {
        return flattened;
    }
    flattened.chars().take(DESCRIPTION_MAX).collect()
}

/// The first `HEAD_BYTES` of a regular file.
///
/// `None` for a symlink, a directory, an unreadable file or an IO error.
/// Symlinks are refused rather than followed: one can point straight out of
/// the scanned tree, and this scan promises to stay inside it.
pub(crate) fn read_head(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut buffer = vec![0u8; HEAD_BYTES];
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(_) => return None,
        }
    }
    buffer.truncate(filled);
    Some(String::from_utf8_lossy(&buffer).into_owned())
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd src-tauri && cargo test prompt_assets`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/prompt_assets.rs src-tauri/src/lib.rs
git commit -m "feat(prompts): parse skill and agent descriptors in rust"
```

---

### Task 4: Rust root walk, scan and command

**Files:**

- Modify: `src-tauri/src/prompt_assets.rs`
- Modify: `src-tauri/src/lib.rs` (`mod prompt_assets;` at the top, `prompt_assets::list_prompt_assets` in `generate_handler!`)

**Interfaces:**

- Consumes: everything from Task 3.
- Produces:
  - `fn project_root(cwd: &Path) -> Option<PathBuf>`
  - `fn plugin_roots(installed_json: &str) -> Vec<(String, PathBuf)>`
  - `fn collect(agent: &str, home: &Path, project: Option<&Path>) -> PromptAssets` — the injectable core the tests drive
  - `#[tauri::command] async fn list_prompt_assets(agent: String, cwd: Option<String>) -> PromptAssets`
  - IPC contract: `invoke("list_prompt_assets", { agent, cwd })` → `{ skills: PromptAsset[], subagents: PromptAsset[] }`, `PromptAsset = { kind: "skill" | "subagent", name, description, source: "global" | "project" | "plugin" }`

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `src-tauri/src/prompt_assets.rs`:

```rust
    /// A throwaway tree under the OS temp dir. No `tempfile` dev-dependency:
    /// this feature ships zero new crates, test-only included.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deck-prompt-assets-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(root: &Path, skill: &str, description: &str) {
        let dir = root.join("skills").join(skill);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {skill}\ndescription: {description}\n---\n"),
        )
        .unwrap();
    }

    fn write_agent_md(root: &Path, agent: &str, description: &str) {
        let dir = root.join("agents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("{agent}.md")),
            format!("---\nname: {agent}\ndescription: {description}\n---\n"),
        )
        .unwrap();
    }

    #[test]
    fn project_root_walks_up_to_the_nearest_marker() {
        let base = fixture("project-root");
        let nested = base.join("repo/src/deep");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(base.join("repo/.git")).unwrap();
        assert_eq!(project_root(&nested), Some(base.join("repo")));

        let orphan = fixture("project-root-orphan");
        assert_eq!(project_root(&orphan), None);
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&orphan);
    }

    #[test]
    fn plugin_roots_read_install_paths_not_the_cache_directory() {
        let json = r#"{
            "version": 2,
            "plugins": {
                "superpowers@official": [
                    { "scope": "user", "installPath": "/cache/official/superpowers/6.2.0" }
                ],
                "broken@official": [ { "scope": "user" } ]
            }
        }"#;
        assert_eq!(
            plugin_roots(json),
            vec![(
                "superpowers".to_string(),
                PathBuf::from("/cache/official/superpowers/6.2.0")
            )]
        );
        assert_eq!(plugin_roots("not json"), Vec::new());
    }

    #[test]
    fn collects_claude_assets_with_project_shadowing_global() {
        let base = fixture("claude-scan");
        let home = base.join("home");
        let project = base.join("repo");
        std::fs::create_dir_all(project.join(".claude")).unwrap();
        write_skill(&home.join(".claude"), "code-review", "global one");
        write_skill(&home.join(".claude"), "only-global", "global only");
        write_skill(&project.join(".claude"), "code-review", "project one");
        write_agent_md(&home.join(".claude"), "planner", "global planner");
        write_agent_md(&project.join(".claude"), "planner", "project planner");

        let assets = collect("claude", &home, Some(&project));
        let names: Vec<&str> = assets.skills.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["code-review", "only-global"]);
        assert_eq!(assets.skills[0].description, "project one");
        assert_eq!(assets.skills[0].source, AssetSource::Project);
        assert_eq!(assets.skills[1].source, AssetSource::Global);
        assert_eq!(assets.subagents.len(), 1);
        assert_eq!(assets.subagents[0].description, "project planner");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn plugin_skills_stay_qualified_and_never_shadow_a_bare_name() {
        let base = fixture("plugin-scan");
        let home = base.join("home");
        let plugin = base.join("cache/superpowers/6.2.0");
        write_skill(&home.join(".claude"), "brainstorming", "bare one");
        write_skill(&plugin, "brainstorming", "plugin one");
        let plugins_dir = home.join(".claude/plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                "{{\"plugins\":{{\"superpowers@official\":[{{\"installPath\":\"{}\"}}]}}}}",
                plugin.to_string_lossy()
            ),
        )
        .unwrap();

        let assets = collect("claude", &home, None);
        let names: Vec<&str> = assets.skills.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["brainstorming", "superpowers:brainstorming"]);
        assert_eq!(assets.skills[1].source, AssetSource::Plugin);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn collects_codex_assets_from_user_dirs_only() {
        let base = fixture("codex-scan");
        let home = base.join("home");
        write_skill(&home.join(".codex"), "audit-5-layers", "five layers");
        let agents = home.join(".codex/agents");
        std::fs::create_dir_all(&agents).unwrap();
        std::fs::write(
            agents.join("plan-reviewer.toml"),
            "name = \"ignored\"\ndescription = \"Reviews plans.\"\n",
        )
        .unwrap();
        // A project dir must not be scanned for codex — user dirs only (spec §8).
        let project = base.join("repo");
        write_skill(&project.join(".claude"), "project-skill", "nope");

        let assets = collect("codex", &home, Some(&project));
        assert_eq!(assets.skills.len(), 1);
        assert_eq!(assets.skills[0].name, "audit-5-layers");
        assert_eq!(assets.subagents.len(), 1);
        // Name is the file stem, not the `name =` field (spec §8).
        assert_eq!(assets.subagents[0].name, "plan-reviewer");
        assert_eq!(assets.subagents[0].description, "Reviews plans.");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn unknown_agents_and_missing_dirs_are_empty_not_errors() {
        let base = fixture("empty-scan");
        assert_eq!(collect("gemini", &base, None), PromptAssets::default());
        assert_eq!(
            collect("claude", &base.join("nowhere"), None),
            PromptAssets::default()
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_unreadable_descriptor_skips_only_itself() {
        let base = fixture("bad-file");
        let home = base.join("home");
        write_skill(&home.join(".claude"), "good", "fine");
        // A skill directory with no SKILL.md at all.
        std::fs::create_dir_all(home.join(".claude/skills/empty")).unwrap();
        let assets = collect("claude", &home, None);
        assert_eq!(assets.skills.len(), 1);
        assert_eq!(assets.skills[0].name, "good");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn serializes_for_the_frontend_contract() {
        let asset = PromptAsset {
            kind: AssetKind::Subagent,
            name: "plan-reviewer".into(),
            description: "Reviews plans.".into(),
            source: AssetSource::Plugin,
        };
        assert_eq!(
            serde_json::to_value(&asset).unwrap(),
            serde_json::json!({
                "kind": "subagent",
                "name": "plan-reviewer",
                "description": "Reviews plans.",
                "source": "plugin",
            })
        );
    }
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test prompt_assets`
Expected: FAIL — `cannot find function 'project_root'` / `'plugin_roots'` / `'collect'`.

- [ ] **Step 3: Implement the walk and the scan**

Append to `src-tauri/src/prompt_assets.rs`, above the `tests` module:

```rust
/// The nearest ancestor of `cwd` (itself included) holding `.claude` or
/// `.git`.
///
/// A pane's CWD is usually *inside* a project, not at its root, so the
/// project's own `.claude/skills` is invisible without this walk. First hit
/// wins; `ancestors()` stops at the filesystem root on its own.
pub(crate) fn project_root(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        if dir.join(".claude").is_dir() || dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

/// Every active plugin's `(name, installPath)`, name being the part of
/// `<plugin>@<marketplace>` before the `@`.
///
/// Read from `installed_plugins.json` rather than globbed off the cache
/// directory: the cache keeps stale versions of the same plugin side by side,
/// so a glob would offer skills the CLI can no longer see.
pub(crate) fn plugin_roots(installed_json: &str) -> Vec<(String, PathBuf)> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(installed_json) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(|node| node.as_object()) else {
        return Vec::new();
    };
    let mut roots: Vec<(String, PathBuf)> = Vec::new();
    for (key, installs) in plugins {
        let name = key.split('@').next().unwrap_or(key).to_string();
        let Some(entries) = installs.as_array() else {
            continue;
        };
        for entry in entries {
            if let Some(path) = entry.get("installPath").and_then(|node| node.as_str()) {
                roots.push((name.clone(), PathBuf::from(path)));
            }
        }
    }
    roots.sort();
    roots
}

/// Directory names directly under `dir`, sorted, symlinked entries skipped.
fn child_dir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

/// File names directly under `dir` with the given extension, sorted, symlinks
/// skipped.
fn child_file_stems(dir: &Path, extension: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut stems: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some(extension) {
                return None;
            }
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .collect();
    stems.sort();
    stems
}

/// `<dir>/skills/<name>/SKILL.md`, one asset per readable entry. `prefix`
/// qualifies a plugin's skills (`superpowers:brainstorming`).
fn scan_skills(
    root: &Path,
    source: AssetSource,
    prefix: Option<&str>,
    out: &mut Vec<PromptAsset>,
) {
    let dir = root.join("skills");
    for entry in child_dir_names(&dir) {
        let Some(head) = read_head(&dir.join(&entry).join("SKILL.md")) else {
            continue;
        };
        let (declared, description) = parse_frontmatter(&head);
        let base = declared.unwrap_or(entry);
        let name = match prefix {
            Some(plugin) => format!("{plugin}:{base}"),
            None => base,
        };
        out.push(PromptAsset {
            kind: AssetKind::Skill,
            name,
            description: clamp_description(description),
            source,
        });
    }
}

/// `<root>/agents/<name>.md` (frontmatter) or `<name>.toml` (Codex). The name
/// is always the file stem — a `name:` field that disagrees with the file the
/// CLI loads by path would send the wrong reference into the prompt.
fn scan_agents(root: &Path, source: AssetSource, extension: &str, out: &mut Vec<PromptAsset>) {
    let dir = root.join("agents");
    for stem in child_file_stems(&dir, extension) {
        let path = dir.join(format!("{stem}.{extension}"));
        let Some(head) = read_head(&path) else {
            continue;
        };
        let description = if extension == "toml" {
            parse_toml_description(&head)
        } else {
            parse_frontmatter(&head).1
        };
        out.push(PromptAsset {
            kind: AssetKind::Subagent,
            name: stem,
            description: clamp_description(description),
            source,
        });
    }
}

/// Project entries shadow global ones of the same name (they are collected
/// first), and the per-kind cap applies after the dedupe.
fn merge(mut ordered: Vec<PromptAsset>) -> Vec<PromptAsset> {
    let mut seen = std::collections::HashSet::new();
    ordered.retain(|asset| seen.insert(asset.name.clone()));
    ordered.truncate(RESULT_CAP);
    ordered
}

/// The scan itself, with its roots injected so tests never touch a real home
/// directory. `project` is already resolved by `project_root`.
pub(crate) fn collect(agent: &str, home: &Path, project: Option<&Path>) -> PromptAssets {
    let mut skills: Vec<PromptAsset> = Vec::new();
    let mut subagents: Vec<PromptAsset> = Vec::new();
    match agent {
        "claude" => {
            if let Some(root) = project {
                scan_skills(&root.join(".claude"), AssetSource::Project, None, &mut skills);
                scan_agents(
                    &root.join(".claude"),
                    AssetSource::Project,
                    "md",
                    &mut subagents,
                );
            }
            let user = home.join(".claude");
            scan_skills(&user, AssetSource::Global, None, &mut skills);
            scan_agents(&user, AssetSource::Global, "md", &mut subagents);
            let manifest = user.join("plugins").join("installed_plugins.json");
            if let Some(json) = read_head(&manifest) {
                for (name, install) in plugin_roots(&json) {
                    scan_skills(&install, AssetSource::Plugin, Some(&name), &mut skills);
                }
            }
        }
        "codex" => {
            let user = home.join(".codex");
            scan_skills(&user, AssetSource::Global, None, &mut skills);
            scan_agents(&user, AssetSource::Global, "toml", &mut subagents);
        }
        // Unknown / unverified CLI (gemini, opencode, agy, a declared agent):
        // empty lists, not an error — the picker hides itself (spec §9).
        _ => {}
    }
    PromptAssets {
        skills: merge(skills),
        subagents: merge(subagents),
    }
}

/// The one command. `cwd` is a pane's working directory, not a project root —
/// `project_root` resolves that. A home directory that cannot be resolved is
/// an empty answer, same fail-soft rule as everything else here.
#[tauri::command]
pub async fn list_prompt_assets(agent: String, cwd: Option<String>) -> PromptAssets {
    let Ok(home) = crate::platform::user_home() else {
        return PromptAssets::default();
    };
    let project = cwd
        .map(PathBuf::from)
        .and_then(|dir| project_root(&dir));
    collect(&agent, &home, project.as_deref())
}
```

> Note on `read_head` for `installed_plugins.json`: 16 KiB is the same head bound used for descriptors. If a machine's manifest ever exceeds it, `serde_json` fails to parse the truncated text and `plugin_roots` returns an empty list — plugin skills disappear, nothing else breaks. Documented, accepted.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd src-tauri && cargo test prompt_assets`
Expected: PASS (17 tests total in the module).

- [ ] **Step 5: Register the command**

In `src-tauri/src/lib.rs`, add `mod prompt_assets;` to the module list (alphabetical: after `platform`, before `pty`), and add the handler inside `generate_handler!`, after `agents::dirs_exist`:

```rust
            prompt_assets::list_prompt_assets,
```

- [ ] **Step 6: Build and commit**

```bash
cd src-tauri && cargo test && cargo check && cd ..
git add src-tauri/src/prompt_assets.rs src-tauri/src/lib.rs
git commit -m "feat(prompts): scan skills and subagents from disk"
```

---

### Task 5: Prompt assets IPC client

**Files:**

- Create: `src/prompts/prompt-assets-client.ts`
- Create: `src/prompts/prompt-assets-client.test.ts`

**Interfaces:**

- Consumes: `PromptAssetKind` (Task 2); the Rust payload contract (Task 4).
- Produces:
  - `interface PromptAsset { readonly kind: PromptAssetKind; readonly name: string; readonly description: string; readonly source: "global" | "project" | "plugin" }`
  - `interface PromptAssets { readonly skills: readonly PromptAsset[]; readonly subagents: readonly PromptAsset[] }`
  - `const EMPTY_PROMPT_ASSETS: PromptAssets`
  - `interface PromptAssetsClient { list(agent: string, cwd: string | null): Promise<PromptAssets> }`
  - `createTauriPromptAssetsClient()`, `createMemoryPromptAssetsClient(assets, options?)`, `defaultPromptAssetsClient`

- [ ] **Step 1: Write the failing test**

Create `src/prompts/prompt-assets-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  createMemoryPromptAssetsClient,
  createTauriPromptAssetsClient,
  EMPTY_PROMPT_ASSETS,
} from "./prompt-assets-client";

describe("createTauriPromptAssetsClient", () => {
  it("passes agent and cwd through to the command", async () => {
    invoke.mockResolvedValueOnce({ skills: [], subagents: [] });
    await createTauriPromptAssetsClient().list("claude", "/repo");
    expect(invoke).toHaveBeenCalledWith("list_prompt_assets", {
      agent: "claude",
      cwd: "/repo",
    });
  });
});

describe("createMemoryPromptAssetsClient", () => {
  it("answers with the configured assets", async () => {
    const assets = {
      skills: [
        {
          kind: "skill" as const,
          name: "code-review",
          description: "",
          source: "global" as const,
        },
      ],
      subagents: [],
    };
    await expect(
      createMemoryPromptAssetsClient(assets).list("claude", null),
    ).resolves.toEqual(assets);
  });

  it("can be made to fail, so the caller's degraded path is testable", async () => {
    const client = createMemoryPromptAssetsClient(EMPTY_PROMPT_ASSETS, {
      fail: true,
    });
    await expect(client.list("claude", null)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/prompts/prompt-assets-client.test.ts`
Expected: FAIL — `Failed to resolve import "./prompt-assets-client"`.

- [ ] **Step 3: Write the client**

Create `src/prompts/prompt-assets-client.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { PromptAssetKind } from "./snippet-format";

/** Mirror of the Rust `PromptAsset` payload from `list_prompt_assets`. */
export interface PromptAsset {
  readonly kind: PromptAssetKind;
  /** Qualified as the CLI would address it, e.g. `superpowers:brainstorming`. */
  readonly name: string;
  /** May be "" — a descriptor without a description is still selectable. */
  readonly description: string;
  readonly source: "global" | "project" | "plugin";
}

export interface PromptAssets {
  readonly skills: readonly PromptAsset[];
  readonly subagents: readonly PromptAsset[];
}

export const EMPTY_PROMPT_ASSETS: PromptAssets = { skills: [], subagents: [] };

/** Detection seam — real IPC in production, fakes in tests. */
export interface PromptAssetsClient {
  /** Rejects on IPC failure; the popover degrades to paste-only (spec §12). */
  list(agent: string, cwd: string | null): Promise<PromptAssets>;
}

export function createTauriPromptAssetsClient(): PromptAssetsClient {
  return {
    list(agent, cwd) {
      return invoke<PromptAssets>("list_prompt_assets", { agent, cwd });
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryPromptAssetsClient(
  assets: PromptAssets = EMPTY_PROMPT_ASSETS,
  options: { readonly fail?: boolean } = {},
): PromptAssetsClient {
  return {
    async list() {
      if (options.fail === true) {
        throw new Error("list_prompt_assets failed");
      }
      return assets;
    },
  };
}

/** Shared production client — callers accept an override for tests. */
export const defaultPromptAssetsClient: PromptAssetsClient =
  createTauriPromptAssetsClient();
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/prompts/prompt-assets-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/prompt-assets-client.ts src/prompts/prompt-assets-client.test.ts
git commit -m "feat(prompts): add list_prompt_assets client and memory fake"
```

---

### Task 6: Ordered writes — `pasteText` + per-pane FIFO queue

**Files:**

- Modify: `src/terminal/pane.ts` (the `Pane` interface ~line 40-71, the returned object ~line 336-360)
- Modify: `src/terminal/pane-lifecycle.ts` (`PaneLifecycle` interface, `paneEvents.onData`, new queue)
- Modify: `src/terminal/pane-lifecycle.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `Pane.pasteText(text: string): void` — routes through `term.paste`, the same bracketed-paste + `\n→\r` path the clipboard uses
  - `PaneLifecycle.enqueueWrite(id: number, data: string): void`

- [ ] **Step 1: Write the failing ordering tests**

Add to `src/terminal/pane-lifecycle.test.ts`. The file already has a `fakePane(id, events)` factory at line 9 and passes inline `createPane` closures — there is no `makeLifecycle`/`fakeCreatePane` helper, so the block below writes its own `mount` helper on top of `fakePane`. Do not rename anything already in the file.

**Timing matters here, and the assertions below are deliberate.** `enqueueWrite` chains on `tail.then(...)`, so even the very first write starts one microtask after the call — asserting synchronously right after `enqueueWrite` would see an empty `writes` array and tempt an implementer into "fixing" a queue that is correct. Every assertion is therefore preceded by a microtask flush.

```ts
describe("write queue", () => {
  /** Let every pending microtask chain settle before asserting. */
  const flush = async (): Promise<void> => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  };

  /** A pty whose writes settle only when the test releases them. */
  const gatedPty = () => {
    const writes: { id: number; data: string }[] = [];
    const releases: (() => void)[] = [];
    return {
      writes,
      releases,
      client: {
        ...createMemoryPtyClient(),
        writePty(id: number, data: string) {
          writes.push({ id, data });
          return new Promise<void>((resolve) => releases.push(resolve));
        },
      },
    };
  };

  const mount = (
    gate: ReturnType<typeof gatedPty>,
    // Annotated, not inferred from the default: `= () => {}` would infer
    // `() => void`, and test 3 passes `(id: number) => …`. A function taking
    // MORE parameters than its target type declares is never assignable
    // (TS2345), and `tsconfig.json` includes `src`, so that lands as a red
    // `npm run build` in Step 6 — while vitest stays green, because esbuild
    // does not typecheck.
    onWriteWhileExited: (id: number, data: string) => void = () => {},
  ) =>
    createPaneLifecycle({
      pty: gate.client,
      getSettings: () => DEFAULT_SETTINGS,
      createPane: (id, _settings: Settings, events: PaneEvents) =>
        fakePane(id, events),
      onWriteWhileExited,
      onFocus: () => {},
    });

  const sent = (gate: ReturnType<typeof gatedPty>): string[] =>
    gate.writes.map((write) => write.data);

  it("starts a write only after the previous one settles", async () => {
    const gate = gatedPty();
    const life = mount(gate);
    const pane = await life.spawnPane();

    life.enqueueWrite(pane.id, "frame");
    life.enqueueWrite(pane.id, "\r");
    await flush();
    // The second write must not have started while the first is unsettled.
    expect(sent(gate)).toEqual(["frame"]);

    gate.releases[0]();
    await flush();
    expect(sent(gate)).toEqual(["frame", "\r"]);
  });

  it("drops a queued write for a pane that exited meanwhile", async () => {
    const gate = gatedPty();
    const life = mount(gate);
    const pane = await life.spawnPane();

    life.enqueueWrite(pane.id, "frame");
    await flush();
    expect(sent(gate)).toEqual(["frame"]);

    // Queued while the pane is still alive, so it passes the enqueue-time
    // guard; the pane then exits before its turn comes up.
    life.enqueueWrite(pane.id, "\r");
    life.exited.add(pane.id);
    gate.releases[0]();
    await flush();
    expect(sent(gate)).toEqual(["frame"]);
  });

  it("still routes a bare Enter on an exited pane to the respawn path", async () => {
    const gate = gatedPty();
    const respawns: number[] = [];
    const life = mount(gate, (id: number) => respawns.push(id));
    const pane = await life.spawnPane();
    life.exited.add(pane.id);
    life.paneEvents.onData(pane.id, "\r");
    // Synchronous: the enqueue-time guard fires before any microtask.
    expect(respawns).toEqual([pane.id]);
    await flush();
    expect(gate.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts`
Expected: FAIL — `life.enqueueWrite is not a function`.

- [ ] **Step 3: Add the queue to `pane-lifecycle.ts`**

Add to the `PaneLifecycle` interface, after `paneEvents`:

```ts
  /**
   * Queue one write for a pane, behind everything already queued for it.
   * `onData` uses this too, which is what makes "paste frame, then `\r`"
   * ordered by construction rather than by a timeout.
   */
  enqueueWrite(id: number, data: string): void;
```

Inside `createPaneLifecycle`, after `const respawning = new Set<number>();`:

```ts
/**
 * Per-pane write chain. `pty.writePty` is fire-and-forget over IPC, so two
 * writes issued back to back have no ordering guarantee — a `\r` could
 * reach the PTY before the paste frame it is meant to submit. Chaining each
 * write behind the previous one's settled promise makes the order
 * structural; no timers, no arbitrary delays.
 */
const writeChains = new Map<number, Promise<void>>();

function enqueueWrite(id: number, data: string): void {
  if (exited.has(id)) {
    deps.onWriteWhileExited(id, data);
    return;
  }
  const tail = writeChains.get(id) ?? Promise.resolve();
  const next = tail.then(async () => {
    // Re-checked at drain time, not only at enqueue time: the pane may have
    // exited or closed while this write waited its turn.
    if (exited.has(id) || !panes.has(id)) {
      return;
    }
    try {
      await deps.pty.writePty(id, data);
    } catch {
      reportPersistError(
        "Couldn't send input to the terminal — the session may have ended.",
      );
    }
  });
  writeChains.set(id, next);
  void next.finally(() => {
    if (writeChains.get(id) === next) {
      writeChains.delete(id);
    }
  });
}
```

Replace the body of `paneEvents.onData` with:

```ts
    onData(id, data) {
      enqueueWrite(id, data);
    },
```

Return `enqueueWrite` from the factory, beside `paneEvents`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts`
Expected: PASS, including every pre-existing test in that file (the exited-pane and write-failure behaviours are preserved verbatim).

- [ ] **Step 5: Add `Pane.pasteText`**

In `src/terminal/pane.ts`, add to the `Pane` interface after `paste()`:

```ts
  /**
   * Paste arbitrary text through the same bracketed-paste path as the
   * clipboard (`\n → \r`, DECSET 2004) — the only route that lands a
   * multi-line body in an agent TUI's composer as one block instead of
   * line by line. Writing the bytes to the PTY directly skips both.
   */
  pasteText(text: string): void;
```

And to the returned object, after `paste()`:

```ts
    pasteText(text) {
      term.paste(text);
    },
```

- [ ] **Step 6: Verify the type surface and commit**

Run: `npm run build`
Expected: PASS (this is `tsc && vite build`). Adding a method to the `Pane` interface breaks **every** full fake of it. There are exactly three, all needing a `pasteText() {}` stub: `src/terminal/pane-lifecycle.test.ts:14` (`fakePane`), `src/terminal/terminal-manager.test.ts:22`, `src/terminal/tab-manager.test.ts:109`. Add all three in this step, or `npm run build` stays red.

```bash
git add src/terminal/pane.ts src/terminal/pane-lifecycle.ts src/terminal/pane-lifecycle.test.ts
git commit -m "feat(terminal): order pane writes through a per-pane FIFO queue"
```

---

### Task 7: Injection gate + TabManager primitives

**Files:**

- Create: `src/prompts/inject.ts`
- Create: `src/prompts/inject.test.ts`
- Modify: `src/terminal/terminal-manager.ts` (interface + returned object)
- Modify: `src/terminal/tab-manager.ts` (interface + returned object)
- Modify: `src/terminal/tab-manager.test.ts`

**Interfaces:**

- Consumes: `PaneLifecycle.enqueueWrite`, `Pane.pasteText` (Task 6); `freshPaneInfo` (`src/terminal/pane-info.ts`); `PaneAttentionSnapshot` (`src/terminal/agent-attention.ts`); `PaneProcessInfo` (`src/lib/process-info.ts`).
- Produces:
  - `interface PromptTarget { readonly paneId: number; readonly agent: string | null; readonly cwd: string | null }`
  - `type InjectOutcome = "sent" | "pasted" | "no-target"`
  - `submitAllowed(input: SubmitGateInput): boolean` (pure)
  - `capturePromptTarget(activePaneId: number | null, pty?: PtyClient): Promise<PromptTarget | null>`
  - `TerminalManager.pasteIntoPane(id: number, text: string): boolean`
  - `TerminalManager.submitPane(id: number): boolean`
  - `TabManager.activePaneId(): number | null`
  - `TabManager.paneAttention(paneId: number): PaneAttentionSnapshot | null`
  - `TabManager.injectIntoPane(paneId: number, text: string, opts: { readonly autoSend: boolean; readonly expectedAgent: string | null }): Promise<InjectOutcome>`

- [ ] **Step 1: Write the failing gate tests**

Create `src/prompts/inject.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { capturePromptTarget, submitAllowed } from "./inject";
import { createMemoryPtyClient } from "../terminal/pty-client";
import type { PaneAttentionSnapshot } from "../terminal/agent-attention";
import type { PaneProcessInfo } from "../lib/process-info";

const agentInfo = (patch: Partial<PaneProcessInfo> = {}): PaneProcessInfo => ({
  id: 1,
  cwd: "/repo",
  process: "claude",
  kind: "agent",
  agent: "claude",
  ...patch,
});

const idle = (
  patch: Partial<PaneAttentionSnapshot> = {},
): PaneAttentionSnapshot => ({
  phase: "idle",
  attention: "none",
  source: null,
  confidence: "explicit",
  agentLabel: "claude",
  unread: false,
  changedAt: 0,
  revision: 1,
  ...patch,
});

describe("submitAllowed", () => {
  it("passes when all three gates hold", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle(),
        alive: true,
      }),
    ).toBe(true);
  });

  it("passes on a completed run — the agent is done, not mid-dialog", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle({ attention: "completed" }),
        alive: true,
      }),
    ).toBe(true);
  });

  it("fails gate 1 when the pane is no longer that agent", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo({ kind: "idle-shell", agent: null }),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo({ agent: "codex", process: "codex" }),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: null,
        info: agentInfo(),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: undefined,
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
  });

  it("fails gate 2 while working or while attention is latched", () => {
    for (const attention of [
      idle({ phase: "working" }),
      idle({ attention: "requested" }),
      idle({ attention: "warning" }),
      idle({ attention: "error" }),
    ]) {
      expect(
        submitAllowed({
          expectedAgent: "claude",
          info: agentInfo(),
          attention,
          alive: true,
        }),
      ).toBe(false);
    }
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: null,
        alive: true,
      }),
    ).toBe(false);
  });

  it("fails gate 3 when the pane is gone from the layout", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle(),
        alive: false,
      }),
    ).toBe(false);
  });
});

describe("capturePromptTarget", () => {
  it("snapshots the pane, its agent and its cwd", async () => {
    const pty = createMemoryPtyClient({
      infos: new Map([[7, agentInfo({ id: 7 })]]),
    });
    await expect(capturePromptTarget(7, pty)).resolves.toEqual({
      paneId: 7,
      agent: "claude",
      cwd: "/repo",
    });
  });

  it("reports a bare shell as no agent, not as a missing target", async () => {
    const info = agentInfo({
      id: 8,
      kind: "idle-shell",
      agent: null,
      process: "zsh",
    });
    const pty = createMemoryPtyClient({ infos: new Map([[8, info]]) });
    await expect(capturePromptTarget(8, pty)).resolves.toEqual({
      paneId: 8,
      agent: null,
      cwd: "/repo",
    });
  });

  it("has no target with no active pane", async () => {
    await expect(
      capturePromptTarget(null, createMemoryPtyClient()),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/prompts/inject.test.ts`
Expected: FAIL — `Failed to resolve import "./inject"`.

- [ ] **Step 3: Write `src/prompts/inject.ts`**

```ts
import type { PaneProcessInfo } from "../lib/process-info";
import type { PaneAttentionSnapshot } from "../terminal/agent-attention";
import { freshPaneInfo } from "../terminal/pane-info";
import { defaultPtyClient, type PtyClient } from "../terminal/pty-client";

/**
 * What the popover captured when it opened. Every later step — scan, paste,
 * submit — uses this snapshot's `paneId`, never "whatever is active now": the
 * user picked a template for the pane they were looking at.
 */
export interface PromptTarget {
  readonly paneId: number;
  /** The agent the pane ran at capture time; null = bare shell (paste only). */
  readonly agent: string | null;
  readonly cwd: string | null;
}

/** `sent` = pasted and submitted, `pasted` = pasted with `\r` withheld. */
export type InjectOutcome = "sent" | "pasted" | "no-target";

export interface SubmitGateInput {
  /** The agent captured when the popover opened. */
  readonly expectedAgent: string | null;
  /** Fresh `pty_info` for the target pane — undefined when it was not reported. */
  readonly info: PaneProcessInfo | undefined;
  /** Attention snapshot for the target pane, from the tracker. */
  readonly attention: PaneAttentionSnapshot | null;
  /** Whether the pane is still in some tab's layout. */
  readonly alive: boolean;
}

/**
 * The triple gate (spec §7). Read immediately before `\r` is enqueued, never
 * at popover-open time — the whole point is that state can change in between.
 *
 * 1. the pane still runs the SAME agent it ran at capture;
 * 2. it is idle with nothing latched — a `working` pane, or one carrying a
 *    `requested`/`warning`/`error` latch, may be showing a dialog whose
 *    highlighted option Enter would accept;
 * 3. it is still in the layout.
 *
 * `completed` passes: it is the latch a finished run leaves behind, which is
 * exactly the moment a follow-up prompt is wanted.
 *
 * Residual risk, accepted and documented in the spec: a TUI dialog that emits
 * no OSC signal is invisible to gate 2. Per-template `autoSend` is the user's
 * choice made in that knowledge.
 */
export function submitAllowed({
  expectedAgent,
  info,
  attention,
  alive,
}: SubmitGateInput): boolean {
  if (!alive) {
    return false;
  }
  if (expectedAgent === null || info === undefined) {
    return false;
  }
  if (info.kind !== "agent" || info.agent !== expectedAgent) {
    return false;
  }
  if (attention === null || attention.phase !== "idle") {
    return false;
  }
  return attention.attention === "none" || attention.attention === "completed";
}

/**
 * Snapshot the focused pane. Fresh `pty_info`, not the 2s poll cache: the user
 * may have started or quit an agent since the last tick, and the captured
 * agent is what gate 1 later compares against.
 */
export async function capturePromptTarget(
  activePaneId: number | null,
  pty: PtyClient = defaultPtyClient,
): Promise<PromptTarget | null> {
  if (activePaneId === null) {
    return null;
  }
  const [info] = await freshPaneInfo([activePaneId], pty);
  return {
    paneId: activePaneId,
    agent: info?.kind === "agent" ? info.agent : null,
    cwd: info?.cwd ?? null,
  };
}
```

- [ ] **Step 4: Run the gate tests and watch them pass**

Run: `npx vitest run src/prompts/inject.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the TerminalManager primitives**

In `src/terminal/terminal-manager.ts`, add to the `TerminalManager` interface after `pasteIntoActive()`:

```ts
  /**
   * Paste text into ONE pane by id (the Prompt Board targets the pane the
   * popover captured, not whatever is active by the time the user clicks).
   * False when the pane is unknown or already exited.
   */
  pasteIntoPane(id: number, text: string): boolean;
  /**
   * Queue a bare `\r` for one pane, behind whatever it already has queued —
   * which is what makes it land after a paste frame issued moments earlier.
   * False when the pane is unknown or already exited.
   */
  submitPane(id: number): boolean;
```

And to the returned object, after `pasteIntoActive()`:

```ts
    pasteIntoPane(id, text) {
      const pane = life.panes.get(id);
      if (!pane || life.exited.has(id)) {
        return false;
      }
      pane.pasteText(text);
      return true;
    },
    submitPane(id) {
      if (!life.panes.has(id) || life.exited.has(id)) {
        return false;
      }
      life.enqueueWrite(id, "\r");
      return true;
    },
```

- [ ] **Step 6: Write the failing TabManager tests**

Add to `src/terminal/tab-manager.test.ts` (reuse the file's existing harness for creating a manager with a memory pty and fake panes):

```ts
describe("injectIntoPane", () => {
  it("pastes and sends when the gate holds", async () => {
    // Harness: one tab, pane id 1 reported as an idle claude agent, tracker
    // primed by a poll (`noteProcess` runs inside the poller's onUpdate).
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId();
    expect(paneId).not.toBeNull();
    await expect(
      manager.injectIntoPane(paneId as number, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("sent");
    expect(pty.writes.at(-1)).toEqual({ id: paneId, data: "\r" });
  });

  it("pastes without sending when autoSend is off", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: false,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
  });

  it("withholds the submit when the pane changed agent since capture", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("codex");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
  });

  it("reports no target for an unknown pane", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    await expect(
      manager.injectIntoPane(9999, "x", {
        autoSend: false,
        expectedAgent: null,
      }),
    ).resolves.toBe("no-target");
  });
});
```

> `mountManagerWithAgentPane` is a helper to add in that test file. It creates a `TabManager` over a memory pty whose `ptyInfo` reports `{ kind: "agent", agent, process: agent }` for the spawned pane, **calls `await tm.init()`**, materializes one tab, and awaits one poll cycle.
>
> `init()` is not optional here: the memory client's `emitOutput` only reaches handlers registered through `listenOutput`, and `TabManager` registers that listener exclusively inside `init()`. Skip it and the OSC emit below is a silent no-op — the phase stays `unknown` and the test fails with the exact same pasted-not-sent symptom described next, from a different cause. (Materialize alone does drive the poll, so the process gate opens either way; only the OSC emit needs the listener.)
>
> **A poll alone is not enough, and getting this wrong looks like a gate bug.** `freshState()` starts a pane at `phase: "unknown"` ([`agent-attention.ts:168-183`](../../src/terminal/agent-attention.ts)), and `noteProcess`'s pre-poll→agent branch (`:406-417`) spreads `prev` without touching `phase` — the poll opens the process gate but leaves the phase `unknown`, so gate 2 (`phase === "idle"`) refuses and the "pastes and sends" test would resolve `"pasted"`. After the poll the helper must therefore drive one activity transition, exactly as the existing attention tests in this same file do (e.g. `tab-manager.test.ts:620`):
>
> ```ts
> pty.emitOutput(paneId, "\x1b]9;4;0\x07"); // OSC 9;4 state 0 → idle
> ```
>
> After that emit the pane reads `phase: "idle"`, `attention: "none"` — `reduceActivity`'s idle branch only latches `completed` when the previous phase was `working`, and here it was `unknown`. `submitAllowed` passes on the `"none"` arm. (A helper that emitted `9;4;1` before `9;4;0` would land on `completed` instead, which also passes — by design.)
>
> **Do not "fix" this by letting gate 2 accept `"unknown"`.** Gate 2 is the safety property this whole feature is built around: an unpolled pane whose state nobody has observed is exactly the pane an Enter must not be sent to.

- [ ] **Step 7: Run and watch them fail**

Run: `npx vitest run src/terminal/tab-manager.test.ts`
Expected: FAIL — `manager.injectIntoPane is not a function`.

- [ ] **Step 8: Add the TabManager methods**

In `src/terminal/tab-manager.ts`, import the gate:

```ts
import { submitAllowed, type InjectOutcome } from "../prompts/inject";
```

and **extend** the existing `pane-info` import at `tab-manager.ts:56` rather than adding a second one (a duplicate `freshCwd` binding is a compile error):

```ts
import { freshCwd, freshPaneInfo } from "./pane-info";
```

Add to the `TabManager` interface:

```ts
  /** The focused pane of the active tab; null when there is no tab. */
  activePaneId(): number | null;
  /** Attention snapshot for one pane — the tracker's read side (gate 2). */
  paneAttention(paneId: number): PaneAttentionSnapshot | null;
  /**
   * Paste `text` into `paneId`, then submit only when the triple gate still
   * holds (spec §7). Never throws: a failed gate degrades to `"pasted"`, an
   * unknown pane to `"no-target"`.
   */
  injectIntoPane(
    paneId: number,
    text: string,
    opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
  ): Promise<InjectOutcome>;
```

Add the implementation beside `activePaneCwd` (before the returned object):

```ts
function ownerOf(paneId: number): TabEntry | undefined {
  return tabs.find((tab) => tab.manager.paneIds().includes(paneId));
}

/**
 * The tracker's read side (gate 2). One function, used by `injectIntoPane`
 * below AND returned on the interface, so the gate and any future reader can
 * never disagree about where a pane's attention comes from.
 */
function paneAttention(paneId: number): PaneAttentionSnapshot | null {
  return tracker.snapshot(paneId);
}

/**
 * Paste-then-maybe-submit for the Prompt Board. The paste is unconditional
 * (it is exactly a ⌘V, and bracketed paste means even a bare shell inserts
 * without executing); the `\r` is not. Ordering is guaranteed by the
 * per-pane write queue, not by waiting: the paste frame is already queued
 * before this function awaits anything, so a `\r` enqueued after the await
 * can only ever land behind it.
 */
async function injectIntoPane(
  paneId: number,
  text: string,
  opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
): Promise<InjectOutcome> {
  const owner = ownerOf(paneId);
  if (!owner || !owner.manager.pasteIntoPane(paneId, text)) {
    return "no-target";
  }
  if (!opts.autoSend) {
    return "pasted";
  }
  const [info] = await freshPaneInfo([paneId], pty);
  // Re-resolved after the await: the tab could have closed across it.
  const stillOwned = ownerOf(paneId);
  const allowed = submitAllowed({
    expectedAgent: opts.expectedAgent,
    info,
    attention: paneAttention(paneId),
    alive: stillOwned !== undefined,
  });
  if (!allowed || stillOwned === undefined) {
    return "pasted";
  }
  return stillOwned.manager.submitPane(paneId) ? "sent" : "pasted";
}
```

Add to the returned object:

```ts
    activePaneId() {
      return activeManager()?.activePaneId() ?? null;
    },
    paneAttention,
    injectIntoPane,
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `npx vitest run src/terminal/tab-manager.test.ts src/prompts/inject.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npm test
git add src/prompts/inject.ts src/prompts/inject.test.ts \
  src/terminal/terminal-manager.ts src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts
git commit -m "feat(prompts): gate prompt submission behind a fresh triple check"
```

---

### Task 8: `CommitTextarea`

**Files:**

- Create: `src/ui/controls/commit-textarea.tsx`
- Create: `src/ui/controls/commit-textarea.test.tsx`
- Modify: `src/styles.css` (one rule block; see Step 5)

**Interfaces:**

- Consumes: nothing.
- Produces: `CommitTextarea({ value, placeholder, ariaLabel, onCommit, autoFocus? })` — commits on blur and on ⌘/Ctrl+Enter, reverts on Escape, auto-grows to a max height then scrolls.

- [ ] **Step 1: Write the failing test**

Create `src/ui/controls/commit-textarea.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitTextarea } from "./commit-textarea";

describe("CommitTextarea", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const mount = (
    value: string,
    onCommit: (next: string) => void,
  ): HTMLTextAreaElement => {
    act(() =>
      render(
        <CommitTextarea
          value={value}
          placeholder="prompt body"
          ariaLabel="Body"
          onCommit={onCommit}
        />,
        host,
      ),
    );
    return host.querySelector("textarea") as HTMLTextAreaElement;
  };

  const type = (field: HTMLTextAreaElement, next: string): void => {
    act(() => {
      field.value = next;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("does not commit per keystroke", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "new body");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the draft on blur", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "new body");
    act(() => field.dispatchEvent(new FocusEvent("blur", { bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith("new body");
  });

  it("commits on Cmd+Enter and leaves a bare Enter to the textarea", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "line one");
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onCommit).not.toHaveBeenCalled();
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(onCommit).toHaveBeenCalledWith("line one");
  });

  it("reverts the draft on Escape without committing", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "discarded");
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(field.value).toBe("old");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("adopts a value changed elsewhere, e.g. restore defaults", () => {
    const onCommit = vi.fn();
    mount("old", onCommit);
    act(() =>
      render(
        <CommitTextarea
          value="from the store"
          placeholder="prompt body"
          ariaLabel="Body"
          onCommit={onCommit}
        />,
        host,
      ),
    );
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "from the store",
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/ui/controls/commit-textarea.test.tsx`
Expected: FAIL — `Failed to resolve import "./commit-textarea"`.

- [ ] **Step 3: Write the control**

Create `src/ui/controls/commit-textarea.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

/** Ceiling before the field scrolls instead of growing (DL-13.5). */
const MAX_HEIGHT_PX = 220;

interface CommitTextareaProps {
  /** The committed value from the store. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  /**
   * Called with the draft on blur or ⌘/Ctrl+Enter — never per keystroke, and
   * never trimmed: a prompt body's own whitespace is content. The caller
   * validates and may refuse; refusing leaves the draft in place so nothing
   * the user typed is lost.
   */
  onCommit: (value: string) => void;
  /** Focus on mount — the click that revealed it landed on the row, not here. */
  autoFocus?: boolean;
}

/**
 * Multi-line sibling of `CommitInput` (DL-6.3, DL-13.5). Same reason for
 * existing: a store-controlled `value={…}` field inside a surface that never
 * unmounts is a data-loss trap, because any app re-render rewrites the DOM
 * value out from under whatever is being typed.
 *
 * Enter is deliberately NOT a commit — it inserts a newline, which is the
 * whole point of a multi-line body. ⌘/Ctrl+Enter commits, Escape reverts.
 */
export function CommitTextarea({
  value,
  placeholder,
  ariaLabel,
  onCommit,
  autoFocus = false,
}: CommitTextareaProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Adopt changes made elsewhere (restore defaults, another edit) without
  // clobbering a draft still being typed.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  // Grow with the content up to the ceiling, then scroll. Layout effect, not
  // a rAF loop: one synchronous measure per change (DL-1.3).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field === null) {
      return;
    }
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  const commit = (): void => {
    if (draft === committed.current) {
      return;
    }
    onCommit(draft);
  };

  return (
    <textarea
      ref={fieldRef}
      class="text-input prompt-textarea"
      rows={3}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autofocus={autoFocus}
      value={draft}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(committed.current);
        }
      }}
    />
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/ui/controls/commit-textarea.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add its one style rule**

Append to `src/styles.css`, right after the `.text-input--small` rule:

```css
/* Multi-line field (DL-13.5): inherits .text-input, grows by content up to a
   ceiling set in JS, then scrolls. No resize grip — the height is derived. */
.prompt-textarea {
  min-height: 60px;
  max-height: 220px;
  resize: none;
  line-height: 1.45;
  font-size: 11.5px;
}
```

- [ ] **Step 6: Commit**

```bash
npm test
git add src/ui/controls/commit-textarea.tsx src/ui/controls/commit-textarea.test.tsx src/styles.css
git commit -m "feat(chrome): add CommitTextarea for multi-line chrome fields"
```

---

### Task 9: Action, keymap, dispatch and generated menu

**Files:**

- Modify: `src/terminal/action-registry.ts` (registry row after `focus-next-attention` ~line 370; `MACOS_KEYMAP` ~line 629; `WINDOWS_KEYMAP` ~line 759)
- Modify: `src/terminal/tab-manager.ts` (`COMMAND_ACTIONS` ~line 113, the `commands` table ~line 976)
- Modify: `src/chrome/events.ts`
- Modify: `src/terminal/action-registry.test.ts`, `src/terminal/tab-manager.test.ts`
- Regenerate: `src-tauri/src/menu_registry.rs` via `npm run generate:menu`

**Interfaces:**

- Consumes: `reportChromeMessage` (`src/chrome/events.ts`).
- Produces:
  - action id `"toggle-prompts"`, label `"Prompts…"`, `scope: "pane"`, `menu: { submenu: "View", group: "prompts" }`
  - bindings: macOS `⌘⇧P`, Windows `Ctrl+Shift+P`
  - `promptsOpen` signal (`src/chrome/events.ts`)

- [ ] **Step 1: Write the failing tests**

Add to `src/terminal/action-registry.test.ts`:

```ts
it("binds toggle-prompts on both platforms without colliding", () => {
  const mac = MACOS_KEYMAP.filter(
    (binding) => binding.action === "toggle-prompts",
  );
  const win = WINDOWS_KEYMAP.filter(
    (binding) => binding.action === "toggle-prompts",
  );
  expect(mac).toEqual([
    { key: "p", meta: true, shift: true, action: "toggle-prompts" },
  ]);
  expect(win).toEqual([
    { key: "p", ctrl: true, shift: true, action: "toggle-prompts" },
  ]);
  // It has a menu item, so the RULE above CharKeyBinding requires `key`.
  expect(mac[0]).not.toHaveProperty("code");
});
```

**Also update the id-census test in the same file.** `action-registry.test.ts:41` is `it("has exactly the 42 action ids including updater menu actions")` and enumerates all 42 in a literal `Set` — adding a registry row makes it 43 and turns that test red. Add `"toggle-prompts"` to the enumerated set (beside `"toggle-settings"`) and change the title to `"has exactly the 43 action ids including updater menu actions"`. This is deliberate bookkeeping, not a test to loosen: the census is what stops an action from being added without anyone noticing.

Add to `src/terminal/tab-manager.test.ts`. The file's `beforeEach` (`:276-290`) resets none of the overlay signals or `persistError`, and existing tests set them, so this block resets everything it depends on rather than inheriting whatever ran before it. `boardOpen`, `editorRequest`, `saveDialogOpen` and `settingsOpen` are already imported in that file (`:9-14`); add `promptsOpen` and `persistError` from `../chrome/events`.

```ts
describe("toggle-prompts", () => {
  beforeEach(() => {
    promptsOpen.value = false;
    persistError.value = null;
    // `scope: "pane"` blocks this action while ANY overlay is open, so all
    // four overlay signals have to be cleared — not just the board. This is
    // load-bearing, not defensive: the file's last test
    // (tab-manager.test.ts:3374) sets `settingsOpen.value = true` and never
    // resets it, and the file-level beforeEach (:276) does not either — so a
    // describe appended at the end of the file inherits an open Settings and
    // both tests below fail.
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  it("opens the popover signal when a pane is focused", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(true);
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
  });

  it("says so instead of opening with no pane to paste into", () => {
    const manager = createTabManager(
      document.createElement("div"),
      createMemoryPtyClient(),
    );
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
    expect(persistError.value).toBe("No pane to paste into.");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/tab-manager.test.ts`
Expected: FAIL — `"toggle-prompts"` is not a valid `ActionId`, and `promptsOpen` does not exist.

- [ ] **Step 3: Add the signal**

Append to `src/chrome/events.ts`:

```ts
/**
 * Prompt Board popover open state.
 *
 * Deliberately NOT part of `openOverlayRanks()` (tab-manager.ts): this is a
 * pane-level popover anchored to a chrome button, not a surface that covers
 * the terminal grid, so it neither blocks other actions nor needs a tier. The
 * relationship runs the other way — the trigger is disabled and an open
 * popover closes while a real overlay is up, because the pane it targets is
 * then hidden.
 */
export const promptsOpen = signal(false);
```

- [ ] **Step 4: Add the registry row and bindings**

In `src/terminal/action-registry.ts`, after the `focus-next-attention` entry:

```ts
  {
    id: "toggle-prompts",
    label: "Prompts…",
    // Tier "pane": the popover targets the FOCUSED pane, which every overlay
    // hides — the same reason `save-preset` refuses to capture a layout it
    // cannot show. The chrome button carries its own disabled state, because
    // a direct onClick never passes through `overlayBlocksAction`.
    scope: "pane",
    menu: { submenu: "View", group: "prompts" },
  },
```

In `MACOS_KEYMAP`, after the `toggle-settings` binding:

```ts
  // Prompt Board. ⌘⇧P is free on both keymaps (no `p` binding existed) and
  // matches the "palette" chord people already reach for. CharKeyBinding is
  // mandatory, not a style choice: this action has a macOS menu item, and a
  // Cocoa accelerator is declared by character (see the RULE above).
  { key: "p", meta: true, shift: true, action: "toggle-prompts" },
```

In `WINDOWS_KEYMAP`, after the `toggle-settings` binding:

```ts
  { key: "p", ctrl: true, shift: true, action: "toggle-prompts" },
```

- [ ] **Step 5: Wire the dispatch**

In `src/terminal/tab-manager.ts`, add `"toggle-prompts"` to `COMMAND_ACTIONS` (keep the list alphabetical — it sits between `toggle-expand` and `toggle-settings`), import the signal:

```ts
import {
  boardOpen,
  editorRequest,
  promptsOpen,
  reportChromeMessage,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
```

and add to the `commands` table, next to `toggle-settings`:

```ts
    // Writes the signal directly rather than routing through an App seam
    // (unlike toggle-settings): the popover has no draft to protect and no
    // overlay stack to keep consistent — the same reason `open-tab-options`
    // sets `requestTabOptionsKey` itself.
    //
    // The close branch returns focus HERE, not in the popover: this path
    // unmounts the surface without ever calling its `onClose`, so DL-13.2's
    // "focus returns to the pane that had it" would otherwise be skipped and
    // the caret would land on <body> — the shortcut fires while focus sits on
    // the popover root, a div, so nothing else would take it back.
    "toggle-prompts": () => {
      if (promptsOpen.value) {
        promptsOpen.value = false;
        activeManager()?.focusActive();
        return;
      }
      if ((activeManager()?.activePaneId() ?? null) === null) {
        reportChromeMessage("No pane to paste into.");
        return;
      }
      promptsOpen.value = true;
    },
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/tab-manager.test.ts src/terminal/dispatch-coverage.test.ts src/terminal/keymap.test.ts`
Expected: PASS — including `dispatch-coverage.test.ts`, which fails if a keymap binding points at an action nothing dispatches.

- [ ] **Step 7: Regenerate the menu**

```bash
npm run generate:menu
npm run generate:menu:check
```

Expected: `menu_registry.rs` gains a `toggle_prompts` item in the View submenu, preceded by a separator (its `group` differs from `attention`), with accelerator `Some("CmdOrCtrl+Shift+P")`. Do not hand-edit the output (R3).

- [ ] **Step 8: Commit**

```bash
npm test && cd src-tauri && cargo check && cd ..
git add src/terminal/action-registry.ts src/terminal/action-registry.test.ts \
  src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts \
  src/chrome/events.ts src-tauri/src/menu_registry.rs
git commit -m "feat(prompts): register the toggle-prompts action and shortcut"
```

---

### Task 10: The popover surface

**Files:**

- Create: `src/prompts/prompt-popover.tsx`
- Create: `src/prompts/prompt-popover.test.tsx`
- Modify: `src/ui/chrome-actions.tsx`
- Modify: `src/ui/tab-bar.tsx` (forward the new props to its `ChromeActions`)
- Modify: `src/ui/app.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `PromptTemplate`, `createPromptTemplateId`, `TEMPLATE_LABEL_MAX`, `TEMPLATE_BODY_MAX` (Task 1); `composePromptText`, `isPromptAgentId`, `PromptAssetKind` (Task 2); `PromptAssets`, `defaultPromptAssetsClient` (Task 5); `PromptTarget`, `InjectOutcome`, `capturePromptTarget` (Task 7); `CommitTextarea` (Task 8); `promptsOpen` (Task 9); `settings`, `updateSettings`; `ConfigRow`, `CommitInput`; `tabViews`; `reportChromeMessage`.
- Produces:

```ts
interface PromptPopoverProps {
  /** Snapshots the focused pane; null closes the popover with a message. */
  capture(): Promise<PromptTarget | null>;
  /** Fetches detected assets; rejection degrades the pickers, not the list. */
  loadAssets(target: PromptTarget): Promise<PromptAssets>;
  /** Paste (+ maybe submit) into the captured pane. */
  inject(
    target: PromptTarget,
    text: string,
    autoSend: boolean,
  ): Promise<InjectOutcome>;
  /** Whether the captured pane is still in some tab's layout. */
  isAlive(paneId: number): boolean;
  onClose(): void;
}
export function PromptPopover(props: PromptPopoverProps): JSX.Element;
```

and on `ChromeActions`: `promptsOpen: boolean`, `promptsDisabled: boolean`, `onTogglePrompts(): void`, `promptPopover?: ComponentChildren`.

- [ ] **Step 1: Write the failing component test**

Create `src/prompts/prompt-popover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

import { PromptPopover } from "./prompt-popover";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { EMPTY_PROMPT_ASSETS } from "./prompt-assets-client";
import type { PromptTarget } from "./inject";

const target: PromptTarget = { paneId: 1, agent: "claude", cwd: "/repo" };

const templates = [
  { id: "tpl:fix-bug", label: "fix bug", body: "Fix it.", autoSend: false },
  { id: "tpl:review", label: "review PR", body: "Review it.", autoSend: true },
];

describe("PromptPopover", () => {
  let host: HTMLDivElement;
  let inject: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS, promptTemplates: templates };
    inject = vi.fn(async () => "sent" as const);
    onClose = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    settings.value = DEFAULT_SETTINGS;
  });

  const mount = async (
    overrides: Partial<Parameters<typeof PromptPopover>[0]> = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <PromptPopover
          capture={async () => target}
          loadAssets={async () => EMPTY_PROMPT_ASSETS}
          inject={inject}
          isAlive={() => true}
          onClose={onClose}
          {...overrides}
        />,
        host,
      );
      await Promise.resolve();
    });
  };

  const click = (element: Element): void => {
    act(() =>
      element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  };

  it("renders one row per template with the auto tag on autoSend", async () => {
    await mount();
    const rows = host.querySelectorAll(".cfg-row--item");
    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("fix bug");
    expect(host.querySelectorAll(".prompt-row__auto")).toHaveLength(1);
  });

  it("injects the body and closes when the pill is clicked", async () => {
    await mount();
    click(host.querySelector('[aria-label="Inject fix bug"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });
    expect(inject).toHaveBeenCalledWith(target, "Fix it.", false);
    expect(onClose).toHaveBeenCalled();
  });

  it("expands exactly one editor at a time (DL-13.4)", async () => {
    await mount();
    const labels = host.querySelectorAll(".cfg-row__label--edit");
    click(labels[0]);
    expect(host.querySelectorAll(".prompt-editor")).toHaveLength(1);
    click(labels[1]);
    expect(host.querySelectorAll(".prompt-editor")).toHaveLength(1);
    expect(labels[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the pickers when the captured pane runs no known agent", async () => {
    await mount({ capture: async () => ({ ...target, agent: null }) });
    expect(host.querySelector(".prompt-picker")).toBeNull();
    // Templates still inject — paste-only.
    expect(host.querySelectorAll(".cfg-row--item")).toHaveLength(2);
  });

  it("shows one faint line, not an error state, when detection fails", async () => {
    await mount({
      loadAssets: async () => {
        throw new Error("ipc");
      },
    });
    expect(host.textContent).toContain("skills unavailable");
    expect(host.querySelectorAll(".cfg-row--item")).toHaveLength(2);
  });

  it("closes without injecting when there is no target", async () => {
    await mount({ capture: async () => null });
    expect(onClose).toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it("closes when the captured pane leaves the layout", async () => {
    let alive = true;
    await mount({ isAlive: () => alive });
    expect(onClose).not.toHaveBeenCalled();
    alive = false;
    // tabViews is what syncViews bumps on close/exit.
    await act(async () => {
      tabViews.value = [];
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses an empty body with an inline error", async () => {
    await mount();
    click(host.querySelector(".cfg-row__label--edit") as Element);
    const body = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      body.value = "   ";
      body.dispatchEvent(new Event("input", { bubbles: true }));
      body.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain(
      "a body is required",
    );
    expect(settings.value.promptTemplates[0].body).toBe("Fix it.");
  });
});
```

(Add `import { tabViews } from "../terminal/tabs-store";` at the top for the liveness test.)

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/prompts/prompt-popover.test.tsx`
Expected: FAIL — `Failed to resolve import "./prompt-popover"`.

- [ ] **Step 3: Write the popover**

Create `src/prompts/prompt-popover.tsx`:

```tsx
import { Fragment } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { settings, updateSettings } from "../settings/settings-store";
import { tabViews } from "../terminal/tabs-store";
import { reportChromeMessage } from "../chrome/events";
import { ConfigRow } from "../ui/controls/config-row";
import { CommitInput } from "../ui/controls/commit-input";
import { CommitTextarea } from "../ui/controls/commit-textarea";
import {
  createPromptTemplateId,
  TEMPLATE_BODY_MAX,
  TEMPLATE_LABEL_MAX,
  type PromptTemplate,
} from "./prompt-templates";
import {
  composePromptText,
  isPromptAgentId,
  type PromptAssetKind,
  type PromptAssetPick,
} from "./snippet-format";
import {
  EMPTY_PROMPT_ASSETS,
  type PromptAsset,
  type PromptAssets,
} from "./prompt-assets-client";
import type { InjectOutcome, PromptTarget } from "./inject";

interface PromptPopoverProps {
  capture(): Promise<PromptTarget | null>;
  loadAssets(target: PromptTarget): Promise<PromptAssets>;
  inject(
    target: PromptTarget,
    text: string,
    autoSend: boolean,
  ): Promise<InjectOutcome>;
  isAlive(paneId: number): boolean;
  onClose(): void;
}

function labelProblem(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  return trimmed.length > TEMPLATE_LABEL_MAX
    ? `names stay under ${TEMPLATE_LABEL_MAX} characters`
    : null;
}

function bodyProblem(body: string): string | null {
  if (body.trim() === "") {
    return "a body is required";
  }
  return body.length > TEMPLATE_BODY_MAX
    ? `bodies stay under ${TEMPLATE_BODY_MAX} characters`
    : null;
}

/** One `<select>` of detected assets — the DL-6 `menu` value kind (DL-1.4). */
function AssetPicker({
  label,
  assets,
  chosen,
  onPick,
}: {
  label: string;
  assets: readonly PromptAsset[];
  chosen: string;
  onPick: (name: string) => void;
}) {
  return (
    <ConfigRow label={label}>
      <span class="cfg-btn cfg-btn--overlay">
        <span class="cfg-btn__text">{chosen === "" ? "none" : chosen}</span>
        <span class="cfg-btn__hint">▾</span>
        <select
          value={chosen}
          aria-label={label}
          onChange={(event) => onPick(event.currentTarget.value)}
        >
          <option value="">none</option>
          {assets.map((asset) => (
            <option
              key={asset.name}
              value={asset.name}
              title={asset.description}
            >
              {asset.name}
            </option>
          ))}
        </select>
      </span>
    </ConfigRow>
  );
}

/**
 * The Prompt Board: templates the user declared, and one click that pastes one
 * into the pane captured when this opened (DL §12 rows inside a DL §13
 * popover).
 *
 * Everything that touches a pane arrives as a prop, so this component is a
 * pure surface over the settings signal and can be driven by fakes in tests.
 */
export function PromptPopover(props: PromptPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const target = useSignal<PromptTarget | null>(null);
  const assets = useSignal<PromptAssets>(EMPTY_PROMPT_ASSETS);
  const assetsFailed = useSignal(false);
  const expanded = useSignal<string | null>(null);
  const rowError = useSignal<{ id: string; message: string } | null>(null);
  const skill = useSignal("");
  const subagent = useSignal("");
  const draftOpen = useSignal(false);
  const draftLabel = useSignal("");
  const draftBody = useSignal("");
  const draftError = useSignal<string | null>(null);

  const templates = settings.value.promptTemplates;

  // Capture first, then scan with what was captured (spec §7). Both are
  // one-shot: transient state never survives an open (DL-13.6).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const captured = await props.capture();
      if (cancelled) {
        return;
      }
      if (captured === null) {
        reportChromeMessage("No pane to paste into.");
        props.onClose();
        return;
      }
      target.value = captured;
      if (!isPromptAgentId(captured.agent)) {
        return; // bare shell or an unverified CLI — pickers stay hidden
      }
      try {
        const found = await props.loadAssets(captured);
        if (!cancelled) {
          assets.value = found;
        }
      } catch {
        if (!cancelled) {
          assetsFailed.value = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dismiss on any pointerdown outside the anchor (which contains both the
  // trigger and this surface, so the trigger's own toggle still works).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const node = event.target as Element | null;
      if (node?.closest(".prompts-anchor") === null) {
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    rootRef.current?.focus();
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  // The captured pane can exit or have its tab closed while this is open;
  // `tabViews` is what `syncViews` bumps on every layout change, poll and
  // exit, so reading it here is the subscription (spec §7, §12).
  useSignalEffect(() => {
    tabViews.value;
    const captured = target.value;
    if (captured !== null && !props.isAlive(captured.paneId)) {
      props.onClose();
    }
  });

  const replace = (next: readonly PromptTemplate[]): void => {
    updateSettings({ promptTemplates: next });
  };

  const patch = (id: string, change: Partial<PromptTemplate>): void => {
    replace(
      templates.map((entry) =>
        entry.id === id ? { ...entry, ...change } : entry,
      ),
    );
  };

  const renameTemplate = (id: string, label: string): void => {
    const problem = labelProblem(label);
    if (problem !== null) {
      rowError.value = { id, message: problem };
      return;
    }
    rowError.value = null;
    patch(id, { label: label.trim() });
  };

  const retypeBody = (id: string, body: string): void => {
    const problem = bodyProblem(body);
    if (problem !== null) {
      rowError.value = { id, message: problem };
      return;
    }
    rowError.value = null;
    patch(id, { body });
  };

  const removeTemplate = (id: string): void => {
    replace(templates.filter((entry) => entry.id !== id));
    if (expanded.value === id) {
      expanded.value = null;
    }
  };

  const commitDraft = (): void => {
    const problem =
      labelProblem(draftLabel.value) ?? bodyProblem(draftBody.value);
    if (problem !== null) {
      draftError.value = problem;
      return;
    }
    replace([
      ...templates,
      {
        id: createPromptTemplateId(draftLabel.value, templates),
        label: draftLabel.value.trim(),
        body: draftBody.value,
        autoSend: false,
      },
    ]);
    draftOpen.value = false;
    draftLabel.value = "";
    draftBody.value = "";
    draftError.value = null;
  };

  const picks = (): readonly PromptAssetPick[] => {
    const chosen: PromptAssetPick[] = [];
    if (skill.value !== "") {
      chosen.push({ kind: "skill" as PromptAssetKind, name: skill.value });
    }
    if (subagent.value !== "") {
      chosen.push({
        kind: "subagent" as PromptAssetKind,
        name: subagent.value,
      });
    }
    return chosen;
  };

  const injectTemplate = (template: PromptTemplate): void => {
    const captured = target.value;
    if (captured === null) {
      return;
    }
    const text = composePromptText(template.body, captured.agent, picks());
    void props.inject(captured, text, template.autoSend).then((outcome) => {
      if (outcome === "no-target") {
        reportChromeMessage("The pane is gone — nothing was pasted.");
      } else if (template.autoSend && outcome === "pasted") {
        reportChromeMessage("Pasted — not sent");
      }
    });
    props.onClose();
  };

  const showPickers =
    target.value !== null && isPromptAgentId(target.value.agent);

  return (
    <div
      ref={rootRef}
      class="prompt-popover"
      role="dialog"
      aria-label="Prompts"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      {templates.length === 0 && !draftOpen.value ? (
        <div class="cfg-custom prompt-popover__empty">no templates yet</div>
      ) : null}

      {templates.map((template) => (
        <Fragment key={template.id}>
          <div class="cfg-row cfg-row--item">
            <div class="cfg-row__key">
              <button
                type="button"
                class="cfg-row__label cfg-row__label--edit"
                aria-expanded={expanded.value === template.id}
                title="Edit"
                onClick={() => {
                  expanded.value =
                    expanded.value === template.id ? null : template.id;
                  rowError.value = null;
                }}
              >
                {template.label}
              </button>
            </div>
            <div class="cfg-row__value">
              {template.autoSend ? (
                <span class="prompt-row__auto" aria-hidden="true">
                  auto
                </span>
              ) : null}
              <button
                type="button"
                class="cfg-btn"
                aria-label={`Inject ${template.label}`}
                title="Paste into the focused pane"
                onClick={() => injectTemplate(template)}
              >
                ↩
              </button>
            </div>
          </div>
          {expanded.value === template.id ? (
            <div class="cfg-custom prompt-editor">
              <CommitInput
                value={template.label}
                placeholder="name"
                ariaLabel={`Name for ${template.label}`}
                autoFocus
                onCommit={(label) => renameTemplate(template.id, label)}
              />
              <CommitTextarea
                value={template.body}
                placeholder="the prompt to paste"
                ariaLabel={`Body for ${template.label}`}
                onCommit={(body) => retypeBody(template.id, body)}
              />
              <div class="prompt-editor__foot">
                <button
                  type="button"
                  role="switch"
                  aria-checked={template.autoSend}
                  aria-label={`Auto send ${template.label}`}
                  class={`cfg-btn ${template.autoSend ? "cfg-btn--on" : "cfg-btn--off"}`}
                  title="Press Enter after pasting, when it is provably safe"
                  onClick={() =>
                    patch(template.id, { autoSend: !template.autoSend })
                  }
                >
                  {template.autoSend ? "auto send on" : "auto send off"}
                </button>
                <button
                  type="button"
                  class="cfg-row__remove"
                  aria-label={`Remove ${template.label}`}
                  title={`Remove ${template.label}`}
                  onClick={() => removeTemplate(template.id)}
                >
                  ×
                </button>
              </div>
            </div>
          ) : null}
          {rowError.value?.id === template.id ? (
            <div class="cfg-custom--error" role="status">
              {rowError.value.message}
            </div>
          ) : null}
        </Fragment>
      ))}

      {draftOpen.value ? (
        <>
          <div class="cfg-custom prompt-editor">
            <input
              type="text"
              class="text-input text-input--small"
              placeholder="name"
              aria-label="New template name"
              value={draftLabel.value}
              onInput={(event) => {
                draftLabel.value = event.currentTarget.value;
                draftError.value = null;
              }}
            />
            <textarea
              class="text-input prompt-textarea"
              rows={3}
              placeholder="the prompt to paste"
              aria-label="New template body"
              value={draftBody.value}
              onInput={(event) => {
                draftBody.value = event.currentTarget.value;
                draftError.value = null;
              }}
            />
          </div>
          {draftError.value !== null ? (
            <div class="cfg-custom--error" role="status">
              {draftError.value}
            </div>
          ) : null}
        </>
      ) : null}

      <ConfigRow label="New template" desc="a name and the prompt body">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            if (draftOpen.value) {
              commitDraft();
              return;
            }
            draftOpen.value = true;
          }}
        >
          {draftOpen.value ? "add" : "+"}
        </button>
      </ConfigRow>

      {showPickers ? (
        <div class="prompt-picker">
          {assetsFailed.value ? (
            <div class="cfg-custom prompt-picker__unavailable">
              skills unavailable
            </div>
          ) : (
            <>
              <AssetPicker
                label="skill"
                assets={assets.value.skills}
                chosen={skill.value}
                onPick={(name) => {
                  skill.value = name;
                }}
              />
              <AssetPicker
                label="subagent"
                assets={assets.value.subagents}
                chosen={subagent.value}
                onPick={(name) => {
                  subagent.value = name;
                }}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test and watch it pass**

Run: `npx vitest run src/prompts/prompt-popover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the trigger to `ChromeActions`**

In `src/ui/chrome-actions.tsx`, extend the props:

```tsx
interface ChromeActionsProps {
  settingsOpen: boolean;
  expandActive: boolean;
  /** Whether the Prompt Board popover is up (drives `aria-expanded`). */
  promptsOpen: boolean;
  /** No pane to paste into, or an overlay is covering the one there is. */
  promptsDisabled: boolean;
  /** Rendered inside the trigger's anchor while open — see `.prompts-anchor`. */
  promptPopover?: ComponentChildren;
  updateAction?: ComponentChildren;
  onSplitRow(): void;
  onSplitColumn(): void;
  onClosePane(): void;
  onToggleExpand(): void;
  onTogglePrompts(): void;
  onToggleSettings(): void;
}
```

Add the icon (hand-drawn inline SVG, 13px to match its siblings — DL-11.3):

```tsx
function PromptsIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
      <path d="M9 12h6" />
    </svg>
  );
}
```

And render the trigger inside its anchor, between the expand button and the separator:

```tsx
<span class="prompts-anchor">
  <button
    type="button"
    class={`iconbtn ${props.promptsOpen ? "is-active" : ""}`}
    title={`Prompts (${prompts})`}
    aria-label="Open the prompt board"
    aria-haspopup="dialog"
    aria-expanded={props.promptsOpen}
    disabled={props.promptsDisabled}
    onClick={props.onTogglePrompts}
  >
    <PromptsIcon />
  </button>
  {props.promptsOpen ? props.promptPopover : null}
</span>
```

with `const prompts = shortcutLabel("toggle-prompts");` beside the other labels.

- [ ] **Step 6: Forward the props through `TabBar`**

In `src/ui/tab-bar.tsx`, add the same five props to `TabBarProps` and pass them straight to its `<ChromeActions>`. No logic there — `TabBar` is a pass-through for every other chrome action already.

- [ ] **Step 7: Wire it in `app.tsx`**

Add imports:

```tsx
import { promptsOpen } from "../chrome/events";
import { PromptPopover } from "../prompts/prompt-popover";
import { capturePromptTarget } from "../prompts/inject";
import { defaultPromptAssetsClient } from "../prompts/prompt-assets-client";
```

Inside `App()`, before the `chromeActions` const:

```tsx
/**
 * Every overlay that covers the terminal grid. The Prompt Board targets the
 * FOCUSED pane, so it must not open — or stay open — while one of these
 * hides it. The keyboard path is already gated by `scope: "pane"`; a button
 * onClick is a direct call and needs this guard of its own.
 *
 * One function, read in two places: the render body (for `promptsDisabled`)
 * and INSIDE the effect below. It has to be a function, not a captured
 * boolean — see the effect's own comment.
 */
const overlayCoversPane = (): boolean =>
  boardOpen.value ||
  settingsOpen.value ||
  editorRequest.value !== null ||
  saveDialogOpen.value;

/**
 * Close an ALREADY OPEN popover the moment an overlay opens over it —
 * otherwise it keeps painting at z-100, above the Settings screen (z-35) it
 * is now covering nothing behind.
 *
 * The overlay signals are read INSIDE this callback on purpose.
 * `useSignalEffect` subscribes to exactly the signals its callback touches,
 * and it is created once; a boolean captured from the render body would make
 * this effect depend on `promptsOpen` alone, so opening Settings with ⌘,
 * would re-render App and never re-run this.
 */
useSignalEffect(() => {
  if (promptsOpen.value && overlayCoversPane()) {
    promptsOpen.value = false;
  }
});

const closePrompts = (): void => {
  promptsOpen.value = false;
  tabsRef.current?.focusActive();
};

const promptPopover = promptsOpen.value ? (
  <PromptPopover
    capture={() => capturePromptTarget(tabsRef.current?.activePaneId() ?? null)}
    loadAssets={(target) =>
      defaultPromptAssetsClient.list(target.agent ?? "", target.cwd)
    }
    inject={(target, text, autoSend) =>
      tabsRef.current?.injectIntoPane(target.paneId, text, {
        autoSend,
        expectedAgent: target.agent,
      }) ?? Promise.resolve("no-target" as const)
    }
    isAlive={(paneId) =>
      tabsRef.current?.allPaneIds().includes(paneId) ?? false
    }
    onClose={closePrompts}
  />
) : null;
```

> Both readers matter and they are not redundant: calling `overlayCoversPane()` in the render body is what greys the button out on the next render, and the `useSignalEffect` is what tears down a popover that is _already_ open when an overlay appears. Neither covers the other's case.

Pass the five new props to both `<ChromeActions>` (the `chromeActions` const) and `<TabBar>`:

```tsx
      promptsOpen={promptsOpen.value}
      promptsDisabled={overlayCoversPane() || tabViews.value.length === 0}
      promptPopover={promptPopover}
      onTogglePrompts={() => {
        if (promptsOpen.value) {
          closePrompts();
          return;
        }
        promptsOpen.value = true;
      }}
```

- [ ] **Step 8: Add the styles**

Append to `src/styles.css`, after the tab-popover block:

```css
/* ── Prompt Board popover (DL §13) ───────────────────────── */

/* The anchor holds both the trigger and the surface, so "outside click" is
   one containment test and no rect math is needed (DL-13.1). */
.prompts-anchor {
  position: relative;
  display: inline-flex;
}

.prompt-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  padding: 6px 0 8px;
  background: var(--chrome-2);
  /* A hairline, not a shadow — depth comes from the background step (DL-1.3). */
  box-shadow: inset 0 0 0 1px var(--hair-strong);
  border-radius: 8px;
}

.prompt-popover:focus-visible {
  outline: none;
}

.prompt-popover__empty,
.prompt-picker__unavailable {
  font-family: var(--ui-font);
  font-size: 10.5px;
  color: var(--text-faint);
}

/* Non-interactive marker that a row's template presses Enter after pasting.
   Faint, so the pill stays the only thing that reads as clickable. */
.prompt-row__auto {
  margin-right: 8px;
  font-family: var(--ui-font);
  font-size: 10.5px;
  color: var(--text-faint);
}

/* The one inline editor a row may expand beneath it (DL-13.4). */
.prompt-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-editor__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Pickers sit under a hairline: they compose the prompt, they are not a
   template (DL-3.3 — structure from hairlines, not color). */
.prompt-picker {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--hair);
}
```

And extend the reduced-motion scope list so the new surface is covered by scope, not by an allowlist (DL-1.5 / §9.3). `src/styles.css` has **three** `@media (prefers-reduced-motion: reduce)` blocks (lines 250, 699, 1406); the one to edit is the chrome-scope list at **1406** (`.settings-screen, .settings-screen *, .tabbar *, .wsbar *, .status *`) — add `.prompt-popover *` to it.

- [ ] **Step 9: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS both.

```bash
git add src/prompts/prompt-popover.tsx src/prompts/prompt-popover.test.tsx \
  src/ui/chrome-actions.tsx src/ui/tab-bar.tsx src/ui/app.tsx src/styles.css
git commit -m "feat(prompts): add the prompt board popover and its chrome trigger"
```

---

### Task 11: DESIGN-LANGUAGE §13

**Files:**

- Modify: `docs/DESIGN-LANGUAGE.md` (new §13 after §12, before the drift ledger)

**Interfaces:**

- Consumes: the surface built in Task 10 — write the rules to match what shipped, not the other way round.
- Produces: citable rules `DL-13.1` … `DL-13.6`.

- [ ] **Step 1: Append §13 verbatim from the spec**

Insert between §12 and the `## Chưa khớp thực tế` heading:

```markdown
## 13. Anchored popovers

Approved as a fork on 2026-08-08, for the Prompt Board. §5 governs rows inside
a settings section; a popover is a small screen anchored to a chrome button,
and these rules say how it stays made of rows instead of becoming a new widget
genre.

- **DL-13.1** A popover is a `--chrome-2` surface with a 1px `--hair-strong`
  inset hairline, radius 8px, anchored to its trigger. No blurred shadow
  (DL-1.3); depth comes from the background step.
- **DL-13.2** Dismissal: Esc, outside click, or completing the popover's
  action. On dismiss, focus returns to the pane (or control) that had it. The
  trigger carries `aria-expanded`; the surface is `role="dialog"` with a label.
- **DL-13.3** Content inside a popover is made of §5 rows and §12 list rows —
  a popover is a small screen, not a new widget genre.
- **DL-13.4** A §12 item row may expand exactly one inline editor region
  beneath it (`aria-expanded` on the row); expanding a row collapses any other.
  This is the documented extension of DL-12.5 for items whose value is
  multi-line.
- **DL-13.5** Multi-line text uses `CommitTextarea`
  (`src/ui/controls/commit-textarea.tsx`): DL-6.3 semantics (local draft,
  commit on blur / Cmd+Enter, Esc reverts), auto-grown by content up to a max
  height, then scrolls.
- **DL-13.6** Transient controls in a popover (pickers, search) reset when it
  opens; a popover never remembers half-finished state across opens.
```

- [ ] **Step 2: Extend the §9 checklist**

Item 5 becomes:

```markdown
5. Text fields go through `CommitInput`, multi-line ones through
   `CommitTextarea` (DL-6.3, DL-13.5). Never bind a store value straight into
   an `<input value=…>` / `<textarea value=…>` inside a surface that does not
   unmount.
```

- [ ] **Step 3: Leave §10 alone**

The migration table gains **no** row: no existing popover violates §13, and
`.tab-popover__label`'s uppercase violation already has its own row awaiting the
tab-popover rework. Do not "fix" it here (§10's own instruction).

- [ ] **Step 4: Commit**

The user must approve doc content before it is committed (D14) — ask, then:

```bash
git add docs/DESIGN-LANGUAGE.md
git commit -m "docs(design-language): add §13 anchored popovers"
```

---

### Task 12: Full verification and the in-flight record

**Files:**

- Modify: `AGENTS.md` (the "In flight" list — move the Prompt Board entry from "specced, not implemented" to what shipped)
- Modify: `docs/CONTEXT.md` (D9: a completed plan updates it)

- [ ] **Step 1: Run every gate and paste the output**

```bash
npm test
npm run build
npm run generate:menu:check
cd src-tauri && cargo test && cd ..
```

Expected: all green. No "done" claim before this output exists (L5/W4).

- [ ] **Step 2: Docs compliance**

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

- [ ] **Step 3: Eye-review the popover on a screenshot (DL §9.6)**

Run `npm run tauri dev`, open a workspace with a Claude pane, press ⌘⇧P, screenshot the popover with one row expanded and both pickers populated. Check against §12/§13: `--chrome-2` surface, inset hairline, no blurred shadow, no uppercase, no monospace, one editor expanded at a time, `auto` tag faint. A green build proves nothing about design.

- [ ] **Step 4: Manual acceptance (spec §13)**

| Case                                                             | Expected                                    |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `autoSend` template into a Claude pane that is mid-run           | pasted, not sent; toast "Pasted — not sent" |
| Same template into an idle Claude pane                           | pasted and submitted                        |
| Quit the agent between opening the popover and clicking the pill | pasted only                                 |
| Multi-line body into Claude's composer                           | lands as one block, not line by line        |
| Close the target pane's tab while the popover is open            | popover closes, nothing pasted              |
| Open Settings while the popover is open                          | popover closes; the button greys out        |
| A pane running a bare shell                                      | pickers hidden; the template still pastes   |

- [ ] **Step 5: Record the outcome and close the thread**

In `AGENTS.md`, rewrite the Prompt Board bullet to say what shipped (the five forks stay recorded, plus the two §14 answers this plan resolved: the ⌘⇧P binding and the Codex `.toml` description). In `docs/CONTEXT.md`, add what the feature does and what was verified. Ask the user before committing docs (D14).

```bash
git add AGENTS.md docs/CONTEXT.md
git commit -m "docs(agents): record the prompt board landing"
```

---

## Self-review

**Spec coverage**

| Spec section                                                             | Task                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| §3 goals — declare/edit/delete templates                                 | 1, 10                                                                |
| §3 — one-click paste through bracketed paste                             | 6, 7, 10                                                             |
| §3 — detection incl. project + plugin                                    | 3, 4                                                                 |
| §3 — `autoSend` degrades, never wrong Enter                              | 7 (gate), 10 (toast)                                                 |
| §3 — read-only detection, no shell                                       | 3, 4                                                                 |
| §4 non-goals                                                             | nothing implements them; §4's Restore-Defaults note is Task 1 Step 9 |
| §6 data model + Restore Defaults copy                                    | 1                                                                    |
| §7 target capture / ordered writes / paste / triple gate / composed text | 6, 7, 2                                                              |
| §8 Rust detection                                                        | 3, 4                                                                 |
| §9 UI popover                                                            | 9 (trigger/action), 10 (surface)                                     |
| §10 DL §13                                                               | 11                                                                   |
| §11 module structure                                                     | file table above                                                     |
| §12 error handling                                                       | 1 (reset), 7 (gate), 10 (toasts, empty body, unavailable pickers)    |
| §13 verification                                                         | 12                                                                   |
| §14 open questions                                                       | resolved in "Decisions" above                                        |

**Deliberate deviations from the spec**, each with its reason:

1. `TabManager.activePaneId()` added — §11 omits it, §7 requires it.
2. `PromptAssetKind` declared in `snippet-format.ts` rather than in the client — keeps the import direction pure → impure.
3. `TerminalManager` gains two primitives (`pasteIntoPane`, `submitPane`) that §11 does not list; `TabManager.injectIntoPane` is still the single orchestrator §11 names, and these are what it drives.
4. The popover renders inside `ChromeActions`'s anchor rather than as a free-floating fixed-position surface — same anchoring guarantee, no rect math, and it survives a window resize.
5. §7's "if that pane exits … the popover closes" is implemented as **"leaves the layout"**, which is narrower. A single-pane tab whose process exits enters the "Session ended — press Enter to start a new one" limbo ([`terminal-manager.ts:246-260`](../../src/terminal/terminal-manager.ts)) and stays in `allPaneIds()`, so `isAlive` keeps returning true and the popover stays up. Accepted rather than fixed: injecting into that pane is already safe — `pasteIntoPane` refuses on `life.exited`, so the click returns `"no-target"` and says so — and closing on limbo would need a new exited-state accessor on `TabManager` for a case the user can dismiss with Esc. Recorded here so it is a decision, not a gap.

**External review (2026-08-08).** Reviewed against the working tree by an independent agent; verdict _executable with fixes_, and every finding was verified against the real files before being folded in. What changed: the `action-registry.test.ts` id census (42 → 43) is now an explicit step in Task 9 — adding a registry row turns that enumerated test red and the plan had not said so; Task 6's write-queue tests now flush microtasks before asserting, because `enqueueWrite` defers even the first write and the original assertions would have failed against a correct queue; Task 10's overlay effect now reads the overlay signals **inside** the `useSignalEffect` callback, since a captured boolean never re-triggers it and the popover would have stayed painted over Settings; Task 7's test harness now drives one OSC `9;4;0` transition after the poll, because `noteProcess` opens the process gate while leaving `phase: "unknown"`, so gate 2 would have refused every submit; plus the smaller ones — the duplicate `freshCwd` import, the three `Pane` fakes that need `pasteText`, focus return on the ⌘⇧P close path, `paneAttention` actually used by the gate, test-state resets the file's `beforeEach` does not do, and two cross-reference slips.

A second pass over the patched regions caught three more, all now fixed: the `mount` helper's `onWriteWhileExited` needed an explicit parameter annotation (inferring `() => void` from the default makes test 3's `(id: number) => …` unassignable — TS2345 — and `tsconfig.json` includes `src`, so that is a red `npm run build` while vitest stays green); the Task 9 `beforeEach` had to reset all four overlay signals, not just `boardOpen`, because the file's last test leaves `settingsOpen` true and a `scope: "pane"` action is blocked by it; and the Task 7 harness needed `await tm.init()`, since the memory pty's `emitOutput` only reaches listeners registered inside `init()` — without it the OSC emit is a no-op and the test fails with the same symptom from a different cause.

**Type consistency:** `PromptTemplate` (id/label/body/autoSend) is used identically in Tasks 1, 10; `PromptTarget` (paneId/agent/cwd) in 7, 10; `InjectOutcome` (`"sent" | "pasted" | "no-target"`) in 7, 10; `PromptAssets` (`{skills, subagents}`) matches the Rust `PromptAssets` field-for-field, and `PromptAsset`'s four fields match the `#[serde(rename_all = "camelCase")]` output verified by the Rust serialization test in Task 4.
