# Agent Board — model, treatment and specimen — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything the Agent Board needs that does NOT touch a load-bearing seam — the pure projection, the window-scoped store, the design-language amendments and their gate, the stylesheet, the four components — and mount the REAL component in the gallery so the owner can pass an eye over it before any wiring (spec §14, gate 1).

**Architecture:** A second pure projection (`agent-board-model.ts`) over the rail's own `buildAgentRail` output joined to `PaneView` by pane id, a signal store in the browser store's shape, and a presentational `AgentBoard` composed of card / nav / panel. Facts the spec says do not exist yet (`ordinal`, `startedAt`, `lastAgent`, the task prompt, confidence) enter the model as input MAPS in this plan and are replaced by `PaneView` fields in the wiring plan, so the gallery specimen can show every card state today. This plan ends at the spec's gate 1: a gallery specimen and the owner's eye pass. Surface wiring, keymap, journal, `pty_kill_foreground`, `serializePane`, `acknowledgePane` and `restartPane` are the second plan.

**Tech Stack:** Preact + `@preact/signals`, Vitest (`npx vitest run <file>`), Prettier, the design-language gate (`npx vitest run scripts/design-language.test.ts`), the gallery (`npm run prototype:gallery` at `127.0.0.1:5175/gallery.html`), Playwright MCP for screenshots.

**Spec:** [docs/specs/2026-09-03-agent-board-design.md](../specs/2026-09-03-agent-board-design.md) — sections are cited as §N below. Read §5, §6, §7, §9, §10 and §11 before any task.

## Global Constraints

- **R1** — English only in strings, comments, docs, commit messages.
- **R2** — every chrome style decision cites its DL rule in a code comment (`DL-34.3`, `DL-4.3`); the gate resolves every citation, so cite only rules that exist after Task 1.
- **R5** — renderer state is Preact signals, module stores are window-scoped.
- **R7** — gallery imports flow app → gallery only; `src/gallery/` is never imported from `src/ui/`.
- **DL-1.1** — no new runtime dependency. **DL-1.3** — no blurred/offset `box-shadow`; `inset 0 0 0 1px` only. **DL-1.2** — only the spinner loops (§5.4).
- **DL-4.5 / DL-2.x** — sizes and colours from tokens, never a literal at the use site; radius from `var(--radius-control)` only (the gate's `RADIUS_VALUES`).
- **Typography** — mono only inside `.agent-board` via `var(--board-font)`; uppercase + tracking only on `.board-label` (§9.4).
- **`box-sizing: border-box`** on every element given a percentage size and a padding (AGENTS.md known trap).
- **C1** — never mutate; stores replace maps and arrays.
- **F-rules** — kebab-case files, no `utils.ts`, ≤ 800 lines per file, every new file imported by something in the same task.
- **Commits** — conventional with scope, one task one commit, always `git commit -m "…" -- <paths>` (other sessions leave files staged in this checkout), every message ending with the trailer line `Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi`.
- **Verify before claiming** — a task is done when its test command passed and its output is quoted in the report (W4).
- **Tree** — `mxrsv/add-board-agent` at `be03646` (spec commit) on top of `57d3f3f`; `subjectWhere` and main's dirty-tree files do NOT exist here (spec header).
- **Prerequisite** — this worktree has NO `node_modules`: run `npm ci` once before Task 1; every `npx vitest` / `npx tsc` / `npx prettier` below assumes it.
- **Prettier and docs** — `.prettierignore` lists `*.md`, so a `.md` in a `prettier --check` list is skipped silently (alone it exits 2, "No files matching"); never cite prettier for a doc. For code, run `npx prettier --write <paths>` BEFORE `--check` in every commit step: `printWidth` is 100 and several code blocks below are wider.
- **Component tests** — the vitest environment is `node`; every test that touches `document` starts with the line `// @vitest-environment jsdom` (the repo's per-file convention), and every `render(...)` is wrapped in `act(() => { ... })` from `preact/test-utils` so effects (focus, menus) have run before an assertion reads the DOM.
- **Orphans by design** — `strip-ansi-sequences.ts` (Task 2) and `agent-board-store.ts` (Task 6) are imported only by their tests in this plan; they are the wiring plan's seams, named here so F7 is a known exception, not an accident.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/styles/01-tokens.css` (modify) | declare `--board-font`, `--label-tracking` |
| `docs/DESIGN-LANGUAGE.md` (modify) | amend DL-1.2, DL-3.4, DL-4.1, DL-4.3, DL-4.4, DL-18.9, DL-21.7; add §34; ledger row |
| `scripts/design-language.test.ts` (modify) | `LABEL_TREATMENT_SELECTORS`; `DL-34 agent board` gate |
| `src/lib/strip-ansi-sequences.ts` (create) | pure: drop CSI/OSC/ESC sequences; keep the last N rows |
| `src/ui/controls/rail-status-mark.tsx` (create) | `RailStatusMark` moved out of `agent-rail.tsx` so the Board imports no host module |
| `src/ui/agent-rail.tsx` (modify) | re-export `RailStatusMark` from its new file |
| `src/ui/agent-board-model.ts` (create) | `buildAgentBoard`, `boardWhere`, `cardForDigit`, the card/nav types |
| `src/ui/agent-board-store.ts` (create) | window-scoped signals: open/openedAt/surfaceActive, selection, filters, held order, pane ordinals |
| `src/styles/19-agent-board.css` (create) + `src/styles.css` (modify) | the Board's treatment, imported last |
| `src/ui/agent-board-card.tsx` (create) | one card: five rows, frame, hover column, `More` menu |
| `src/ui/agent-board-nav.tsx` (create) | STATUS then PROJECTS listbox |
| `src/ui/agent-board-panel.tsx` (create) | title, key-value rows, snapshot, reply box, actions |
| `src/ui/agent-board.tsx` (create) | composition, heading, empty states, roving focus, digits, Escape |
| `src/gallery/sections/agent-board-section.tsx` (create) + `section-registry.ts` (modify) | the REAL component over a fixture, four states |
| `AGENTS.md`, `docs/CONTEXT.md` (modify) | direction bullet, fork-queue entry, context entry, drift rows |

Tests sit beside their module as `*.test.ts(x)`.

---

### Task 1: Tokens, design-language amendments and the gate

**Files:**
- Modify: `src/styles/01-tokens.css` (the type block after `--type-project`)
- Modify: `docs/DESIGN-LANGUAGE.md` (DL-1.2, DL-3.4, DL-4.1, DL-4.3, DL-4.4, DL-18.9, DL-21.7; new §34 before `## Chưa khớp thực tế`; one ledger row)
- Modify: `scripts/design-language.test.ts`
- Test: `scripts/design-language.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--board-font`, `--label-tracking`; DL rules `DL-34.1`…`DL-34.10` that later tasks cite in comments; gate allowlist `LABEL_TREATMENT_SELECTORS = [".board-label"]`.

- [ ] **Step 1: Write the failing gate test** — append to `scripts/design-language.test.ts`:

```ts
describe("DL-34 agent board", () => {
  it("declares the board rules and the two treatment tokens", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");
    const css = readStylesheet().replace(CSS_COMMENT, "");
    expect(rulebook).toContain("## 34. The agent board");
    for (const rule of ["34.1", "34.2", "34.3", "34.4", "34.5", "34.6", "34.7", "34.8", "34.9", "34.10"]) {
      expect(rulebook).toContain(`**DL-${rule}**`);
    }
    // DL-4.1 (amended): one face token, declared once, never read from the terminal setting.
    expect([...css.matchAll(/--board-font\s*:/g)].length).toBe(1);
    expect(css).toMatch(/--board-font\s*:\s*ui-monospace,/);
    // DL-4.3 (third exception): a treatment token, not a size rung.
    expect([...css.matchAll(/--label-tracking\s*:/g)].length).toBe(1);
    expect(css).toMatch(/--label-tracking\s*:\s*0\.06em\s*;/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run scripts/design-language.test.ts -t "DL-34"`
Expected: FAIL — `expected '...' to contain '## 34. The agent board'`.

- [ ] **Step 3: Declare the tokens** in `src/styles/01-tokens.css`, directly after the `--type-project: 13px;` line:

```css
  /* DL-4.1, amended 2026-09-03: the Agent Board's face. A SECOND face for
     chrome, scoped to `.agent-board` by DL-34.5 and to nothing else. It is
     the §31 code stack, so it costs no file and no dependency (DL-1.1), and
     it does NOT read the terminal's `fontFamily` — DL-4.1's isolation clause
     holds: changing the terminal font never changes the Board, and vice
     versa. */
  --board-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  /* DL-4.3's third exception (2026-09-03): the Board's label treatment,
     `.board-label`. A TREATMENT token, declared once so it is measured in one
     place — not a size rung, so DL-4.4's ladder and DL-4.5's closed list are
     untouched. */
  --label-tracking: 0.06em;
```

Also amend the comment above `--ui-font` that ends "…leak terminal typography back into native UI." by appending one sentence: `Amended 2026-09-03: \`--board-font\` below is that token, scoped to the Agent Board by DL-4.1's amendment.`

- [ ] **Step 4: Widen the gate's allowlist.** In `scripts/design-language.test.ts`, after the `OPTICAL_TRACKING_SELECTORS` declaration add:

```ts
/**
 * DL-4.3's third exception (2026-09-03, the Agent Board): `.board-label` is
 * uppercase WITH positive tracking, and it is copy — two nav group headings
 * and the state word. Unlike the optical list above, which exempts negative
 * tracking only, this list exempts BOTH regexes the scan rejects on one
 * branch. A second selector here is an edit to DL-4.3 first.
 */
const LABEL_TREATMENT_SELECTORS = new Set([".board-label"]);
```

and in `styledCasingViolations()`, immediately after `if (GLYPH_GEOMETRY_SELECTORS.has(selector)) continue;` add:

```ts
    if (LABEL_TREATMENT_SELECTORS.has(selector)) continue;
```

- [ ] **Step 5: Amend the seven rules** in `docs/DESIGN-LANGUAGE.md`. Each is an APPENDED paragraph inside the existing bullet (keep the rule's original text; add the amendment after its last sentence), except where noted:

DL-1.2 — after "No other surface inherits any of the three." append:

```
  **A fourth scoped exception was added 2026-09-03 by DL-34.3:** the Agent
  Board draws DL-27.3's `WorkspaceSpinner` on every card whose pane is
  `working` — one loop per working pane, the same budget the rail already
  spends, ended by the state's removal. The rail's `asked` ripple does NOT
  cross to the Board (DL-34.3); the yellow frame is the whole signal there.
  "No other surface inherits any of the three" therefore no longer holds as
  written: the Board inherits exactly the spinner.
```

DL-3.4 — after "…neither holds alone." append:

```
  **Amended 2026-09-03 by DL-34.5:** inside `.agent-board` a group label
  (`STATUS`, `PROJECTS`) is `--text-faint`, not `--text-muted`, and sits at
  `--type-meta` — the Board's near-flat scale puts hierarchy in weight, case
  and tone rather than size, and its label is the quietest thing on the
  surface by design. Scoped to that subtree; the rail's group label is
  unchanged.
```

DL-4.1 — change the bold opening sentence to **The monospace face belongs to the terminal and to the Agent Board, and nowhere else.** and append:

```
  **Amended 2026-09-03 (owner, Agent Board spec §9):** the Agent Board is
  set in `--board-font` — the §31 code stack, declared once in
  `01-tokens.css` — over its whole `.agent-board` subtree, and nothing
  outside it. The rule's argument does not object: it banned mono in chrome
  because "mono there reads as terminal output that leaked out of its pane",
  and the Board is not chrome around a terminal but a picture OF the
  terminals, whose flat-size hierarchy only works when every glyph shares one
  advance width. The isolation clause is untouched: `--board-font` never reads
  the terminal's `fontFamily`. App-wide mono is a separate, unmade decision;
  DL-11.4 (rail labels are `--ui-font`) is untouched.
```

DL-4.3 — after "…not on words whose spelling is uppercase." (the sentence is wrapped across two lines in the file; search for `whose spelling is uppercase.`) append:

```
  **A third exception, added 2026-09-03, and it IS copy:** the Agent Board's
  `.board-label` class — `--type-meta`, uppercase, `letter-spacing:
  var(--label-tracking)` (0.06em), weight 400, `--text-faint` — for exactly
  two things: the nav's two group headings (`STATUS`, `PROJECTS`) and the
  state word on a card and in the panel's `State` value. No key, no
  description, no value, no title, no button. The gate's
  `LABEL_TREATMENT_SELECTORS` holds that one selector and, unlike the optical
  list, exempts BOTH the uppercase and the tracking regex — a fourth entry
  amends this rule again. Why it is safe here and nowhere else: the ban was
  measured against a proportional face at chrome sizes; the Board IS mono,
  which is the advance width the old tracking was tuned against. The
  worktree card spec's §9.9 refused this reopening on purpose so it could not
  happen by accident; the Agent Board spec §9.5 is the deliberate one.
```

DL-4.4 — after "…everything but keys was lowercase)." append:

```
  **Amended 2026-09-03 by DL-34.5, twice:** the casing clause above gains
  DL-4.3's third exception (the Board's `.board-label` is uppercase), and the
  group-label clause — a label heading a list of rows is `--type-title` —
  gains a Board-scoped exception: `STATUS` and `PROJECTS` head their lists at
  `--type-meta`, because the Board's scale is near-flat by design (spec §9.2)
  and its hierarchy comes from case and tone. No new size exists; DL-4.5's
  closed list is untouched.
```

DL-18.9 — the rule runs several paragraphs; insert this paragraph immediately BEFORE the line that begins `- **DL-18.10**`:

```
  **Cross-reference, 2026-09-03:** the hidden state can now be PRODUCED by a
  surface rather than by the user — the Agent Board hides the sidebar while it
  holds the stage (DL-34.1), without writing `sidebarCollapsed`, and omits the
  strip-mounted toggle meanwhile. `sidebarCollapsed` is no longer the only way
  the column is at width 0.
```

DL-21.7 — after "…both of which DL-3.5's contrast floors already measure." (wrapped across two lines; search for `floors already measure.`) append:

```
  **Amended 2026-09-03 by DL-34.2:** an Agent Board card carries the same
  resting wash, by this rule's own argument — a card floats alone on the
  stage's `--bg` exactly as a chip does, and "no wash" there reads as
  _nothing here_. "Everywhere else, rest means no wash" gains that one place.
```

- [ ] **Step 6: Add §34** in `docs/DESIGN-LANGUAGE.md`, inserted immediately BEFORE the line `## Chưa khớp thực tế`:

```
## 34. The agent board

Added 2026-09-03 from the owner-decided
[Agent Board spec](specs/2026-09-03-agent-board-design.md) `decided`. The
surface is a grid of live agent panes with a status-counting nav and a right
detail panel, toggled against the rail; it is built by
[`agent-board-model.ts`](../src/ui/agent-board-model.ts) `building`,
[`agent-board.tsx`](../src/ui/agent-board.tsx) `building` and
[`19-agent-board.css`](../src/styles/19-agent-board.css) `building`.
Numbered 34 because §33 was the previous highest rule.

- **DL-34.1** **The Board is a stage surface that hides the sidebar while it
  holds the stage.** It covers `.stage__surface` as the document and the
  browser do (DL-18.8), has one chip on the strip, and produces DL-18.9's
  hidden sidebar transiently — never writing `sidebarCollapsed`, omitting the
  strip-mounted `SidebarToggle` meanwhile, and leaving the dock unpainted as
  the Open Board does. Leaving the Board restores whatever the user had.
- **DL-34.2** **A card is a pane, and it outlives its agent.** One card per
  agent pane (the rail's own unit); a pane whose agent has left keeps its
  card as `idle` wearing the departed agent's name until the pane closes.
  Cards sort loudest-first (DL-27.3's fold), live, and the order is held
  while a panel is open; a card's number is its rank among live cards in
  pane-ordinal order, never its sort position. A card carries DL-21.7's
  resting wash (amended) inside DL-1.3's inset hairline at
  `--radius-control`.
- **DL-34.3** **`asked` and `failed` colour the card's frame, and nothing else
  does.** The inset hairline takes `--status-unread` or `--red`; `working`,
  `done` and `idle` keep `--hair`. `working` is DL-27.3's `WorkspaceSpinner`
  in the state slot (DL-1.2's fourth exception); the rail's `asked` ripple is
  switched off inside `.agent-board` — the frame is the whole signal at the
  size of the whole card. Green appears nowhere: DL-3.2 and the worktree
  card's colour rule already own it.
- **DL-34.4** **Selection is the Board's own, drawn with DL-27.22's token.**
  The selected card — the one whose panel is open — wears `--tab-active-bg`
  and `aria-current`; at most one. Selecting neither focuses a pane nor
  acknowledges it; only a `sent` reply or a step to the full stage does.
- **DL-34.5** **The Board is mono, near-flat, and its hierarchy is weight,
  case and tone.** `--board-font` over the whole subtree (DL-4.1 amended);
  only `--type-title` / `--type-body` / `--type-meta`; 600 weight for the
  card name and the panel title alone; `.board-label` (DL-4.3's third
  exception) for the two nav headings and the state word; `--text-primary`
  for names and values, `--text-muted` for the task or tail, `--text-faint`
  for labels, the where-line, meta and the number.
- **DL-34.6** **The panel's terminal is a snapshot of the pane's own
  scrollback.** Plain text, colour stripped, the last rows of the real
  buffer; no element moves, no PTY resizes, no second renderer exists.
- **DL-34.7** **The reply box goes through the inject gate.** Text is placed;
  Enter follows only when `submitAllowed` allows it AND the pane has reached
  `working` once; a real question gets the text placed and not sent, and the
  panel says so. Only a `sent` outcome acknowledges the pane.
- **DL-34.8** **The nav is STATUS then PROJECTS, live only, totals not
  filtered.** `Failed` appears only while some pane is `failed`; a PROJECTS
  row is a checkout holding at least one card; counts are totals and the
  grid's heading states the filtered result.
- **DL-34.9** **Escape closes the panel, then steps the Board back to the
  terminal.** A Board rule, not DL-29.8's — the Board is not a modal.
- **DL-34.10** **Stop leaves the shell and the card; Restart resumes the
  conversation and exists only once the agent has left; Close lives in
  `More`.** The hover column carries at most Stop-or-Restart, `Open in
  stage` and `More`; `More` carries all four rows.
```

- [ ] **Step 7: Add the ledger row.** The `## Chưa khớp thực tế` section at the end of `docs/DESIGN-LANGUAGE.md` is prose today — it opens `**Empty.** The only standing entry …` and has no table. Change that opening `**Empty.**` to `**One open claim, in the table below.**`, keep the rest of the paragraph, and insert — after that paragraph and before the paragraph beginning `The violations table above` — a D7 table with the header `| Claim | Intent | Status | Evidence |`, its `| --- | --- | --- | --- |` separator, and exactly this row:

`| The Agent Board is a shipping surface | \`building\` | gallery-only | §34 landed 2026-09-03 with the spec; model, treatment and specimen are this plan's; no surface wiring, no host seam, no native pass, no owner eye review — [plan](plans/2026-09-03-agent-board-model-and-specimen.md) \`building\` |`

- [ ] **Step 8: Run the whole gate**

Run: `npx vitest run scripts/design-language.test.ts`
Expected: every test passes except one. **That one is red at BASELINE on this branch and stays red until another session's work lands:** `resolves every cited rule to a declared rule or section` lists exactly nine unresolved citations — `DL-19.9` (×4: `file-tree-view.test.tsx`, `tree-root-actions.tsx`, `explorer-tree-section.tsx`, `14-dock.css`), `DL-27.25` (×3: `agent-rail-card-model.ts`, `worktree-card.tsx`, `icon-system.test.ts`), `DL-13.7` and `DL-13.8` (`worktree-card-menus.tsx`) — rules that exist only in main's UNCOMMITTED `DESIGN-LANGUAGE.md` (measured 2026-09-03 before Task 1). The gate for this task and every later one is: **that list is still exactly those nine, and every other test passes.** Do not add those rules here; they are not this plan's.

- [ ] **Step 9: Prettier and commit**

```bash
npx prettier --write src/styles/01-tokens.css scripts/design-language.test.ts && npx prettier --check src/styles/01-tokens.css scripts/design-language.test.ts
git commit -m "docs(dl): add §34 for the agent board and amend the type, motion and wash rules

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- docs/DESIGN-LANGUAGE.md src/styles/01-tokens.css scripts/design-language.test.ts
```

---

### Task 2: `strip-ansi-sequences.ts`

**Files:**
- Create: `src/lib/strip-ansi-sequences.ts`
- Test: `src/lib/strip-ansi-sequences.test.ts`

**Interfaces:**
- Produces: `stripAnsiSequences(text: string): string`, `lastRows(text: string, rows: number): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { lastRows, stripAnsiSequences } from "./strip-ansi-sequences";

describe("stripAnsiSequences", () => {
  it("drops SGR colour and cursor sequences", () => {
    expect(stripAnsiSequences("\x1b[32mok\x1b[0m \x1b[2Kline")).toBe("ok line");
  });
  it("drops OSC sequences ended by BEL or ST", () => {
    expect(stripAnsiSequences("\x1b]0;title\x07text\x1b]8;;url\x1b\\link")).toBe("textlink");
  });
  it("drops carriage returns and bare escapes, keeps newlines and tabs", () => {
    expect(stripAnsiSequences("a\r\nb\tc\x1b(B")).toBe("a\nb\tc");
  });
});

describe("lastRows", () => {
  it("keeps the last N rows and trims trailing blank rows", () => {
    expect(lastRows("1\n2\n3\n4\n\n\n", 2)).toBe("3\n4");
  });
  it("returns everything when there are fewer rows than asked", () => {
    expect(lastRows("only", 40)).toBe("only");
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/lib/strip-ansi-sequences.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Plain text out of a terminal buffer (Agent Board spec §7.3, DL-34.6). The
 * serialize addon emits SGR and other control sequences; the panel wants the
 * words. CSI `ESC [ … final`, OSC `ESC ] … (BEL | ESC \)`, every other
 * two-byte `ESC x`, and `\r` are dropped; `\n` and `\t` survive.
 */
const SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\([A-Za-z0-9]|\r/g;

export function stripAnsiSequences(text: string): string {
  return text.replace(SEQUENCE, "");
}

/** The last `rows` lines of `text`, trailing blank lines trimmed first. */
export function lastRows(text: string, rows: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - rows), end).join("\n");
}
```

- [ ] **Step 4: Run to see it pass** — `npx vitest run src/lib/strip-ansi-sequences.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/strip-ansi-sequences.ts src/lib/strip-ansi-sequences.test.ts && npx prettier --check src/lib/strip-ansi-sequences.ts src/lib/strip-ansi-sequences.test.ts
git commit -m "feat(board): add the pure ANSI stripper the panel snapshot reads through

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/lib/strip-ansi-sequences.ts src/lib/strip-ansi-sequences.test.ts
```

---

### Task 3: Move `RailStatusMark` to `src/ui/controls/`

**Files:**
- Create: `src/ui/controls/rail-status-mark.tsx`
- Modify: `src/ui/agent-rail.tsx` (delete the local `RailStatusMark`, re-export it)
- Test: `src/ui/controls/rail-status-mark.test.tsx`; existing `src/ui/agent-rail.test.tsx` must stay green.

**Interfaces:**
- Produces: `RailStatusMark({ state }: { readonly state: RailState })` from `src/ui/controls/rail-status-mark.tsx`; unchanged markup (`.asr-row__mark`, `data-state`, spinner variant).

Why: `agent-rail.tsx` imports host modules (`store-host`, `dialog-host`, `bridge`, `file-drop`) that every test rendering it has to mock; the Board must import the mark without them. Internal move — not a fork.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { RailStatusMark } from "./rail-status-mark";

describe("RailStatusMark", () => {
  it("draws the spinner for working and a data-state dot otherwise", () => {
    const host = document.createElement("div");
    act(() => {
      render(<RailStatusMark state="working" />, host);
    });
    expect(host.querySelector(".asr-row__mark--spinner[data-state='working']")).not.toBeNull();
    act(() => {
      render(<RailStatusMark state="asked" />, host);
    });
    expect(host.querySelector(".asr-row__mark[data-state='asked']")).not.toBeNull();
    expect(host.querySelector(".asr-row__mark--spinner")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/controls/rail-status-mark.test.tsx` → FAIL, module not found.

- [ ] **Step 3: Create the file** with the component body copied VERBATIM from `agent-rail.tsx` (the `export function RailStatusMark` at ~line 173, its doc comment included), importing `WorkspaceSpinner` from `"../workspace-spinner"` and `type RailState` from `"../agent-rail-model"`. In `agent-rail.tsx` delete the local definition and add, beside the other exports:

```ts
export { RailStatusMark } from "./controls/rail-status-mark";
```

In `agent-rail.tsx` also drop `type RailState` from the `./agent-rail-model` import (line 19 — `RailStatusMark` was its only user, and `noUnusedLocals` is on, so leaving it breaks `tsc`), and keep the `WorkspaceSpinner` import only if something else there still uses it (grep; remove if unused).

- [ ] **Step 4: Run both suites** — `npx vitest run src/ui/controls/rail-status-mark.test.tsx src/ui/agent-rail.test.tsx` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/controls/rail-status-mark.tsx src/ui/controls/rail-status-mark.test.tsx src/ui/agent-rail.tsx && npx prettier --check src/ui/controls/rail-status-mark.tsx src/ui/controls/rail-status-mark.test.tsx src/ui/agent-rail.tsx
git commit -m "refactor(rail): move RailStatusMark to controls so the board imports no host module

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/controls/rail-status-mark.tsx src/ui/controls/rail-status-mark.test.tsx src/ui/agent-rail.tsx
```

---


---

## The other parts

This plan is split so no file exceeds the repository's size rule (F8). Tasks continue, numbered across the parts:

- [Part 2 — the projection and the store (Tasks 4–6)](2026-09-03-agent-board-model-and-specimen-2-model-store.md)
- [Part 3 — the stylesheet and the card (Tasks 7–8)](2026-09-03-agent-board-model-and-specimen-3-treatment-card.md)
- [Part 4 — nav, panel and composition (Tasks 9–11)](2026-09-03-agent-board-model-and-specimen-4-nav-panel-board.md)
- [Part 5 — the specimen, the living docs and the end gates (Tasks 12–13)](2026-09-03-agent-board-model-and-specimen-5-specimen-docs-gates.md)
