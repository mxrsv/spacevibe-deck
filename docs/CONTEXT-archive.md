# CONTEXT archive — kickoff

Crystallized kickoff brief (2026-07-09). Living working memory lives in `docs/CONTEXT.md`.

## What it is

Stackgrid is a minimal macOS terminal aimed at people who run AI agent CLIs (Claude Code, Codex, Gemini CLI, and similar). Hierarchy is Window → Tab → Pane. Real PTY, login shell, split panes, themes, session layout restore.

It lives under the SpaceVibe workspace as an independent project (own git remote: `mxrsv/stackgrid`). SpaceVibe is a parent folder for multiple AI-workflow tools; Stackgrid is not the workspace itself.

## Product stance (confirmed in kickoff)

- Primary job: make running and watching agent CLIs pleasant — not to be a general-purpose iTerm replacement as the north star, even if some iTerm-parity work exists in plans.
- Platform: macOS only for now.
- Input: mouse and keyboard are both first-class; no “keyboard-only ideology.”
- Runtime: real PTY with login shell (`$SHELL -l`) so PATH, aliases, and dotfiles work.
- Stack: currently Tauri 2 + Preact + xterm.js; stack is not locked forever (Electron not forbidden by principle).
- Privacy: no telemetry by default; terminal data stays local unless the user deliberately sends it.
- Scope horizon: may later embed agent UI; not frozen as “terminal-only forever.”
- License: MIT / open source.
- Session restore: keep existing ADR — persist layout chrome (tabs, names, colors), do not persist CWD in `session.json`. CWD only in the in-memory closed-tab stack.

## Existing material (pre-pipeline)

- Root `CONTEXT.md`: domain language glossary (Window, Pane, Tab, Busy, Agent, Session, …). Treat as living vocabulary; distill into PRINCIPLES/PRD as needed, do not duplicate wholesale.
- `docs/adr/0001-session-restore-without-cwd.md`, `docs/adr/0002-last-tab-close-quits-app.md`: decisions already shipped; pipeline `docs/decisions/` is for new ADRs going forward.
- `docs/superpowers/`: prior specs/plans (UI redesign, iTerm parity batch, pane drag, focus expand, public release metadata, etc.). Research backdrop only — not frozen pipeline docs.

## Research notes (light)

- Public positioning matches README: “minimal macOS terminal for AI agent CLIs,” Tauri 2, unsigned Gatekeeper friction on first install.
- Agent recognition today is process-name driven for pane-header styling only.
- Closing the last tab quits the app (ADR 0002); busy guard still applies.

---

# CONTEXT archive — product elicitation (2026-07-09)

Crystallized before freeze of PRD + BUSINESS-FLOW. Living memory compacted into `docs/CONTEXT.md`.

## Confirmed intent (now frozen in PRD / BUSINESS-FLOW)

- Pain: iTerm/Terminal thiếu tiện ích agent CLI; job = quan sát + điều khiển nhiều agent song song.
- Must-now: focus, split, swap pane, layout preset (mock → new tab; save from live; CRUD; split+CWD), move pane ↔ window (bidirectional), file sidebar (Cmd+click → md preview + git diff, view-only).
- Open board: workspace ∥ preset → Open → agent picker (PATH detect + Shell + Skip all; pick = spawn).
- Relaunch: restore chrome all windows; one-shot agent picker after restore. New Window → always Open board.
- Busy: confirm only on close, not swap/move.
- OUT: embed agent UI, SSH/remote, full iTerm parity, sidebar edit, signed build as v1 gate.
- Gatekeeper: unsigned OK for v1.
- Cmd+click: relative via pane CWD; missing → toast, no sidebar.
- Preset empty: built-in single-pane default always available.

## Deferred at freeze

- Multi-window session schema; ADR 0002 amendment; PATH agent discovery heuristics; Open-board empty-preset UX polish.

---

# CONTEXT archive — full prose before the 2026-08-22 compaction

Verbatim snapshot of `docs/CONTEXT.md` as it stood on 2026-08-22, before that file was
compacted from 4,598 lines. Every entry there keeps its decisions, reasons and verification
state; this is where the original wording, the per-task detail and the long evidence prose
live. Historical, not authoritative — read `docs/CONTEXT.md` first.


## Docs layout

- `docs/DESIGN-LANGUAGE.md` — canonical rulebook for chrome UI: tokens, color
  roles, typography, motion, copy. Rules are numbered (`DL-3.2`) and cited from
  code comments. Single source of truth for the app's visual language.
- `docs/specs/`, `docs/plans/` — per-feature design notes and implementation
  plans, dated `YYYY-MM-DD`.
- `docs/review/` — audit and drift-review findings.
- `docs/intent/`, `docs/archive/`, `docs/CONTEXT-archive.md` — historical
  material, kept for provenance, not authoritative.
- Domain glossary: repo-root `CONTEXT.md`.

## The landing stage draws the shipped app — 2026-08-20

The landing's window mock had been drawing the July app for a month: a workspace
sidebar of avatars, a status bar, a dock, an Open board panel. None of those is
what Deck opens on any more. Since 2026-08-20 the hero is one still, living
`.a-appwin` in `deck-dark`'s own plane order — an
[AgentRail](../marketing/stage/appwin.js) `current` of project clusters and
per-pane sentence rows, one unified tab strip carrying a terminal chip, a file
chip and a browser chip, a frame row of traffic lights + sidebar toggle + `New`,
three streaming panes, and **no status bar and no dock**, because
`showStatusBar: false` / `dockOpen: false` are the shipped defaults. The tour's
`grid` panel is cut with its whole stranded render chain; the four that remain
are rebuilt on the new chrome and two are new (Usage → Overview, Settings →
Agents). Twenty-one tasks over six phases, to the
[plan](plans/2026-08-20-landing-stage-redesign.md) `current`; the
[spec](specs/2026-08-20-landing-stage-redesign-design.md) `decided` is unchanged.

**No `src/` or `electron/` file was touched.** The redesign is a drawing of app
chrome, not a change to it: the branch's diff is `marketing/`, `docs/`, and one
new `scripts/capture-landing-stage.mjs`. That is also why no DL rule moved — DL
binds app chrome, and this obeys it from outside. The one place the work reaches
into `src/` is a test import: `stage-markup.test.js` reads `BUILTIN_AGENTS` out
of `src/lib/agent-catalog.ts` so the landing's agent list cannot drift behind a
seventh built-in without something going red.

**The mock's colours are re-derived, not re-picked.** All ten `--sg-*` tokens
changed value and eleven were added, each named after the app token it mirrors
(`--sg-rail` = `--sidebar-bg`'s pinned `#272d31`, `--sg-seam-column` =
`--sidebar-seam`, `--sg-raised` = `--tab-active-bg`, and so on). Every token NAME
was kept because `video.css` reads them. The plane order inverts: the stage
`#17181c` is now the DEEPEST surface and the rail stands above it, which is
2026-08-19's dark-sidebar decision arriving on the landing.

**A pane's script now moves its own rail row and its own tab chip.** Each step in
`stagePanes` may carry a `tail` (the sentence) and a `state` (the dot), which
[`mountStageStream`](../marketing/landing-prototype/src/product-stage.js)
`current` writes to every `[data-tail]` / `[data-dot]` node the pane owns — its
rail row and, while it is focused, the active chip. Two rules that are easy to
get backwards and are now pinned by tests: the lookup is `querySelectorAll`, never
`querySelector`, because a pane owns more than one node per hook; and it is scoped
to the root it was handed, never widened to `document`, because the page mounts
several stages. `tail` and `state` are seeded from **two independent scans** of
the script — codex's and opencode's first step carries a state and no tail, so a
single scan pairs a working spinner with a finished sentence for ~4s of every
loop.

**Two deliberate divergences from the app, both recorded rather than hidden.** The
active chip echoes the FOCUSED pane's sentence; the app's `tabTail` prints the
LOUDEST pane's by `STATE_RANK`, which would need a cross-pane scheduler the mock's
independent timers do not have. And **the marketing video keeps drawing the July
shell by choice**: `stage-driver.js` hard-requires a `[data-ws-avatar]` node and
derives its sidebar from a flat `{id, active}` list `stageRail` does not have, so
`stageSidebar` / `renderStageSidebar` / `renderStageStatus` all survive as
video-only. Nothing was deleted from `marketing/stage/`.

**The one test that says the stage is wired.** There was none before —
`grep -l "stage\|appwin"` over the three landing tests returned nothing, and
`build:landing` passes on wrong markup because it is a bundling check.
[`stage-markup.test.js`](../marketing/landing-prototype/src/stage-markup.test.js)
`current` is 41 assertions over the seams the rewrite can silently break: the
hooks resolve to panes that have transcripts, the six scene keys and the six
panel copy keys agree in both locales, no renderer prints `undefined` / `null` /
`[object Object]` / `src="null"`, a remembered cluster emits no caret and a framed
tab emits N leaves and zero rows, `AGENT_MARKS` still mirrors
`src/lib/agent-catalog.ts`, and both motion paths land where they should. It was
mutation-checked with seven deliberate regressions — a naive single-scan seed, a
`querySelector` hook lookup, a dropped `vi` copy key, a reordered agent list, an
`undefined` in a shared renderer, a caret on a still header, a hook pointing at a
pane with no transcript — each failing a distinct named test and nothing else.

**Evidence.** Gate 1: `npm run build:landing` clean and `npx vitest run marketing/`
**159/159 across 10 files** (the baseline before this work was 38 across 5). Gate
2 and gate 4's visual layer:
[`scripts/capture-landing-stage.mjs`](../scripts/capture-landing-stage.mjs)
`current` served the BUILT `dist` to headless chromium and shot the hero plus each
of the six panels at 1440 / 768 / 390, twice — 42 images, every in-page check
PASS at all six combinations: no horizontal page overflow, no rail that scrolls
sideways, no rail text under 9px at 1440/768 or under 7px at 390, and every
catalog command on one line. The measured boxes reproduce the plan's D10 figure
exactly — `.a-appwin` **896 × 555.5 / 639.6 / 298.4** with a **223.5 / 159.4 /
124.5** rail. Gate 4's other two layers: all six `.panel.is-revealed` animations
declared in `scenes.css` appear in its reduce block (the pre-existing
`.scene-rail__archived` omission went with the scene that drew it), and a live
probe counted **207 animating nodes with motion allowed against 0 under
`prefers-reduced-motion: reduce`**, with the rail landing on each pane's LAST
sentence and a quiet `done` dot. The video entry still links and paints with no
console error — 896.2 × 555.8, sidebar 223.6, avatar node present.

**Not established, and some of it is structural.**

- **There is NO lint signal for `marketing/**` at all.** `.prettierignore` line 6
  is `marketing/**` and `.oxlintrc.json`'s `ignorePatterns` carries the same
  entry, so `npx oxlint marketing/` answers "No files found to lint" and
  `npx prettier --check <marketing file>` prints "All matched files use Prettier
  code style!" WITHOUT reading it — proven by re-running with
  `--ignore-path /dev/null`, which then warns on five stylesheets. Every "prettier
  clean" claim made during this work was vacuous. The disagreement is only 80-col
  house style against prettier's 100, so `--write` would reformat the tree against
  its own convention; the honest statement is that this work has no lint gate, not
  that one passed. Separately, repo-wide `npx oxlint` exits 1 at HEAD on three
  pre-existing `src/` files (`src/lib/link-target.test.ts`,
  `src/ui/agent-rail.test.tsx:36`, `src/ui/app.tsx:14`) that this branch never
  touched.
- **The full `npm test` is red, and none of it is here.** 3482 passed / 10 failed
  / 3 skipped across 277 files, with all five failing files under `src/` —
  `tab-manager.drop-agent-pane`, `tab-manager.materialize`,
  `tab-manager.quick-agent`, `agent-rail-model`, `settings/shortcut-groups`. The
  branch changed no `src/` file and the tree has none dirty, so `src/` at this
  HEAD is byte-identical to `src/` before the plan started: the red is inherited,
  not caused. `npx vitest run marketing/` is the scope this work can attribute,
  and it is 159/159.
- **Gate 3 (`frontend-design-bar`) and gate 5 (owner eye review) are owner-side
  and were not run.** `frontend-design-bar` is not a repo command — it appears
  only in plan and spec prose. The 42 images are assembled and waiting at
  `/tmp/spacevibe-deck-landing-stage/` with a `report.json` beside them; an agent
  can hand them over and nothing more.
- **The rendered video is now stale in COLOUR as well as in shape.** `tokens.css`'s
  `:root` is shared with the video entry, so the live video page has taken the new
  palette while `marketing/video/out/` still holds the old render. Nothing was
  re-rendered — spec §7 puts that out of scope — so the shipped file and the page
  that produces it no longer agree.
- **`.a-appwin__chips` clips 1–2px vertically at 390, and the strip is new here.**
  Measured: `scrollHeight 8` against `clientHeight 7` in the hero and `8` against
  `6` in the two strip-bearing panels, with `overflow: hidden`; at 1440 and 768 the
  two are equal. A 10× crop shows the glyphs surviving — the overflow is line-box,
  not ink — and nothing focusable lives inside (`tabindex="-1"` under
  `aria-hidden="true"`), so the "1px overflow moves the shell" trap cannot fire.
  T19 reported it as pre-existing, which is true of T19's own file and false of the
  branch: `.a-appwin__chips` did not exist before this work. Recorded, not fixed —
  T21 owns no stylesheet.
- **No owner eye review, no native host run, and the reduced-motion evidence is
  emulated.** `prefers-reduced-motion` was set through Chromium's emulation, not by
  an OS setting on a real machine, and every screenshot is Linux headless chromium
  at DPR 2 — not macOS type rendering.

### The hero grows a fleet rail and four scene tabs — 2026-08-20

Owner-asked the same day, with onorca.dev as the named reference: the hero should
read as a fleet mid-flight, and the stage should show more than one capability
without waiting for the panels. Two moves, both marketing-only:

- **The rail fixture densified to six clusters**
  ([`stageRail`](../marketing/stage/stage-data.js) `current`): the live framed
  deck tab as before, then `spacevibe-api` (yellow `asked` gemini + `working`
  agy), `spacevibe-bench` (a red **`failed`** codex row and a quiet `done`
  `cursor-agent` row — the monogram path's first real appearance), a `working`
  opencode row on `spacevibe-academy`, and TWO remembered headers (hub, active).
  All six built-in agents now appear on the hero. The
  `stage-markup` remembered-header pin counts the fixture instead of the literal
  `1` it used to hold.
- **The stage cycles through four scenes on a timer**
  ([`HERO_SCENES`](../marketing/landing-prototype/src/directions/a.js) `current`):
  agents (14s) / restore / surfaces / usage (9s each), advancing which
  `.a-appwin__stage` region shows behind the ONE live rail — the rail sits
  outside every region, so its stream hooks keep painting whichever scene is
  up. The three alternate regions are the tour panels' own bodies
  (`restoreBody` / `surfacesBody` / `usageBody`, split out of their `frame()`
  callers with `stageRegion()` in `chrome.js`), so hero and panel cannot drift.
  This shipped first as a row of click pills the same day; the owner replaced
  them within hours ("no need for these tabs — the workspaces run one after
  another"), which **knowingly amends the 2026-08-19 no-decorative-loops
  decision**: this one timer shows work, it is the page's only one, and under
  `prefers-reduced-motion` no timer is armed at all — the hero stands on the
  agents frame. `hidden` is the show/hide mechanism — a region re-entering
  layout restarts its CSS reveals — and the scene animations' gate widened to
  `:is(.panel, .a-appwin__stage).is-revealed` — one class, two writers (the
  panels' IntersectionObserver and the cycle). The cycle itself pauses on an
  IntersectionObserver of its own while the hero is off screen, so nothing
  swaps or replays under the fold.
- **The window went native on the owner's screenshot review.** Three fixes,
  all mirroring what the app actually draws: the pane grid is FLUSH — a 1px
  `--sg-seam-divider` (tone 12%, `--seam-divider`'s recipe) is the only thing
  between panes, the card border/radius/gap and the accent focus ring are gone
  (`06-stage-panes.css:263-334` is the reference; `is-focused` stays in the
  markup for the narrow-viewport rule but paints nothing) — and the transcript
  inks are neutral: `t-tool` purple and `t-ok` green died, `t-agent` blue
  became dim bold, because the CLIs themselves print plain foreground and the
  borrowed ANSI read as syntax highlighting the real window never shows. The
  restore scene's three columns and its purple prompt glyph took the same
  treatment.
- **The typewriter moved to animation longhands**, and so did every
  `var()`-carrying scene reveal: a shorthand holding `var()` is stored as a
  pending-substitution value and Chromium restarts such an animation on ANY
  global style recalc. Playwright's screenshot machinery injects a caret-hiding
  stylesheet, which was enough to catch the two delayed restore panes back at
  width 0 in every capture — the steady state in a real browser was always
  correct. Longhands close the gap between what the page does and what its own
  evidence gate records.

Evidence: `vitest run marketing/` 165/165 (six cycle tests — order, wrap,
is-revealed, reduced-motion stillness, dispose — plus the fixture pin reworked),
`build:landing` clean, `scripts/capture-landing-stage.mjs` rerun clean at all
three widths in both motion modes, and screenshots of the agents frame and the
first automatic advance. The same caveats as the parent section: no owner eye
review of the running page, no native host run, headless Chromium evidence
only.

## Performable keybindings and Ctrl+C — 2026-08-20

`handleShortcut` called `preventDefault()` and `stopPropagation()` the moment `matchBinding`
returned an action, and only then called `dispatchAction`, where `overlayBlocksAction` decided
whether the action could run at all. The key was committed before anything decided whether the
action could do anything — and that ordering cost two different things.

It cost a working chord. Every `scope: "pane"` action — `find`, `clear-buffer`, the `zoom-*`
family, `copy-selection`, `paste`, the `scroll-*`/`focus-*`/`swap-*` families, `next-tab`/
`prev-tab` — was swallowed and then blocked while a file surface or an overlay owned the stage.
Monaco escapes the `isChromeTextField` early return because with `editContext` on it focuses a
plain `<div>`, never an `<input>`/`<textarea>`, so nothing upstream could tell those actions
they were about to act on a hidden terminal. Ctrl+Shift+C over an open document therefore
copied nothing AND denied Chromium's own copy: a dead key, silently.

It also cost a feature. Bare Ctrl+C could not be bound on Windows at all. Windows Terminal
binds it to copy and lets it fall through to the app when there is no selection; Deck could
not, because a binding here always consumed.

[`isActionPerformable`](../src/terminal/action-performable.ts) `current` is the answer, and
`handleShortcut` asks it BEFORE `preventDefault()`. A false answer means the binding behaves as
if it did not exist and the key continues to whatever holds focus. `dispatchAction` keeps
`overlayBlocksAction` unchanged — it still guards the macOS menu path, which never passes
through `handleShortcut` at all.

**The predicate is keyed on the ACTION, not on the binding.** Ghostty expresses this as a
`performable:` prefix on the bind, which cannot work here: Deck stores user overrides per
action and replaces an action's whole chord set
([`resolveKeymap`](../src/lib/keybindings.ts) `current`), so two chords of one action cannot
carry different conditionality — and a user who had rebound `copy-selection` would never
receive the new Ctrl+C. kitty's compound-action shape is what fits, so
[`copy-or-interrupt`](../src/terminal/action-registry.ts) `current` is a second action beside
`copy-selection` rather than a flag on one. It carries no `menu` field on purpose: a Cocoa
accelerator is consumed before the webview and would force the action regardless of whether it
could be performed, which is the same reason Ghostty excludes performable binds from menus.

The two differ in exactly two ways. `copy-selection` (Ctrl+Shift+C) is stage-conditional only —
over a document it falls through so Chromium's copy reaches Monaco, but inside a terminal it
keeps consuming even with nothing selected, because nothing else wants that chord and leaking
it into an agent TUI has unspecified behaviour. `copy-or-interrupt` (Ctrl+C, Windows only) is
stage- AND selection-conditional, and it is the only one that CLEARS the selection. Without the
clear, a second Ctrl+C would copy again instead of interrupting — kitty shipped a second action
(`copy_and_clear_or_interrupt`) for exactly this. The clear runs synchronously after the text is
read, never in the clipboard write's callback: `copyTerminalSelection` writes asynchronously,
and clearing there could erase a selection the user made in the meantime.

**Deck writes no interrupt byte.** When `copy-or-interrupt` is not performable, `handleShortcut`
returns without consuming and xterm encodes the keystroke itself. Writing a literal `\x03`
through `pty.writePty` would pin one encoding, and a terminal that has negotiated a different
keyboard protocol expects a different sequence. The focus objection does not apply: the
predicate answers "no selection" only when a terminal pane already owns the stage, which means
focus is in that pane's xterm textarea.

Two costs were taken deliberately. **Cancelling after a selection takes two presses** — the
first Ctrl+C copies, the second interrupts. Windows Terminal behaves the same way, but it costs
more here than in a plain shell because agent CLIs use Ctrl+C as a routine cancel. And
`stageOwner()` reads `browserSurfaceActive` beside `surfaces.activeIndex()` rather than trusting
the browser tab to be folded into it: answering "terminal" while a web view covers the stage
would consume a key the page wanted, and reading both fails toward not consuming.

macOS is untouched — ⌘C stays the native Cocoa Copy role, and `copy-or-interrupt` ships unbound
there, because ⌘C-copies/Ctrl+C-interrupts are already two different keys and binding it would
invent a problem. Renderer-only, so the mechanism reaches BOTH hosts.

**Evidence:** `npm test` 3375 passed / 10 failed, every one of the ten reproduced identically on
a pristine `HEAD` worktree (agent launch-command strings, the rail's remembered-projects model,
and `toggle-sessions` missing from `shortcut-groups.ts`'s `PLACEMENT` — three other sessions'
in-flight work, none of it touched here); `npx tsc --noEmit`, `npx tsc -p tsconfig.electron.json
--noEmit`, `npm run build` and `npm run generate:menu:check` all clean; 4 new chord tests driving
the real capture-phase `window` listener through the pane's own textarea. **The Ctrl+C keystroke
itself has never been pressed on Windows (Gate C), and no host run or owner eye review has
happened.** This is renderer-verified, never Windows-verified.

**Known gap, unresolved.** macOS menu-bound actions (`find`, `find-next`, `find-previous`,
`clear-buffer`, the `zoom-*` family, `split-*`, the `toggle-*` family) keep dying over a file
surface, because Cocoa consumes their accelerators before the webview and no renderer-side
reorder can reach them. Ghostty's answer is that performable binds get no menu shortcut at all;
adopting that here means dropping accelerators from those menu items, which trades away the
menu's role as the place chords are learned. Out of scope, and the remaining ~18 pane-scoped
actions are deliberately not registered — the table is built to take them later as a data
change. See [spec](specs/2026-08-20-performable-keybindings-design.md) `decided` and
[plan](plans/2026-08-20-performable-keybindings.md) `current`.

## One tab, one frame — 2026-08-20

A tab running three agents printed three rows, and nothing on screen said they
belonged together. That was not an oversight: DL-27.13's parent row and elbow
guides are the thing that used to say it, and they have been behind
[`PANE_TREE_HIDDEN`](../src/ui/agent-rail.tsx) `current` since 2026-08-16 —
the fourth time in a week the owner took tab-tier chrome off this rail. The
grouping problem survived every one of those removals because each removal took
away a ROW, and a row was the only vocabulary the rail had for "these belong to
one tab".

**The answer is an edge, not a row.** Since 2026-08-20 a multi-agent tab's panes
stand inside a rounded `--hair-strong` hairline at `--radius-control`
(new [DL-27.19](DESIGN-LANGUAGE.md) `current`): no name, no count, no indent, no extra
line, nothing that a previous pass had already rejected.

**It is CSS only.** `data-headless` on `.asr-item` already means exactly
"several panes, no parent row" — the seam the hidden tree left behind — so
[the headless-item rule](../src/styles/04b-agent-rail-rows.css)
`current` is the whole implementation. No component, model, IPC or R4 seam
moved, and reverting is deleting one rule block.

**It took three shapes, and the owner caught two of them.** A frame drawn with
a `border` is layout: it either pushes its rows 1px inward or is bled back out
with `margin: 0 -1px`. The bleed shipped first, and within minutes the owner
reported the sidebar shifting and its gray ground disappearing behind the rows.
The cause measured immediately: `.asr-rail__list` held 255px of content in a
254px box. `overflow-x: hidden` does not remove a scroll container — it hides
the bar and keeps the container, so the first focus the browser answers with
`scrollIntoView` slides the whole column, which is exactly the Known trap
recorded for `#root`. An `outline` fixed that half — it adds nothing to scroll
width, measured `scrollWidth === clientWidth` at 254px — and lost the frame's
left edge, which the owner also caught within minutes: the item fills the
list's CONTENT box exactly and the list carries no padding of its own (the rail
does), so an outline paints on the 1px outside it and the same `overflow-x:
hidden` clips it away. The third shape is the one this repo already had a rule
for — DL-1.3's `box-shadow: inset 0 0 0 1px`, a hairline rather than a shadow.
It paints the 1px INSIDE, follows `border-radius`, joins no layout and leaves
nothing to clip; a leaf inside a frame and a tab row outside one both start at
x = 287. Vertically 3px inside and 3px outside stacks with `.asr-cluster`'s 4px
gap into 10px between two framed tabs against 7px between a frame and a bare
row: a closed block reads as heavier than a row boundary.

**Colour was offered and turned down.** The gallery drew the same frame in the
tab's own [`TabView.dotColor`](../src/lib/tab-colors.ts) `current` (column B4,
cyan and magenta). The owner picked neutral. Two reasons stand behind that: the
status dot owns red and yellow (DL-27.3), so a frame in either would claim a
state the tab is not in; and nothing has been able to SET `dotColor` since
`TabPopover` was deleted on 2026-08-16, so a per-tab colour would ship as a
frame nobody can change.

**Provenance.** The shape came from the owner's own sketch, drawn on 2026-08-19
after reading the earlier grouping marks (a hairline rule, a wash) as cluttered.
That reading had been recorded in
[`rail-structure-variants.tsx`](../src/gallery/rail-structure-variants.tsx)
`current` as closing the separator question toward geometry; it is superseded —
a separator did answer it, once it was a closed frame rather than a mark beside
the rows. All five columns stay in
[`multiAgentGroupingSpecimen`](../src/gallery/agent-rail-variants.tsx) `current`
so a later reversal can see what was judged against what.

**Evidence.** `scripts/design-language.test.ts` and `src/ui/agent-rail.test.tsx`
57/57 at 00:12 on 2026-08-20; a browser measurement against the running
`prototype:gallery` reading the radius (10px), `scrollWidth === clientWidth` and the
x-alignment above, plus an element screenshot proving all four strokes paint; and a screenshot of the REAL `AgentRail` with four framed items.

**Not established.** No full `npm test` and no `npm run build` — a concurrent
session's `src/lib/terminal-links.ts` is mid-edit and fails `tsc`, so neither
gate can attribute cleanly right now. No `electron:dev` pass, no `tauri dev`
pass, and no owner eye review of the running app. The frame is presence chrome,
so it draws only where `showAgentPresence` is true — Electron in practice; the
Tauri host shows the flat rows it always did.

## The dock header says what it is, and its third tab gets a chord — 2026-08-19

The docked right column's header is four icon-only controls — File explorer,
Token usage, Session history, and the panel toggle — and nothing on screen said
what any of them was beyond a native `title` that appears after an OS-owned
delay and never appears at all for a keyboard. The owner asked for bigger
glyphs and for real tooltips carrying the shortcut. New DL-23.10; DL-14.2
widened.

**The tooltip already existed; it was locked to one surface.** `ActionTooltip`
and `useTooltipVisibility` (`src/ui/controls/action-tooltip.tsx`) were written
for the feature toolbar in the 2026-08-14 pass, and DL §23 already specifies
their content, surface and positioning. Nothing new was designed here — the
dock header's chips and its panel toggle draw the same component through the
same hover/focus rules, and the native `title` came off both, because two
tooltips for one control is one too many and the native one is the half a
keyboard never sees. That widening is DL-23.10 rather than a silent reuse: the
§23 text said "at the toolbar layer" in two places, and a rule that is now
general has to say so.

**`useTooltipVisibility` is a hook, so the chip became a component.**
`DockTabs` mapped its items inline; a hook cannot be called per iteration, so
`DockTabChip` exists for the same reason `ToolbarControl` does. It carries no
unavailable branch — `availableDockTabs` OMITS a surface the host cannot
answer rather than showing it inert (DL-19.7), so a chip in this list is always
runnable.

**The third tab had no chord to print, so it got one.** The file-explorer spec
§3.1 shipped session history as "toolbar control only, no shortcut, no menu
item", which was invisible until three chips stood in a row and two of them
could say ⌘⇧B and ⌘⇧U. `toggle-sessions` is an action now — ⌘⇧Y / Ctrl+Shift+Y,
`y` verified free at every modifier combination on both keymaps, and the
letter browsers already train for history; ⌘⇧H, the obvious choice, is Cocoa's
Hide Others. `toggle-dock` had a menu item with no accelerator and took
⌘⇧J / Ctrl+Shift+J, the panel chord VS Code trains, pairing with ⌘⇧B the way
⌘J pairs with ⌘B there. Ctrl+Shift+J is also Chromium's DevTools console
chord; Deck installs its own menu with no DevTools role, and the identical
trade was already accepted for `toggle-browser` on Ctrl+Shift+I.

Two things the new action needed that its siblings did not:

- **A guard.** `revealDockTab("sessions")` on a host with no `sessions_list`
  writes a tab `resolveDockTab` then falls back to explorer — so an unguarded
  chord named "Session History" would have answered by opening the file
  explorer. It reports "Session history is not available on this host."
  instead, the way `toggle-prompts` reports having no pane to paste into.
- **`COMMAND_ACTIONS` and `isChromeScopedAction`.** The first is what
  `dispatch-coverage.test.ts` checks a binding against; the second is what lets
  the column be reached while a document holds the stage, which its two
  siblings already had.

**The glyphs went from 13px to 15px** — `FEATURE_ICON`, an existing rung, not a
new size. The `.iconbtn` box stays 24px: the glyph grew, the control did not.
The panel toggle takes the size as an explicit prop rather than deriving it
from `open`, which merely correlates today; its stage-strip mount keeps 13px,
where it stands beside the toolbar's own chrome glyphs.

The chord is read from the action id through `shortcutLabel` at render, never
stored as a string in `DOCK_TABS` — that is what makes a rebind reach the
tooltip and stops one platform's notation from shipping to the other.

Electron and Tauri both, since this is renderer plus the shared registry;
`npm run generate:menu` regenerated `menu_registry.rs`, so the Tauri View menu
carries both new accelerators. Verified by targeted suites, `tsc`, the full
bundle and a gallery pass — **no native `electron:dev` or `tauri dev` run and
no owner eye review of the running app**. Out of scope and still true: the
navigation sidebar's own toggle has neither a tooltip nor a chord.

## The quick picker grows keys, and every project gets a `+` — 2026-08-19

One pass over `AgentQuickPicker` and the one thing around it that decided
_where_ it opens. New DL-27.18 and DL-29.8; DL-27.17 and DL-29.5 amended.

**Escape moved off the panel.** `Modal` read Escape from a handler on the
dialog element, which meant it only answered while focus was still inside the
dialog — and focus leaves: a click on the scrim, a native `<select>` handing
focus back to the body. The modal then sat on screen while Escape travelled
into the terminal behind it, which is the exact failure DL-29.5's
`stopPropagation` was written to prevent. It is a document listener in the
CAPTURE phase now, installed once at mount and reading the current `onDismiss`
through a ref so a caller passing a fresh closure each render cannot churn
listeners. Nothing else about the shell moved: the Tab trap, the scrim's
press-and-release rule and `onKeyDown` all stay on the panel. This reaches
`PresetEditor` and `SavePresetDialog` too — all three modals were equally
affected and none of their own code changed.

**The rows answer arrows, and the keys are stated.** ArrowUp/ArrowDown/Home/End
move roving focus over the chips; Enter is then the browser's own button press,
so no new activation path exists. Focus still starts on the PANEL, not on the
first row (DL-29.2) — first-row focus would put a reflexive Enter straight
after ⌘T one keystroke from launching Claude Code, where today it does nothing.
The `<select>` guard that already stopped digit keys inside the worktree menu
stops the arrows there too, so the menu keeps its own type-ahead. Under the
rows there is now one `--text-faint` line naming every key the panel answers.
That line exists because the chips' digit badges came off on 2026-08-16 and the
digits kept working: the shortcut was real and nothing on screen admitted to
it. One line says all of them once, instead of putting a number back inside
every row.

**A row whose binary is gone opens Settings.** Only a declared custom agent can
reach this state — `agentOptions` omits an undetected BUILT-IN entirely — and
until now picking one spawned a shell that printed `command not found` and sat
there. It routes to Settings instead, by click and by digit key alike, because
the digit must not be a way around the check the pointer gets. The row is not
disabled: DL-19.7 prefers omission to inertness, and this control is neither.

**Every project header carries a `+`.** The tab strip's `+` and ⌘T always mean
"the ACTIVE tab's workspace", so launching an agent into a project that was
visible in the rail but not selected meant switching tabs first — which is the
one thing a rail exists to make unnecessary. The header's `+` opens the same
panel with the destination decided by which project was pressed.

Three consequences worth recording:

- The header is a **row of two controls** now, not one button:
  `.asr-cluster__head` became a `div` holding `.asr-cluster__toggle` (folder,
  name, caret — the whole former button) and `.asr-cluster__add`. A `+` nested
  inside the collapse button would be a button inside a button. The CSS moved
  with it, and DL-27.17's "caret at the far edge" is amended: the caret is
  still the collapse control's trailing edge and still the expansion
  affordance, but the launcher is now the last thing on the line.
  **Re-amended hours later on the owner's ask:** the `+` sits one slot INSIDE
  the caret, so DL-27.17's trailing caret stands as written. Reading order is
  folder → name → `+` → caret, and the header expresses it as a GRID rather
  than as DOM order — `minmax(0, 1fr) 17px 17px`, the tab rows' own two
  trailing slots. The collapse button spans every track so its caret keeps the
  outermost one; the launcher is pinned into the middle track over it, the way
  `.asr-row__actions` already pins the close over the agent glyph; and the
  caret reserves that track from inside the button with a `7 + 17` margin,
  gated by `:has(.asr-cluster__add)` so a project with no launcher (DL-19.7)
  does not open a dead slot. The same pass closed a real defect the reordering
  exposed: `.asr-cluster__head` was `width: 100%` beside its own padding with
  no `border-box` — the repo's standing percentage-plus-padding trap — so the
  header measured 11px wider than every row beneath it and BOTH trailing
  controls hung past the rail's edge. Measured after: the caret's box and the
  rows' agent-glyph box are the same 17px slot, centre 512 in the gallery.
- The destination is carried by `quickPickerWorkspace`, a signal beside
  `agentQuickPickerOpen` in `chrome/events.ts` rather than inside `App` —
  because `newTab()` in `tab-manager.ts` is outside `App`'s closure and has to
  CLEAR it. Without that clear, the next ⌘T would inherit the last rail
  target and open somewhere the user never pointed at. It is cleared on cancel,
  on select and on the Settings route as well.
- A project git knows nothing about used to render the panel's
  "Runs in this workspace" line, which becomes a lie the moment the target is
  not the active workspace. `plainFolderDestination` states the folder as a
  one-value destination instead, which DL-29.7 already renders as a readout.

Renderer-only, so it reaches BOTH hosts — the launcher works on Tauri too,
where the worktree list is always empty and the synthetic folder destination is
what the row shows. Verified by targeted suites only:
`agent-rail` (41), `agent-quick-picker` (34), `modal` (20),
`worktree-destinations` (16), `app` (33), `design-language` (12) and the
tab-manager/settings/gallery batch (362), plus `npx tsc --noEmit` clean.
**No `npm test`, no `npm run build`, no native `electron:dev` or `tauri dev`
pass, and no owner eye review of the running app.**

## The agent catalog — 2026-08-19

Settings → Agents is the catalog of everything Deck can launch, and each row
states the command that agent will actually run with.

**The commands ship with the app.** `BuiltinAgent` carries `defaultCommand` and
`url`, so a fresh install shows `claude --dangerously-skip-permissions` on the
first open. This is the point the surface took four attempts to reach: three
earlier builds all left the list empty until the user typed something, and each
time the owner's answer was the same — _the command is not showing_. A
recommendation the app ships is not a setting the user forgot to fill in.

Flags are verbatim from each CLI's own `--help` on the owner's machine:
`claude --dangerously-skip-permissions`,
`codex --dangerously-bypass-approvals-and-sandbox`,
`agy --dangerously-skip-permissions`, `gemini --yolo`, `cursor-agent --force`
(`--yolo` is its documented alias). `opencode` ships bare — its `--auto` is
opt-in per session and its prompts are coarse enough that skipping them is not
what anyone wants by default.

Several of these skip the agent's own confirmations, which is the point — Deck
exists to run agents that keep working — and it is also why every one is spelled
out on screen rather than hidden behind a label, and why a row can be disabled.

**A user preset replaces the shipped command** for that agent. Nothing merges;
the resolution order is the user's starred preset, then the catalog's
recommendation, then the bare binary.

**The list splits on `$PATH`.** Installed is what the discovery probe found,
with a count and a Refresh — a CLI installed in another terminal will not
otherwise appear until the 30s cache expires. Available to install is everything
else Deck knows how to launch, kept visible so "can Deck run X" is answered here
rather than in a docs page.

**Two settings fields.** `disabledAgents`: a built-in cannot be deleted, because
the probe would find it again on the next scan, so the switch is the only thing
that takes one out of the pickers. `defaultAgent`: offered on installed rows
only — starring a binary that is not on `$PATH` would name a default that cannot
run.

### A preset is a command line, not a set of options

Three shapes were built on 2026-08-19 and the reasoning behind the discarded two
is why the third validates the way it does.

**Enum options per agent.** A profile stored closed enums plus a validated model
token, and `composeLaunchCommand` turned them into a command. The argument was
safety: `AgentLauncher.arm` writes its string VERBATIM into a live interactive
shell, and enums make a dangerous string unrepresentable. It also made every
flag a modelling exercise — `gemini --yolo` was in the owner's reference from the
first minute and was unreachable.

**A row per agent with nested alternatives.** Closer, but adding was still a
form.

**What shipped**: `{ id, command }` and one text field.
[`commandProblem`](../src/lib/launch-profile.ts) `current` carries the safety
rule directly — it refuses `;` `|` `&` and newlines (separators), `$` and
backticks (substitution), `>` `<` (redirects), quotes and backslash (whose only
purpose here would be smuggling one of the above past a reader), and
subshell/glob punctuation. What survives is what binaries, flags, paths and
model names are made of, and the refusal is a message the person who typed it
can act on. A user who needs a pipeline writes a wrapper script and declares it
as a custom agent.

The agent is the command's first word, computed on read: two fields would let a
preset claim `claude` while typing `codex`.

### Restore stores the command, not the id

Editing or removing a preset must not rewrite a session already running under
the old one. Only `claude` is re-flagged on resume: its flags sit beside
`--resume`, whereas `codex resume` and `opencode -s` take theirs in positions
this repo does not model, so those are returned untouched rather than guessed
at. **That compatibility claim comes from `claude --help`, not from an observed
resume.**

**Two known limits, recorded not fixed.** A pane detached into another window
loses its recorded command — the map is per TabManager and the adopting window
has no entry for it. And a RESTORED pane is not re-tagged: restore's materialize
intent carries `paneCommands` and no `agent`, so the map stays empty and the next
journal write records `null`. A session restored twice loses its command on the
second boot.

### cursor-agent, the sixth built-in

Appended LAST to `BUILTIN_AGENTS` (owner-approved fork — the list reaches
process classification). Order is the digit-key contract in `AgentQuickPicker`
and the Open board, so appending leaves every existing key on the agent it
already opened. **No Cursor session scanner exists**, so `resume_lookup` answers
null for a cursor pane and `COMMAND_TABLE`'s `bare` form is what gets typed; the
`--resume` and `--continue` forms are in the table anyway, so adding a scanner
later is one file rather than two.

### Not built

**Drag-to-reorder** and the **per-row expand caret**, both of which the owner's
reference image shows.

**Evidence.** `npm test` — 3250 passed, 3 skipped, 0 failed. `npm run build`
clean. `tsc` clean. A gallery pass on the REAL component in both palettes. **No
native `electron:dev` pass, no `tauri dev` pass.**

## Open Board is the start surface — 2026-08-19

Open Board now starts or resumes work; it no longer tries to summarize live
work and history at the same time. Its Home view is headed `Start a workspace`,
with one primary `Open workspace…` action, capability-gated Worktree and
Sessions actions, and recent workspace rows. Each row exposes its remembered
preset/agent, last-opened time and a visible `Open` state when that workspace
already has a live tab. The activation and remove controls are sibling buttons,
so keyboard access does not depend on a nested interactive element
([`OpenBoardHome`](../src/open-board/open-board-home.tsx) `current`). Missing
workspaces are collapsed behind a count, and open attempts expose pending and
failure feedback on the board itself.

Session rows left Home. `Resume a previous session…` enters a third board view
that reuses the existing Sessions body and returns Home on Back or Escape
([`OpenBoard`](../src/open-board/open-board.tsx) `current`). A successful resume
closes the board; a failure leaves it visible. Session support remains
Electron-only, so unsupported hosts omit the action as before.

The surrounding shell now states the same ownership. The Agent Rail projects
only `tabViews`; archived workspace inputs, rows, callbacks and CSS are gone
([`buildAgentRail`](../src/ui/agent-rail-model.ts) `current`, DL-27.16). With no
live tab, [`sidebarEffectivelyCollapsed`](../src/ui/app-policy.ts) `current`
suppresses the rail, its toggle and resize seam without writing the saved
sidebar choice. While the board is open,
[`dockVisible`](../src/ui/app-policy.ts) `current` unmounts the dock without
changing `dockOpen` or `dockTab`; live tabs still keep the Agent Rail visible.
The gallery's existing board section now carries both compositions — cold start
and active work — using the real board/rail components.

Evidence on 2026-08-19: the final focused Open Board, Agent Rail, App policy,
sidebar shell, Sessions and Design Language run is 169/169; `npx vite build`
and the final `npm run build` both exit 0 after 5,565 modules transformed;
`generate:menu:check` and `git diff --check` exit 0. The bundle still reports
the repository's existing large-chunk warning. **No gallery server, native
host, screenshot or owner eye review was run**, so the visual direction
remains unverified; Tauri Sessions remain unsupported and Windows remains
unverified.

## The Agent Rail stops looking disabled — 2026-08-19

The owner withdrew state-based dimming from every live agent row: a clickable
`working`, `done`, or `idle` item was visually indistinguishable from a disabled
control. The `data-quiet` attributes and their text/glyph overrides are gone;
names, turns, and agent marks keep the same legibility in every state.

The trailing status vocabulary is exception-first now. [`RailStatusMark`](../src/ui/agent-rail.tsx#L123-L133)
`current` renders one static 9px dot shape for `failed` (red), `asked` (yellow),
and `working` (neutral), while `done` and `idle` paint nothing. The semantic
five-state model, fold precedence, `title`, and accessible wording are unchanged.
This retires the halo, turning arc, green check, idle ring, and every looping
animation owned by the Agent Rail. The shared trailing slot remains reserved,
so the hover close and row geometry do not shift when a mark is absent.

The workspace control now reads folder → name → trailing caret
([`AgentRail` project header](../src/ui/agent-rail.tsx#L493-L510) `current`). The
folder names the group genre; the caret uses the far edge as the consistent
expand/collapse affordance. Both remain decorative and the button keeps the
whole action in its accessible name.

The same-day follow-up removed the redundant `Workspace` caption from the
then-current launcher row, leaving `New` at its trailing edge. On 2026-08-19
that launcher moved intact into [`SidebarFrameActions`](../src/ui/sidebar-toggle.tsx)
`current`, immediately after the hide control; the rail now starts with its
live project rows. The folder had already risen 13px → 15px and the name
11px → 13px through [`--type-project`](../src/styles/01-tokens.css#L84-L86)
`current`; the trailing caret stays at 13px.

Evidence: `npm test -- --run src/ui/agent-rail.test.tsx` passes 38/38. **No
build, native host, screenshot, or owner eye review of the running result was
run.** Renderer-only, so the change reaches both hosts; native behavior and
appearance remain unverified.

## The dark sidebar rises off the stage — 2026-08-19

The owner picked a colour for the dark sidebar — `#272D31` — and it is
**lighter** than the stage, which reverses the plane the side columns have
stood on since 2026-08-14. `--sidebar-bg` was `bg` mixed 24% toward black: the
darkest surface in the window. It is now the FIRST surface above the stage, so
the terminal is the deepest plane and every piece of chrome stands on top of
it. Light themes are untouched — darkening is still the only direction with
headroom there — so the two modes now recede in opposite directions from the
same rule (DL-18.7, amended).

**The ladder had to move with it, and that was the owner's second call.** At
+8% the sidebar landed between `--chrome-1` (+5%) and `--chrome-2` (+9%), so a
popover would have read as a smudge of the column behind it. The dark chrome
surfaces are measured from `--sidebar-bg` now rather than from `--bg`
([`deriveChromeColors`](../src/lib/derive-colors.ts) `current`), which makes
the separation structural: every chrome plane is above the sidebar by
construction, for every dark theme including imports.

The steps are narrower than the light ones — 3/6/10 against 5/9/15 — and the
number was chosen against DL-3.5's floors, not by eye. A lighter surface spends
the headroom `--text-primary` needs, and at 4/8/14 One Dark's active row
measures **7.13:1** against white, under the 8:1 floor: `ensureContrast` would
flatten every chrome tone to plain white, and `checkChromeTextContrast` would
start rejecting imported themes it accepts today. At 3/6/10 the tightest preset
still measures 8.07:1.

Three consequences rode along, all of them forced:

- **`--input-bg` sinks instead of climbing.** An input is a recessed surface,
  and `bg + 12%` is now mid-ladder rather than below the chrome. It is
  half-way from the sidebar back to the stage: below every chrome plane,
  still above the terminal.
- **`--seam-raised` moved onto the ladder too.** Measured from `--bg` it fell
  BELOW `--chrome-2` on deck-dark (0.0397 against 0.0409) — a popover framed in
  a line darker than its own body. It keeps the place it always held, just
  under the active row.
- **`#272d31` is a literal.** It is not reachable by mixing `#17181c` toward
  white — hue 228° → 204°, saturation up — so
  [`PINNED_SIDEBAR_BG`](../src/lib/derive-colors.ts) `current` pins it. Keyed
  on the BACKGROUND, not on a preset id: `deriveChromeColors` is a function of
  `(bg, fg)` and its four callers (the app, the editor host, the gallery
  matrix, the theme card) hold nothing else, so keying it any other way would
  have made them disagree. Overriding that background correctly drops the pin.
  DL-2.2 carries the exception.

Renderer-only plus a derivation change, so it reaches BOTH hosts. **Verified by
a colour-relationship smoke only** — a `tsx` script that re-checked every
preset and override case in `derive-colors.test.ts` against the new
derivation: contrast floors, ladder ordering, the seam ladder, and the new
ascending dark ladder all hold. **No `npm test`, no `npm run build`, no
typecheck, no native pass on either host, and no owner eye review.**

## Light, Dark, and Settings as a document — 2026-08-19

Appearance offers **two** values now. [`ThemeModeSelector`](../src/ui/settings/theme-mode-selector.tsx)
`current` is a DL-6.5 `binary` radio group over `deck-light` / `deck-dark`, and
it stands where the theme gallery, the `Import theme` row, the `Themes folder`
row and the four colour-override rows used to be. Deck exposed four terminal
palettes, an import picker and four colour pickers as its FIRST settings
category, which made the app's opening statement "here is a theme workshop"
rather than "here is how Deck looks".

**Nothing was deleted.** `theme-gallery.tsx`, `theme-card-preview.tsx`,
`color-overrides.tsx`, `custom-themes-store.ts` and all four file-format
parsers build, pass their own tests, and are imported by nothing in Settings.
DESIGN-LANGUAGE §24 carries a retirement banner rather than a deletion for the
same reason: the fork argument is a record of a decision that was made, not
unmade.

### What a legacy profile sees

- **Opening Settings writes nothing.** A stored `tokyo-night`, an imported
  `file:…` id and a saved `colorOverrides` all survive being looked at;
  `validateSettings` keeps any string id verbatim, and only a non-string falls
  back.
- The selected segment is decided by [`themeModeOf`](../src/settings/themes.ts)
  `current`, which classifies **the background the app actually resolves** —
  `resolveTheme`'s output, so an override moves the selection with it — against
  `derive-colors`' own `DARK_LUMINANCE_THRESHOLD`. Reading the id instead would
  be faster and would let a dark-overridden `deck-light` show "Light" over a
  black window.
- A click is an explicit conversion: it writes the canonical id AND clears
  `colorOverrides`, because an override that survived would keep editing the
  mode the user just chose from a surface that no longer shows it. When
  something unrecoverable is on the line — an imported theme's selection, or
  non-empty overrides — it asks first (`conversionDiscardsData`). A legacy
  built-in with nothing overridden converts silently; nothing is lost that
  re-picking cannot restore.
- **Accepted risk, unchanged from the plan:** once converted, those overrides
  cannot be restored from Settings, because the rows that edited them are gone.

New installs default to `deck-dark`, and `getPreset`'s fallback moved with it —
the two canonical presets lead `THEME_PRESETS`, so an id nothing answers to now
resolves to the mode a new install gets rather than to Tokyo Night.

Both seeds shipped with **neutral** foregrounds: DL-3.6 binds six built-ins now,
so the reviewed `#e5e7eb` / `#25272c` became their luminance twins `#e7e7e7` /
`#272727` (contrast moves by 0.02 and 0.00). `deck-light` is also the first
LIGHT background `deriveChromeColors` has ever been asked for — which surfaced a
dark-only assumption in its own test: the seam-ladder assertion compared raw
luminance, and every chrome surface sits BELOW its background on a light theme.
The assertion is signed by `--tone` now; the derivation itself was correct.

### Settings became a document

Each category owns a one-sentence `description` in the registry, and the section
side renders title → sentence → hairline → one grouped surface (new DL-11.6).
The measure moved from each row (`max-width: 620px`) to the column
(`min(680px, 100% - 80px)`, centred): rows that cannot stretch still sit flush
against the rail on a wide window and read as a list in an empty field. Below
720px the rail is icons and the document takes edge padding (new DL-11.7); each
tab keeps its name in `aria-label` and `title`, so what compact width hides is
the label, never the accessible name.

Three interaction contracts landed underneath it, none of them visible in a
screenshot:

- **Tab cannot leave the screen.** The surface covers the window but does not
  remove the app from the document, so Tab used to walk into panes and tabs the
  user could not see.
- **Escape belongs to the innermost owner.** `CommitInput` now claims Escape
  while its draft is dirty — reverting to the saved value and stopping the
  event — so one press no longer costs both the edit and the screen. A clean
  field claims nothing, so the second press closes as always.
- **A loading snapshot cannot overwrite an edit.** `initSettings` assigns the
  disk snapshot over `settings.value` when it resolves; the section is a
  disabled `fieldset` until it has.

Settings chrome is achromatic throughout (new DL-3.7): the green "on", the
accent focus ring (DL-21.3 carve-out) and the accent step icons are neutral on
this surface only. `--red` on Restore defaults stays — that is a warning, not a
state.

### Two follow-ons the owner asked for the same day

**The rail is text, and the icons are gone** (DL-11.3 retired). Eight
categories meant eight glyphs standing in for words like `Appearance` — a rail
item is already one line of text, and the icon beside it was decoration that
had to be picked and kept in sync for nothing. `settings-nav-icons.tsx` and its
test are DELETED and `SettingsCategory` lost its `Icon` field; unlike the theme
gallery there is no user data or parser behind them, so `git revert` is the
whole restore path. DL-11.7 moved with it: the compact rail was specified as a
54px ICON rail hours earlier, which would have left an icon rail with no icons,
and is now 132px of truncating text with `title` carrying the full name.

**Settings covers the whole window** (DL-11.1 amended). `position: fixed;
inset: 0`, over the sidebar, the rail and the frame row; the close X became a
**Back** control, and Escape is unchanged. This reverses the shared rule that
kept full-window surfaces below the stage strip — and the reversal is
Settings-only on purpose. That rule was never "the strip is sacred", it was
"do not strand the user": a board opened on a window with no tabs cannot be
cancelled, so covering the row left nothing able to bring the sidebar back.
Settings has two exits that owe nothing to the chrome underneath. Covering the
frame row means the header inherits its two jobs — the macOS traffic lights'
reserved footprint (the OS paints over that box whatever the page draws) and
the window's drag region. `app.test.tsx` asserts the exemption together with
both exits rather than just dropping the old assertion.

**Reset is an ordinary category** (DL-11.5 amended). The pinned rail foot is
deleted — markup, CSS and mount point — and `reset` is the last entry in
`SETTINGS_CATEGORIES`, with the same title, sentence and grouped surface every
other stop gets. The foot treated POSITION as the safeguard, and position was
never carrying it: what stops an accidental reset is the native confirm the
action has always raised. What the foot did cost was legibility — the rail is
220px, so a config row pinned in it stacked its label over its button and
printed a three-line description in a column sized for one word. The row keeps
`--red`, which DL-3.7's achromatic surface deliberately does not override.

### Verification state

Targeted suites green: `src/ui/settings/` 121/121, `app.test.tsx`,
`design-language`, `modal.test.tsx` 18/18, `icon-system` 6/6. **Browser/gallery evidence
only — no `npm run electron:dev` pass, no `npm run tauri dev` pass, and no
owner eye review of the RUNNING app.** The gallery specimen the direction was
approved from is `src/gallery/sections/settings-direction.tsx`; the shipped
surface has not been compared against those screenshots side by side. This is
renderer-only work, so it reaches BOTH hosts — and neither has been run.

**The full-suite and build gates could not be run to green, and not because of
this work.** Three other sessions were editing the same checkout: `npm test`
ends with 2 design-language failures owned by an in-flight `09-open-board.css`
redesign (tracking on `.board-home__title` / `.board-sessions__head h1`, and
`border-radius: inherit` on `.row__open`), plus the two standing timeout flakes
(`search-bar`, `file-tree-view`). `tsc --noEmit` reports only
`chrome-fixtures.tsx`, `board-section.tsx`, `agent-rail-model.ts` and
`app.tsx` — an `onResumeWorktree` / `SessionEntry` signature change from the
rail work — so `npm run build` cannot pass either. **No file this change set
touched appears in any of those.** Re-run both gates once the neighbouring
sessions land; do not read this note as a pass.

## Automatic terminal renderer — implemented 2026-08-19

Every pane now attempts one WebGL activation after `Terminal.open()` during its
first mount. [`activateWebglRenderer()`](../src/terminal/pane.ts) `current` owns
that one-shot lifecycle; later mounts and `applySettings()` cannot create or
replace the addon. Initialization failure and context loss both dispose the
active addon, emit distinct warnings, and leave xterm's DOM renderer active
without restarting the pane or PTY. Pane disposal explicitly releases a still
active GPU context through the same [pane lifecycle](../src/terminal/pane.ts)
`current`.

Renderer selection no longer exists in persisted settings or the Settings
surface. [`validateSettings()`](../src/settings/settings-schema.ts) `current`
ignores legacy renderer keys, and the [Appearance section](../src/ui/settings/sections/appearance-section.tsx)
`current` plus its [gallery specimen](../src/gallery/sections/settings-direction.tsx)
`current` expose no selector or fallback status.

Automated evidence on macOS 2026-08-19:

- `npm test -- src/settings/settings-schema.test.ts src/terminal/pane-renderer.test.ts src/ui/settings/settings-screen.test.tsx` exited 0: 3 files, 72 tests passed.
- `npm run build` exited 0, including the gallery specimen; `npm run electron:build` exited 0.
- `rg -n 'terminalRenderer|TERMINAL_RENDERERS|TerminalRenderer' src` returned no matches (exit 1 is ripgrep's no-match status).
- `npm test` exited 1: 3,123 passed, 2 timed out, and 3 were skipped. The two timeouts were outside this change (`search-bar.test.ts` and `file-tree-view.test.tsx`); isolated reruns exited 0 at 23/23 and 16/16 respectively. The full-suite gate is still recorded as failed, not converted into a pass.

Native acceptance remains deferred because no explicit permission was given to
launch either host. OpenCode custom glyphs, the missing Settings row, and owner
eye approval are therefore unverified under both Electron and Tauri on macOS;
Windows remains unverified as well. The [implementation plan](plans/2026-08-19-automatic-terminal-renderer.md)
`building` keeps agent detection, focus-driven renderer swaps, retries, and
WebGL-context pooling out of scope.

## The icons stayed outline, except the panel toggles — 2026-08-19

[`DeckIcon`](../src/ui/controls/deck-icon.tsx) `current` draws `weight="regular"`
for every icon except the components listed in its `SOLID_ICONS` set, which
today is exactly `SidebarSimple` — both panel toggles, since the dock draws the
same icon mirrored. No dependency changed, no call site moved, and it reaches
BOTH hosts because it is renderer-only.

**This is where a same-day reversal landed, and the reversal is the finding.**
It started as "change Deck's icon set", which had two readings — the UI icon
library or the packaged app's `.icns` — and the owner picked the library. The
complaint underneath was that the chrome reads too heavy, which turned out to be
three separable questions: too thick (fixable with `light`/`thin`), too round
(Phosphor rounds every terminal at every weight, so only a new library fixes
it), too outline (fixable with `fill`, in the same package). The probe that
separated them was a throwaway gallery section, `icon set comparison`
(`src/gallery/sections/icon-set-section.*`), **deleted once the choice was
made** and recoverable only from this entry's own commit range: 29 of Deck's
icons drawn by Phosphor `regular`/`light`/`thin`/`fill`/`duotone` and by
Lucide, Tabler, Iconoir, Material Symbols (sharp and rounded, outline and fill)
and Remix (line and fill), at every DL-14.2 size, with live size and stroke
controls. Candidate SVG was read out of npm packages
installed in a **scratchpad** and frozen into a JSON beside the section — so
`package.json` was never touched and no dependency fork was opened.

The owner picked `fill`, the app ran entirely at `fill`, and then the owner
looked at it RUNNING and reversed: solid is right for a panel toggle and wrong
for everything else. The mechanism is that Phosphor's `fill` does three
different things. Icons with a body go solid (folder, trash, globe, terminal,
table, calendar, chat, gear, gauge, play). Stroke figures merely thicken
(`ArrowLeft`, `Repeat`, both clockwise arrows, `TreeView`, `GitFork`). And bare
glyphs change SHAPE: `X`, `Plus`, `Minus` and `Check` become a solid square with
the mark knocked out, and the carets become solid triangles — the tab strip's
close control and the font-size stepper became filled tiles, which is what the
uniform version died of. A panel toggle survives because its icon is a picture
of a layout, and a filled half IS the layout.

The exception lives as a set of components in `deck-icon.tsx`, not as a `weight`
prop, so no call site can pick its own weight (DL-14.1). Identity, not
`displayName` — a minifier may drop the name, and a silently-empty match would
quietly restore the uniform outline set.

**Two measurements from the pass, both worth keeping.** All 53 icons the app
imports do change at `fill` — one `regular`-vs-`fill` path comparison each,
against `@phosphor-icons/react/dist/defs`. And solid coverage across libraries,
over the 29 the probe carried: Phosphor 29/29, Material Symbols 29/29, Remix
29/29, Tabler 18/29, Iconoir 8/29, Lucide none at all (it is outline-only, which
removed the set recommended minutes earlier as the most SF-Symbols-like). Two
counts were wrong on the way here and are corrected: a guess of "about twelve
change", and the probe's own belief that Deck uses 29 icons. It uses 53 — a
shell scan missed six multi-line imports (`settings-nav-icons.tsx`'s eight rail
categories among them) and the gap surfaced only when the owner recognised the
settings rail in a screenshot of the running app. The gallery comparison
therefore covers 29 of 53: enough to choose between libraries, not a census.

**Evidence and what is owed.** `deck-icon` 8/8 pins both halves. The full suite
ran green apart from two entries outside this change — `search-bar` (a timeout
that passes 23/23 in isolation) and `icon-system`'s glyph gate, which another
session's `gallery/sections/settings-direction.tsx` fails on a literal `↺`.
Owner eye review happened on the app they were running, which is what produced
the reversal; **no packaged build and no `electron:dev` pass of the final
state**, and Tauri is unverified as always. The comparison section and its
registry row are gone — it was built to answer one question and the question is
answered.

## Chrome ink goes neutral — 2026-08-17

The owner read the app's text as "hơi ánh xanh" — faintly blue — and asked for
gray. The tint was measurable, not a matter of taste: `deriveChromeColors`
builds the entire `--text-*` ladder out of the theme's `foreground`, and three
of the four built-in palettes ship a blue-violet one. Tokyo Night's `#c0caf5`
is 73% saturated, Catppuccin Mocha's `#cdd6f4` 64%; the derived `--text-primary`
came out at `#cfd7f7` (s71%) and `#dee4f8` (s65%) respectively. Nothing in the
chrome was blue on purpose — every label, path, tab title and menu item in the
app was simply wearing the terminal's ink.

**The fix is at the palettes, not at the derivation** (owner's call, offered
against the alternative of neutralizing inside `deriveChromeColors`). Each
built-in `foreground` is now the gray of MATCHING WCAG relative luminance:

| theme            | fg before | fg after  | contrast on its own bg |
| ---------------- | --------- | --------- | ---------------------- |
| Tokyo Night      | `#c0caf5` | `#cbcbcb` | 11.14 → 11.09          |
| Dracula          | `#f8f8f2` | `#f8f8f8` | 13.36 → 13.41          |
| One Dark         | `#abb2bf` | `#b2b2b2` | 6.57 → 6.60            |
| Catppuccin Mocha | `#cdd6f4` | `#d7d7d7` | 11.34 → 11.40          |

Matching the luminance is what makes this a hue-only change: every ratio moves
by less than 0.06, so DL-3.5's floors, the `ensureContrast` raise and the
ordering guarantee are all untouched, and `checkChromeTextContrast` still
returns `ok` for all four. The derived ladder now measures 0–4% saturation
instead of 65–71%; the residue is `textMuted`/`textFaint` mixing back toward a
background that is itself faintly blue, which is why the new test asserts a 6%
ceiling rather than a literal gray.

**The ANSI sixteen are deliberately untouched.** They are what makes a palette
recognizable and what program output is supposed to look like — Tokyo Night's
blue is still Tokyo Night's blue. `cursor` followed `foreground` only where the
palette already had the two equal (Tokyo Night, Dracula); One Dark's `#528bff`
and Catppuccin's rosewater are deliberate accents and stay.

Recorded as **DL-3.6**, and it binds the four built-ins ONLY. An imported theme
keeps whatever foreground its file declares — the file is the user's, and
rewriting it would make an import a suggestion — so chrome under a tinted
import is still tinted. That is the trade this shape accepts in exchange for
never overriding a user's file.

**`--hair`/`--hair-strong` came along** (owner, same ask). They were the last
chrome tokens still mixing from `--fg`, so every input border and config rule
was drawn in the palette's blue; once the ink beside them went neutral, a
tinted hairline would have been the one coloured thing left in the chrome.
They now mix from `--tone` like the seams do, which closes the carve-out
DL-2.3 had been carrying ("the surfaces still on them were not part of what was
reviewed"). Source and job are separate questions now: `--tone` answers the
first for every line in chrome, inside-vs-between-surfaces answers the second.

**Evidence.** `npm test` 3009 passed / 2 failed of 3011 — both reds
(`agents-section`, `prompt-popover`) belong to a concurrent session's
uncommitted work in this checkout: those files were last written 2026-08-16
23:34, before this task started, and contain zero references to theme, `--fg`
or hair. `npm run build` clean. A Chrome pass against the running
`prototype:gallery` confirmed the live values (`--fg: #cbcbcb`,
`--hair: rgba(255,255,255,0.12)`, `--text-primary: #d9d9d9`) and photographed
the window-chrome specimen under Tokyo Night and Catppuccin Mocha. **Not
established:** no `npm run electron:dev` pass, no `npm run tauri dev` pass, and
**no owner eye review** — a gallery is a browser, and this is a colour change,
which is exactly the class of work a screenshot in a dev harness is weakest at
proving. Renderer-only plus a data change, so it reaches BOTH hosts.

## opencode answers a tail, and its store had moved — 2026-08-17

The owner ran an opencode pane, watched it answer in the terminal, and saw the
rail row still say nothing but `opencode`. Two separate causes sat behind that
one symptom, and the second one only surfaced because fixing the first did not
help.

**Cause one: a deliberate v1 absence.**
[`session-tail.ts`](../electron/resume/session-tail.ts) `current` listed opencode
as an absence with ONE stated reason — its storage layout was unconfirmed —
so it answered `null` before any scanning happened. Reading the layout expired
that reason.

**Cause two, the real one: opencode 1.18 moved its state into SQLite.** Deck's
scanner walked `~/.local/share/opencode/storage/` — a json tree of session
objects, `message/<sessionID>/` turns and `part/<messageID>/` words — and that
tree is now **frozen legacy data**. Everything current lives in `opencode.db`
beside it, ids and json blobs unchanged. Nothing failed: the directory still
exists and still parses, so the scan returned old sessions and the rail showed
the fallback. On this machine the tree's newest file was hours stale while panes
were answering, and **no session in it named any workspace the owner had open**.
`lsof` on the running `opencode` process is what settled it.

That means the defect was never only cosmetic. `resolve.ts` reads the SAME
scanner, so **session restore was resolving opencode panes against dead data** —
resuming a months-old conversation or none — with no error anywhere.

### How it reads now

[`opencode-db.ts`](../electron/resume/opencode-db.ts) `current` uses
**`node:sqlite`**, Node's own driver: no npm dependency, no native rebuild, no
packaging or signing consequence. That was the fork the owner approved
(`better-sqlite3` was the alternative, rejected for its ABI-rebuild cost).
Verified present in the Node that Electron 43 embeds — 24.18.1 — via
`ELECTRON_RUN_AS_NODE=1`, which is also how to run any Electron-runtime check
headlessly on this Mac.

[`opencode.ts`](../electron/resume/opencode.ts) `current` merges both layouts,
database first, and `resolve.ts` did not change a line — it still calls
`opencode.candidates`. Four details are load-bearing:

- **The merge dedupes by id.** The migration carried ids over unchanged, so a
  migrated session exists in both stores. Two copies would defeat the greedy
  `takenByAgent` dedup: pane two would "match" the file copy of the session pane
  one already took, and both panes would resume one conversation.
- **Sub-agent sessions are excluded** (`parent_id IS NOT NULL` — 56 of this
  machine's 157). They share their parent's `directory`, so one would otherwise
  rank as a candidate and show a delegated task's turn as the pane's own.
- **`type = 'text'` exactly, in SQL as in the file walk.** A `reasoning` part
  carries a `text` field of its own and is frequently the NEWEST part of a turn;
  matching the field's presence would print the model's private thinking on the
  rail. A tool-only turn contributes no row, so ordering by time and taking one
  row IS the walk-back to the turn before it.
- **The connection never outlives the call.** Opening reads a page, not the
  290 MB file (measured 7 ms for a tail query), and a held handle would sit on a
  database another process is actively writing.

The legacy tree still answers when the database does not, for an install that
never migrated — that half is `legacyCandidates`/`legacySessionTailText`, with
its ids `[A-Za-z0-9_-]`-checked before they reach `path.join` (C7). The
`TAIL_SOURCES` entry shape also changed, from `{ candidates, parse }` to
`{ candidates, read }`, because opencode's reader owns the whole read; the
`sourcePath === undefined → null` guard moved INTO the Claude/Codex closures,
since opencode's candidates never carry a path.

### Verification state

`electron/resume` suites **45/45** (`opencode-db` 10, `session-tail` 20,
`resolve` 15) and `tsc -p tsconfig.electron.json` clean. A `tsx` smoke against
the owner's real `opencode.db` resolved the live `spacevibe-api` pane to its own
session id (`resolveResume` → `ses_ff1000cf2…`) and to the exact sentence
visible in the terminal, and two panes in one cwd took two different sessions.
**No full suite, no bundle, no native `electron:dev` pass, no owner eye review.**
Electron only; on Tauri the rail keeps its fallback.

## One line, and the sentence takes the agent's name — 2026-08-17

Same day, hours after the section below: the turn stopped being a SECOND line
and took the agent name's slot, so every rail row is one line — and the tab
strip's chips print the same sentence. Both are the owner's calls, made from
the shipped rail; [DL-27.15](DESIGN-LANGUAGE.md) `current` and
[DL-18.10](DESIGN-LANGUAGE.md) `current` carry the amendments, and DL-20.1
gained a fourth radius role for the chip.

**Why the name went.** A project running three `claude` panes printed `claude`
three times: the word was already said by the brand glyph beside it, and the
only text telling those rows apart was the sentence underneath — which was
also the text being trimmed hardest. So the row spends its one slot on the
turn. Two exceptions keep a word that exists nowhere else and let the turn
follow it on the same line: a name the USER typed, and an unlabelled row (no
cluster header above it to carry the project name). A pane that has said
nothing keeps its agent name, so no row is ever blank.

**What that cost, accepted.** Sharing the line with the age and the state mark
trims the sentence sooner than a full-width second line did — measured at the
276px specimen width, roughly 30 characters before the ellipsis. The sidebar
is resizable (DL-18.9) and the whole sentence stays in `title` and the
accessible name (DL-27.4).

**The model got simpler, not richer.** `RailPaneRow.message` is now the tail
or empty — the custom-name fallback inside
[`agent-rail-model.ts`](../src/ui/agent-rail-model.ts) `current` is gone,
because the name it fell back to now stands on the row itself. `RailTabRow`
gained one boolean, `named`, which is the whole of the "a typed name is not
replaceable" rule. `.asr-leaf--flat` took the tab row's own height and vertical
padding (34px, 6px): with the turn on one line a leaf and a tab row are the
same object seen twice, and 4px of difference read as two lists.

**The strip quotes the rail, through the rail's own precedence.**
[`tabTail`](../src/ui/agent-rail-model.ts) `current` is exported for
`TabStrip`, so "which pane speaks for this tab" is answered in ONE place and
the two surfaces cannot quote different agents. The chip reports no agent
STATE — everything 2026-08-16 took off it (dot, attention mark, popover) stays
off; only the text changed. Paying for the longer text: `--radius-flat` (2px,
DL-20.1's new dense-row role) so the left padding stops holding text off a
curve, `--type-meta` instead of `--type-body`, `max-width: 210px`, and the
label's own 140px cap removed so the trim lives in one place.

**Verification.** Rail and strip suites green; `scripts/design-language.test.ts`
green after its radius gate learned the new role (the gate is why the token,
the rulebook prose and the table row all had to move together). Gallery
screenshots at 276px rail width: every row 34px, chips at 2px radius / 11px /
≤210px. `paneTails` is now seeded in the gallery
([`SEED_PANE_TAILS`](../src/gallery/seed-data.ts) `current`) — without it no
specimen could show a turn at all, since a browser has no session log. `npm run
build` is clean, and the four suites that own this work are 95/95 —
`agent-rail-model`, `agent-rail`, `tab-strip` and `tab-bar`, including new
cases for `tabTail` and for all three chip branches.

The full suite read 2997 pass / 4 fail at 15:57, and **every failure belongs to
a session running concurrently in this same checkout**: `AgentsSection`'s label
id, `PromptPopover`'s empty body and two `OpenBoard home view` cases, in files
last written 15:49–15:51 and importing nothing from this work. That session also
briefly broke `src/ui/app.tsx` mid-run (`DetectedAgent`, then
`quickPickerAgents`), which is worth knowing when a build here fails in a file
nobody in this task opened. **Owed: the native `electron:dev` pass and the owner
eye review**, on both surfaces.

## The rail says what the agent just said — 2026-08-17

Tier 3 of the agent status rail is built. Every rail row now spends its second
line on the agent's newest turn, and a quiet row dims — the treatment the owner
approved from rendered specimens in
[`attention-direction.tsx`](../src/gallery/sections/attention-direction.tsx) `current`
on 2026-08-17. It is the HYBRID of that section's two variants, not
either alone: a turn on every row (variant A) AND quiet rows faint (variant B).
New [DL-27.15](DESIGN-LANGUAGE.md) `current`; DL-27.11's "only `asked`/`failed`
may spend a second line" sentence is superseded.

Two frozen decisions were overridden on the owner's explicit ask that day, and
both are recorded here rather than edited out of the spec:
[spec](specs/2026-08-16-agent-status-rail-design.md) `decided` §2.6's "a message line is
exceptional", and §10's sequencing gate ("tier 1 native pass before tier 3
starts"). The rail has been in the owner's daily native use since 2026-08-16;
the native eye review still happens, as this work's own gate, not as a
precondition.

### Where the sentence comes from

[`session-tail.ts`](../electron/resume/session-tail.ts) `current` reads it off
the agent's own session log, in the main process, over a new flat `session_tail`
channel (R6) that mirrors `resume_lookup` request-for-request. It reuses the
resume scanners rather than re-walking disk: `CandidateSession` gained an
optional `sourcePath`, which `SessionRecord` already declared — so **neither
`claude.ts` nor `codex.ts` changed at all**, which is the one deviation from the
plan (it asked for a new `filePath` field, a second name for the same thing).
[`tailBytes`](../electron/resume/head.ts) `current` is `headBytes`' mirror:
`lstat`-guarded, symlink-refusing, reading the LAST 64 KiB instead of the first.
Ranking, the 30-day cutoff and the greedy `takenByAgent` dedup are
`resolveResume`'s, imported rather than copied — without the dedup, two panes
running one agent in one cwd would wear the same sentence.

**`claude`, `codex` and `opencode` produce a real tail.** `gemini` (no candidate
scan at all), `agy` (protobuf, no schema) and declared custom agents answer
`null`, and those rows keep the fallback they had. `opencode` shipped in that
list on 2026-08-17 and left it hours later, once its store was found — see
[opencode's SQLite move](#opencode-answers-a-tail-and-its-store-had-moved--2026-08-17)
above. Every failure —
unreadable file, malformed request, unparseable line — answers `null` AT ITS OWN
POSITION, so a batch of eight panes cannot lose seven because one scan tripped.

### When it asks

[`session-tail-store.ts`](../src/terminal/session-tail-store.ts) `current` is a
window-scoped signal store (R5) driven by `tabViews`, **never by a timer**: a
300ms debounce, a fingerprint of every agent pane's `changedAt`, one batch in
flight at a time with the latest fingerprint winning. Two rules carry its
correctness. **Only a pane with `hasRun === true` is asked**, because a freshly
opened pane's cwd may well hold yesterday's session and the rail would dress a
silent pane in someone else's sentence. And **a `null` answer keeps the previous
tail** rather than erasing it — a scan that raced a write is not evidence the
pane never spoke. The sent fingerprint is claimed before the await and kept on
failure: resetting it would turn `pane-info-poller`'s 2s cadence into a retry
loop, which is the interval this store exists to avoid.

### v1 limits, accepted

- A pane spawned in a subdirectory or another worktree drifts from its tab's
  `workspacePath`; the cwd match fails silently and that pane's tail stays null.
- A tail refreshed mid-turn can show a partial sentence. The debounce plus
  `changedAt` should mostly avoid it; the owner rules after the native look.
- A `failed` pane shows its last assistant text, not the error line. Open.

### Verification state

Electron only; no Tauri implementation exists, and on Tauri the rail degrades to
the custom-name fallback. `npm test` 2968 pass / 253 files, `npm run build`,
`npm run generate:menu:check` and `npm run electron:build` all clean on
2026-08-17. **The native `electron:dev` pass and the owner eye review of the
running rail are both OWED** — the gallery pass on the real `AgentRail` is the
only visual evidence so far. Windows is unverified (Gate C).

## `New`, and a pane you can drag into place — 2026-08-16

`New` now sits in the sidebar frame immediately after the hide control
(owner, 2026-08-19), leaving the rail itself for live project rows only. It
still answers "another one, where?" two ways: clicked, it opens the Open board;
dragged onto a pane, it docks an agent pane at that pane's nearest edge inside
the tab that is already open. Design rule:
[DL-27.14](DESIGN-LANGUAGE.md#27-the-agent-status-rail) `current`. On the
owner's ask the frame control is compact: 24px high, label `--type-body`, glyph
`CHROME_ICON`, directly beside `SidebarToggle`. Its click/drag controller moved
with it; only the mount changed.

**Which agent, and why nobody is asked.** The owner chose spawn-immediately
over a picker step, so the drop itself is the confirmation and the agent has
to come from memory. [`agentForWorkspace`](../src/lib/workspace-recents.ts)
`current` reads the target tab's workspace `lastAgent` and resolves it through
the existing `resolveAgentChoice` rule against a live `detect_agents` probe.
The probe is AWAITED, for the reason the open board already documented: a
resolution against a not-yet-answered list silently spawns a Shell. A folder
never opened before takes the first detected agent; a host that detects none
opens a plain shell; a remembered agent whose binary has left `$PATH` falls
back silently, since there is no step left in which to warn.

**The seam.** [`dropAgentPane`](../src/terminal/tab-manager.ts) `current` is
the first agent launch that adds a pane to a LIVE tab — `openQuickAgent` and
every preset/board open create a tab — and therefore the only `arm` call
outside `materialize`. That is safe because `AgentLauncher.arm` merges per
pane id rather than replacing the pending set, which session restore (many
panes armed at once) depends on. Underneath it,
[`dockNewPaneAt`](../src/terminal/terminal-manager.ts) `current` follows
`adoptIntoActiveTab`'s shape: fresh cwd from the target pane, spawn, then
`dockNewPane` — NOT `splitLeaf`, which takes a direction and always appends to
branch `b`, so a left or top drop would land on the wrong side. A test pins
exactly that: a `left` drop leaves pane order `[2, 1]`.

**The drag.** [`new-pane-drag.ts`](../src/ui/new-pane-drag.ts) `current` is a
new controller rather than a mode of `pane-drag.ts`: it carries no source
pane, so no slot is excluded and a tab with ONE pane is a legal target, where
the pane drag deliberately refuses below two. It reuses that module's pure
`dropTargetAt`/`edgeFor` and its `.pane-drag-ghost`/`.drop-overlay` CSS
verbatim, so the two drags cannot look different. Below the 5px threshold
nothing is created and the button's own `click` fires untouched; above it, a
click released back over the row is swallowed once so an aborted drag does not
open the board. The drag reports "no targets" whenever the stage is
covered — a browser or document surface (the rail's own `surfaceActive`), and
`panelObscured()` for the board, the full-bleed Settings screen and every
modal. Both matter: the `WebContentsView` sits above the renderer DOM, which
is the ⌘T-under-the-picker bug in another shape, and the rail keeps its column
while Settings covers only the stage, so without the second gate a drop would
dock a pane behind an opaque screen. A ZOOMED tab is handled rather than
excluded: `TerminalManager.slotRects()` collapses to the zoomed pane at the
container's rect, because `layout.slotRects()` keeps returning the hidden
grid's `.pane-slot` geometry while the zoom overlay covers it — the same
reading `fileDrop` takes with `zoomedId() ?? paneIdAt(x, y)`.

**Evidence.** `npm run build`, `npm run electron:build` and
`generate:menu:check` exit 0; 23 new tests pass (9 drag controller, 6
`dropAgentPane`/`activeSlotRects`, 8 `agentForWorkspace`) alongside the rail's
own 26. Renderer only, so it reaches the Tauri host too, where nothing has
been run. **No hand
has dragged it**: every drop in the suite is a synthesized pointer sequence
over fabricated rects, so the ghost has never been seen over a real xterm
canvas or over a `WebContentsView`, and there is no owner eye review.
`RepositoryRail` is parked and keeps its own `Open workspace` row.

## The rail speaks the dev's states, and a multi-agent tab is a tree — 2026-08-16

The rail's five states now read from the dev's side
([`paneState`](../src/ui/agent-rail-model.ts) `current`, DL-27.3): `asked`
(yellow) is everything needing your eyes — a question, a permission wait, or a
finished run you have not checked; the old accent `done` ring folded into it
as a TEMPORARY owner call, and the tracker still keeps `completed` distinct so
unfolding is one case label. A quiet pane splits on a new tracker bit,
[`hasRun`](../src/terminal/agent-attention.ts) `current`: `done` (ran, you
checked — the icon system's green `CheckCircle`, DL-14.6's one scoped
exception) versus `idle` (never ran — a hairline ring with a core, the owner's
R4 pick; the bare ring is retired). A tab running several agents lists each
pane as an always-visible leaf row joined by a hairline elbow (new DL-27.13,
reversing DL-27.11's two-level rule same-day); the chip budget, `+N` and the
joined `claude + codex` identity died with it — an unnamed multi-agent parent
says `N agents`. The rail close's hover wash went neutral like the strip's.
Every choice was owner-picked from gallery specimens
([`agent-rail-variants.tsx`](../src/gallery/agent-rail-variants.tsx)
`current`, kept as the approved record). Evidence: typecheck clean and the
gallery mounting the real rail; **no `npm test`, no native pass, no owner eye
review of the wired rail** — and the change reaches the frozen Tauri host,
where nothing has been run.

## The icons are Phosphor now — 2026-08-16

The owner asked to move to another library's icon set, then asked whether
Lucide itself had a different style. It does not — Lucide is outline-only, and
`strokeWidth` is the whole of its expressive range — so a different look meant
a different package. Offered Phosphor, Tabler, Heroicons and "keep Lucide,
retune the weight", they chose **Phosphor**, and chose to see it before it was
written rather than after.

- **The specimen came first and is already gone.** A gallery section drew all
  54 icons the app imported, each beside the Phosphor name proposed for it, at
  the four sizes chrome draws and under a live weight picker. The owner picked
  **`regular`** from it. The section was deleted in the swap, because it was
  the last module importing `lucide-preact` and the dependency could not come
  out while it stood.
- **Weight replaces stroke width.** Phosphor has no `strokeWidth`: `regular`
  is one of six discrete families, picked because it reads closest to the
  `strokeWidth={1.8}` the retired set drew at.
- **The class the stylesheet targets is Deck's own now.** `.lucide` was a
  vendor's naming convention that the app's one icon rule
  (`display: block; flex: none`) had quietly come to depend on; Phosphor emits
  no class at all, so `DeckIcon` emits `.deck-icon` unconditionally and the
  rule follows it. A per-icon `.deck-icon--<name>` modifier, derived from
  Phosphor's `displayName`, exists **for tests only** — 31 assertions
  identified icons by the old class — and nothing in CSS may depend on it,
  because a minifier is entitled to drop a `displayName`.
- **Three icons changed what they depict, and one rule decided them.**
  Phosphor draws no folder-with-git and no branch-with-plus, so the naive
  mapping put the repository rail's row and the open board's create-worktree
  action on one `GitBranch` — which DL-14.5 forbids. The live surface kept
  `GitBranch`; the parked rail's row took `GitFork`. `FolderX` became
  `FolderDashed` (a missing checkout, not a subtracted one) and `FolderTree`
  became `TreeView`. `FileJson` has no file-shaped equivalent and became
  `BracketsCurly`. `PanelRight` is not a second drawing: Phosphor's
  `SidebarSimple` faces left and `DeckIcon` gained a `mirrored` prop.
- **Phosphor is a React package.** It reaches Preact through the `preact/compat`
  alias `@preact/preset-vite` already installs; `tsconfig.json` gained the
  matching `paths` entry, which is what makes its types resolve — that change
  affects how the whole repo typechecks from now on, not just icons.
- **Not verified.** `npx tsc --noEmit` is clean over the tree (excluding two
  pre-existing failures another session left in `src/files/`), and that is the
  only gate that has run: **no `npm test`, no `npm run build`, no native
  pass**, and the gzip ceiling DL-1.1 cites has not been re-measured — see the
  §10 ledger. Renderer-only, so it reaches BOTH hosts; only Electron has ever
  been run. The owner has eye-reviewed the specimen, not the running app, and
  four substitutions (`GitFork`, `FolderDashed`, `TreeView`, the mirrored dock
  toggle) were chosen after that review and have never been seen.

## The open board stops asking — 2026-08-16

The owner sent a screenshot of the board's Layout + Agent screen and said it was
not needed any more. Asked what a click on a recents row should do instead, they
chose **open it straight through with the combo it was last opened with**, over
handing off to `AgentQuickPicker` or folding the chips into the home view; on
the layout half they chose to keep presets and remove only the board's picker.
No spec or plan document, by their choice.

**What the board is now.** Two views, not three:
[`OpenBoard`](../src/open-board/open-board.tsx) `current` renders home, or the
create-worktree form. `BoardView` lost `"config"`, and with it `configView()`,
the `section` / `renamingId` / `renameValue` / `confirmDeleteId` /
`selectedPath` / `selectedPresetId` / `selectedAgent` signals, the digit-key and
arrow-key handling, and `open-board-layout-section.tsx` outright. What is left
is one function —
[`openWorkspace`](../src/open-board/open-board.tsx) `current` — reached three
ways: a click on a recents row, a folder from the picker (⌘O / Ctrl+Shift+O),
or a worktree the form just created. All three call `onOpen` with the same
`(workspace, preset, agent)` the config view's Open button used to.

**Where the combo comes from.** `lastPresetId` and `lastAgent` on the recent
itself, which the app already writes on every open. `lastAgent` carries three
cases and all three are honoured now: a string is that agent, `null` is a
remembered Shell-only open, `undefined` (never opened, or opened before the
field existed) means first detected. That reverses one small rule the config
view had — "Shell is only ever an explicit click", which existed because the
chip row would not pre-select it; without a chip row there is nothing to
pre-select and refusing to remember Shell would just be forgetting. A folder
with no memory takes `presetsData.lastUsedId`, or the first preset.

**The race the change created.** `detect_agents` is async, and one-click-opens
makes a click land during the probe the normal case rather than a
double-click edge case: `resolveAgentChoice` FALLS BACK rather than waiting, so
a remembered `claude` resolved against an empty list would have quietly opened
a Shell. The board now holds the probe **promise** in a ref and awaits it inside
the open path instead of reading a signal that may not be filled yet. Covered by
a test that holds the probe open across the click.

**What has no home any more.**

- **Warnings before the fact.** The footer said "X isn't installed — opens with
  Y" and "X isn't on $PATH — the pane will open, the command won't run". There
  is no step between the click and the spawn to say either in, so a remembered
  agent missing from `$PATH` now falls back **silently**. Stopping the open to
  say it would be worse than opening.
- **Preset rename and delete.** The layout cards were the only call sites of
  `renamePreset` / `deletePreset`; both functions stay exported from
  `presets-store` and are now unreachable from the UI. Creating (⌘⇧N / menu)
  and overwriting a preset (⌘⇧S) are untouched. Named at removal time and
  accepted — restoring it needs a new home, most likely a settings section.
- **`EditorRequest`'s `"board"` source.** The `+ New Layout` card was its only
  producer, so `handleEditorCreate`'s board branch is gone and the union is one
  member. `livePresetOpensATab` is unchanged: ⌘⇧N over the board still saves the
  preset without materializing a tab behind it.

**Where a failure is said.** The config footer was the only place the board ever
reported one, and the reason still holds — the manager writes its error into a
terminal behind this overlay, and on a first run there is no terminal at all. So
home grew one line, `.board-home__notice` (`role="status"`, `--yellow` per
DL-3.2), carrying both a failed spawn and a click on a row whose folder is gone.
A missing row stays clickable on purpose: an inert row explains nothing, and the
folder may have come back since the scan.

**Verification.** One gate: `npx tsc --noEmit` exits clean over the whole tree
(run after the owner reported an unrelated `derive-colors.test.ts` type error,
fixed in the same turn — `ThemeColors` leaves `blue` optional, so that test now
resolves the accent through the exported `FALLBACK_ACCENT` exactly as
`applyThemeVars` does). No `npm test`, no `npm run build`, no native pass — the
board's three test files were rewritten in this same pass and have never been
executed. The renderer is shared, so this reaches the Tauri host too, where
nothing has been run.

## The grab stops at the clipboard — 2026-08-16

The owner asked for react-grab's output to go to the clipboard only and to stop
being typed into an agent pane. Framed as temporary, so it is one constant, not
a removal. No spec or plan document, by their choice.

**The cut.** [`GRAB_PASTE_DISABLED`](../src/browser/browser-store.ts) `current`
short-circuits `deliverGrab` before it asks for the focused pane, so every
non-empty grab now reports `clipboard`. Nothing else moved: `GrabTarget`, the
`paste` seam, its wiring in `App`, the preload's `isTrusted` gesture gate and
rate limit, `sanitizeGrabText` and the injected bootstrap are all untouched.
Reverting is flipping the constant to `false` and restoring the two strings
below.

**What the clipboard holds.** react-grab's own copy, written from the page's
copy path — the component-and-source snippet, and NOT the `Page: <url>` line
`formatGrab` appends. That line only ever existed on the paste path. Putting it
in the clipboard would mean Deck writing the clipboard a second time behind the
page's own write; nobody asked for that, and it is the obvious follow-up if the
missing URL turns out to matter in use.

**Copy.** `grabSummary`'s `clipboard` branch stopped being an apology
(`Element copied — no pane to paste into` → `Element copied to the clipboard`):
it is now the outcome of an ordinary grab, fired with a focused pane sitting
right there. `failed` reads `could not be copied` for the same reason — with
the paste path off, the only way to fail is a grab with nothing in it.

**Coverage.** `deliverGrab` took a third parameter defaulted to the constant,
purely so the kept-for-revert paste path keeps its tests instead of rotting
until someone flips the constant back; the suite exercises both modes.
Evidence: `npx vitest run src/browser` — 39 passed, 3 files. The full `npm test`
and `npm run build` were skipped at the owner's instruction, and there has been
no native `electron:dev` pass against a real page.

## One modal shell, and a scrim that closes — 2026-08-16

The owner reported that clicking outside `AgentQuickPicker` did nothing and
asked for every modal to be standardised onto one base component. Rule:
`DESIGN-LANGUAGE` §29, new, with DL-1.3 amended. Requested and approved by the
owner on 2026-08-16, with no spec or plan document by their choice.

**What was actually there.** Three components — `AgentQuickPicker`,
`SavePresetDialog`, `PresetEditor` — each opening with its own
`<div class="modal-scrim">`, its own `tabIndex={0}` panel, its own ref, its own
focus-on-mount effect and its own Escape branch. Four copies counting the
gallery's `ScrimStage`, which wrapped a second scrim around specimens that
already had one, so every modal specimen was painting the wash twice. None of
the three dismissed on a scrim click, and that is the shape of the bug: no
single place was responsible for saying they should. A z-index sweep of
`styles.css` confirmed the genre is exactly those three — `.open-board`,
`.usage-screen`, `.sessions-screen` and `SettingsScreen` are full-window
screens (§11), `.tab-popover`/`.prompt-popover` are popovers (§13),
`.persist-error-bar` is a bar.

**The shell.** [`Modal`](../src/ui/modal.tsx) `current` owns the scrim, the
`role="dialog"` + `aria-modal` frame, focus-on-mount and both exits. A modal
passes `panelClass`, a label, `onDismiss`, its own `onKeyDown` and its body —
the panel classes did not change, so the stylesheet did not move and neither
did the z-40 ladder `app.test.tsx` depends on. `initialFocus` is a selector
resolved inside the panel: `SavePresetDialog` focuses its input, the other two
take the panel itself because bare digits and arrows drive them.

**Dismissal reads the press, not the click.** A drag that starts inside the
panel — a preset divider, a text selection swept out of an input — releases
outside it, and the browser fires `click` on the nearest common ancestor, which
is the scrim. Tracking `pointerdown` is what stops the modal closing on the
gesture it just asked for (DL-29.4). `PresetEditor` withdraws scrim dismissal
outright (DL-29.3): its draft — split tree, per-pane cwds, name — exists nowhere
else until "Create tab", so a slipped click there would be the one gesture in
the app that silently destroys work. Escape still closes it, and Escape stops at
the panel because a live terminal reading raw keys is one element behind.

**The blur is a rule change, not a style tweak.** The owner asked for a
blurred, more translucent overlay; DL-1.3 bans `backdrop-filter` outright, and
the renderer had zero uses of it. The rule is amended with a second scoped
exception (the first being DL-1.2's focus ping), on the frugality argument the
section is built from: a modal scrim exists only while a modal is open, so its
compositing layer is transient rather than a standing cost. **That frugality
claim is reasoned, not measured** — no compositing cost was profiled. The
radius of the blur, by contrast, WAS measured: `.modal-scrim` is now a 42%
`--bg` wash — down from 65% — plus `blur(10px)`, picked by rendering the
gallery specimen over a synthetic terminal ground and comparing 6/10/14px.
6px still let the line rhythm read as text; 14px erased the stage into a flat
wash, which is the thing the 42% figure exists to avoid. Reading DL-1.3
closely also turned up three `filter` declarations the
ledger had never carried (`.sidebar-banner` art grading, `button.attn-mark`'s
`transition: filter`); they are recorded as open rows in §10 and deliberately
left alone.

**Two things rode along.** The `.achip` digit badges came off in BOTH mounts —
the quick picker and the Open board's agent section — on the owner's ask; the
digit keys still pick, so order remains the contract, it just is not printed on
the chip. `.achip kbd` and `.achip.is-selected kbd` went with them. And
`agentQuickPickerOpen` joined `panelObscured()` in `app.tsx`: it was already
ranked `modal` by `openOverlayRanks()`, but the list that hides the browser's
native view never learned about it, so ⌘T over an open browser tab drew the
picker underneath the `WebContentsView`. It stays OUT of `overlayCoversPane()`
on purpose — that predicate answers "is the focused pane covered", and the
picker opens a new tab rather than covering the current one.

**Then the panel took the sidebar's ground.** Seen against the blur, a
`--chrome-1` panel — one step off `--bg` — read as a lighter smudge of the
same background rather than as an object. All three modals moved to
`--sidebar-bg`, the recessed plane the navigation column and the docked panel
already stand on (DL-29.6, new). It is the only ground in the app that never
appears on the stage, which is what makes the panel unmistakably chrome, and
it stops modals from being a third chrome surface colour.

**And the picker became a destination plus a column of rows.** The owner asked
for the agents stacked one per row, each read against the worktree and branch
the tab will open in, with the worktree changeable. DL-29.7, new, is the shape:
the target is stated ONCE in a §5 config row above the list (`menu` value kind,
a native `<select>` under the styled pill per DL-1.4), and the agents are rows
in a column rather than the open board's wrapped grid — a grid reads
left-to-right-then-down, which leaves "which destination do these agents belong
to" ambiguous. The open board keeps its grid: there the chips are a value being
set, not a list of things to launch.

Worktree and branch are **one** choice, not two, and that is git's doing rather
than a simplification: a worktree is checked out on exactly one branch and two
worktrees cannot share one, so the row prints `folder · branch` and changing it
changes both. Selecting a branch independently would mean `git checkout` inside
a worktree that may be dirty and may have another agent running in it — a
repository write from a modal called "quick". The owner was offered that and
chose not to have it; opening a branch with no worktree stays the open board's
create-worktree flow.

No new IPC: `git_repository` already returns every worktree with its branch,
and `repositories-store` already caches scans by path for the rail, so the
picker's open re-uses that cache and only pays a scan on a workspace the rail
has not reached.
[`worktree-destinations.ts`](../src/repositories/worktree-destinations.ts)
`current` is the pure half — it drops bare and prunable entries, computes
`primary` on git's first non-bare entry so the flag means the same thing here
as on a rail row, and resolves the default through `worktreeForPath`'s
longest-prefix rule so a pane sitting in `worktree/packages/web` preselects
`worktree`. Three edges are deliberate: the scan is async so the component
resolves its selection on every render instead of seeding state at mount (it
normally mounts with an empty list); a digit typed while the `<select>` has
focus is the browser's type-to-select and must not launch a tab; and one
worktree is not a choice, so it renders as DL-17.3's readout. `git_repository`
is Electron-only, so on Tauri the row is **omitted** and the tab lands where it
always did.

The one seam that moved is `TabManager.openQuickAgent`, which took a second
argument: a chosen destination overrides BOTH the cwd and the workspace tag,
because tagging the tab with the worktree it runs in is what files it under the
right rail row. Passing null reproduces the old behaviour exactly, which is
what every host without the channel gets. Approved as a fork by the owner on
2026-08-16 (tab materialization, `AGENTS.md`).

**Evidence.** `npm test` — 2872 passed, 1 failed:
`src/files/ui/file-tree-view.test.tsx`'s 10,000-row windowing case, which
times out at 5s under full-suite load and passes in 1.8s on its own; both that
file and its test date from 2026-08-14 and neither was touched here. (An
earlier run in this same session also flagged `scripts/icon-system.test.ts`
against `src/ui/sessions/session-row.tsx`, an untracked copy of an unmerged
branch; that failure is gone, fixed by another session sharing this checkout.)
`npm run build` and `npm run generate:menu:check` both green;
`scripts/design-language.test.ts` resolves every new `DL-29.x` citation. Plus
browser measurements against the gallery specimen over a synthetic terminal
ground: the `blur(10px)` figure was chosen there by comparing 6/10/14px, and
the destination row's pill was measured for truncation (`.cfg-btn__text`'s
130px cap is sized for the settings column and ate the branch, so the picker
raises it to 240px). **Owed: a native `npm run electron:dev` pass and an owner
eye review** — a gallery specimen is a browser, not a host, so nothing here
establishes how the blur composites in a packaged app over a real xterm canvas,
and no worktree has actually been opened into. Renderer-only, so the shell and
the row reach the Tauri host too, where nothing has been run and where the
destination row will not appear at all.

## One strip, one chip, one order — 2026-08-16

The tab strip stopped being two segments. A terminal tab, a document and the
browser now share one chip shape and sit in the order they were opened; the
`.tabbar__sep` hairline that used to split terminal chips from surface chips is
gone from the strip (the feature toolbar still uses that class to group
buttons). Rule: `DESIGN-LANGUAGE` DL-18.10, with DL-18.6 and DL-18.8 amended in
place. Requested and approved by the owner on 2026-08-16, from a screenshot of
another editor's tab bar, with no spec or plan document by their choice.

**What a chip is now.** One glyph slot (15px) holding exactly one mark, the
label, the close control — identical for every kind. A terminal chip leads with
the agent's brand mark, or `SquareTerminal` when no agent is recognised. A
document takes the file-type icon the tree already uses, which is where that
vocabulary stopped being docked-panel-only. The browser keeps its globe.
[`AgentGlyph`](../src/ui/controls/agent-glyph.tsx) `current` was lifted out of
`AgentRail` so a chip and a rail row cannot disagree about what an agent looks
like.

**Then the chip was stripped down to one job.** Reviewing it the same day, the
owner took off everything that was not "what is open": the colour dot, the
agent attention mark, and the rename popover a chip used to open. What is left
is glyph + label + close, and a click on the chip that already holds the stage
does nothing. Agent state now lives in exactly one place — the rail — instead
of being reported by two surfaces in the same window. None of the three
features was deleted: `AgentAttentionMark` and `TabPopover` are untouched and
still raised by the rail, so this is the strip stepping out of them. Two
consequences worth stating: the strip no longer claims the window-wide popover
slot (`tab-popover-slot.ts`, whose whole point was arbitrating between the rail
and the strip), and **⌘⇧R now reaches nothing in top-tab mode**, which has no
rail to answer it — sidebar mode is unaffected.

**Every chip got a resting wash, and the selected one got a frame.** With the
dot, the mark and the popover gone, the strip read as text floating in the
terminal: an idle chip had no background at all, and DL-21.1's 15% selection
wash had nothing to be brighter than. Two steps fixed it, both scoped
exceptions written into §21 rather than general licences. `--tab-rest-bg` (3%
of `--tone`, new DL-21.7) gives every chip a body at rest, so the ladder now
reads 3% → 6% hover → 15% selected. The selected chip also carries a neutral
1px `--hair-strong` frame (DL-21.1's exception) — neutral so it is not the
retired accent marker (DL-21.6) returning, and every chip carries the same
border as `transparent` at all times so selection changes a colour and never
the row's geometry. The reason both exist is the same and worth keeping: a
chip has no list around it. A rail row sits among rows on a painted column, so
"no wash" means _not selected_; a chip floats alone on the stage's `--bg`,
where "no wash" means _nothing is here_.

**The strip closes with a seam.** `.stage__strip` now draws the same
`--seam-recessed` hairline along its bottom edge that `.tabbar` has always
drawn in top-tab mode (DL-18.6 amended), so both layouts mark where chrome ends
and the work area begins the same way. It is `box-sizing: border-box`, so the
line costs no height and the terminal grid underneath is unmoved.

**The frame's earlier note.** With the dot, the mark and the popover gone,
the wash alone was not enough to say which tab was live: a chip floats on a
transparent strip over the stage's own `--bg`, unlike a rail row that sits among
rows on a painted column, so DL-21.1's 15% wash had nothing to be brighter than.
The selected chip now also carries a neutral 1px `--hair-strong` frame — a
scoped exception written into DL-21.1, not a general licence, and deliberately
neutral so it is not the retired accent marker (DL-21.6) coming back. Every chip
carries the same border as `transparent` at all times, so selection changes a
colour and never the row's geometry.

**The colour dot lasted one revision.** The first cut kept the per-tab dot as a
badge on the brand mark's corner, to avoid silently retiring the colour picker.
The owner looked at it the same day and removed both: two marks in one 15px box
read as noise. The picker is gone from
[`TabPopover`](../src/ui/tab-popover.tsx) `current` — which now carries rename
and, in the sidebar mounts, the workspace logo — but this is **parked, not
deleted**, at the owner's word. `dotColor` still round-trips through settings,
`tab-materialize.ts` and session restore, every mount still passes
`dotColor`/`onPickColor`, and the `.tab-popover__colors` rules are still in
`styles.css`, so restoring the feature is putting one JSX block back. The only
dot left on the strip is the document chip's unsaved marker. In the same pass
the close control's hover dropped its red tint for DL-21.2's neutral wash:
closing a tab has an undo (⌘⇧T), so it was spending DL-3.2's danger colour on
an everyday action. The two other close buttons that share that red —
`.wsitem__close` and `.asr-row__action--close` — were left alone; the request
was about the strip.

**Order, and why it is not just paint.** Three owners publish chips —
`TabManager`, the file store and the browser store — and none of them can see
the others, so a per-owner counter could only order that owner's own chips. One
window-wide clock ([`open-sequence.ts`](../src/lib/open-sequence.ts) `current`)
stamps every open, and [`mergeStripOrder`](../src/lib/strip-order.ts) `current`
merges the two index spaces into the visible row.
**`TabManager` and `TabStrip` both consume that merge**, which is the reason it
lives in `src/lib/` instead of in the renderer: ⌘⇧[ / ⌘⇧], ⌘1–9 and ⌘9 now count
CHIPS, so ⌘2 can land on a document. That reverses the 2026-08-14
"digits stay terminal-only" rule on the owner's explicit call.

**The seam held.** `SurfaceStrip` gained exactly one optional method,
`orderKey(index)` — TabManager learns when a surface was opened and still
nothing about what a surface IS (file-explorer spec §2.3). A `SurfaceStrip`
implementation without it reads as `UNSEQUENCED`, which reproduces the old
terminals-then-surfaces strip exactly, so every existing fake keeps compiling
and behaving. No PTY, window, materialization or close path changed.

**Two things deliberately did not change.** The green labels in the owner's
reference screenshot are another editor's git-status colouring; Deck's file
model has no git status, and a label is still `--text-primary` when selected
and `--text-muted` otherwise. Sidebar mode still scopes terminal chips to the
active repository — the merge orders whatever that scope leaves visible.

**Evidence.** `npm test` on 2026-08-16 at 12:56 local: 2818 passed, 2 failed.
One is `scripts/icon-system.test.ts`, and what it reports is
`src/ui/sessions/session-row.tsx` — an untracked file from the unmerged
session-history branch, last written at 01:11 that morning, which this work
never opened. The other is the 10,000-row `file-tree-view` windowing test,
which times out only under full-suite parallelism on a loaded machine and
passes when run alone (as does `settings-screen`, which flaked the same way on
an earlier run). `npm run build` and `npm run generate:menu:check` clean.
The merged strip was rendered and read in the gallery, which now seeds a
document opened before the terminal tabs and one opened after them so the
interleave is visible rather than implied. **Owed: a native `npm run
electron:dev` pass and the owner's eye review of the running app.** Renderer
only, so it reaches the Tauri host too, where nothing has been run.

## The docked column became a side panel with tabs — 2026-08-16

The right column stopped belonging to the file explorer. It hosts three
surfaces as tabs now — file explorer, token usage, session history — and one
control on the stage strip opens and closes it.

**What moved.** Token usage and session history left the full-window class
(`DESIGN-LANGUAGE` §11) for tabs of the column, so
[`UsageBody`](../src/ui/usage/usage-body.tsx) `current` and
[`SessionsBody`](../src/ui/sessions/sessions-body.tsx) `current` were extracted
from their screens with a `variant` that lays them out for a 360–560px column.
`ExplorerPanel` became [`ExplorerTab`](../src/files/ui/explorer-tab.tsx)
`current` — the tree and its empty state, nothing else — while the column, its
resize grip and its drag-past-the-floor close moved up into
[`DockPanel`](../src/ui/dock/dock-panel.tsx) `current`. The browser did NOT move
back: it stays a stage tab (DL-18.8).

**Why the toggle is on the stage.** The explorer's hide control lived inside the
panel's own header, so closing the column took its only visible way back with
it — the failure the owner caught on 2026-08-16. It is now
[`DockToggle`](../src/ui/dock/dock-toggle.tsx) `current`, last in the tab strip,
mirroring [`SidebarToggle`](../src/ui/sidebar-toggle.tsx) `current` first in it.
Both are components rather than markup inlined in `App` for the same reason: the
gallery composes `DesktopChrome` itself, so anything written inside `App`'s
stage JSX is invisible to every specimen.

**Settings and Prompts went the other way**, into a pinned footer at the bottom
of the rail ([`SidebarActions`](../src/ui/sidebar-actions.tsx) `current`, new
DL §28). Top-tab mode has no rail, so `DeckToolbar`'s `compact` mode stands the
same two rows up in the toolbar's `More` menu instead. What is left on the
toolbar is the browser and the pane group.

**Consequences worth stating.** `usageOpen`/`sessionsOpen` are gone: a docked
column displaces the terminal grid rather than covering it (DL-19.1), so those
two left `openOverlayRanks()` and `overlayCoversPane()`, and the three-way
mutual exclusion with Settings went with them. `toggle-usage` dropped from
`scope: "always"` back to `"pane"` for the same reason. The persisted keys
`explorerOpen`/`explorerWidth` are retired into `electron/settings-merge.ts`'s
`RETIRED_KEYS`; `dockWidth` starts at 420 with a 360 floor, so a user who kept
a 180px file tree cannot have one any more — one column serving three surfaces
takes its floor from the widest of them.

**The bottom status row went with it.** `showStatusBar` ships false, so the
window drops the row entirely (`window--no-status` zeroes `--status-h` —
the grid loses the band rather than painting 28px of empty chrome). The
component and its readout are untouched; Settings ▸ Appearance ▸ _Show
status bar_ brings it back. Nothing else reads the row, so no layout math
moved with it.

**Two loose ends, stated rather than hidden.** `UsageScreen` and
`SessionsScreen` were deleted — nothing mounted them once their content
moved into the dock — but both bodies keep a `variant="screen"` branch and
the `usage-screen__*` / `sessions-screen__*` rules are still in
`styles.css`. That branch is now unreachable in the app; removing it and
its CSS is a follow-up pass, not part of this one. Second: `VIEW_PANEL_ID`
and `viewTabId()` in [`usage-views.ts`](../src/ui/usage/usage-views.ts)
`current` are unscoped DOM ids shared by the nav's `aria-controls` and the
section — safe only while one usage surface exists at a time, which is true
now and would break the moment a second one mounts.

**Verified by suite and build only.** `npm test`, `npm run build`,
`npm run generate:menu:check` and `npm run electron:build` all pass. Nothing has
been run natively: no `electron:dev` pass, no owner eye review, no gallery
specimen for the new column, and the narrow usage/sessions layouts have never
been seen rendered. Session history is built on `src/ui/sessions/`, an untracked
copy of an unmerged branch, so it may need rework when that branch lands.

## History note (2026-07-27)

This tree used to run an **adk ADR-first pipeline**: `PIPELINE.lock`, an
append-only ADR log in `docs/decisions/` (0001–0028), and six docs rendered from
it — `PRINCIPLES.md`, `PRD.md`, `BUSINESS-FLOW.md`, `ARCHITECTURE.md`,
`UX-DESIGN.md`, `REQUIREMENTS.md`. All of it was removed on 2026-07-27; the
git history still has it.

Consequences worth knowing:

- Code comments no longer cite `FR-…`, `UX §…`, `BF-Rule …` or `ADR …` — those
  references were stripped when the docs went away. `DL-…` citations stay valid.
- Design decisions are no longer recorded as immutable ADRs. Record them in the
  relevant spec or plan under `docs/specs/` / `docs/plans/`.
- Older files under `docs/plans/` and `docs/review/` still reference the removed
  docs. They are point-in-time records; left as written.

## Product snapshot

- Job: observe and control many agent CLIs in parallel on desktop.
- A Deck-native three-region workbench direction is being explored only in the
  chrome gallery before any shipping UI changes
  ([gallery design](specs/2026-08-12-agent-workbench-gallery-design.md) `building`).
- macOS is the current public release; Windows 11 x64 is an engineering preview
  ([platform configs](../src-tauri/tauri.macos.conf.json) `current`,
  [Windows config](../src-tauri/tauri.windows.conf.json) `current`).
- Surfaces: layout presets and the preset editor, pane swap, multi-window
  move/join, the Open board (workspace ∥ preset) reached from the sidebar's
  "Open workspace" row, AgentQuickPicker (the tab strip's `+`/⌘T fast path —
  single pane, active tab's workspace, no workspace/preset step), the
  post-materialize agent picker, the file sidebar with preview and diff, and a
  full-window Settings screen with a category rail
  ([`SettingsScreen`](../src/ui/settings/settings-screen.tsx) `current`,
  [category registry](../src/ui/settings/settings-categories.ts) `current`) —
  a new category is one registry entry plus one file under `sections/`.
- Agents are user-extensible: beyond the built-in five, an agent is a label plus
  a full command line declared in Settings → agents
  ([catalog](../src/lib/agent-catalog.ts) `current`,
  [section](../src/ui/settings/sections/agents-section.tsx) `current`). A
  built-in id equals its binary name, so a workspace's remembered `lastAgent`
  resolves without migration. Discovery probes only names that pass
  [`is_probe_safe`](../src-tauri/src/agents.rs) `current` — the macOS probe
  interpolates them into a shell.
- Session persists chrome only, never CWD; presets carry optional per-pane CWDs
  separately.
- Out of scope: embedding agent UI, SSH, chasing iTerm parity, editing from the
  sidebar, a notarized ship gate.

## Windows engineering preview — 2026-07-29

Implemented source boundaries:

- Windows prefers `pwsh.exe`, falls back to `powershell.exe`, uses
  `USERPROFILE`, and injects session-only prompt/CWD integration
  ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L12-L113) `current`).
- Each Windows pane owns a Job Object; WMI process snapshots expose explicit
  CWD/process/kind/agent truth and fail closed to `unknown`
  ([platform session](../src-tauri/src/platform/windows/mod.rs#L14-L84) `current`,
  [pty_info](../src-tauri/src/info.rs#L10-L34) `current`).
- Windows paths support drive, relative, Unicode, and location suffixes. UNC
  candidates are recognized by the frontend pattern but never resolved: hover
  and open-in-editor reject a `\\`-root before any filesystem call, so a UNC
  path is copy-pasteable and not clickable
  ([terminal-links.ts](../src/lib/terminal-links.ts) `current`,
  [has_rejected_root](../src-tauri/src/shell_integration.rs#L96-L122) `current`).
  Editor requests are structured and Windows custom templates are argv, not
  shell commands
  ([links.rs](../src-tauri/src/links.rs#L187-L314) `current`).
- The Windows keymap, primary modifier, visible labels, clipboard chords, and
  native decorated chrome are platform-owned
  ([WINDOWS_KEYMAP](../src/terminal/default-keymaps.ts#L289-L358) `current`,
  [commands table](../src/terminal/tab-manager.ts#L946-L1024) `current`,
  [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Resolved 2026-08-10: the capture-phase shortcut listener left `Ctrl+V`
  unbound, so it reached the active agent; Codex then treated a text paste as
  image paste. Deck now owns `Ctrl+V`, `Ctrl+Shift+V`, and physical
  `Shift+Insert` for text only, through the existing clipboard-to-xterm path.
  Deck leaves `Alt+V` unbound; whether the active agent CLI handles it for
  image paste is unverified. Plain Explorer Copy of a folder (`CF_HDROP`
  file-list data) and smart clipboard routing are unsupported
  ([WINDOWS_KEYMAP](../src/terminal/default-keymaps.ts#L289-L358) `current`,
  [clipboard text boundary](../src/terminal/terminal-clipboard.ts#L45-L55) `current`).
- This exact paste contract has unit coverage, but real Windows desktop E2E is
  still unverified; it remains part of the pending real-device checklist
  ([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).
- Pull-request CI compiles the Windows desktop without producing or publishing
  an installer
  ([windows-check](../.github/workflows/ci.yml#L65-L109) `current`). CI run
  [30475656139](https://github.com/mxrsv/spacevibe-deck/actions/runs/30475656139)
  passed Linux and Windows on 2026-07-29, including the Windows desktop build.

Delivery state:

- An unsigned NSIS setup is published publicly as the
  [v0.9.0-windows-preview](https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0-windows-preview)
  prerelease (2026-07-31), and the landing resolves its download link at load
  time
  ([shared release source](../marketing/landing-prototype/src/release-data.js#fetchPublishedReleases) `current`,
  [link upgrade](../marketing/landing-prototype/src/download-links.js#upgradeReleaseLinks) `current`).
  The landing header exposes a Changelog item; the GitHub CTA also shows the
  latest stable tag and links that tag to the dedicated bilingual changelog,
  while the hero shows the current combined `.dmg` and `.exe` asset download
  count. The changelog lists stable releases and previews from the same
  validated response
  ([landing CTA](../marketing/landing-prototype/src/directions/a.js#renderDirectionA) `current`,
  [download total](../marketing/landing-prototype/src/release-data.js#totalInstallerDownloads) `current`,
  [changelog view](../marketing/landing-prototype/src/changelog-view.js#renderReleaseList) `current`).
  The manual engineering job in CI still validates one NSIS setup, rejects MSI
  output, and refuses to build unless the repository is private
  ([artifact job](../.github/workflows/ci.yml#L111-L159) `current`); the repo
  was public on 2026-08-01, and how the published exe was produced is not
  recorded in reachable history.
- Gates W1–W4 and the full real-device checklist remain pending
  ([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).
  First field report, 2026-08-01: the installer fails with an NSIS
  "Extract: error writing" when targeting a secondary drive; the default
  per-user install to `%LOCALAPPDATA%` on the system drive succeeds.
- Real Windows screenshots at `1100x720` and `480x320` in top-tab and sidebar
  modes remain pending user eye approval
  ([demo surface](specs/2026-07-29-windows-desktop-design.md#77-window-chrome-and-demo-surface) `decided`).
- Signing remains pending — the preview ships unsigned, so SmartScreen warns
  on install, and the landing says so next to the Windows CTA. The existing
  public macOS release remains unchanged; the tagged workflow now stages the
  next macOS stable and Windows preview as separate updater-enabled releases
  ([release.yml](../.github/workflows/release.yml) `current`).

## Stack

Tauri 2 + Rust + Preact + xterm.js. Signals for state; module stores are
window-scoped. The Rust PTY/window coordinator, tab materialize, layout engine
and close-coordinator paths are the load-bearing seams — treat `src-tauri`
module boundaries as in-flight when planning.

## Cross-platform auto-update — 2026-08-03

Implemented source boundaries:

- Deck checks once after launch and exposes `Update` → `Downloading…` →
  `Install & Relaunch`; download and installation require separate clicks
  ([controller](../src/updater/update-controller.ts#L82-L208) `current`,
  [chrome action](../src/updater/update-action.tsx) `current`).
- On 2026-08-04, the macOS App menu added `Check for Updates…` for explicit
  rechecks and `Release Notes…` for the existing web changelog; current/error
  checks receive native feedback and never start a download
  ([menu registry](../src/terminal/action-registry.ts#L138-L159) `current`,
  [menu behavior](../src/updater/update-menu-actions.ts#L62-L90) `current`).
- Installation reuses fresh pane inspection with update-specific copy, flushes
  pending settings, and retains retry state on download, flush, install, or
  relaunch failure
  ([App integration](../src/ui/app.tsx#L182-L210) `current`,
  [close guard](../src/terminal/close-guard.ts) `current`).
- Tauri grants only updater check/download/install and process restart. macOS
  points at stable `latest.json`; Windows points at the fixed unsigned preview
  channel; updater artifacts are enabled only by the release config
  ([capability](../src-tauri/capabilities/default.json) `current`,
  [macOS channel](../src-tauri/tauri.macos.conf.json) `current`,
  [Windows channel](../src-tauri/tauri.windows.conf.json) `current`,
  [release config](../src-tauri/tauri.release.conf.json) `current`).
- The tag workflow isolates macOS stable from Windows preview, keeps both as
  drafts until their validation gates pass, and promotes Windows `latest.json`
  only from an exact-SHA artifact with checked digests and GitHub release asset
  membership
  ([release workflow](../.github/workflows/release.yml#L1-L314) `current`,
  [validator](../scripts/verify-updater-manifest.mjs) `current`).
- The same workflow now requires every active conventional `feat`, `fix`, and
  `perf` commit to declare `Release-Note: <user-facing description>` or
  `Release-Note: skip` before either draft build. Standard, nested, and merge
  reverts are removed; `skip` wins; breaking metadata routes the explicit
  public description into its own section; both platform releases share the
  change sections; and a release with no public entry fails before publishing
  generic copy. Manual Windows rebuilds of older tags instead reuse the reviewed
  stable GitHub release body, preserving the exact tag while avoiding a false
  failure against history created before the policy
  ([generator](../scripts/generate-release-notes.mjs#generateReleaseNotes) `current`,
  [workflow contract](../scripts/release-workflow.test.ts) `current`).

Remaining delivery gates:

- Deploy the current landing artifact and verify
  `https://deck.spacevibe.dev/landing-prototype/changelog/` returns `200`
  before shipping the desktop menu link; it returned `404` on 2026-08-04,
  while `npm run build:landing` produced the expected changelog artifact.
- ~~Generate the production updater keypair~~ — done; `0.10.0` and `0.11.0`
  shipped signed against it. The key is the one thing that must never change:
  its public half is compiled into every build already in the field, so a new
  keypair makes old builds refuse new ones and every user reinstalls by hand.
- Run the update flow on real Windows 11 x64. macOS closed on 2026-08-05
  (see below); Windows was deliberately skipped.
- Obtain user eye approval for the `1100x720` and `480x320` screenshots in both
  top-tab and sidebar layouts. Windows remains an unsigned B2 preview, so
  Authenticode/SmartScreen publisher identity is intentionally unresolved.

## Hardened updater — 0.11.0, shipped 2026-08-05

`0.11.0` is the bootstrap the rest of the update story rests on: from here every
later patch reaches users on its own, so this one had to be right.

What the release actually changed:

- The release validator reproduces Tauri's Minisign check in Node — packet
  parsing, key-id equality, BLAKE2b-512 prehashing for `ED`, the payload
  signature and the trusted-comment global signature — over bytes re-downloaded
  from the exact draft, not over the staging directory
  ([verifier](../scripts/verify-updater-manifest.mjs) `current`).
- macOS gained the same collect → re-download → verify → publish gate Windows
  already had; before this, macOS only checked that a signature string was
  non-empty ([release workflow](../.github/workflows/release.yml) `current`).
- The updater plugin is pinned to a fork revision with upstream PR #3516 and a
  macOS transactional swap ([pin](../src-tauri/Cargo.toml) `current`).

What was verified on real hardware, 2026-08-05:

- macOS `0.11.0-rc.1` → `0.11.0-rc.2` upgraded end to end through an isolated RC
  channel. The installed bundle kept mode `0755` rather than the extraction
  directory's `0700` — upstream issue #3506 proven fixed at runtime.
- A manifest advertising a non-existent `0.11.0-rc.3` with one flipped signature
  byte was downloaded and refused; nothing installed, no bundle touched.
- Both published channels were re-verified against the live bytes after release:
  `releases/latest` and `windows-preview-channel` both serve `0.11.0` with valid
  signatures.
- Windows end-to-end was **skipped by decision**, and failure injection with it.
  Recorded with its cost in [AGENTS.md](../AGENTS.md) `current`.

Before buying signing certificates, check three things — none are about the
certificates themselves, all three are about what gets edited in the same sitting:

1. **Never rotate the updater keypair.** See the delivery gate above.
2. **macOS: changing the signing identity resets TCC.** Permissions the user
   granted are bound to the code signature, so moving from the ad-hoc identity
   to a Developer ID makes macOS treat it as a different app. Updates still
   install; the app just forgets it was ever allowed
   ([current identity](../src-tauri/tauri.macos.conf.json) `current`).
3. **Windows: keep `bundle.publisher` byte-identical.** NSIS derives its product
   identity from it, so changing it to match a certificate's legal name makes
   the installer place a second copy beside the first instead of upgrading
   ([publisher](../src-tauri/tauri.conf.json) `current`).

## Reaching updates without a menu bar — 0.12.0

`src-tauri/src/menu.rs` is gated `#[cfg(target_os = "macos")]` end to end, so
Windows has no menu and therefore had no `Check for Updates…` and no
`Release Notes…`. The chrome button only appears once an update has been
found, which left a Windows user with no pending update unable to ask for one
without restarting Deck.

- Settings gains an `about` category — two config rows on the existing
  `action` kind, so §6's closed set needed no new entry
  ([section](../src/ui/settings/sections/about-section.tsx) `current`,
  [registry](../src/ui/settings/settings-categories.ts) `current`).
- The pill drives the controller already in use; the description answers the
  press rather than leaving it silent.
- The running version comes from the bundle, not the updater — the updater's
  view reports an empty string until a check finds something
  ([store](../src/updater/app-version.ts) `current`).
- Sections take no props, so `App` publishes its controller through a
  window-scoped signal
  ([store](../src/updater/active-update-controller.ts) `current`).
- OpenCode was the only built-in agent absent from `AGENT_LOGOS` and wore a
  letter avatar beside three brand marks
  ([logo map](../src/open-board/open-board.tsx) `current`). Agents the user
  declares still fall through to the letter avatar.

## Antigravity CLI becomes the fifth built-in — 2026-08-07

Google announced on 2026-05-19 that Gemini CLI would stop serving free, AI Pro
and Ultra users on 2026-06-18, replaced by Antigravity CLI — command `agy`, a
closed-source Go binary installed by a shell script rather than npm. Nothing in
Deck knew the name, so an `agy` pane classified as `busy`: no dot color, no
agent label, and the board offered no chip for it.

- `agy` joins `BUILTIN_AGENTS`, and the row is reordered by reach rather than
  by history: Claude, Codex, OpenCode, Antigravity, Gemini. That list is also
  the digit-key order, so `4` now opens Antigravity and `5` Gemini — a
  deliberate break with the keys people already have in their fingers, taken
  because the row should lead with what is actually reached for
  ([catalog](../src/lib/agent-catalog.ts) `current`,
  [Rust mirror](../src-tauri/src/agents.rs) `current`).
- Gemini CLI stays. Paid Code Assist licences still reach the service, and a
  built-in id equals its binary name, so dropping `gemini` would strand every
  `lastAgent` on disk holding that string with no migration to catch it.
- `agy` shares Gemini's `--cyan`. The theme injects eight colors; four are
  taken, `--red` is error-only (DL-3.2) and `--accent` _is_ the theme's blue,
  reserved for interactive (DL-3.1). A new token sourced from `brightBlue` was
  the first choice and was dropped on evidence: `brightBlue` equals `blue` in
  three of the four presets ([presets](../src/settings/themes.ts) `current`),
  so the dot would have read as the accent color
  ([dot map](../src/lib/process-info.ts) `current`).
- Windows identifies it by executable name only — a single Go binary has no
  node wrapper, so there is no npm signature to match
  ([snapshot](../src-tauri/src/platform/windows/process_snapshot.rs) `current`).
- Its brand mark is the first raster one in `AGENT_LOGOS` — Google publishes
  the Antigravity icon as PNG. Stored at 96px against a 15px chip, which keeps
  3x headroom at 5.5 kB, and checked on the dark chrome background to confirm
  the alpha channel is real and not a white plate
  ([logo map](../src/open-board/open-board.tsx) `current`).
- Known-open: its OSC 9;4 behaviour is unobserved — a closed-source binary
  cannot be read for it, so the activity tracker falls back to the
  sustained-output heuristic until someone runs it
  ([activity](../src/terminal/agent-activity.ts) `current`).

## Prompt Board — 2026-08-08

A chrome popover of reusable prompt templates. One click pastes a template body
(plus optional skill / subagent reference lines) into the agent session running
in the pane that was focused when the popover opened. Opened by ⌘⇧P /
Ctrl+Shift+P or View → Prompts…; the trigger sits beside Settings in the tab
bar. Zero new dependencies, npm or cargo.

- Templates are `{id, label, body, autoSend}` in the settings store beside
  `customAgents`, validated with the same drop-not-repair discipline — a
  malformed entry is dropped, never guessed at, because its body is pasted
  verbatim into a live PTY
  ([catalog](../src/prompts/prompt-templates.ts) `current`,
  [validation](../src/settings/settings-schema.ts) `current`).
- Injection rides xterm's bracketed-paste path
  ([`Pane.pasteText`](../src/terminal/pane.ts) `current`), which is the only
  route that lands a multi-line body in an agent TUI's composer as one block.
  Ordering of "paste frame, then `\r`" is structural, not timed: every write
  for a pane now chains behind the previous one's settled promise in a per-pane
  FIFO queue ([`enqueueWrite`](../src/terminal/pane-lifecycle.ts) `current`),
  so `onData` keystrokes and a programmatic submit share one order.
- `autoSend` is never an unconditional Enter. Immediately before `\r` is
  enqueued a triple gate is re-read: the pane still runs the SAME agent it ran
  at capture (fresh `pty_info`, not the 2s poll cache), its attention snapshot
  is `idle` with nothing latched beyond `completed`, and it is still in some
  tab's layout ([`submitAllowed`](../src/prompts/inject.ts) `current`,
  [orchestration](../src/terminal/tab-manager.ts) `current`). A failed gate
  degrades to paste-only and says "Pasted — not sent".
- Detection is a read-only Rust scan — no shell, no PTY. It walks
  `~/.claude/skills`, `~/.claude/agents`, the project's own `.claude/…` found
  by walking up from the pane's cwd, and every active plugin's `installPath`
  read from `installed_plugins.json`; Codex gets `~/.codex/skills` and
  `~/.codex/agents/*.toml`. Symlinks are refused rather than followed, reads
  are head-bounded at 16 KiB, results capped at 200 per kind, and a missing
  directory or unreadable file is an empty list rather than an error
  ([scanner](../src-tauri/src/prompt_assets.rs) `current`).
- Frontmatter and TOML are parsed by hand, not by a crate: the zero-dependency
  rule holds, and every descriptor verified on disk carries `name` /
  `description` as a plain, quoted or folded scalar. A Codex agent is named by
  its **file stem**, not its `name =` field — the stem is what the CLI loads by
  path, so a disagreeing field would send the wrong reference into the prompt.
- The surface is DL §12 rows inside a new DL §13 anchored popover, plus
  `CommitTextarea` — the multi-line sibling of `CommitInput`, with the same
  local-draft discipline because the popover's parent never unmounts
  ([popover](../src/prompts/prompt-popover.tsx) `current`,
  [control](../src/ui/controls/commit-textarea.tsx) `current`,
  [rules](DESIGN-LANGUAGE.md) `current`).
- Restore Defaults wipes templates along with declared agents — it always did
  for agents; the confirm sentence now says so
  ([copy](../src/ui/settings/sections/reset-section.tsx) `current`).

Verified 2026-08-08: `npm test` 1093 passing across 96 files, `npm run build`
(tsc + vite) green, `npm run generate:menu:check` green, `cargo test` 151
passing. The popover surface was eye-reviewed against §12/§13 on a screenshot of
its real rendered DOM over the real stylesheet.

Known-open, deliberately: the acceptance table in the plan's Task 12 Step 4 has
NOT been run. Nothing has driven ⌘⇧P inside a running desktop build, so a real
paste into a live Claude composer, a real auto-send through the gate, and the
popover closing when its target pane's tab closes are all unobserved outside
unit tests. `agy`, `gemini` and `opencode` have no verified asset layout, so a
pane running one of them hides the pickers and pastes the body alone.

## Unified icon system — 2026-08-09

The app's functional icons now come from one place. Before this, chrome and the
settings rail carried hand-drawn SVG while rows, tabs and the search bar used
typographic characters — `×`, `▾`, `↹`, `↺`, `‹`, `›`, `↩` — so the same action
was a picture in one surface and a character in the next, at whatever weight
the surrounding font happened to give it.

- The source is `lucide-preact` (the first new runtime dependency chrome has
  taken) — **superseded 2026-08-16 by `@phosphor-icons/react`; see "The icons
  are Phosphor now" above.** It was imported by name and drawn through one
  component that owns every presentation default — `aria-hidden`, `focusable`, `fill`, stroke and the
  four sizes the chrome uses
  ([`DeckIcon`](../src/ui/controls/deck-icon.tsx) `current`,
  [rules §14](DESIGN-LANGUAGE.md) `current`). `strokeWidth` is 1.8
  because the icons it replaced already drew at 1.8 in the same 24-unit box —
  true for chrome and the settings rail, but NOT for the Open Board, whose two
  folder drawings used a 16-unit box and came out heavier (≈1.4px against
  ≈1.1px now).
- CSS is where this kind of contract usually dies: a `stroke-width` or `width`
  rule beats an SVG attribute, and `.row__ico` / `.openfolder svg` had both.
  Those declarations are gone, their themed colours restated as `color` so
  `currentColor` resolves the same way it painted before
  ([styles](../src/styles.css) `current`).
- Prompt Board's one action became two: `ClipboardPaste` when a template only
  pastes, `Send` when it presses Enter, with the accessible name and tooltip
  saying the same thing. The safety gate is untouched and still authoritative —
  a Send that fails it pastes and reports "Pasted — not sent"
  ([popover](../src/prompts/prompt-popover.tsx) `current`,
  [gate](../src/prompts/inject.ts) `current`).
- The search bar stays imperative DOM but does not get a second icon path: it
  renders `DeckIcon` into its existing buttons with Preact and unmounts those
  roots on both disposal paths. Its buttons also gained explicit
  `aria-label`s — with the text replaced by an aria-hidden icon, the only name
  left would have been the tooltip
  ([bar](../src/terminal/search-bar.ts) `current`).
- Outside the library on purpose: the Deck brand mark, agent and OS logos,
  keyboard/terminal notation, status dots and `WorkspaceSpinner`. A filesystem
  test scans `src/**/*.{ts,tsx}` for authored `<svg>` and for retired glyphs,
  with counts as well as paths, so neither can come back quietly
  ([guard](../scripts/icon-system.test.ts) `current`). It earned itself
  immediately: it found a layout-preset delete button the plan had missed.

Verified 2026-08-09: `npm test` 1136 passing across 99 files (from 1103/96),
`npm run build` green, `npm run generate:menu:check` green, and
`npm run video:render` exit 0 across all four presets. Main JS gzip went
170.37 KiB → 172.67 KiB, **+2.30 KiB** against a 15 KiB ceiling, which is the
evidence that Rollup tree-shakes the barrel rather than shipping the catalog;
CSS shrank 9.02 → 8.97 KiB.

The marketing stage did NOT change and could not have: `marketing/stage/appwin.js`
draws its own chrome icons as inline SVG strings and imports nothing from `src/`,
so the app and the film now carry two different icon sets that happen to agree
because the marketing copies were traced from the same drawings. Nothing broke —
but `video:render` is a weaker gate than it looks for this migration, and the
film's chrome will drift from the app's the moment either side changes an icon
([stage icons](../marketing/stage/appwin.js) `current`). Reconciling them is out
of this migration's scope, which explicitly excluded marketing.

Visual review closed 2026-08-10. `npm run tauri dev` built and opened the native
app at 1100×720; macOS denied direct window capture because this session lacks
Screen Recording permission, so the same DOM was then captured at 1100×720 and
device scale 2 through the Vite surface in Tokyo Night, Dracula, One Dark and
Catppuccin Mocha. The Open Board folder icons, sidebar add slot, `Maximize2`,
settings rail and reset control were all legible and geometrically consistent;
no implementation adjustment followed the review. This proves the rendered
frontend across all four themes, not Windows WebView2 parity. The unified icon
system is therefore `current`, while real Windows visual E2E remains separate.

## Pane detach — Phase A landed 2026-08-10

Implemented from
[the plan](plans/2026-08-10-pane-detach-window.md) `current` in its own wave
order: the Rust transfer transaction, then the wave-1 frontend against fakes,
then the window lifecycle, then the frontend integration. Sections A, B and C
are complete; **section D (cross-window drag) was not started** and stays behind
the plan's §0.7 gate.

**Verified by command, with output.** `cargo test --locked` — 239 passed;
`cargo fmt --check` — clean; `npm test` — 1244 passed across 105 files;
`npm run build` (`tsc && vite build`) — clean; `npm run generate:menu:check` —
exits 0 with `menu_registry.rs` regenerated for the new Window-menu action.
Bundle: `dist/assets/index-*.js` went 172.68 kB → 180.40 kB gzip, entirely
`@xterm/addon-serialize@0.14.0` (the one dependency the spec pre-approved).

**One bug the gates could not see, found by pressing the key.** The first ⌘⇧M
failed with "Couldn't move the pane — it stayed here."; `open_pane_window`
declared a single `args: OpenPaneWindowArgs` parameter while the frontend sent
the frozen contract's flat `{ token, screenX?, screenY? }`. Tauri resolves each
command parameter by looking its camelCased name up in the invoke payload
([`ipc/command.rs`](https://docs.rs/tauri/2.11.5/src/tauri/ipc/command.rs.html)),
so it demanded a key literally named `args`. That mismatch compiles,
type-checks and passes every unit test — Vitest mocks the PTY client, `tsc` has
never heard of a Rust signature, and `cargo test` cannot read `src/`. Fixed by
taking the three arguments flat; a sweep of all 30 commands found no second
instance.
The [IPC contract test](../scripts/ipc-contract.test.ts) `current` now parses
both sides and fails on any command whose required payload keys a call site
does not send. It is the only gate in this repo that crosses
the IPC boundary.

**Verified by hand on 2026-08-10, after that fix.** ⌘⇧M on a pane detaches it
into a second window and **the scrollback arrives intact** — so `prepare` →
`stage` → `open_pane_window` → `claim` → `commit` all run end to end against a
real PTY, and the serialize/replay path works. The one-pane guard below behaves
as designed.

**Still NOT verified — and the automated gates cannot see any of it.**
Outstanding manual pass, under `npm run tauri dev`:

- Typing in the new window reaches the **same process** (an agent mid-run keeps
  answering), not a fresh shell.
- The route lock is now held **across** `app.emit_to` (that is what makes the
  ordering guarantee structural rather than timed). Run several panes producing
  continuous output, detach one and close a window while they are still
  writing, and watch for a **hang** rather than for a wrong result.
- Detach a pane, then force-kill the destination window's webview: the PTY must
  die, not leak (`sweep_and_reap` and `on_window_destroyed` have no unit test —
  `AppHandle` cannot be constructed in one).
- Destroy the destination before it claims: the source pane must return
  **immediately**, not after ten seconds. A ten-second wait means
  `reserve_destination` did not run.
- ⌘Q with a busy agent in the non-focused window: exactly one dialog, naming
  that agent; a second ⌘Q while it is open does nothing.
- Close one window of two: only its panes die. Close the last window: the
  process actually exits (`ps` shows no `spacevibe-deck`) — the old
  `prevent_exit` would have hung here.
- Change a setting in each window in turn: both stick, and both survive a
  relaunch.
- Windows only: F5 in a detached window does nothing, and the devtools console
  shows no capability errors.

**A fork resolved on the day, not in the spec or the plan.** ⌘⇧M from a window
holding exactly one pane is now a **no-op with a message** rather than a move.
Neither document covered it: the plan weighed a one-pane window only for the
Phase B _drag_ path (Task D9 and manual item 8), and only for dragging **into
another window**. Moving that pane to a NEW window closes this window and opens
another holding the same pane — the window is swapped, its geometry lost, and
the pane is risked through a whole transaction for no observable change. The
condition is **window-level, not tab-level**: a second tab keeps the window
alive, so splitting that tab out is still a real move. Only the new-window
target is guarded — offering the pane to an **existing** window merges it and
stays meaningful even from a one-pane window, which is exactly what manual item
8 asks for.

## Electron migration — prep opened 2026-08-11

**Status: prep only. No product code, no Electron dependency, nothing scaffolded
in the product tree.** The decisions are in
[`AGENTS.md`](../AGENTS.md) `current` In flight, the work sequence in the
[prep plan](plans/2026-08-11-electron-migration-prep.md) `current`, and the
target design in the
[design spec](specs/2026-08-11-electron-migration-design.md) `decided`.

Deck leaves Tauri for an Electron host written in Node/TS. The motivation is
ship speed and DX — the Rust seams are correct, they are just slow to move in —
and it is worth naming that this buys nothing a user can see. What a user gets
is worse on two axes at once: a larger binary and more RAM, plus a one-time
loss of every stored setting.

**Tauri feature work is frozen from this date.** Hotfixes still ship. The token
usage dashboard ([spec](specs/2026-08-10-token-usage-dashboard-design.md) `decided`)
and pane-detach Phase B ([plan](plans/2026-08-10-pane-detach-window.md) `current`,
section D) are the two features the freeze holds back, and both are
re-targeted at Electron rather than cancelled. The freeze lifts when the three
spike gates each reach a conclusion, not on a date — see below.

**The two open questions in the plan's §5 are answered (2026-08-11):**

- The public "no Electron" proof point is replaced by "no accounts, no
  telemetry" as the lead, with "made for agent CLIs" promoted beside it —
  agent detection, attention state, prompt board, presets. Deliberately not a
  performance claim: Electron would make one false, and a claim that a
  competitor can disprove is worse than no claim. The copy itself is NOT
  edited yet — [`README.md`](../README.md) `current` and
  [`copy.js`](../marketing/landing-prototype/src/copy.js) `current` still say
  "no Electron", which stays true until the cutover ships. Editing
  them is a cutover-plan task.
- The freeze ends on **gates, not on a calendar**. The plan proposed one week
  for the spike and six weeks to MVP parity; both were replaced, because the
  motivation ("ship speed and DX") has never been measured in hours or build
  minutes, so any deadline would have been a guess enforced against real work.
  The cost of the swap is the obvious one and is accepted rather than
  overlooked: a hanging gate hangs the freeze. Gate C is hardware-blocked right
  now, so this is not hypothetical.

**Spike baseline — ran 2026-08-11, 7/7 passed.** Throwaway spike, kept out of
the repo per F4 (session scratchpad, not the worktree): Electron 43.3.0 +
`node-pty` 1.1.0 + a Vite/Preact/xterm renderer loaded from `file://` with
`contextIsolation` on and `nodeIntegration` off. It spawns `$SHELL -l` on a
real PTY, streams bytes into xterm, resizes, and kills. Resize is checked by
reading `tput cols` back **from the shell** rather than by trusting the return
value, so SIGWINCH is proven to arrive. Login-shell agent detection was
reproduced exactly as [`agents.rs`](../src-tauri/src/agents.rs) `current` does
it — `$SHELL -ilc "command -v …"`, interactive login, 3 s budget — and found
all five built-in agents in 0.8–1.2 s. The **same script also passes inside the
packaged universal `.app`**, which is the only version of this proof that means
anything.

Four findings that change how Gate B reads, all of them packaging rather than
capability:

- **`node-pty` 1.1.0 is pure N-API** — 38 `napi_*` imports and **zero**
  `v8::`/`node::` internal symbols in the prebuilt `pty.node`. Its prebuilds
  are therefore ABI-stable across Electron versions, and the plan's stated
  Gate B risk ("`electron-rebuild`, prebuilds, ABI per Electron version") is
  mostly not real. Prebuilds ship for `darwin-arm64`, `darwin-x64`,
  `win32-x64` and `win32-arm64`, and the loader picks
  `prebuilds/<platform>-<arch>` **at runtime**, so a universal app ships both
  directories and the addon itself never needs `lipo`.
- **The npm tarball ships `spawn-helper` without the exec bit** (`0644`), and
  node-pty's `postinstall` only chmods `build/Release/`, never `prebuilds/`.
  The symptom is `posix_spawnp failed` on the first spawn and nothing else —
  no hint about permissions. A `chmod +x` fixes it and a postinstall step must
  do that for real. Worth noticing that this is the same failure family as the
  Tauri updater's issue #3506, which shipped a bundle with the wrong mode:
  file modes are where this project keeps getting bitten.
- **`asarUnpack` for `node-pty` is mandatory, not tuning.**
  `unixTerminal.js` rewrites `app.asar` → `app.asar.unpacked` in the
  `spawn-helper` path, so the module is unusable from inside an asar.
- **`mac.x64ArchFiles` is required** for the universal merge.
  `@electron/universal` refuses single-arch Mach-O files that are identical in
  both arch builds, which is exactly what node-pty's per-arch prebuild
  directories are. Without the rule the build fails; with
  `**/node_modules/node-pty/prebuilds/**` it succeeds.

**Measured size, apples to apples.** The packaged universal spike `.app` is
**502 MB**, of which 486 MB is Chromium in `Contents/Frameworks` and only 16 MB
is app code. The installed universal Tauri build is **33 MB**. That is roughly
**15×**, and it is the concrete form of the "binary size accepted for DX"
decision — the trade is now a number rather than a shrug. RAM was not measured.

**Gate status as of 2026-08-11 — none passed:**

| Gate                           | Blocked on                                                                                                                                                                                                                                                                      | Consequence                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A — `electron-updater` E2E     | Apple Developer Program **not bought yet**; Squirrel.Mac refuses an app that is not Developer ID signed and notarized                                                                                                                                                           | No macOS auto-update proof is possible until the identity exists              |
| B — `node-pty` universal in CI | **Partial — everything but CI is done.** A universal `.app` (x86_64 + arm64 verified with `file`) builds locally with `electron-builder` and passes the spike 7/7 when run from the bundle. What is left is one GitHub Actions run, which needs a branch pushed and is not done | Low residual risk, but the gate says "in CI" and a local build is not that    |
| C — Windows process semantics  | **No Windows machine available.** [`job_object.rs`](../src-tauri/src/platform/windows/job_object.rs) `current` and [`process_snapshot.rs`](../src-tauri/src/platform/windows/process_snapshot.rs) `current` are ~1,100 audited LOC with no Node equivalent                      | The migration's top risk, and the trigger for the plan's §0.2 abort criterion |

If Gate C can only be met with a native addon, the "pure Node/TS host" decision
was wrong and gets reopened explicitly — adding the addon quietly would delete
most of the DX argument that motivates the migration while leaving the
migration in flight.

## Electron MVP built — 2026-08-11

**The host is implemented and runs the real app.** Branch `electron-migration`,
commits `5b9305f` and `187af3f`, against
[the MVP plan](plans/2026-08-11-electron-mvp.md) `building`. ~4,100 lines of
TypeScript replace 10,504 lines of Rust; the renderer is unchanged apart from
its imports, which now point at 277 lines of facades under `src/host/`.

**The gate ordering was overridden by the owner.** Both the prep plan and the
spec say an MVP plan may only be authored after gates A, B and C conclude.
Gate A (no Apple identity) and Gate C (no Windows machine) are still open, so
**a Gate C abort can still make this branch sunk cost**. That is a named,
accepted risk, not an oversight.

**Verified, and the distinction matters here.** `npm test` is 1383/1383 across
119 files — but the suite mocks the host, so on its own it proves little about
a migration whose whole point is replacing the host. The evidence that counts
is a headed smoke run against the real app (`npm run electron:smoke`, 10/10):
the preload bridge is exposed, `contextIsolation` holds, **a terminal actually
paints (34 xterm rows after opening a workspace)**, agent detection finds all
five built-ins over IPC, a real PTY echoes back through `pty:output`,
`pty_info` classifies the pane as `idle-shell`/`zsh`, and `kill_pty` succeeds
for its owner.

**`pty_info` reads `ps`, not `node-pty`.** Measured, not assumed: `.process`
returned `"2.1.227"` for a real `claude` pane — the CLI's version banner — and
the executable name instead of argv0 for a renamed job. Deck classifies panes
by argv0 — that is why [`macos.rs`](../src-tauri/src/platform/macos.rs) `current`
reads `KERN_PROCARGS2` rather than `p_comm` — so trusting `.process`
would have labelled every agent pane `Busy` and silently killed the agent chip,
the dot colour and attention state. One `ps -A` per poll tick, joined
tty → `tpgid` → `pgid`: 69 ms for 717 rows against a 2 s interval.

**Windows is a stub that throws by name, not a port.**
[`process_snapshot.rs`](../src-tauri/src/platform/windows/process_snapshot.rs) `current`
and [`job_object.rs`](../src-tauri/src/platform/windows/job_object.rs) `current`
are ~1,100 audited lines with no machine to run a replacement on.
Porting them blind would manufacture confidence in the code where being wrong
is worst: a bad classification either lets quit kill a working agent or leaves
the user unable to quit.

**Four bugs the gates caught, each a class rather than a typo:**

1. **`offer_transfer` sent `targetLabel` while the host destructured `label`.**
   Caught by the new Electron IPC contract test on its first run — the same
   mismatch that shipped `open_pane_window` with four green gates.
2. **The host is CommonJS in an ESM repo**, so a `.js` file was loaded as an ES
   module and died on `exports`. Emitting `.cjs` was the fix; an ESM main
   process would have forced interop on every CommonJS dependency, `node-pty`
   included.
3. **Vite emitted absolute asset paths**, which under `file://` resolve to the
   filesystem root, 404, and produce a blank window with nothing on stderr.
4. **A failed background store write was swallowed** (`void this.save()`) —
   exactly the failure `settings_merge.rs` warns about, "how a full disk used
   to look like a successful write". Writes now report through an `onError`
   hook. The test was checked by reverting the fix and watching it go red.

**One deliberate behaviour change:** `kill_pty` no longer unregisters the pane
route. The exit path owns teardown, so the `pty:exit` following a kill still
reaches its owner instead of being dropped as "no route for pane".

**Not done:** the updater (Gate A), Windows (Gate C), cross-window drag,
packaging, and the full manual pass. Nothing here ships, and the Tauri build
remains what users run.

## Browser panel + Inspect — 2026-08-12

Electron only, on `electron-migration`. A docked column on the right of the
stage loads a dev server; Inspect turns any element on that page into
component-and-source context that lands in the focused agent pane.

### What it is made of

| Piece                                    | Where                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Native web view, one per window          | [`electron/browser/view.ts`](../electron/browser/view.ts) `current`                                                                      |
| Injected bootstrap (pure string builder) | [`electron/browser/inject.ts`](../electron/browser/inject.ts) `current`                                                                  |
| Address-bar input rules                  | [`electron/browser/url.ts`](../electron/browser/url.ts) `current`                                                                        |
| Page → host bridge                       | [`electron/browser-preload.ts`](../electron/browser-preload.ts) `current`                                                                |
| Vendored react-grab 0.1.50               | [`electron/vendor/react-grab/`](../electron/vendor/react-grab/SOURCE.md) `current`                                                       |
| Panel chrome + measured hole             | [`src/browser/browser-panel.tsx`](../src/browser/browser-panel.tsx) `current`                                                            |
| Grab delivery + sanitising               | [`src/browser/browser-store.ts`](../src/browser/browser-store.ts) `current`, [`grab-format.ts`](../src/browser/grab-format.ts) `current` |

### The three facts that shape all of it

1. **The web content is a native view, not an element.** It paints above every
   DOM layer, so the renderer measures `.browser-panel__view` and sends the
   rectangle, and hides the view whenever an overlay opens. CSS cannot put the
   Open board in front of it.
2. **The injection has to run in the page's MAIN world.** React stores its
   fiber as an expando on the DOM node and expandos are per-world; from the
   preload's isolated world every element is plain HTML with no component and
   no source location. So the bundle goes in through `executeJavaScript`, and
   the grab comes back out through a DOM `CustomEvent` the preload forwards —
   the only channel two worlds share.
3. **The page is untrusted.** It can dispatch the grab event itself with any
   payload. Hence: parsed defensively, length-capped, every C0 control
   stripped (an embedded `ESC[201~` would break out of the bracketed paste and
   be read as keystrokes), and **never submitted** — a grab pastes and stops.

### Verified on a real window (2026-08-12)

`npm run electron:smoke` gained six checks and they pass: the panel attaches a
view and loads a page; `__deckGrab`, `__REACT_GRAB__` and
`__REACT_GRAB_MODULE__` all exist in the page's main world; a grab crosses
page → preload → IPC → renderer intact; Inspect arms react-grab in the page;
**no request reaches react-grab.com**; closing the panel destroys the page.
22/24 overall — the two failures are the Linux container (`platform=unsupported`,
cwd with no shell integration) and predate this work.

Two defects that run found and the mocked suite could not:

- `window.__REACT_GRAB__` was never set. Disabling the bundle's self-init also
  skips the `setGlobalApi` call inside it, so react-grab's documented handle was
  missing while everything else looked healthy.
- `generateSnippet` can fail to settle in a throttled frame. `getContent` sits
  between ⌘C and BOTH destinations, so an unsettled promise means no paste and
  no clipboard with nothing on screen; it now races a 2 s deadline and falls
  back to the element's markup.

### What the code review changed (2026-08-12)

15 findings, 14 real, all fixed in the follow-up commit. The ones that changed
behaviour rather than wording:

| Was                                                                     | Is                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Any page could dispatch the grab event; no gesture check, no rate limit | The preload gates on `isTrusted` — a bit page script cannot set — within 3 s, and both preload and host rate-limit                |
| `sanitizeGrabText` stripped C0 and DEL                                  | It strips C1 too; `U+009B 201~` is the same bracketed-paste escape without an ESC                                                 |
| The view hid only for `overlayCoversPane()`                             | It hides for every floating surface; the Prompt Board popover opened inside the panel's own column and was invisible              |
| The toggle destroyed the page                                           | It hides it, which is what "reopening keeps the page" always claimed                                                              |
| Grabs were sent from `getContent`                                       | They are sent from `onCopySuccess` / `onAfterCopy`, after the bundle's abort race has decided — a cancelled copy no longer pastes |
| `browserHomeUrl` had no UI                                              | Settings has a **browser** category                                                                                               |
| The `.js → .cjs` walk swept the vendored bundle                         | `vendor/` is skipped, and the output dir is cleared before the copy                                                               |

One finding did not survive verification: closing a window was said to throw
out of the cleanup path and strand PTYs. A probe on Electron 43 showed
`webContents.close()` on an already-destroyed contents is a no-op, so it became
a guard rather than a fix.

Two traps found while fixing, both now locked by tests:

- An escape written `\n` inside `inject.ts`'s template literal is consumed by
  TypeScript and emits a real newline into the generated script. The injection
  was a SyntaxError and Inspect was dead on every page while every `toContain`
  assertion passed. The test now runs `new Function(script)`.
- A synthesised DOM event can never exercise the new gate — `isTrusted` is
  false, and `executeJavaScript(..., true)` marks user activation, not trust.
  Only `sendInputEvent` into a focused view produces a trusted event, which is
  how the smoke run now drives a real copy.

Smoke is 24/26: a forged grab is dropped, a real `copyElement` reaches the
renderer, and the two failures are the same pre-existing Linux ones.

### Not verified

- **A real React dev server.** Component names and `file:line` come from
  react-grab reading React's fiber; no React app was available in this
  environment. The transport is proven end to end, the richness of what it
  carries is upstream behaviour.
- **Windows.** Same Gate C hole as the rest of the branch.
- **The panel under a real compositor** — resize, drag-to-width, and the
  hide-on-overlay path were exercised by unit tests and by the smoke run's
  bounds call, not by a human dragging the seam.

## File explorer — model merged, surface dropped — 2026-08-12

Electron branch only; nothing here ships on Tauri. Built against the
[plan](plans/2026-08-12-file-explorer.md) `partly-built` task by task, from the
[spec](specs/2026-08-12-file-explorer-design.md) `decided` — 34 of 36 tasks
done — and then **split in half before merge**. Read the plan's §8 before
touching any of it.

~~**THE FEATURE IS NOT USABLE.** There is no way to open a file in Deck.~~
**Superseded 2026-08-14: the surface was built on top of this model and host —
see the straight-through completion run below.** The
machinery merged and the chrome did not, at the time this section was written.
That was a decision, not a shortfall:
the owner is redesigning the Electron version completely, and while this was
being written `electron-migration` took DESIGN LANGUAGE §18 for the application
frame, wrote a **§19 "Docked side panels" for a browser panel that reserves
itself for the file explorer**, docked that panel as a STAGE column rather than
a `.window` grid column, and collapsed the chrome frame. (Those sections were
first numbered §16/§17 and moved up two on 2026-08-12 to dodge a cross-branch
collision; the numbers here were rewritten to match on 2026-08-14 — the exact
stale-citation class the redesign plan's §3.5 warns about, in a file the
citation gate never scans.) Merging a second docked-panel convention into a
frame about to be redrawn would have meant paying for the surface twice.

**What merged.**

- **Pure model** (`src/files/`) — the tree, the preview-slot promotion rules,
  the §5 external-change table, the dirty model, encoding/EOL, and the path
  bound. None of it knows what renders the text, so it survives an
  editor-engine change intact.
- **Host** (`electron/fs/`) — `list_dir`, `read_file`, `write_file`,
  `stat_files`, `watch_paths` and `set_dirty_files`, every one bounded to the
  workspace root by `path-guard.ts`. Registered in main; no renderer calls them
  yet. `writeAtomically` moved out of `JsonStore` into `fs/write.ts` and the
  store now calls it — one atomic writer, not two, with the store's existing
  205 lines of tests as the regression gate on the extraction. **This half is a
  security fix on its own**: the target branch still writes settings through a
  fixed-name `.settings.json.tmp` and a symlink-following `fs.writeFile`.
- **The dirty bridge across all four exits** (below).
- **An inert `SurfaceStrip` seam** in `TabManager`, whose only implementation is
  `INERT_SURFACES`. Nothing in production passes a real one. It stays because
  the invariants it encodes — "last surface, not last tab", the combined cycle
  index space, `movePane`'s refusal, the `applySettings`/`focusActive` fan-out —
  are expensive to retrofit and cheap to keep proven.

**What was dropped.** The docked panel, the virtualized tree, the file tabs in
both chrome layouts, DESIGN LANGUAGE §16, the explorer CSS and settings, and the
`toggle-explorer` / `save-file` actions. `file-editor.tsx` and
`external-change-bar.tsx` stay in the tree unmounted — they are not chrome, they
carry the Monaco lifecycle knowledge the redesign would otherwise rediscover
(the `ready` dep, the `applying` re-entry flag, `pushEditOperations` over
`setValue`, view-state pairing).

**The exits all changed together**, because any five of the six parts is a hole,
and this half merged whole. `app.on("before-quit")` returned early on an empty
pane list, so a window holding only file tabs would quit with unsaved edits and
no prompt; the census now carries `dirtyFiles`, `closeRequestOrNull` was widened
to keep the field, and the renderer's `busyPanes === 0` auto-confirm became
"empty in both dimensions". Installing an update is a **fourth** exit the spec's
three did not count — `app_relaunch` calls `app.exit(0)` and never reaches
`before-quit` — so `confirmInstall` passes `dirtyPaths()` itself. `confirmMessage`
names a busy agent and unsaved files in ONE dialog. Window death clears that
window's dirty entries beside the pane routes. With no surface the list is
always empty, so `close-guard.test.ts` now covers that half directly: it is the
only proof left that an unsaved file survives an exit.

**Monaco is a declared dependency that nothing reachable imports.** The build
therefore emits no `editor.api` chunk and the entry is 178.83 kB gzip, +0.49 kB
over the 178.34 kB baseline. The measurements taken while the surface existed —
entry 189.26 kB, a lazy 674.50 kB gzip `editor.api`, 27 per-language tokenizer
chunks, two worker chunks, no language services — are recorded in the plan's
§6.2 as what the surface cost, and must be re-taken when the redesign mounts it.

**Two defects the new tests caught.** Saving through an existing symlink that
pointed OUT of the workspace was allowed, because the link's parent was inside
the root and the guard fell through to its "new file" branch — a real escape,
now refused by an `lstat` check. And the first file tab got an editor with no
model, because Monaco's dynamic import resolves after the model effect has
already run and nothing re-ran it.

**NOT verified — everything needing a real window.** Gate M has not been run and
now has no subject: it was already blocked on MVP T19 producing a packaged
build, and nothing imports Monaco any more. The thirteen-item manual pass has
not been run at all; every `manual (owner)` line in the plan is outstanding.
`npm test` (1717 passing on the merged half), `npm run build`,
`npm run electron:build`, `generate:menu:check` and the Electron IPC contract
test are green, and none of them opens a window. The plan's §7.2 follow-ups
mostly went away WITH the surface — unreachable, not fixed — but three merged
because they live in the host layer: `realpathSync` runs synchronously per entry
on the main thread, and `stat_files` / `watch_paths` take unbounded arrays.

## Redesign phase 2 — the chrome transfusion — 2026-08-14

The gallery-proven direction reached the app.
[Plan](plans/2026-08-13-redesign-phases-2-5.md) `current`,
[shipping addendum](specs/2026-08-13-direction-token-rebuild-design.md) `decided`
(its §9), DL §20/§21 written, decisions D1–D12 owner-approved as written.

**What landed, in ten steps plus the mirrors.** The token layer (`--radius-control`
/ `--radius-surface`, `--duration`/`--ease`, `--state-hover-bg`); the shell —
`.deck-frame` is the head of the navigation column and the stage reaches the
window's top edge (DL-18.3 rewritten, rail 275px to keep a draggable titlebar);
navigation, atoms, settings shell, Open board, popovers and imperative surfaces
swept onto the tokens, closing four DL §10 ledger rows; the browser panel and
`src/files/ui` took the motion-pair residue; both hosts' pre-paint grounds now
match `--bg`'s `#16161e` (the Electron value was the gallery's `#101014`); and the
marketing mirrors were re-shaped by hand to the new shell — they import nothing
from `src/`, so the next chrome change owes them another manual pass.

**This is a cross-host visual change (D9).** `src/styles.css` is shared; Tauri
ships it. Nothing here may be labelled Electron-only.

**Evidence obtained.** All automated gates green at every step (`npm test` 160
files / 1975 tests, `build`, `generate:menu:check`, `electron:build`). Native
macOS Electron screenshots exist for steps 1–3 (frame 275×34 at origin, stage
from `y=0`, state matrix across four themes × five states). A Linux Electron
pass (xvfb, cloud session, 2026-08-14) exercised the real app end-to-end: the
smoke suite 24/27 (the three failures are Linux-environment PTY/platform
artifacts, not chrome), a real workspace opened over a live PTY with the
redesigned shell, and the browser panel's `WebContentsView` hole measured
**pixel-exact** against its DOM rect ({680, 35, 420×657} on both sides of the
IPC). Rendered stills of the marketing film and a headless capture of the built
landing show the mirrored shell.

**Still owed, named honestly.** The owner's eye review of every step (DL §9.6);
the `css-audit` re-read with the owner; a native macOS pass over steps 4–10; any
Tauri run at all — `styles.css` is shared, so that gap is real; the top-tab
layout render; Windows anything; light themes (all four presets are dark; a
light `--bg` via overrides is a named limit, not a claim).

## Redesign phases 3–5 — toolbar, Gate M path, usage port — 2026-08-14

The same program, continued to the edge of what a Linux cloud session can
verify. [Plan §0.8](plans/2026-08-13-redesign-phases-2-5.md) `current` is the
detailed record; the durable facts:

**Feature toolbar shipped (phase 3).** `DeckToolbar` projects registry actions
into the gallery-proven `FeatureToolbar`; `App` builds one element and both
layouts mount it, so the mounts cannot drift. `ChromeActions` is retired (its
gallery specimens render the shipping projection now). Browser is docked by
contract — [productization spec](specs/2026-08-13-browser-productization-design.md)
`decided`, amending the toolbar spec's main-surface sentence — and Usage joined
the tools group when its surface landed. DL §23 governs the tooltip and the
overflow menu; the menu got roving arrow-key focus, and the two remaining
toolbar gaps are accepted inside DL-23.4/23.7 with reasons.

**Gate M has a complete path~~ and no run~~ (phase 4).** `electron-builder.monaco-smoke.yml`
(unsigned, local, `--dir --publish never` — D10), the `monaco-smoke.html` harness
mounting the real `FileEditor` + one real xterm over the real hosts, and
`scripts/verify-electron-monaco-smoke-package.mjs`, which checks the packaged
structure with a dependency-free asar reader and then drives typed focus
markers, tokenization, save-to-disk and `file://` asset health over CDP. The
harness ran end-to-end UNPACKAGED on Linux (tokenized Monaco, markers routed by
focus, save byte-exact, the dirty guard blocking a graceful close). ~~Gate M
itself requires the verification Mac, and no explorer surface exists or may be
written before it passes.~~ **Superseded 2026-08-14: Gate M ran packaged on the
verification Mac, PASS 6/6, and the explorer surface was built after it passed —
see the straight-through completion run below.**

**The usage dashboard is landed and ported (phase 5).** The branch merged over
`main` as a true merge; DL gained its §15/§16 in the reserved slots,
era-corrected against §20/§21. The ~3,700-line Rust backend now has a
module-for-module TypeScript port in `electron/usage/` — reader, discovery,
both parsers, atomic versioned cache (independent version space; cutover is a
clean install), single-flight scan yielding between bounded batches — behind
`usage_snapshot` on the bridge facade, with the renderer's direct Tauri import
gone. The parity gate is the load-bearing piece: a redacted JSONL fixture
corpus is checked in with a golden snapshot produced by the RUST scanner
itself, and `electron/usage/parity.test.ts` deep-equals the port against it,
cold and warm. An xvfb run rendered the dashboard over this machine's real
Claude transcripts through the real IPC path. ~~The §6.1.8 owner-machine
acceptance table has still never been run.~~ **Superseded 2026-08-14: it ran
on this machine's real corpus — see the straight-through completion run
below.**

**Browser restore (phase 5 §6.2).** `browserLastUrl` persists committed
main-frame navigations (a dedicated `browser:navigated` event — hash changes
deliberately excluded) and the toggle's cold open restores it, proven live
against a real HTTP server across a hard kill. The compositor manual pass and
a real-React Inspect check stay owed, as does everything native.

## Straight-through completion run — explorer surface, board redesign, usage acceptance — 2026-08-14

Executed from the
[straight-through completion plan](plans/2026-08-14-straight-through-completion.md)
`current`, 17 tasks run in parallel tracks on `main` with no new branch (owner's
global no-auto-branch rule). Full per-task evidence, screenshots and raw command
output live in
[the evidence record](review/2026-08-14-straight-through-evidence.md) `current`;
this section is the durable summary.

**Gate M passed packaged, on the owner's verification Mac.** All 6 checks PASS:
file opens in the packaged Monaco, syntax tokenization proves the packaged
`editor.worker` chunk loaded, a keystroke mutates the focused document, save
reaches disk, no `file://` asset 404s inside DevTools, and focus moves between
Monaco and xterm without either capturing the other's keystrokes
([verifier](../scripts/verify-electron-monaco-smoke-package.mjs) `current`,
[Gate M harness, now packaged Monaco smoke](../monaco-smoke.html) `current`). "Edit marks dirty" is evidenced as
content mutation, not a visible dirty-badge assertion — the harness page has no
dirty indicator to assert on. Adding a Content-Security-Policy later
invalidates this run and requires a rerun.

**The file explorer surface is built**, gated behind that Gate M pass as the
spec required: the docked panel, the virtualized tree at 22px row height with
monochrome icons, file tabs rendered as chips in both the sidebar and top-tab
toolbar layouts, the `toggle-explorer` (⌘⇧B) and `save-file` (⌘S) actions with
a regenerated menu, a focus guard so pane shortcuts no longer fire while a file
surface holds focus, document lifecycle fixes (an evicted preview document is
now disposed; `closeWorkspaceSurface`/`closeWorkspace` now exist and are wired
to a real caller), and `fs:changed` events driving a targeted tree refresh
instead of a full reload
([`createFileSurfaceController`](../src/files/file-surface-controller.ts#L115) `current`,
[`explorer-panel.tsx`](../src/files/ui/explorer-panel.tsx) `current`,
[`file-tree-view.tsx`](../src/files/ui/file-tree-view.tsx) `current`,
[`SurfaceStrip`](../src/terminal/tab-manager.ts#L278-L322) `current` — no
longer inert; a real strip is passed in). Electron only; no Tauri
implementation exists. **Pending: the owner's eye review of every rendered
change (DL §9.6) and a native macOS sign-off** — automated gates cannot
establish this, per this repo's own known-traps section in `AGENTS.md`.

**STOP #2 (10k-entry filesystem stall) cleared.** `listDir`'s per-symlink
`fs.realpathSync` was serial and blocking; a bounded async pool
(`MAX_REALPATH_CONCURRENCY = 32`) now resolves symlinked entries concurrently
without reordering the result
([`electron/fs/read.ts`](../electron/fs/read.ts) `current`). Measured on a
quiet machine, two 10k-entry fixtures (mixed symlinks; and the worst case,
every entry escaping the root), 10 reps each, two independent runs: max
sampled event-loop stall 13–16 ms, well under the 100 ms threshold that would
have forced a redesign.

**STOP #3 (bundle size) judged within expectation, not a blowout.** Entry
bundle gzip is 201.90 kB against a previously recorded 189.26 kB baseline —
+12.64 kB, explained by six further explorer commits landing on top of the
commit that baseline was measured at (file-tab chips, the worktree flow,
`fs:changed` refresh, the toggle-explorer/save-file actions, tree windowing,
the focus-guard fix). The lazy `editor.api` chunk is byte-identical at
674.50 kB gzip, proving no Monaco byte leaked into the eager entry and no new
eager Monaco chunk appeared.

**All four close/quit exits driven against the real production code path**,
intercepting `dialog.showMessageBox` rather than reading pixels (no Screen
Recording permission in this environment). A structural finding, verified
rather than assumed: **tab-level close guards never aggregate busy + dirty
into one dialog, by design** — only window-close and app-quit do that,
because a file tab's prompt should not accuse an unrelated terminal tab of
being busy
([`close-coordinator.ts`](../src/terminal/close-coordinator.ts) `current`,
[`close-guard.ts`](../src/terminal/close-guard.ts) `current`). Window-close and
quit both proved the combined message ("X is still running, and Y has unsaved
changes"), both proved settings flush before teardown by direct file mtime
comparison, and both survived repeated Cancel without silently clearing either
cause. The fourth exit, Install & Relaunch, needs a signed updater build and
stays blocked on Gate A.

**Usage §6.1.8 owner-machine acceptance ran on this machine's real
`~/.claude`/`~/.codex` corpus** — all 7 rows pass. An independent
hand-reimplemented oracle matched the real scanner exactly on 6 sampled files
(3 Claude, 3 Codex, including one subagent and one archived file). Cold scan:
5.76 s / ≈627.5 MiB peak RSS; warm scan (cache reload, unchanged corpus):
60.5 ms / ≈85.4 MiB — ≈95× faster, ≈7.4× lower peak RSS. A byte-level
instrumentation proof showed zero bytes read from any of 2050 unchanged files
on a warm poll. Missing/unreadable/stale corpus states all classify correctly.
The dashboard stayed interactive through a live cold scan (nav clicks
answered immediately while the header still read "reading this machine's
recorded history…"); a supplementary event-loop-lag measurement peaked at
106–120 ms during the scan's per-batch yields — noticeable but not a freeze,
and not the same 100 ms gate as STOP #2's `listDir` threshold.

**Major finding, fixed 2026-08-18 (was: not fixed — flagged for a
follow-up task).**
[`discoverClaude`](../electron/usage/discover.ts#L199-L223) `current` walked
only one level into each session's `subagents/` directory. On this machine,
470 of 1906 total Claude `.jsonl` files (~25% of the corpus) live one level
deeper, at `<session>/subagents/workflows/<id>/*.jsonl`, and were silently
invisible to every count and total the Usage dashboard shows. Real,
reproducible, confirmed independently of the parity fixture (which never
exercised this depth) — the real-corpus run is what caught it, not the
fixture. Windows corpus behaviour is unverified (Gate C); everything above
ran on macOS only. **Resolution:** both the Electron port and the Rust twin
now walk `subagents/` recursively up to `MAX_WALK_DEPTH`
(`walkSubagents` / `walk_subagents`), so the workflow-nested transcripts
count; a nested-file case pins the walk in each implementation's own unit
tests, and the parity gate is untouched because its golden compares
aggregates over a corpus that has no nested files.

**Browser panel: compositor pass and a real-dev-server Inspect round trip.**
Resize (via an emulated viewport, no OS-level resize available in this
sandbox), drag-to-width (via the real `startResize` pointer-capture handler)
and hide-under-overlay (the panel's `WebContentsView` survives a Settings
open/close cycle without being destroyed, consistent with a visibility toggle
rather than teardown) are evidenced by DOM state and code citation, not a
native pixel overlay proof — that needs Screen Recording permission this
sandbox does not have
([`browser-panel.tsx`](../src/browser/browser-panel.tsx#L104-L165) `current`).
Inspect was driven end to end against this repo's own real Vite dev server:
react-grab's overlay highlighted a real element, a grab crossed
page → preload → IPC → renderer, and the formatted payload landed in the
focused pane's PTY. The panel's root now carries an explicit "Electron only"
tooltip and accessible name
([`browser-panel.tsx`](../src/browser/browser-panel.tsx) `current`). Both
toolbar layouts were captured with real content, closing a standing plan gap —
top-tab mode had never been rendered before this run.

**First `npm run tauri dev` run of this entire program.** Cargo built clean,
the native binary launched, and it loaded the same shared `styles.css` and
Vite dev server Electron uses. No CDP or screen-capture path exists for
WKWebView in this sandbox, so this is process/network proof only, named
honestly as such: the dev binary's dedicated `com.apple.WebKit.Networking` XPC
helper process held an ESTABLISHED TCP connection to `localhost:1420` with
real bytes exchanged. No pixel or interaction evidence for the redesigned
chrome under Tauri exists; that remains a real, open gap — `src/styles.css` is
shared, so the visual claim is untested on the host most users actually run.

**The open board was redesigned to one center surface with three views**
(home / config / worktree) and the board's own second sidebar (`.rail`) was
removed — the app's own `WorkspaceSidebar` is the one sidebar now
([`open-board.tsx`](../src/open-board/open-board.tsx) `current`,
[`open-board-home.tsx`](../src/open-board/open-board-home.tsx) `current`).
Home is mouse-only: centered mark, "Open project" (⌘O), a "Create worktree"
button, and the grouped Recent list; a single click on a recent switches to
config (Layout + Agent + Open, unchanged content, now with a Back control); a
double click opens immediately with the remembered combo. Contract invariant:
home ⟺ nothing picked. Known, disclosed gap: the home view has no footer, so a
mouse-only user with `canCancel: true` has no visible dismiss control there
besides Esc — flagged for the owner, not patched, because the locked contract
specified no footer on home.

**Create-worktree is an Electron-only flow reached from the open board's home
view**, gated behind `worktree-host`'s `available` (a `window.__deckHost`
presence check — every `src/host/*` facade in this repo is already
Electron-only, so this is the same three-way truth table the rest of the host
layer already uses)
([`worktree-host.ts`](../src/host/worktree-host.ts) `current`). `git worktree
add` runs main-process side via `execFile` with an argv array, never a shell
string; raw git error text never crosses IPC — only one of five closed error
codes does
([`electron/git/worktree.ts`](../electron/git/worktree.ts) `current`). The new
`worktree_add` IPC channel keeps the flat payload contract, pinned by both the
generic scanner and an explicit fixture in
[the IPC contract test](../scripts/electron-ipc-contract.test.ts) `current`.
Driven end to end in a real Electron host against a throwaway git repo: a real
`git worktree add` ran, the board handed off straight to the config view with
the new path selected, and a real `branch-exists` failure surfaced as friendly
copy with git's own error text staying out of the renderer. Windows is
unverified (Gate C); the destination-path builder is POSIX-only.

**Still owed, named honestly** (the deferred register this plan closes on):
the owner's eye review of every rendered change against the captured evidence
(DL §9.6); the `css-audit` re-read with the owner; native macOS sign-off for
phase 2 steps 4–10, both toolbar layouts, the explorer surface and the
redesigned open board; a Tauri-run sign-off; Install & Relaunch (Gate A);
every Windows claim across this whole run (Gate C); a packaged Monaco smoke rerun if a CSP is
ever added or the owner designates a different verification Mac; and the
browser productization spec's owed owner read.

## The stage tab strip, and the document off the panel — 2026-08-14

The explorer surface shipped with the editor parked in a `__preview` block at
the bottom of `ExplorerPanel` — the minimum slice that proved click-a-row →
document → edit end to end, and its own file comment said so. Spec §4.2 always
put the document **on the stage**; that half was never wired. Sidebar layout
compounded it: file tabs were nested rows in `RepositoryRail`, so the user's
open documents lived in a left column while the thing they opened rendered in
the bottom-right corner of a right column.

Both are closed now, on one shape the owner picked from three:

- **The chips moved out of the frame and into their own component.**
  [`TabStrip`](../src/ui/tab-strip.tsx) `current` holds the terminal segment,
  the separator, the file segment, the add button and the rename/colour
  popover; [`TabBar`](../src/ui/tab-bar.tsx) `current` is now only top-tab
  mode's frame around it (lights, strip, spacer, toolbar). No coordination
  moved with it — same six callbacks, same `FileSurfaceController` calls, so
  R4's seams were untouched and `tab-bar.test.tsx` passed unedited, which is
  the evidence the extraction was presentational.
- **Sidebar mode mounts the same strip on the stage**, as `.stage__strip`, in
  the half of the frame row that column 2 owns and that used to be empty. That
  is a new DL rule, [DL-18.6](DESIGN-LANGUAGE.md) `current`, plus an amendment
  to DL-18.3: the sidebar frame row now has **two** occupants split by the
  shell's vertical seam, not one. It adds an occupant, not a row — DL-18.1's
  count is what that rule was ever about.
- **The document renders on the stage** as `.stage__surface`, laid **over**
  `.stage__tabs` rather than replacing it, so the terminal grid keeps its
  measured size and taking the stage back costs no xterm reflow and no PTY
  resize round-trip. The mount condition **did** change, and for the better:
  the old preview block inherited `ExplorerPanel`'s `explorerOpen` gate, so its
  real condition was `explorerOpen && activeFileTab !== null` and ⌘⇧B disposed
  the open document along with the tree. It is `activeFileTab !== null` alone
  now — an open document is not part of the file tree. The condition lives in
  [`StageSurface`](../src/files/ui/stage-surface.tsx) `current` rather than
  inline in `App`, because `App` has no render harness here and anything
  written inline in it is unassertable. (The first draft of this section
  claimed the condition was unchanged; both reviewers caught it.)
- **The rail no longer lists documents at all.** Not moved — removed, with the
  "last surface, not last tab" fallback group and the `wsitem--file` styling.
  A rail row says which repository and worktree a session is in; the strip says
  what is open. Chosen by the owner over keeping both.

`ExplorerPanel` is the tree and nothing else now
([explorer-panel.tsx](../src/files/ui/explorer-panel.tsx) `current`).

**The co-mount class of bug, and the two rounds it took to actually close.**
Sidebar layout mounts the rail and the strip **together** — the first time two
tab surfaces have ever been alive at once. Both reach for module-level state
written on the assumption that only one of them exists.

Round one caught the visible half: `requestTabOptionsKey` (⌘⇧R) had two
listeners, so one keystroke opened two popovers. That was patched by giving the
chord to one surface.

Round two came out of the review, and it was the half that mattered.
`tabPopoverOpen` — the flag that hides the browser panel's native
`WebContentsView`, because a native view wins over every DOM layer no matter
the z-index — was a plain boolean that each surface assigned as
`open = mine !== null`. With both mounted, dismissing either popover cleared it
while the other was still up, and the native view came back **over a live
popover**: the same failure the Prompt Board case already cost this repo once.
The chord also went to the **rail** rather than the strip on review — the
rail's row is what the user is looking at in that layout, and its popover is
the only one carrying the workspace-logo actions, which the first fix had
silently dropped from the keyboard path.

Round three answered the question the fix left open: two popovers floating at
once was still reachable (right-click a rail row, then click a strip chip), and
the owner chose to forbid it rather than live with it. The shared state is now
**one slot**, not a set — `openTabPopover` / `closeTabPopover` /
`tabPopoverOwner` in [`events.ts`](../src/chrome/events.ts) `current` — so
claiming it IS how a surface tells the others to stand down. Two rules carry
the whole contract, and both are in one hook
([`useTabPopoverSlot`](../src/ui/tab-popover-slot.ts) `current`) so three
surfaces cannot drift into three answers: **a surface may only retract its own
claim** (the loser standing down must not report "nothing is open" while the
winner is on screen), and **an empty slot is not somebody else's** (or an
effect ordering would close the popover the same click just opened).

Every test in the repo mounted these components **alone**, which is why nothing
caught any of it. `repository-rail.test.tsx` now renders the sidebar layout the
way `App` assembles it, and each guard was confirmed by removing it and
watching the test fail: last-write-wins for the flag, then the stand-down
effect, then the ownership check in `closeTabPopover`.

**Evidence.** `npm test` 2391 passed / 196 files; `npm run build` clean;
`npm run generate:menu:check` clean; `npx tsc --noEmit` clean.
`scripts/design-language.test.ts` caught the DL-18.6 citations before the rule
was written, which is the ledger gate working. Shell geometry was eyeballed in
the **browser** preview (`npm run dev`, chips and documents injected through
the real stores) — that proves the row placement, the panel insets and the
document rectangle, and it proves nothing native. **Owed: a real
`npm run electron:dev` look, the owner's eye review (DL §9.6), and native macOS
sign-off.** The shape the explorer's Gate M pass covered has changed, so that
run's 6/6 does not carry over to this surface; plan T35 (packaged manual pass,
both layouts) was already unchecked and now covers a different picture.
Electron-only for the explorer half; the strip and the stage surface are shared
renderer code, so Tauri behaviour is unverified.

## Worktree-scoped sidebar strip — 2026-08-15

Sidebar navigation used to select a different global tab while the stage strip
continued rendering every terminal tab in the window. The rail moved, but the
strip looked fixed. The sidebar mount now derives the active worktree through
the same [`repository-model`](../src/repositories/repository-model.ts) `current`
that groups rail rows and renders only that row's terminal tabs. The projection
keeps global tab indexes, so select, attention, close, rename and colour still
leave through `TabManager` without a second ownership model. Top-tab mode stays
global because no repository rail exists there to switch the scope.

[`RepositoryRail`](../src/ui/repository-rail.tsx) `current` also remembers one
selected tab key per worktree for the window lifetime. Clicking an exact agent
mark updates that memory through the normal active-index signal; switching away
and returning through the broad worktree row restores the same tab instead of
falling back to the row's first session. No PTY, materialization, close or
process-classification path changed.

## AgentQuickPicker — the tab strip fast path — 2026-08-14

The tab strip's `+` button (`TabStrip`'s `.tab-add`, ⌘T) used to raise the Open
board's full workspace ∥ preset ∥ agent flow via `newTab()`
(`tab-manager.ts`). It now raises a lighter modal instead:
[`AgentQuickPicker`](../src/ui/agent-quick-picker.tsx) `current`, a
`.modal-scrim` genre alongside `PresetEditor`/`SavePresetDialog` — same
`agentQuickPickerOpen` signal, same "modal" tier in `openOverlayRanks()`
([`chrome/events.ts`](../src/chrome/events.ts) `current`,
[`tab-manager.ts`](../src/terminal/tab-manager.ts) `current`). Picking a chip
(click or digit key `1-9`/`0`) calls
[`TabManager.openQuickAgent`](../src/terminal/tab-manager.ts) `current`, which
materializes a single pane in the active tab's **live** cwd — a fresh
`pty_info` read of the focused pane, not the tab's static `workspacePath` —
carrying the active tab's workspace tag, with no workspace/preset step. A
window with no tabs yet falls back to `$HOME`, same as a bare pre-cutover
`newTab()` did.

The Open board's full flow (new workspace, worktree, layout preset) did not go
away; its entry point moved to the sidebar. `RepositoryRail`'s "Open
workspace" footer row (`onOpenWorkspace` prop, renamed from `onNewTab`) now
sets `boardOpen` directly instead of sharing the tab strip's `+`/⌘T action.
`WorkspaceSidebar` got the identical rename — dead code today, but the two are
deliberately kept prop-identical for the one-line revert
[`repository-rail.tsx`](../src/ui/repository-rail.tsx) `current` describes.

`new-tab`'s action scope stays `"board"`
([`action-registry.ts`](../src/terminal/action-registry.ts) `current`),
unchanged: the F2 reasoning that keeps ⌘T blocked while a modal-tier draft is
open (mount-focus stealing) holds just as well now that the action's own
target is a modal-tier overlay rather than the board.

**Evidence.** `npm test` 2423 passed / 199 files (the one failure,
`file-tree-view.test.tsx`'s 10,000-row windowing timeout, reproduces on an
unmodified tree — pre-existing, unrelated); `npm run build` clean; `npm run
generate:menu:check` clean. The component's visual design was built and
eye-approved against a screenshot via a real-component gallery specimen
(`overlays-section.tsx` `current`) before being wired into the app. **Owed:** a
native `npm run electron:dev` click-through and the owner's eye review of the
wired flow (not just the gallery specimen) — this session had no display to
drive a native Electron window.

## Theme gallery, and themes as files — 2026-08-15

The theme setting was a cycle pill: one `cfg-row` reading `tokyo-night` with a
`↹` glyph, four built-ins, and the only way to see a theme was to land on it.
It is now a grid of cards, each a miniature of Deck painted in that theme —
[`ThemeGallery`](../src/ui/settings/theme-gallery.tsx) `current` and
[`ThemeCardPreview`](../src/ui/settings/theme-card-preview.tsx) `current`,
inside the existing `appearance` category rather than a category of its own
(the owner's call). The grid is a `role="radiogroup"`; arrow keys move
selection and wrap. Selecting still clears `colorOverrides`, exactly as the
cycle pill did.

The card is drawn with the theme's own colours through the same
[`deriveChromeColors`](../src/lib/derive-colors.ts) `current` the running app
uses — not a hand-picked palette. That is the whole reason the card can be
trusted: it is the app's own derivation, one function call away from what the
window will actually look like. It is also why the card cannot use `--tokens`,
which always resolve to the theme that is running.

**Custom themes are imported files, not an editor.** The owner chose import
over a palette editor, and a native picker plus a scanned folder over drag and
drop. So `<userData>/themes` is the model: [`electron/themes.ts`](../electron/themes.ts)
`current` copies files in (`themes_import`, modal to the asking window), lists
them as text (`themes_list`), and reveals the folder (`themes_reveal`).
Removing a theme is deleting its file — there is no delete button, because two
ways to remove one thing is how they disagree.

Four grammars are read, all in the renderer, all dependency-free
([`theme-formats/`](../src/settings/theme-formats/parse-theme-file.ts)
`current`): Windows Terminal JSON (including a `settings.json` with a `schemes`
array), iTerm2 `.itermcolors` (a plist of 0–1 channel floats, parsed by regex
rather than `DOMParser` so it runs outside a DOM), Ghostty `key = value` with
its indexed `palette` entries, and the `[colors.*]` tables of an Alacritty
TOML. VS Code themes are deliberately unsupported: most do not declare
`terminal.ansi*`, so importing one would produce a theme that looks complete
and is not. Alacritty's older YAML is out for the same reason.

The extension is a hint, never the decision — Ghostty files are extensionless
and half the Windows Terminal schemes in circulation are saved as `.txt`, so
every parser is tried in turn and each answers "not mine" with null.
`background` and `foreground` are the only required slots, because every
derived chrome token is a function of those two; cursor and selection fall
back rather than reject a usable palette. A file that will not parse becomes a
danger row naming the file and the reason, never a silent drop.

The folder is scanned twice: once at boot from [`main.tsx`](../src/main.tsx)
`current`, alongside presets and workspaces, and again whenever the appearance
section mounts. The boot scan is not optional — `themeId` persists a `file:`
id across launches, and without it `getPreset` would answer with the built-in
fallback for the whole session unless the user happened to open Settings. It
can land after first paint safely because `app.tsx`'s theme effect is a
`useSignalEffect` that reads `customPresets` through `resolveTheme`, so the
scan snaps the real theme into the chrome and the panes when it arrives.
`validateSettings` passes `themeId` through as a plain string, which is what
lets a `file:` id survive the round trip at all.

Two structural notes. `customPresets` is a signal declared in
[`themes.ts`](../src/settings/themes.ts) `current` rather than beside its
loader, because `getPreset` is the one synchronous lookup `pane.ts`,
`editor-host.ts`, `search-bar.ts` and the status bar all go through — putting
the signal at the lookup keeps the dependency one-way and keeps IPC out of
every test that renders a pane. And the extension allowlist exists twice, once
in the main process and once in the renderer, because sharing it would drag the
parser chain and `@xterm/xterm` types into the main-process tsconfig;
`electron/themes.test.ts` fails if the two lists drift.

**A parallel code review (precision + recall + adjudication) then closed two
HIGH findings**, both of which were the implementation disagreeing with its own
rules. First: the gallery compared the raw persisted `themeId` against each
card, while the status bar and the colour rows go through `getPreset` — so
after deleting a selected imported theme's file, every other surface showed the
fallback and the grid showed **nothing selected**. It now compares through
`getPreset` like everything else. Second, and worse: the picker offers "All
files" (Ghostty themes are extensionless, so it must), the copy loop screened
nothing, and `listThemes` filtered afterwards — so a `.png` or a 2 GB file
copied into `userData` and then vanished from the UI entirely. That is exactly
what DL-24.6 forbids, in the diff that wrote DL-24.6. Screening moved **before**
the copy, and `themes_list` / `themes_import` now answer with
`{ entries, rejected }` so a refused file becomes a named row beside the ones
the parser rejected. The copy path had no test at all — the `electron` mock
answered every picker with `canceled: true` — which is how both got in; it has
seven now. Fixing it surfaced a third bug neither reviewer named: the folder
scan filtered on a known extension, so **extensionless Ghostty themes were
invisible in the folder** even though the parser reads them and a test covers
it. `isThemeFileName` now accepts an empty extension and rejects dotfiles.

`DESIGN-LANGUAGE.md` §24 was written for this: §5 forbids chip grids by name,
so the gallery is a fork with the same shape as §12 (editable lists) and §13
(popovers) — one grid, one setting, everything around it still rows.

**Evidence.** `npm test` 2505 passed / 204 files; the one failure,
`file-tree-view.test.tsx`'s 10,000-row windowing timeout, reproduces on a
stashed (unmodified) tree — pre-existing, unrelated. `npm run
generate:menu:check` and `npm run electron:build` clean. `npm run build` was
clean through the feature's own gate; a later run failed on `app.tsx`,
`browser-store.ts`, `tab-strip.tsx` and `browser-panel` — a concurrent
session's in-flight edits, none of them theme files, and no `error TS` names
anything under `theme-formats/`, `custom-themes-store` or `themes.ts`.
**Owed:** the
owner's eye review (DL §9.6) and a native `npm run electron:dev` pass — the
import picker, the folder round trip and the card grid have no native evidence,
and this session had no display to drive an Electron window. Windows is
unverified (Gate C); Tauri has no implementation at all.

### Thumbnail cards, and the colour rows fold into appearance — 2026-08-16

The gallery shipped with `minmax(168px, 1fr)` tracks, and `1fr` was the bug the
owner saw: on a wide settings panel four themes became four posters, each card
big enough to read a paragraph in. The track now has a max as well as a min —
`repeat(auto-fill, minmax(108px, 132px))` in
[`.theme-gallery`](../src/styles.css) `current` — so the cards stop growing at
132px and the leftover width stays leftover. A theme card is a thumbnail: it
has to be compared against its neighbours at a glance, not admired.

Shrinking the frame meant shrinking the drawing inside it. The miniature's
parts are fixed pixels, not percentages, so the NARROW end of the track is the
one that overflows — every length in `.theme-mini*` is now tuned against the
108px card (a 102×64 mini, rail 33px and stage 40px under a 53px body), which
is why the frame, rail and stage are all still there at the bottom of the
range. The check keeps `CHROME_ICON` (13px): the icon scale (DL-14.1) did not
shrink, so the mark's circle tightened around it instead. A long theme name
ellipses in the footer and `title` hands the full one back to the pointer.

The `colors` rail category is gone (2026-08-16). Its four rows are a
`Colors` group inside `appearance`, directly under the gallery, as
[`ColorOverrides`](../src/ui/settings/color-overrides.tsx) `current` — moved out
of `sections/`, because a file in `sections/` IS a rail category and this one is
four rows a section mounts, the same shape as `theme-gallery.tsx` and
`sidebar-banner-settings.tsx`. The argument is the gallery's own behaviour:
picking a card clears `colorOverrides`, so the rows showing what is overridden
were a whole rail stop away from the control that wipes them. `ColorsIcon` went
with the category. No DL rule changed — §24 never fixed a card size, and §5's
row grammar is what the four rows already followed.

**Evidence.** `npm test` 2707 passed / 221 files, two failures, neither in this
change's diff: `scripts/icon-system.test.ts` on `src/ui/sessions/session-row.tsx`
(a concurrent session's untracked file) and `file-tree-view.test.tsx`'s
10,000-row windowing timeout, the same pre-existing flake the 2026-08-15 entry
above records. Counts drift between runs because another session is adding
tests to this tree live. `npm run build` and `npm run generate:menu:check`
clean. Screenshots of the appearance
section at 1440px and 1100px came from `npm run dev` through headless
Chromium — which paints chrome truthfully and proves nothing native.
**Owed:** the owner's eye review (DL §9.6) and a native
`npm run electron:dev` pass.

## The browser becomes a strip tab — 2026-08-15

The docked right-hand browser column is gone; the browser is now **one chip on
the strip's second segment** (globe + page title, after the file tabs) whose
surface **covers the stage** the way the document editor has since 2026-08-14.
New rule [DL-18.8](DESIGN-LANGUAGE.md) `current`; §19 keeps the docked-panel
class with the explorer as its resident instance.

What moved, and what deliberately did not:

- [`browser-store.ts`](../src/browser/browser-store.ts) `current` gained
  `browserSurfaceActive` beside `browserOpen` (chip-exists vs holds-the-stage),
  plus `activateBrowserSurface`/`deactivateBrowserSurface`. Closing the chip
  keeps the page — `setVisible(false)`, never `close()` — exactly the old
  toggle semantics.
- [`composeSurfaceStrip`](../src/ui/stage-surface-strip.ts) `current` wraps the
  file controller's `SurfaceStrip` and appends the browser as the segment's
  last index. `TabManager` was NOT touched for this (R4): ⌘W routing, tab
  cycling, "last surface, not last tab" and focus all reach the browser through
  the seam that already existed. The one `tab-manager.ts` change is the
  `toggle-browser` command (activate/step-back walk) and its membership in
  `isSurfaceRoutedAction`, so the chord works while an editor holds the stage.
- [`BrowserSurface`](../src/browser/browser-surface.tsx) `current` is the
  browser twin of `StageSurface`; `BrowserPanel` kept its chrome (address bar,
  Inspect, the measured `__view` hole) and lost the width/resize half. The
  `panelObscured()` hide-under-overlay rule is unchanged.
- Mutual exclusion: synchronous on every path through the composed strip,
  `toggle-browser` and the chip callbacks; an `App` effect backstops file-side
  activations (`activeFileTab` set → browser steps back a frame later).
- Settings: `browserWidth` and `clampBrowserWidth` are deleted (old persisted
  values are ignored by the sanitizer); `browserHomeUrl`/`browserLastUrl` and
  the restore-last-page behaviour are unchanged. `--browser-w`,
  `.stage--browser` and the grip CSS are gone.
- `electron/browser/` is untouched — the host still just receives bounds and
  visibility.

Verified 2026-08-15: focused suites for the store, composed strip, chip, tab
bar, toolbar and settings schema (116/116), `npm run build`,
`generate:menu:check` and `electron:build` clean. Full `npm test` was 2567
passed with 2 failures, both outside this work: the `file-tree-view`
10k-windowing timeout (failed identically in this session's pre-change
baseline) and `icon-system.test.ts` flagging
`settings/sidebar-banner-presets.ts`, a concurrent session's new file.
**Owed:** a native `npm run electron:dev` pass and the owner's eye review —
no display in this session. One behaviour change for that manual pass to
eyeball: with the browser chip open and no file tabs, closing the last
terminal tab now lands on the browser surface (the "last surface, not last
tab" rule reaches the browser slot). Electron only; Tauri never had a
browser.

## The daily usage view merges into one row per day — 2026-08-15

The daily table was a row per (day, agent): a reader who wanted one day's
number had to add two rows together, and the `agent` column was the same two
words repeated down thirty days. It is now **one row per local day**, with the
day's agents stacked inside its `agent` cell — brand mark, name, and that
agent's own compact tokens and dollars — while the numeric columns state the
day's totals.

- [`dailyTotals`](../src/lib/usage-aggregate.ts) `current` is the new
  aggregate, built on the untouched `dailyRows`: it groups that function's
  output by day rather than re-scanning buckets. That ordering is the point —
  costs roll up per (day, agent) and are then summed, because both agents can
  report the same model string (`unknown` does on the real corpus) and
  flattening their models into one map first would fuse two agents' counters
  into a single priced entry. The 2026-08-10 priced/unpriced rule carries up
  one level unchanged: a day's `costUsd` is the sum over the agents that have
  a price, null only when none does, with `unpricedModels` disclosed under the
  table.
- [`MetricTable`](../src/ui/usage/metric-table.tsx) `current` widened
  `MetricRow.cells` from `string | null` to `ComponentChild`. No second table
  component was forked, and `null` still renders the em dash in exactly one
  place (DL-15.6).
- New rule [DL-15.9](DESIGN-LANGUAGE.md) `current` governs what a cell may
  hold: rendered content, but still facts — DL-15.2 reaches inside cells, so no
  button, link, hover treatment or tooltip. It also fixes the brand-mark
  treatment (shared `lib/agent-logos.ts` asset, empty `alt` when the name is
  the next element) and requires sub-lines that align across rows to be one
  grid with fixed tracks, because an `auto` track resolves per cell and would
  stagger identical figures on consecutive days.
- Per-agent figures are `formatTokensCompact` and `--text-faint`; the day's
  own totals keep the grouped digits and the primary colour. The two are read
  at different levels on purpose.

Verified 2026-08-15: the usage suites and the DL citation gate (142/142),
`generate:menu:check`, and `npx vite build`. Full `npm test` and `npm run build`
each carry pre-existing failures from other sessions' untracked files
(`settings/sidebar-banner-presets.ts` under `icon-system.test.ts`;
`terminal/session-restore.test.ts` and `terminal/session-journal.test.ts` under
`tsc`) — none in a file this work touches. Eye-reviewed on a rendered
screenshot from `npm run dev` with a seeded snapshot; **owed:** the owner's eye
review and a native `electron:dev` pass with the machine's real corpus.

## Session restore — 2026-08-15

Relaunching Deck now reopens every tab that was open when it last quit or
lost power, with each built-in-agent pane's CLI resumed into its exact
previous conversation where the CLI supports that, and the repository rail
gained clickable rows to rebuild a previously-open worktree's session on
demand. This reverses the earlier "no session restore" decision (fork queue
entry in [AGENTS.md](../AGENTS.md) `current`). Electron only; no Tauri
implementation.

**The journal.** [`session-journal.ts`](../src/terminal/session-journal.ts)
`current` mirrors a window's live tabs — and, for the main window only, its
open file surfaces — into `session.json` through a debounced (1s default)
effect that reacts to `tabViews`, `activeTabIndex`, `fileSurfaces` and
`activeFileTab`. The debounce is what makes the file survive a hard
power-off rather than only a clean quit: it is continuously current, not
written once at exit. Each window writes its own `window:<label>` key —
[`registerLabel`](../src/terminal/session-journal.ts#L87-L93) `current`
tracks which labels exist, since the renderer-side `Store` facade has no
"list keys" primitive — so secondary windows never clobber the main
window's record.
Every main-window write also folds each tab's workspace into a capped,
per-workspace `archive` entry
([`pushArchiveEntry`](../src/lib/session-schema.ts#L205-L225) `current`,
24-workspace / 32-tab caps), which is what
[`sessionArchive`](../src/terminal/session-journal.ts#L63-L64) `current` — the
rail's data source — reads back. [`session-schema.ts`](../src/lib/session-schema.ts)
`current` is the pure validation layer underneath: a malformed pane or file
tab is dropped individually rather than invalidating its whole record.

**Boot restore.** [`session-restore.ts`](../src/terminal/session-restore.ts)
`current` runs before the journal starts writing, so its own first (empty)
capture cannot clobber the record restore is about to read.
`restoreSession` is wrapped in a crash-loop marker
([`sessionRestoreMarker`](../src/terminal/session-journal.ts#L136-L152)
`current`, the same `update-attempt.json` pattern applied to `session.json`
under key `restoreAttempt`): a marker still set from the previous launch
means that launch crashed mid-restore, so this launch clears it and skips
restoring rather than looping. A liveness pass
([`applyLiveness`](../src/terminal/session-restore.ts#L134-L151) `current`)
drops tabs whose workspace no longer exists on disk and nulls out any
individual pane's dead cwd (that pane still restores as a plain shell in its
tab). Every surviving built-in-agent pane then goes into ONE batched
`resume_lookup` IPC call
([`resolveRefs`](../src/terminal/session-restore.ts#L183-L191) `current` →
[`resolveResume`](../electron/resume/resolve.ts#L102-L131) `current`) rather
than one call per pane. On the main-process side, `resolveResume` scans each
needed agent's state dir at most once per call and dedups greedily: a
30-day-old cutoff and closest-`mtime`-to-`lastSeenAt` ranking pick the best
candidate, that candidate's id is added to a `taken` set for its agent, and
the next pane requesting that same agent cannot re-claim it — two panes that
both ran `claude` never resume into the same conversation. The resolved ref
is turned into a literal shell command by
[`buildResumeCommand`](../src/lib/agent-resume.ts#L80-L103) `current` and
carried into `TabManager.materialize` through the widened
[`MaterializeIntent.paneCommands`](../src/terminal/tab-materialize.ts#L128-L133)
`current` (zipped to leaves left-to-right, overriding the older single
`agent` field per pane) and the retyped
[`AgentLauncher.arm`](../src/terminal/agent-launch.ts#L10-L23) `current`,
which now takes `AgentLaunchEntry[]` (`{ id, command }`) instead of a single
shared command. `resumeWorkspace` (the rail's click handler) runs the same
liveness → lookup → materialize core scoped to one archived workspace, with
no marker, no file tabs, and no active-tab selection — `materialize` already
selects the tab it just added.

**Resume precision, by agent:**

| Agent                     | Resume form                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| claude / codex / opencode | Exact session id, scanned from the CLI's own state dir (`~/.claude/projects`, `~/.codex` rollouts, opencode storage)                   |
| gemini                    | Always `gemini --resume latest` — no id-precise resume form exists, so `resolveOne` answers `{ kind: "latest" }` before any scan runs  |
| agy                       | Best-effort byte-scan of antigravity conversations, id-precise when a candidate matches; falls back to `agy --continue` when none does |
| custom agent              | Matched by declared label; relaunches its declared command verbatim, ignoring any resolved ref (no resume support)                     |

An id that fails `SESSION_REF_SAFE` (`/^[A-Za-z0-9._-]{1,128}$/` — a
scanned-off-disk id is untrusted input) degrades to the agent's bare launch
form rather than reaching a PTY write.

**Quit vs. close: an intentional asymmetry.** Quitting flushes the journal
([`app.tsx`](../src/ui/app.tsx#L716-L725) `current`) so the next launch
restores exactly what was open. A deliberate window close does the
opposite — it CLEARS that window's record
([`app.tsx`](../src/ui/app.tsx#L726-L738) `current`) instead of flushing it.
Flushing on close would persist the very tabs the user just closed, and the
next boot's fold-in of secondary-window records (or a macOS re-`activate`)
would resurrect them as ghost tabs the user already dismissed. Quit and
close therefore install separate `flush` callbacks rather than sharing one.

**Fold-in and scope.** A secondary window's tabs write under their own
`window:<label>` key with `isMain: false`; boot restore reads every
registered label, restores the main window's tabs first (in original order)
then every other window's newest-first, and clears every non-main record it
consumed so a later detach starts clean. A secondary window destroyed
without going through the close/quit flush leaves a stale record until the
next boot's fold-in consumes it. `Settings.restoreSessions` (default `true`)
is the renderer-visible kill switch, checked once before `restoreSession`
runs.

**What does NOT restore:** pane scrollback (only cwd + agent are captured,
never terminal buffer content), unsaved file edits (a file tab records its
path and preview flag only, never dirty content), window placement/size, and
detached secondary windows as their own windows — their tabs fold into the
main window on the next boot rather than reopening a second window.

**Owed evidence:** landed and verified by suite/build only —
`npm test` (2619 tests), `npm run build`, `npm run generate:menu:check`, and
`npm run electron:build` all green. No native macOS manual pass has run
(power-off recovery, the crash-loop marker, actual CLI resume behavior), no
owner eye review of the rail's readout→pressable rows, and Windows behavior
is unverified (Gate C). gemini and agy resume are best-effort by design, not
a gap to close.

## The Native balanced rollout — 2026-08-16

The owner-selected Native balanced direction left the Gallery and became the
shipping contract: measured contrast floors inside the colour derivation, four
named text roles in place of repeated px literals, no styled uppercase and
no artificial tracking anywhere in readable copy, and Woven Flag as the
banner's one documented treatment. Twelve tasks, planned in
[the plan](plans/2026-08-16-native-balanced-rollout.md) `current`. Every file
it touched belongs to the shared renderer, so the change reaches every surface
that mounts it — but "the code shipped" and "somebody looked at it" are
different claims, and only the first one is established. See **What is and is
not proven** at the end of this section.

**Contrast became a floor, measured on every surface a tone may sit on.**
[`deriveChromeColors`](../src/lib/derive-colors.ts#deriveChromeColors)
`current` now raises `--text-primary` to **8:1**, `--text-muted` to **6:1** and
`--text-faint` to **4.5:1** — three named constants
([`TEXT_PRIMARY_FLOOR`](../src/lib/derive-colors.ts#TEXT_PRIMARY_FLOOR)
`current` and its two siblings) replacing the 7 / 5.5 / 4.5 the derivation had
carried since the ladder was built. New rule [DL-3.5](DESIGN-LANGUAGE.md)
`current` states the floors and the surface set they are measured against
(`sidebarBg`, `chrome1`, `chrome2`, `tabActiveBg`, plus `inputBg` for primary,
the only tone a recessed input carries). Meeting the numbers is explicitly not
sufficient: the three tones must stay ordered and visually distinct, and that
was measured rather than assumed. Across the four built-in presets × four
surfaces the minimum primary–muted contrast gap is **1.992** (Catppuccin
Mocha) and the minimum muted–faint gap **1.417** (Dracula) — both wider than
the old ladder's 1.5 / 1, so the raise spread the ladder out rather than
compressing it. The ordering algorithm, the surface set and `RAISE_STEP` are
unchanged.

**What that cost: three of the four built-in presets now derive a different
`textPrimary`.** Raising the primary floor from 7 to 8 pushed several themes'
raw foreground out of "already sufficient" territory, so the derivation raises
it where it previously passed it through:

| Preset           | raw `fg`  | derived `textPrimary` |
| ---------------- | --------- | --------------------- |
| Tokyo Night      | `#c0caf5` | `#cfd7f7` (changed)   |
| One Dark         | `#abb2bf` | `#f7f7f9` (changed)   |
| Catppuccin Mocha | `#cdd6f4` | `#dee4f8` (changed)   |
| Dracula          | `#f8f8f2` | unchanged             |

One Dark is the largest move: its raw `fg` cleared only 4.05–7.56:1 depending
on surface, so it was already being raised, and the new floor raises it
further — close to white. This is an intended consequence of the floor, not a
regression, and no fixture asserted the old hexes.

**Standard chrome text comes from four named roles.** `--type-title` (14px),
`--type-body` (12.5px), `--type-meta` (11px) and `--type-micro` (10.5px) are
declared once in `:root`
([`01-tokens.css`](../src/styles/01-tokens.css#--type-title) `current`) and named by
[DL-4.4](DESIGN-LANGUAGE.md) `current`; [DL-4.5](DESIGN-LANGUAGE.md) `current`
requires use sites to read them rather than repeat a literal, and closes the
exception list. Measured after the migration: **117** declarations in
`src/styles.css` take their size from a role variable (46 body, 35 metadata,
32 microcopy, 4 title) and **21** `font-size` px literals remain. The mapping
from the old literals to the roles is the design decision worth finding again:

| former literal                                                       | role                    |
| -------------------------------------------------------------------- | ----------------------- |
| 13 / 14px readable titles                                            | `--type-title` (14px)   |
| 12 / 12.5px row labels, buttons, tabs, nav items, inputs             | `--type-body` (12.5px)  |
| 11 / 11.5px metadata, keyboard hints, notes                          | `--type-meta` (11px)    |
| 10 / 10.5px microcopy, descriptions, paths, timestamps, empty states | `--type-micro` (10.5px) |

If the ladder is ever re-tuned, that is now one edit in one place rather than
two hundred.

**Closed decisions behind the migration**, all made during the rollout and
recorded here because the code no longer shows the alternatives:

- **Single-character marks and icon-glyph buttons keep literal sizes** —
  `.wsitem__badge` 9.5, `.worktree-agents__letter` / `__more` 9, `.pane__badge`
  and `.tab-popover__swatch` 10, `.tab__close` / `.wsitem__close` / `.row__x`
  13, `.tab-add` 17, `.cfg-row__remove` / `.search-bar__btn` 14,
  `.cfg-step__btn` / `.cfg-clear` 12, `.achip__letter` / `.shellmark` /
  `.wsitem__logo-letter` 11, `.mock-pane__*` 10. Their size is glyph geometry
  (§14), not a reading size; forcing them onto the ladder would move mark
  alignment, not readability.
- **`.wshead__title` keeps `font-size: 19px`** (its tracking was removed). The
  board head is the app's one structural screen heading, a level the four roles
  do not have.
- **`.window { font-size: 13px }` is untouched.** It is the shell's root
  default that relative units resolve against, not a text role; changing it
  would rescale the whole app. Twenty of the twenty-one surviving literals sit
  on DL-4.5's closed exception list — this one is covered by this ruling
  instead, because it is not chrome copy at all.
- **The 40px display figure keeps its size and loses its tracking.** DL-4.4
  keeps the figure as an exception; `font-weight: 700` and
  `font-variant-numeric: tabular-nums` stay, `letter-spacing: -0.01em` goes.
- **`letter-spacing` declarations are deleted, never set to `0`**, and a
  `font:` shorthand keeps the shorthand with the size substituted
  (`font: var(--type-meta)/1.35 var(--ui-font)`) rather than being expanded
  into longhands, which would silently drop the shorthand's reset of
  weight/style/variant.
- **DL rule ids are amended in place, never renumbered or deleted** — a test
  scans `src`/`electron`/`scripts` for rule citations and the repo's fork log
  cites rule numbers by name.

**Uppercase and artificial tracking are gone from copy.**
[DL-4.3](DESIGN-LANGUAGE.md) `current` retired both the ≤ 0.06em tracking cap
and the one sanctioned uppercase (the §16 eyebrow), and a new policy test in
[`design-language.test.ts`](../scripts/design-language.test.ts) `current`
enforces it by parsing the stylesheet. Fourteen violations across ten
selectors were closed. **One survivor, and it is sanctioned, not debt:**
`.pane__anchor-grip`'s `letter-spacing: -1px`, which pulls two `⋮⋮` glyphs
into a single grip pattern — glyph geometry with no word in it to read, held
to exactly that one selector by the test's allowlist. Measured after the
rollout: `rg -n "text-transform:\s*uppercase|letter-spacing:" src/styles.css`
returns that hit and nothing else. The usage eyebrow is now sentence-case
`Raw token cost` at `--type-micro`
([`overview-section.tsx`](../src/ui/usage/sections/overview-section.tsx#usage-hero__eyebrow)
`current`), reversing the 2026-08-10 sanctioned-uppercase fork under the
amended [DL-16.2](DESIGN-LANGUAGE.md) `current`; `RAW TOKEN COST` no longer
appears anywhere in `src`, `electron` or `scripts`.

**Woven Flag is the documented banner treatment.** New section **§26** of
[DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) `current` (DL-26.1 … DL-26.4) fixes
one component with one treatment class, says what the treatment is — texture,
fold light, matte colour, rail fade, and nothing else — forbids
theme-specific variants (themes supply colour only), and keeps the banner
decorative and non-interactive.
[`SidebarBanner`](../src/ui/sidebar-banner.tsx#SidebarBanner) `current`
already carried `sidebar-banner--woven` on the shared wrapper as a static
string; the rollout documented it and closed the test gap, so disabled,
preset and custom-image cases each assert their own outcome.

**The Gallery stopped carrying a second design system.**
`src/gallery/muted-contrast-candidate.tsx` — the candidate contrast layer the
direction was chosen from — is deleted, and
[`matrix-section.tsx`](../src/gallery/sections/matrix-section.tsx) `current`
now measures its contrast tables on raw `deriveChromeColors` output, the same
function the app runs, and paints its type specimen from `var(--type-*)` while
reading the footer numbers back through `getComputedStyle`. This was safe
because the candidate layer had become an **identity function** once the
floors moved into production: re-running the deleted algorithm on top of
derived output returned its input unchanged on all four presets for both
roles, so no rendered colour changed. A residual remains by necessity: the
Gallery still writes the three floor numbers down locally in order to
_display_ them, because a floor is an input to the derivation and cannot be
recovered from the colours that come out. `derive-colors.ts` exports the three
constants, so that last duplication is closable.
[`gallery-entry.test.ts`](../scripts/gallery-entry.test.ts) `current` gained a
guard that the deleted module stays deleted and that the matrix carries no
type literals of its own. One known stale spot, out of the rollout's scope:
`src/gallery/sections/treatment-direction-review.tsx` carries the old sizes in
a descriptive note string — prose, nothing renders from it, but it can go
stale.

**What is and is not proven.** This rollout has three different grades of
evidence and they are not interchangeable:

1. **Shared-renderer implementation — verified.** `npm test` reports
   **2710 passed, 1 failed of 2711** across 223 files. The single red is
   `scripts/icon-system.test.ts > does not put a retired glyph back to work as
an icon` (offender `ui/sessions/session-row.tsx: × (remove/close)`) and it
   **pre-dates this work** — that file's mtime is 2026-08-16 01:11, before the
   rollout started, and no task touched it or the icon registry. It was
   reported rather than fixed (W3), so the suite is not fully green and this
   rollout did not make it so. `npm run build`, `npm run generate:menu:check`
   and `npm run electron:build` each exit 0.
2. **Rendered behaviour in a real browser — verified, in the Gallery.**
   `npm run prototype:gallery` was driven through Chrome on 2026-08-16, which
   is the only evidence that reaches things a text-scanning suite cannot see.
   `getComputedStyle(document.documentElement)` returns
   `--type-title=14px`, `--type-body=12.5px`, `--type-meta=11px`,
   `--type-micro=10.5px`, and the type card's footer — which reads those
   variables at runtime rather than restating numbers — prints them back, so
   the `--type-* not resolved` fallback never fired. The contrast floors hold
   on all four built-in themes, with minimum primary / muted / faint ratios of
   8.03 / 6.00 / 4.56 (Tokyo Night), 8.27 / 6.00 / 4.59 (Dracula),
   8.07 / 6.06 / 4.50 (One Dark) and 8.04 / 6.05 / 4.52 (Catppuccin Mocha);
   the exhaustive text-to-surface matrix — 4 themes × 3 roles × 6 surfaces —
   counts **72 safe, 0 unsafe** from the DOM rather than off the picture. At a
   compact 1024×760 viewport none of the ten sections overflowed horizontally
   or clipped visible text; the one scan hit, `.update-action__live`, is the
   visually-hidden aria-live region and a false positive by construction.
   **The Gallery's own limit:** it is a dev harness rendering real components
   against stub IPC, and the compact-width scan resizes the Gallery, whose
   specimens have fixed inner widths — evidence against gross overflow, not a
   narrow real Deck window and not a substitute for the native pass.
3. **Electron native appearance — NOT established.** No screenshot has been
   shown to or approved by the owner, and `npm run electron:dev` was not
   launched. Its dev `userData` is not isolated on this machine — a headed run
   writes the owner's real `workspaces.json` — so launching it is the owner's
   call rather than an agent's.

Packaged-runtime behaviour is not claimed at all. Windows is unverified
(Gate C — no real Windows hardware). Nothing here was committed: documentation
waits for the owner's review (D14), and the working tree carries a large
unrelated uncommitted checkpoint.

## Panel seams that close — 2026-08-16

The two docked edges of the window learned the same gesture, and the
navigation column learned to resize at all.

**What the owner asked for.** A close control inside the Explorer panel — the
toolbar button and ⌘⇧B existed, but nothing in the panel itself — and, for
both the sidebar and the docked panel, "drag the seam out past the edge and it
hides". The sidebar half turned out to rest on an assumption that was not
true: it had no seam. `--sidebar-w` was a fixed 275px, there was no
open/closed state, and in sidebar layout the frame row — the macOS traffic
lights included (DL-18.3, DL-18.4) — lives _inside_ that column. Hiding it
outright would leave the OS painting its window buttons over the terminal.
Presented with that, the owner chose collapse-to-a-rail over a full hide, then
asked for the `PanelLeft`/`PanelRight` glyph pair as the toggle for both.

**What landed.**

- [`resolvePanelDrag`](../src/ui/panel-resize.ts) `current` is one pure
  function serving both seams: it clamps the width and, separately, reports
  whether the RAW pointer width has fallen past `min - PANEL_COLLAPSE_SLACK`.
  Raw, not clamped, is the whole point — clamping maps every overdrag onto the
  floor, so a clamped value cannot tell "resting at the minimum" from "dragged
  200px past it". It is a pure function because this repo has no `<App>` render
  harness, and the threshold is the only part of the gesture worth testing.
- The decision lands on **release**, never mid-drag. Collapsing under the
  pointer would unmount or resize the element the gesture is captured on,
  which makes an overshoot unrecoverable. The two panels preview the outcome
  differently: the explorer dims (`.is-collapse-armed`), while the sidebar
  goes compact immediately — the rail IS the preview there, so a second
  treatment would only be noise.
- The explorer's two new exits — the header control and the drag — both go out
  through `onClose`, which `App` maps to `runAction("toggle-explorer")`. The
  panel never writes `explorerOpen`: that action owns the focus guard, and a
  second way in would bypass it. The collapse path deliberately writes no
  width, so closing does not persist the floor as a preference.
- [`SidebarGrip`](../src/ui/sidebar-grip.tsx) `current` is new — the sidebar's
  first seam. It is a sibling of the rail rather than part of it, because two
  components occupy that slot (`RepositoryRail`, with `WorkspaceSidebar` kept
  beside it for the one-line revert) and a seam living inside one would vanish
  with the revert.
- **Hidden means width 0** (`SIDEBAR_HIDDEN_WIDTH`), revised the same day
  from an earlier collapse-to-icon-rail. The rail, the frame row and the seam
  all go; the stage strip carries the traffic lights' reserved inset while the
  column is away, because that inset is a reservation for buttons the OS
  paints, not a control.
- What made zero possible was emptying the frame row of everything that is not
  a window control. The **hide control moved up beside the traffic lights**
  ([`SidebarToggle`](../src/ui/sidebar-toggle.tsx) `current`), and the
  **feature toolbar moved out** to the stage strip's trailing end
  (`.stage__strip-actions`), so the column's width no longer decides how many
  toolbar controls are visible — before the move, a narrow column folded globe
  and everything after it into `More`. While the column is hidden the control
  mounts at the strip's leading edge instead: the way back out cannot live
  inside the thing it reopens.
- One width, one owner: `App` writes `--sidebar-w` and
  `[data-sidebar-collapsed]` onto `:root`
  ([`applySidebarShell`](../src/ui/sidebar-shell.ts) `current`), the way
  `applyThemeVars` writes theme tokens. That is a workaround, not a
  preference — see the defect below. During a drag the rail paints compact
  from what the drag is ARMED to do, not from the setting it has not written,
  so pulling a collapsed column back out shows its labels while the pointer is
  still down.
- `sidebarWidth` (clamped 200–420, default 275) and `sidebarCollapsed`
  (default false) are ordinary settings. `electron/settings-merge.ts` needed no
  change: it shallow-merges whatever keys arrive and only names _retired_ keys.

**Rules touched.** New DL-18.9 (the navigation column resizes and collapses);
DL-19.4 amended in place (past the floor is a close, not a clamp). Fork
recorded in `AGENTS.md`.

**A defect found on the way, and not fixed here.** The first implementation
put the width and the collapsed flag on the window shell as `style`/`class`
props. In the running app they never took effect. Measured with Playwright
against `npm run dev` AND against the production build: `DesktopChrome`
receives the new props and computes the new class string (logged), its
CHILDREN update — a probe `<span>` inside it flips class on the same
render — but every prop on the element the component itself RETURNS stays at
its mount value, `class`, `style` and a plain `data-` attribute alike. The
same defect reaches shipped behaviour: flipping **Tab bar position** in
Settings leaves `window--sidebar` on the shell, so that setting does not
change the layout it names. It reproduces in an isolated jsdom render of
`DesktopChrome`? **No** — that passes, which is why no unit test catches it.
Reported, not fixed (W3): the cause is somewhere in how this App re-renders,
not in this feature, and the fix belongs with whoever owns that seam. The
sidebar work routes around it by writing to `:root` instead.

**Evidence.** `npm test` reports 2804 passed / 1 failed of 2805. The one red is
outside this work: `scripts/icon-system.test.ts`'s retired-glyph scan, offender
`ui/sessions/session-row.tsx: × (remove/close)` — an untracked file from the
working tree's existing checkpoint, the same red
[the Native balanced rollout](#the-native-balanced-rollout--2026-08-16)
`current` recorded. (An earlier run of this same work also reddened
`file-tree-view.test.tsx`'s 10,000-row windowing case; it passes on its own in
1.26s and only fails inside a full run on a loaded machine.) `npm run build`
and `npm run generate:menu:check` exit 0.
Rendered behaviour was checked in Chrome against `npm run dev`. Before the
hide revision: the column went 275px → 56px, the seam dragged out to 372px,
and a drag past the floor held at 200px while armed then landed collapsed on
release. After it: shown = `--sidebar-w: 275px`, frame row carrying exactly
one button (the hide control) and five toolbar controls on the stage strip;
hidden = `--sidebar-w: 0px`, frame row and rail both `display: none`, the
control remounted in the strip behind an 86px inset (78px lights + 8px), and
the toolbar untouched at five. The explorer panel was
mounted with a stub client in the same page: its header carries the
`PanelRight` control ("Hide the file explorer") and arming the collapse adds
`is-collapse-armed`. New suites:
`src/ui/panel-resize.test.ts` (threshold arithmetic, both bounds, the collapsed
floors) and `src/ui/sidebar-grip.test.tsx` (widen, arm-and-collapse, pull back
out, press-without-move, pointercancel); `explorer-panel.test.tsx` grew the
header control and both drag outcomes; `settings-schema.test.ts` covers the two
new keys.

**A hide rule that named a dead class.** The rule hiding the column named
`.wsbar`, the rail class that `AgentRail` (`.asr-rail`) replaced the same day.
A dead selector fails silently: hiding the sidebar left the live rail at 8px —
its own left/right padding — overhanging the stage instead of gone. Measured
in Chrome (`w: 8` before, `w: 0, display: none` after) and fixed by naming both
classes, since `WorkspaceSidebar` stays in the tree for the one-line revert.
Found while debugging a separate report; the lesson is recorded because the
next rail swap will break the same way: a rule keyed to a retired class throws
no error, it just stops applying.

**Not established.** No `npm run electron:dev` pass and no owner eye review of
either surface. Everything here is renderer code, so it reaches the Tauri host
too — the one users actually run — and nothing was launched there either. The
collapsed floor on Windows is reasoned from the fact that the OS draws its own
controls outside the web contents; that is unverified (Gate C). Nothing was
committed.

## The rail becomes a list of agents — 2026-08-16

The sidebar rail was shaped like the repository layout: repositories on top,
worktrees under them, tabs inside those. A probe of this machine's own
Claude/Codex corpus on 2026-08-16 (1145 user-opened sessions since 2026-03-30,
1032 of them in the last 30 days) says nobody works that way — 46 of 51
repositories have exactly one working directory, the whole corpus holds 4 real
worktrees, and 83% of sessions return to a project already touched that day
with a median gap of ~8 minutes. The rail was answering a directory question
while the owner, asked what they look for after stepping away, named two agent
questions: _which agent just finished or is asking me something_, and _the
overall picture of what is running_.

[`AgentRail`](../src/ui/agent-rail.tsx) `current` replaces
[`RepositoryRail`](../src/ui/repository-rail.tsx) `current` in `DesktopChrome`'s
`sidebarNavigation` slot. One flat list, no mode switch: a pinned `Needs you`
block while anything is actionable, the recency stream under it, quiet archived
resume rows at the bottom, the `Open workspace` footer row unchanged. (The
block and the recency order were both removed later the same day — see "The
pinned block goes, and the list stops moving" below.) One row
per **tab**, because a tab is a pane layout — its agents are chips inside the
row, and a per-row disclosure unfolds them into rows of their own. Design:
[spec](specs/2026-08-16-agent-status-rail-design.md) `decided`, approved from
the gallery specimen the same day.

**Every visible thing is a way back to a specific pane**, which is the whole
reason the rail was worth building. The row body selects its tab; an agent chip
and a per-agent row both activate that exact pane; `+N` opens the row; an
archived row resumes its workspace. The pane-exact path needed a pane id the
renderer never had — `syncViews` now publishes
[`TabView.panes`](../src/terminal/tabs-store.ts) `current` (`paneId`, `agent`,
`attention`, `phase`, `changedAt`) beside the per-tab rollup the tracker was
already producing. Focusing one runs `App`'s `focusRailPane`, which walks the
same `runAttentionFocus` overlay preflight ⌘⇧A walks and then calls
`TabManager.activateForAttention`, so exactly the chosen pane is focused and
acknowledged. Two deliberate differences from the shortcut: `hasCandidate` is
unconditionally true (the user picked a pane, so a resting agent must not be a
silent no-op), and the focus call is the pane-exact one rather than
`focusNextAttention`, which would pick the loudest pane in the window instead
of the one that was pressed. No PTY, window, materialization, close or
process-classification path changed.

**The pane answered back, then was deleted on 2026-08-17.** `pingPane` rang the target pane
for 1.5s on the reasoning that the rail otherwise drops the user into a grid of
identical terminals. The owner removed it: the flash read as an accent event
with no visible cause, and the then-permanent active-pane bar
([`.pane-slot.is-active .pane::before`](../src/styles/06-stage-panes.css)
`deprecated`) already said which pane held the keys. The original ring and its
DL-27.7 rule were withdrawn; the module name later returned for the different
top-edge line below.

**The line now has two lifetimes (2026-08-19).** A click on an Agent Rail row
focuses its exact pane and [`pingPane`](../src/terminal/pane-ping.ts) `current`
replays the yellow current once for 1.5s, even if that agent is idle. Its
`.pane-ping` is anchored by the target's positioned `.pane-slot`; without that
containing block the absolute line climbed to the tab ancestor and spanned the
whole tab. Separately, every recognised agent in tracker phase `working`
carries the same current on its pane continuously until the tracker stops it;
this path is pane-exact and does not require focus, so background work remains
visible. The working path keeps a dim 2px base with a brighter two-packet
charge; reduced motion removes the click locator and freezes working to the
static base. Shells and idle agents draw nothing. This restores the rail
locator's purpose without restoring its old full-pane accent ring, and uses
the owner's Ghostty reference for both.

**State model.** `attention: "error"` reads as `failed` and outranks everything
— a crashed agent belongs in the pinned block, ABOVE `asked`, and is not
allowed to read as `resting`. `attention: "warning"` folds into `asked`; both
mean "come look", and the palette stays three marks wide rather than four.
Attention is read before phase, because the tracker latches attention and
leaves phase live, so a pane can be `working` while carrying a warning nobody
has answered. Precedence when a tab folds its panes into one row: failed >
asked > done > working > resting. `unread` deliberately gets no mark of its
own — it already drives the tab strip's badge, and a second signifier for one
state is DL-21.6's mistake in a new place.

**The row carries no status word.** Colour alone, with the word surviving in
`title` and in the accessible name, so the shape is the fast read and never the
only read. The known cost is recorded rather than argued away: red and yellow
side by side are harder to tell apart at a glance than a word would be. The
spec's two compensations are the message line under a failed row (the failure
itself) and the accessible name — and **only the second one exists today**,
because tier 3 is not built.

**Not built: tier 3.** The `session_tail` IPC channel that would put an agent's
newest turn on the row's second line is gated by spec §10 behind a native
`electron:dev` pass and an owner eye review of tier 1, neither of which an
automated run can produce. Every message line is the tab title today — which is
what §5 already prescribes as the fallback for gemini, agy and declared agents,
so the row shape is coherent, just quieter. The one real gap this leaves: a
`failed` row cannot yet show `Command exited with code 1`, which §3 names as one
of the two things carrying the red/yellow difference.

**The stage strip's scope moved with the rail.**
[`activeRepositoryTabIndexes`](../src/repositories/repository-model.ts)
`current` joins `activeWorktreeTabIndexes` as its sibling, and `TabStrip`'s
sidebar mount calls it at both sites (the visible projection and the popover
guard). The rail's rows are tabs in a project, so a strip scoped tighter than
the rail would hide a sibling tab the rail is still listing. For 46 of 51
repositories the two answers are identical. This amends the 2026-08-15 resolved
fork; the last-selected-tab-per-worktree memory went with `RepositoryRail`.

**Interpretations made during implementation**, recorded because the spec did
not settle them:

- §6 asks for rename, recolour and close as hover actions. Rename and recolour
  are one control, not two: it opens the existing `TabPopover`, which already
  carries both plus the workspace-logo actions. Two bespoke buttons opening the
  same popover would have been a duplicate with a second place to drift.
- §5 says `onFocusAttention` is kept and re-bound. It drives the pinned block's
  COUNT, which is now a button — "take me to the next of these" — rather than a
  row-level control, because DL-27.5 swaps the row's mark out on hover and a
  control you must hover to reach is not a control. (Void: the block, the count
  and the prop were removed later the same day; ⌘⇧A is the walk now.)
- A tab running no recognised agent still gets a row. The rail answers "which
  agent", but it is also the sidebar's only list, and a tab it declines to draw
  is a tab the user cannot reach from there. Shell panes are simply not per-agent
  rows (§9).

**Rules touched.** New DL §27 (the agent rail row) carrying DL-27.1 through
DL-27.7; DL-3.2 amended in place to give `--yellow` a role; DL-1.2's 300ms cap
amended in place with one scoped exception for the 1500ms ping. **DL-1.3 was
NOT amended**: a real glow was considered and refused, so the ping is the inset
hairline that rule permits and what animates is `opacity`. The spec asked for
§26; §26 was taken by the sidebar banner after the spec was written, and §22
stays reserved, so this is §27.

**Evidence.** At the moment this work completed, `npm test` reported 2800
passed / 1 failed of 2801; the single red was `scripts/icon-system.test.ts`'s
retired-glyph scan, offender `ui/sessions/session-row.tsx: × (remove/close)`, an
untracked file from the working tree's existing checkpoint that nothing here
touched — the same red [the panel seams entry](#panel-seams-that-close--2026-08-16)
`current` already recorded, so it pre-dates this work. `npm run build`,
`npm run generate:menu:check` and `npm run electron:build` all exited 0. Minutes
later the second session's own `explorer` → `dock` rename landed mid-flight and
turned five unrelated suites and the build red (`EXPLORER_WIDTH_MIN` no longer
exported); none of those files belongs to this work, and re-running this task's
own ten suites — `agent-rail`, `agent-rail-model`, `pane-ping`,
`repository-model`, `tab-strip`, `repository-rail`, `app`, `design-language`,
`gallery-entry`, `electron-ipc-contract` — reports 165 passed, 0 failed. New
suites: `src/ui/agent-rail-model.test.ts` (29 — the full state mapping,
attention beating phase, the fold precedence, both sort orders, the pane-count
semantics of the pinned count, the worktree suffix, a no-agent tab, archived
rows, every `formatShortAge` boundary), `src/ui/agent-rail.test.tsx` (19) and
`src/terminal/pane-ping.test.ts` (5); `tab-manager.test.ts` and
`repository-model.test.ts` grew the pane projection and the repository-scope
cases. No screenshot was produced: Playwright was locked by the concurrent
session and the Chrome extension was not connected, so the visual gate rests
entirely on the owner's own run.

**What the first native run caught, same day.** The rail shipped without the
shell contract `.wsbar` had been carrying, and no automated check could see it:
jsdom loads no stylesheet, so every render assertion passed against a rail
nobody could see.

- **Grid placement.** `DesktopChrome` renders `sidebarNavigation` as a direct
  grid child of `.window`, and `.wsbar` placed itself with
  `grid-column: 1; grid-row: 2`. `.asr-rail` did not, so it auto-flowed into
  the next free cell — under the stage, on top of the status row — and left the
  navigation column empty.
- **Surface.** `background: transparent` let the stage's `--bg` up into the
  navigation column, against DL-18.7's "frame and rail are one continuous
  recessed surface".
- **Scrollport.** `.wsbar__list` scrolled the rows while the banner stayed put;
  the rail had no such split, so a long list would have grown past the cell
  instead of scrolling. The rows now live in `.asr-rail__list`.
- **The collapsed column.** Every DL-18.9 collapse rule is `.wsbar`/`.wsitem`
  scoped, so replacing the rail dropped all of them silently. The rail has its
  own set now, and its footer row grew a `+` glyph so it survives losing its
  label the way `.wsbar__add` always did.

`src/ui/agent-rail.test.tsx` now reads these declarations straight out of
`src/styles.css`. It is an unusual shape for a component test and it is
deliberate: the stylesheet is the only layer where this class of defect is
visible to a suite at all.

**Not established.** No `npm run electron:dev` pass and no owner eye review of
the wired rail — only of the gallery specimen it was ported from. The renderer
is shared, so this reaches the Tauri host too, where nothing was launched.
`RepositoryRail` and `WorkspaceSidebar` stay in the tree, out of the shell,
until that pass — the repo's own precedent for parked UI, and the reason the
revert is one import and one JSX tag.

### The stream clusters by project — 2026-08-16

The rail shipped flat: one row per tab, each printing its own project name. The
owner opened four tabs on one workspace and got four rows saying
`spacevibe-active`, none of them adjacent — recency had scattered them — with a
second `spacevibe-active` printed under each as the message line, and a third
under every agent inside an unfolded row.

Two separate defects, one cause each:

- **The name.** Spec §1's corpus justified a flat list by measuring PROJECTS
  touched per hour (median 2). It never measured TABS PER PROJECT, so nothing
  in it spoke to the case the owner was in. Grouping the stream by project
  moves the name up one level:
  [`RailStreamGroup`](../src/ui/agent-rail-model.ts) `current`, rendered as a
  `.asr-cluster__head` label above its rows.
- **The line.** Tier 3 (`session_tail`) is unbuilt, so §5 makes the tab title
  the fallback turn — but `RailTab.label` derives from the workspace path
  unless a person renamed the tab, so the fallback was structurally guaranteed
  to repeat the row. `messageOf` now returns `customName ?? ""`.

The shape is deliberately narrow so it cannot become the worktree tree the rail
replaced (spec §9): at that point the header had no state mark, age, disclosure
or hit target (its collapse control arrived later in DL-27.11), the worktree
stays a suffix on the row, clusters are ordered by
their newest tab rather than by name, and at that point a cluster of one printed
no header — most projects have exactly one tab, and a header apiece would
double the rail's height to repeat the row underneath it. DL-27.12 later
superseded that singleton exception. The pinned block is left
flat: it is a queue of answers owed, so a project with one asking tab and two
quiet ones appears in both places, and neither copy is a duplicate.

Inside a labelled cluster a row spends its one strong word on the tab instead:
the user's name for it, else the agents running in it (`claude + codex`), else
`shell`. Carried by `DL-27.9` and spec §2.4.

**Not established.** Suite (`npm test`) and `npm run build` only — no native
pass and no owner eye review of the clustered rail. The gallery specimen
`src/gallery/agent-status-rail.tsx` is a separate copy that still draws the
pre-cluster shape, so the approved specimen and the shipped rail now disagree;
porting it is unclaimed work.

### The pinned block goes, and the list stops moving — 2026-08-16

Clustering fixed the repeated name and left the other half of the same defect
standing: a project with an asking tab was still printed twice, because the
pinned `Needs you` block lifted that tab out of its cluster. The owner, shown
the running rail, asked for the block to go — one project, printed once, with
all of its tabs and panes under it — and then, asked whether an active project
should climb to the top in its place, ruled that out too: _"chúng ta đã có state
icon status rồi"_. The marks say what happened; the list should not move to say
it again.

- **No pinned block.** `buildAgentRail` stopped splitting rows into
  `pinned`/`streamed`; `needsYou`, `needsYouCount` and `RailTabRow.actionable`
  left [`AgentRailView`](../src/ui/agent-rail-model.ts) `current` with them, and
  `onFocusAttention` left `AgentRailProps`. **The feature did not go with it**:
  `focus-next-attention` (⌘⇧A, and the View menu) still walks to the next
  waiting pane through `runAttentionFocus`, which is where a queue belongs — a
  keyboard walk, not a second copy of the list.
- **Open order, not recency.** `sortStream`/`sortPinned` became one
  `sortByOpenOrder`, reading `TabView.openedAt` — the window's one open clock
  ([`open-sequence.ts`](../src/lib/open-sequence.ts) `current`) that `TabStrip`
  already sorts by, so the strip and the rail cannot disagree about where a tab
  sits. A cluster sits where its OLDEST tab put it, so opening a second tab in a
  project never moves that project. Fixtures with no key fall back to tab order.
- **The age moved to its own line.** It sat on the name line between the agent
  chips and the state mark, splitting the row's one glyph cluster with a number
  (the owner's second screenshot circled exactly that column). It now leads a
  `.asr-row__meta` line under the name, with the turn beside it when there is
  one, and a row with neither prints no second line. The tab row's grid lost a
  column.
- **The row got taller and the rows got further apart.** On the owner's ask
  after seeing it run: `.asr-row--tab` takes a 46px floor with 7px of vertical
  padding (the base row's 30px was written for one line), and the gap between
  rows went 1px → 4px in both `.asr-stream` and `.asr-cluster`, which have to
  agree or a project's own tabs would sit tighter than a lone project's row.
  A floor, not a height: a row whose turn wraps still grows.
- **The hover pair moved with it.** DL-27.5 had the actions swapping in over
  the age + mark pair; that pair is 10px wide now, so they would have covered
  agent chips — which are targets, not readouts. They sit at the meta line's
  trailing end instead, over 38px the line reserves at rest, never on `:hover`
  (a padding that appears under the pointer is a reflow). The state mark stays
  visible while a row is hovered, and the `asr-arrive` animation went with the
  block it was written for: nothing enters a list that no longer reorders.

Carried by `DL-27.10`, which amends `DL-27.5` and voids one sentence of
`DL-27.9`; spec §2.5, amending §2, §3 and §6.

**Evidence.** `npm test` at 14:50 on 2026-08-16 — 2872 passed, 1 failed:
`src/files/ui/file-tree-view.test.tsx`'s 10,000-row windowing case, the same
pre-existing full-suite-load timeout the modal-shell entry above already
records. `npm run build` green, and `scripts/design-language.test.ts` resolves
every new `DL-27.10` citation.

**Not established.** Suite and build, plus a static Chrome render of the new
row against the real `src/styles.css` —
enough to see the two lines and the hover pair, not a running app. No
`npm run electron:dev` pass and no owner eye review. Renderer-only, so it
reaches the Tauri host too, where nothing has been run.

### The rail stops at the tab — 2026-08-16

The running Electron rail still asked the user to parse three levels — project,
tab and pane — even though the agent marks in the tab row already reached those
same panes. From the owner's screenshot, the chosen direction is now exactly
**project → tab**. The owner explicitly asked to put that direction into
Electron rather than return to the gallery first.

- [`TabItem`](../src/ui/agent-rail.tsx#L145-L238) `current` is one compact row:
  leading agent glyphs, tab name, age, one rolled-up state mark and a fixed
  hover-close column. Agent glyphs still focus their exact panes; `+N` is an
  inert count. Per-glyph state badges, the tab disclosure and all nested pane
  rows are gone.
- Only `asked` and `failed` may spend a second line on the newest actionable
  turn. Quiet, working and done rows remain one line. The current 34px floor and
  column contract live in
  [`04b-agent-rail-rows.css`](../src/styles/04b-agent-rail-rows.css#L35-L72)
  `current`.
- A labelled project's
  [`asr-cluster__head`](../src/styles/04a-agent-rail.css#L115-L164) `current`
  is now the one disclosure in the rail: it collapses or restores the whole
  project. At this point a one-tab project still printed no header; superseded
  by “Every project keeps its header” below.

This is a renderer change and therefore reaches both hosts; no tab, PTY,
window, materialization or close ownership changed. It is carried by
`DL-27.11` and spec §2.6, superseding the two-line resting shape recorded by
`DL-27.10` above.

**Evidence.** `src/ui/agent-rail.test.tsx` and
`scripts/design-language.test.ts` pass 35/35; `npm run build`,
`npm run electron:build` and `npm run generate:menu:check` all exit 0. An
isolated native Electron `BrowserWindow` then restored three live tab rows
(`claude + codex`, `claude`, `codex`) against the built renderer and measured:
three 34px rows, one project header, zero tab disclosures, zero pane rows and
zero horizontal rail overflow. `webContents.capturePage` captured both the open
and collapsed project states.

**Full-suite caveat.** `npm test` is not green: 2,574 tests pass and 277 fail.
The failures share the current Phosphor/Vitest integration fault — React
`forwardRef` icon objects are externalized before the Preact alias and jsdom
rejects `[object Object]` as a tag name — across unrelated component suites.
The rail suite uses a narrow `DeckIcon` harness mock and is green; the
production bundle and native Electron render both resolve the real icons.
Fixing the repository-wide test harness is outside this rail change.

**Not established.** The owner has not eye-approved the new native screenshot;
Tauri and Windows have not run this shape.

### Every project keeps its header — 2026-08-16

The owner's next running screenshot placed a labelled `spacevibe-active`
cluster above a singleton `spacevibe-academy` row. Although both represented
projects, one looked like a hierarchy and the other looked like an unrelated
tab. The approved invariant is now **project → tab even when there is only one
tab or one agent pane**.

[`LOWEST_LABELLED_SIZE`](../src/ui/agent-rail-model.ts#L347-L348) `current` is
now one, so every non-empty project cluster emits its header and every child
row uses its tab identity (`claude`, `codex`, a multi-agent combination, a
user-supplied tab name, or `shell`). The header keeps the collapse behaviour
from DL-27.11; no row geometry or click target changed. This is DL-27.12 and
spec §2.7, superseding the singleton exception in DL-27.9/DL-27.11.

The TDD gate failed in the expected three places before the model change: two
cluster projections still returned `labelled: false`, and the rendered
singleton had no `.asr-cluster__head`. After the one-line model change, the
rail model + component gate passes 61/61. The broader targeted gate — model,
component and design-language tests — passes 70/70; `npm run build`,
`npm run electron:build`, `npm run generate:menu:check` and `git diff --check`
all exit 0.

An isolated native Electron window then restored four live tabs across two
projects: three under `spacevibe-deck` and one `codex` tab under
`spacevibe-academy`. It measured four 34px rows, **two project headers**, zero
tab disclosures, zero pane rows and zero horizontal rail overflow, then
captured the open and collapsed states through `webContents.capturePage`.

**Not established.** The owner has not eye-approved this new screenshot; Tauri
and Windows remain unverified.

## TabPopover and its features are deleted — 2026-08-16

The owner sent a screenshot of the tab options popover — a `Name` field and a
`Set logo…` button — and asked for the popover **and the features inside it** to
go. Asked how deep, they chose to pull it out by the roots rather than keep an
unreachable API; told that `WorkspaceLogo` is only ever rendered by
`WorkspaceSidebar`, a component nothing mounts (so a logo they set appeared
nowhere), they chose to delete the logo system with it.

**Gone.** `src/ui/tab-popover.tsx`, `src/ui/tab-popover-slot.ts`,
`src/ui/workspace-logo.tsx`, `src/settings/workspace-logo-store.ts`,
`src/ui/workspace-sidebar.tsx` and their tests. With them: the rail row's
options button and right-click, the `open-tab-options` action and its ⌘⇧R
binding in both keymaps, `requestTabOptionsKey`, the `tabPopoverOpen` /
`tabPopoverOwner` slot in `chrome/events.ts` (and its entry in `panelObscured`),
`TabManager.renameTab` / `setTabDotColor` and the private `setOverride` they
were the only callers of, the boot-time favicon scan, the drop-an-image-on-a-row
path, the `.tab-popover*` and `.wsitem__logo*` stylesheet blocks, and the
gallery's `.tab-popover` specimen.

**`WorkspaceSidebar` went because its reason to exist did.** It was a parked
revert target whose rows were a logo, a label and a path; with the logo deleted
it would have been a list of two strings that nothing mounts. `RepositoryRail`
stays, stripped: its rows still select, and pressing the row of the tab already
showing is a plain re-select instead of raising a popover — which is what the
"popover-vs-reselect" regression guard in its suite now asserts.

**What deliberately stayed.** The `TabOverride` plumbing: `tabName` and
`dotColor` still ride the window-transfer payload and the preset snapshot, and
`TabView` still carries both fields. Nothing can put a value in them any more,
so they are dormant, not live — but removing them means opening the
materialization and transfer seam (R4) for no behaviour the owner asked about.
Two tests record the dormancy rather than deleting the coverage: the transfer
identity test now expects `tabName: null, dotColor: null` beside a real
`workspacePath`, and `captureSession` expects `name: null`.

Rules: `DESIGN-LANGUAGE` §13's preamble (the anchored-popover genre has one
member left, the Prompt Board), DL-27.5 amended in place (the hover pair is one
button now), and §18's "removal from the strip, not deletion of the features"
note superseded for its `TabPopover` half — including the "⌘⇧R reaches nothing
in top-tab mode" consequence it recorded, which is moot now that the chord is
gone from both keymaps. Spec §6 amended, §2.2's four click destinations
unchanged — none of them was the popover.

**Evidence.** `npm test` at 15:39 on 2026-08-16 — my own files green
(`tab-manager` 186, `agent-rail` 24, `repository-rail` 21, `action-registry` 15,
`keymap` 89, `design-language` 9); `npm run generate:menu:check` green (the
action never had a menu item, so the generated menu did not move); `npx vite
build` green. `npm run build` does NOT pass right now and it is not this work:
`tsc` fails on `src/lib/derive-colors.test.ts`, a concurrent session's test for
a `deriveAccentIconColor` they have not written yet (that session also owns the
theme-vars, sidebar-actions, DockTabs and open-board-home failures in the same
run — files last touched 15:17–15:25 while this task was running). The
`file-tree-view` 10,000-row timeout remains the pre-existing one recorded above.

**Not established.** No `npm run electron:dev` pass and no owner eye review.
Renderer-only, so it reaches the Tauri host too, where nothing has been run.

## Opening a path an agent printed — 2026-08-20

Built from [the design](specs/2026-08-19-terminal-path-open-design.md) `decided`
in one pass, in its own sequence: detection, then routing, then the external-app
catalog, then ESLint's cross-line grammar last.

**What ⌘+click does now.** It asks the main process which open workspace root
holds the file. A root answers -> the file opens in **Deck's own editor**, as a
preview tab, revealed at the line and column the terminal printed. No root
answers -> it goes to the app selected on the toolbar, by that app's own
declared rule. There is no kill switch and no second chord: a path inside an
open workspace ALWAYS opens in Deck in v1, and ⌘⌥+click is the obvious later
addition if that proves wrong in use.

**Containment is decided main-process side**, in
[`workspace-for-path.ts`](../electron/fs/workspace-for-path.ts) `current`, and
this is the part that would have been a silent bug done the obvious way:
`resolve_paths` answers canonical (realpath'd) absolutes while the renderer
holds roots as the raw strings the user opened, so prefix-matching in the
renderer fails the moment a root is itself a symlink — the `/tmp`-on-macOS case
[`path-guard.ts`](../electron/fs/path-guard.ts) `current` already documents. The
new channel reuses `resolveInsideRoot`, so a ⌘+click passes exactly the guard
the explorer's reads and writes pass. It answers the root **as the renderer
spelled it**, never its realpath: every file-surface lookup is keyed by that
string, and handing back a canonical root would open a tab in a workspace the
store has never heard of.

**Four grammars were added to detection.** tsc's `path(340,15)` — the file
linked before, the LINE did not travel with it; the parenthesised suffix is
tried before the colon one because the colon form can match empty and would win
the alternation. A quoted path, which is both Python's traceback (`File
"src/x.py", line 12`) and the only route to a path holding a space, since the
quotes are a boundary the printer chose rather than one Deck guessed. git's
`--- a/src/foo.ts`, fixed in the RENDERER by emitting the stripped spelling as a
second entry in the same resolve batch and preferring the verbatim hit — doing
it in `resolveOne` would have to be mirrored in `links.rs` or become a host
parity gap, and it would reshape a payload R6 freezes. And ESLint's finding
rows, which name a position but no file: the row walks up to its header, and
**the header's raw text is part of the provider's cache key**, because
`12:5  error  no-unused-vars` is byte-identical under two different headers and
a cache keyed by the line alone would open the first file's document from the
second file's rows.

Two tradeoffs were taken rather than hidden. The quoted rule suppresses the
bare path inside a quoted PHRASE (`"look at src/foo.ts"` links nothing), which
is the price of supporting spaces at all; single quotes are deliberately not
matched, because an apostrophe in prose would pair with the next one and swallow
every path between them. And a candidate can now cost two resolve entries, so a
line caps at 48 rather than 24 — still inside the resolver's own batch cap of 64.

**The reveal is a stored request, not a call.** Monaco arrives through a dynamic
`import()`, so a click can land before the editor exists;
[`pendingReveal`](../src/files/file-surface-store.ts) `current` is written before
the tab opens and consumed by `FileEditor` after the model is attached. It is
gated on `document.file !== null`: on a cold open the model effect runs once with
an empty model while the read is still in flight, and revealing line 65 of
nothing would spend the request and park the caret at 1:1 for good. The tests
assert a MOUNTED editor's position rather than a store value, because the failure
this feature can have is exactly an editor that never mounts.

**The external app is a catalog, not a command.** Ten apps in four groups,
mirrored across [`src/lib/external-app-catalog.ts`](../src/lib/external-app-catalog.ts)
`current` and [`electron/external-apps.ts`](../electron/external-apps.ts)
`current` the way `electron/agents.ts` mirrors `BUILTIN_AGENTS`, with a
suite pinning the two halves together. Installed = the `.app` bundle exists, so
detection is a `stat` and needs no probe; the icon is the bundle's own `.icns`,
found through `CFBundleIconFile` and converted by `/usr/bin/sips` — which keeps
a dozen third-party logos out of the repo and keeps each one current when its
app updates (new DL-14.7). NOT `app.getFileIcon`, which the design named:
measured on 2026-08-20 (Electron 43.4.1) it returns the generic document icon
for every `.app` bundle, and `{ size: "large" }` crashes the process with
SIGTRAP. All 10 catalog apps on this machine resolve a real logo through the
`.icns` path, verified by running the compiled `listExternalApps` under a real
Electron main process and eyeballing the decoded PNGs. An app that is not installed is
ABSENT from the menu. Launching is `execFile` with argv — `/usr/bin/open -a
<bundle> <target>` — never a shell string, the rule `links.ts` already enforces.
The three editors keep the existing validated `open_editor` template, because it
is the only route that carries a line; `open -a` can name a file but never a
position in it.

**One setting replaced two.** `externalAppId` is what both the toolbar and
Settings write, so the chrome and Settings cannot disagree. `editorId`
`vscode`/`cursor`/`zed` migrate to the same catalog app; a stored `custom`
does not, and **the custom editor command stops being reachable** — a real loss,
recorded in `AGENTS.md`'s drift table rather than hidden. `EditorRow` was
deleted with its only call site; `editor-command.ts` and `open_editor` are
untouched, which is what keeps the Rust twin valid.

**Tauri keeps today's behaviour, and one flag is what makes that true.** The
first build of this got it wrong in a way no gate here can see: the facade
fails soft to an EMPTY list, an empty list read as "nothing is installed", and
a ⌘+click that opened VS Code yesterday would have raised an error bar on the
host users are still running. A host that cannot ANSWER is a third state, not
an empty machine. `external-apps-host.ts` exports the same
`window.__deckHost` presence flag [`worktree-host.ts`](../src/host/worktree-host.ts)
`current` already uses — Electron true, Tauri and browser dev false — and
`resolveExternalApp` takes it: unanswered means the selection is taken at its
word, an editor keeping its own validated template and anything else falling
back to VS Code's, because that template is the only thing that host can
launch. The same flag gates the button, which is why the catalog fallback
inside `externalAppChoices` stays Settings-only: the picker has to remain
usable where nothing answers, the button must not render ten rows whose clicks
all fail.

**The split-button is a new control shape** (new DL-23.11): the app's own icon
opens the active tab's workspace, a caret beside it changes which app that is.
It renders immediately before `More` and is absent entirely where nothing is
installed — which is every Tauri build, since `external_apps` is Electron-only.

**Evidence.** `npm test` at 00:34 on 2026-08-20: **3356 passed, 8 failed**, and
**none of the eight is this work**. Seven belong to a concurrent session's
uncommitted `agent-catalog.ts` / `launch-command.ts` (files last written
2026-08-19 18:04–18:05, six hours before this session opened; every failure is
`claude --dangerously-skip-permissions` where the test still expects `claude`),
and the eighth is `shortcut-groups`'s `toggle-sessions`, from the same session's
`action-registry.ts` (18:19). An earlier run at 00:24 had a ninth,
`search-bar.test.ts` — the standing full-suite flake, 23/23 alone and green in
the run above. The two failures this work DID cause were fixed inside it:
`settings-screen`'s row census (`Editor` -> `Open with`, still 18 rows) and
`design-language`'s citation gate (DL-23.11 had to be declared before it could
be cited). `npm run build`, `npm run electron:build` and
`npm run generate:menu:check` all exit 0.
Targeted suites: `terminal-links` 33, `link-provider` 17, `link-target` 12,
`eslint-positions` 9, `external-apps` 14, `workspace-for-path` 6, `file-editor`
14, `electron-ipc-contract` 7, `design-language` 15, `icon-system` 6.

**Not established.** No `npm run electron:dev` pass: nothing here has opened a
real file at a real line, reached a real app, or shown a real icon. No owner eye
review of the split-button (DL §9.6). Windows detection, launching and icons are
**Gate C — unverifiable here**, and `listExternalApps` returns empty off macOS
by design rather than guessing at bundle layouts. Detection is renderer-only and
reaches BOTH hosts; routing degrades on Tauri to exactly today's behaviour
(no workspace ever claims a path, so every ⌘+click goes out through
`open_editor`), which has also not been run.

## One tag ships two platforms, and Gate A is closed for macOS — 2026-08-20

**Gate A is CLOSED for macOS.** The owner ran a real auto-update check against
the published `v0.12.5-electron.2` on 2026-08-19 and it worked end to end —
signed, notarized, Squirrel.Mac accepted the handover. Earlier sections above
that record Gate A as open were true when written and stay as written; this
section is the correction the
[stable-release spec](specs/2026-08-20-electron-stable-release-design.md)
`decided` demanded before the tag. Gate C (real Windows hardware) stays open,
and the owner elected to ship Windows without runtime verification.

**The two-platform release pipeline is built, per the spec and its
[plan](plans/2026-08-20-electron-stable-release.md) `building`, plus the three
parts of the
[workflow design](specs/2026-08-20-development-contribution-release-workflow-design.md)
`draft` the owner adopted the same day** (reviewed CHANGELOG notes, the
tag-ancestry gate, the run summary — the rest of that document stays a draft
for review). [`electron-release.yml`](../.github/workflows/electron-release.yml)
`current` is four jobs — `prepare` (refuses a tag not reachable from
`origin/main`, validates both `build/vX.Y.Z` and `build/vX.Y.Z-electron.N`
against the package version, one source gate, the draft), `mac` (the shipped
sign/notarize/verify job, plus its own renderer build since the gate now runs
on ubuntu), `windows` (unsigned nsis x64, publish only, `shell: bash` +
`set -euo pipefail` because pwsh only fails a step on the LAST command's exit
code), `promote` (all six served assets or the release stays a draft; final
notes = the fixed unsigned/unverified/no-Intel header plus the tagged commit's
`## <version>` section of [`CHANGELOG.md`](../CHANGELOG.md) `current` for a
stable tag — missing section fails the promote — or the generated commit list
for `-electron.N`; `--latest` for stable, `--prerelease` for prerelease; a
`$GITHUB_STEP_SUMMARY` page naming source, channel and assets).
[`release.yml`](../.github/workflows/release.yml) `current` is
`workflow_dispatch`-only — Tauri is retired from tag triggers, the freeze job
stays as defense-in-depth.
[`electron-builder.release.yml`](../electron-builder.release.yml) `current`
gained the win/nsis blocks under the SHIPPING identity (`dev.spacevibe.deck` /
`SpaceVibe Deck`), so the installed Windows `Deck Electron` preview.2 that
auto-updates into it gets a new side-by-side app with fresh userData — a
consequence of fork F1, stated in the config comment. `package.json` is
`1.0.0` — the owner named the stable a V1 (2026-08-20), not a `0.12.x`
increment. Stable outranks both `0.12.5-electron.2` and the Windows preview's
`0.12.4-electron-preview.2` under semver, and both installed shapes reach it
(the preview hardcodes the GitHub feed and `allowPrerelease` defaults true for
a prerelease version — moot for a `--latest` stable anyway).

**No macOS preview ever shipped publicly** (owner, 2026-08-20): the landing
page still says "coming soon", so this stable is the first public macOS
release and no "preview users must reinstall" note is needed. The landing page
swap to real download links happens AFTER the release is public.

**1.0.0 SHIPPED the same day.** Tag `build/v1.0.0` was cut twice. The first
run (32382369994) had prepare, mac and windows green and died in `promote`
with empty `TAG`/`CHANNEL`: `promote` listed `needs: [mac, windows]`, and
`needs.<job>.outputs` resolves only for DIRECTLY listed jobs — worse, an
empty tag made `gh release view ""` quietly audit the LATEST release (the
Tauri v0.12.3) instead of the draft. Nothing went public, which is the
fail-closed design doing its one job. The fix (`775a9a1`, cherry-picked
through a clean worktree because the shared tree carried the landing
session's dirt) names `prepare` a direct need, refuses empty outputs at the
top of the census, and pins both in the guard test. The second run
(32383647050) went green end to end: **`SpaceVibe Deck 1.0.0` is public,
`releases/latest`, eight assets served** — dmg + blockmap, mac zip +
blockmap, `latest-mac.yml`, setup.exe + blockmap, `latest.yml` — with the
CHANGELOG section as its notes under the fixed limitations header. The
pre-tag gates ran on the release commit: `npm test` 3391/0 (after 10 stale
expectations from three peer sessions' shipped features were caught up and
`toggle-sessions` was placed in the App shortcut group), `npm run build`,
`generate:menu:check`.

**Still unverified after the ship:** the electron.2 → 1.0.0 update hop on a
real Mac (the owner's verified hop was prerelease → prerelease); everything
Windows — install, SmartScreen, self-update (Gate C, unsigned by decision);
Intel Mac and Windows ARM are not served. `GRAB_PASTE_DISABLED` and the
preset rename/delete gap shipped knowingly, per the freeze decision.

## Development, contribution, and release governance — 2026-08-20

The [workflow design](specs/2026-08-20-development-contribution-release-workflow-design.md)
`building` is a draft for owner review. It joins the repository's previously separate
development, contributor, verification, release, and update-notification paths into one
contract: short-lived branch or fork → PR → required Ubuntu/macOS/Windows checks → owner
review → squash merge into a protected `main` → explicit release PR and `build/v…` tag →
atomic two-platform promotion.

**Nothing in that governance design is active yet.** GitHub reported no branch protection
and no ruleset for `main` on 2026-08-20; the existing `check` and `windows-check` baseline is
red; `macos-check` does not exist; and the two-platform Electron release workflow in the
shared tree is uncommitted and has never run. The first adoption gate is a green `main`, not
turning on protection around known-red contexts.

## A project cluster goes where the user puts it — 2026-08-22

Built from the [rail workspace reorder spec](specs/2026-08-22-rail-workspace-reorder-design.md)
`decided`; the rule is new DL-27.20.

The rail's project clusters sat where their oldest tab put them and the
remembered tier below them sat in MRU order, so a project that matters every
day could sit fourth because it was opened fourth, and a project deliberately
parked at the bottom climbed back the moment it was touched. The header is now
the whole cluster's drag handle, and the position survives the transition the
owner named: the cluster's last tab closing.

**The load-bearing decision is an identity that outlives the tier.**
`RailStreamGroup.key` is `scan.key` while a project is live and
`remembered:<that same key>` after its last tab closes, so storing positions
against it would lose the position in exactly the case the feature exists for.
`RailStreamGroup.orderKey` is the un-prefixed key, PRODUCED by both branches
rather than derived by stripping a prefix, and
[`rail-order.ts`](../src/ui/rail-order.ts) `current` stores against it and
nothing else. Two worktrees of one repository already fold into one cluster, so
they share one position; a folder git does not know is identified by its path,
so moving or renaming it loses its slot — accepted, there is no other identity.

**`orderKey` is not stable until the scan lands**, which is why
`applyRailOrder` takes the scan map and not the list alone. Before a history
path's scan arrives its cluster reports `plain:<path>`; afterwards the same
cluster reports the repository key. A `railOrder` entry therefore matches on
either spelling, and every `plain:<path>` the scan map can now resolve is
rewritten on WRITE, duplicates collapsing to the first occurrence — the list
canonicalizes itself as scans arrive instead of accumulating both spellings.

**A pinned cluster ignores the live/remembered boundary**, which knowingly
breaks 2026-08-20's "live work first, remembered after": the owner asked for a
position, not a position within a tier. Unpinned clusters keep the boundary
exactly, and with an empty `railOrder` the model returns the stream it
assembled — the same array, asserted as identity, so a rail nobody has dragged
is byte-for-byte what it was.

**A drop pins everything above it too.** Without that, a project dragged to
slot 2 would be pushed around by the open order of whatever sits in slot 1,
which is the ordering the user just overruled. Clusters BELOW stay unpinned.
The stored list drops nothing on its own — an entry naming no visible project
is the memory that brings a parked project back — so it is capped at
`MAX_RAIL_ORDER = 200`, pruned from the END and only of entries naming nothing
on screen.

**Only the cluster drags.** A tab row, a pane row and a tab row moved between
clusters are all excluded on the owner's instruction, and that exclusion is
what keeps the change off the tab strip: the strip and the rail share one order
key by contract, and that contract is about TABS
([`strip-order.ts`](../src/lib/strip-order.ts) `current`). The strip has no
notion of a project cluster, so reordering clusters is invisible to it. No
`openedAt` value is rewritten anywhere, and no R4 seam moves.

The interaction is pointer events with the repo's 5px threshold, not HTML5
drag-and-drop. ONE controller for the whole list by delegation, not one per
header: a header re-renders whenever an agent says something, so a per-element
controller would be disposed mid-drag. The collapse toggle shares the surface
(it carries nearly the whole header) and keeps its `click` below the threshold;
the `+` and a remembered cluster's remove control never start a drag. The ghost
and the insertion line are `document.body` children for the reason every drag
controller here gives. Escape abandons, a drop in place writes nothing, and the
settings write is one per completed drop. Settings are app-level, so a drag in
one window reorders the rail in every window — named rather than avoided, the
way `sidebarWidth` and `sidebarCollapsed` already behave.

Renderer-only, so it reaches BOTH hosts. **Unverified:** no `npm test`, no
`npm run build`, no `npx tsc --noEmit`, no design-language gate run, no
`electron:dev` or `tauri dev` pass, and no owner eye review — the gates the
spec §9 names have not been run in the session that wrote this. Cross-window
dragging is the owner's phase 2 and out of scope; there is no keyboard
equivalent for reordering, which is a named gap.

## Verification state ledger

Full evidence behind [`../AGENTS.md`](../AGENTS.md) `current`'s "Chưa khớp thực tế" table.
That table keeps the claim, its intent label and its status; the evidence prose lives here so
the always-loaded file stays small.

| Claim                                                                   | Intent     | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron can replace Tauri on both supported platforms                  | `building` | partial    | Gate A is CLOSED for macOS: owner-verified auto-update against `v0.12.5-electron.2`, 2026-08-19. Gate C still lacks a real Windows run, and the owner elected to ship Windows unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Deck ships the Electron host                                            | `current`  | done       | `SpaceVibe Deck 1.0.0` (Electron) is public and `releases/latest` since 2026-08-20 — run 32383647050, four jobs green, eight assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| One pushed tag ships macOS and Windows, both self-updating              | `current`  | partial    | Shipped 2026-08-20 per the [spec](specs/2026-08-20-electron-stable-release-design.md) `decided` — run 32383647050 green end to end after the maiden run's promote fix. The electron.2 → 1.0.0 update hop and all Windows behaviour (install, SmartScreen, self-update) are unwitnessed; Windows is unsigned by decision (Gate C); preview.2 on Windows updates into a side-by-side install; Intel Mac and Windows ARM are not served                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pane detach is complete cross-platform                                  | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| File explorer is available                                              | `decided`  | backlog    | Surface built 2026-08-14 after the historical Gate M run, then reshaped the same day. Gate M was retired as current acceptance on 2026-08-23; the maintained packaged Monaco smoke proves packaging mechanics only. Owner eye review, packaged both-layout pass and native macOS sign-off remain owed. Electron only, no Tauri implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The browser tab works everywhere Deck does                              | `building` | partial    | Electron-only; no Tauri implementation exists. The 2026-08-15 tab-on-stage reshape is verified by suite/build only — native `electron:dev` pass and owner eye review owed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AgentQuickPicker's wired flow is native-verified                        | `building` | unverified | Built and wired 2026-08-14; visual design eye-approved via a gallery specimen only — no native `npm run electron:dev` click-through or owner eye review of the wired flow itself yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sidebar collapse and drag-to-close are native-verified                  | `building` | unverified | Landed 2026-08-16 (DL-18.9; DL-19.4 amended). Suite/build plus a browser (`npm run dev`) measurement of the hide, the drag and both controls — no native `electron:dev` pass, no owner eye review of either surface. The renderer is shared, so the sidebar seam reaches the Tauri host too, where nothing has been run; the Windows collapse floor is unverified (Gate C)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The unified tab strip is native-verified                                | `building` | unverified | Landed 2026-08-16 (new DL-18.10): one chip shape, one row, open order, and the keyboard counting chips. Suite/build plus a gallery screenshot of the merged strip — no native `electron:dev` pass and no owner eye review of the running app. Renderer-only, so it reaches the Tauri host too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The side panel's three tabs work                                        | `building` | unverified | Landed 2026-08-16: the docked column became a tab host (file explorer / token usage / session history) and the rail grew an action footer. Explorer and usage: suite/build evidence only — no native `electron:dev` pass, no owner eye review, no gallery specimen, and both were reshaped for a 360–560px column they have never been seen rendered in. **Session history is the exception since 2026-08-16:** it was rendered natively against this machine's real corpus (794 rows, 717 brand marks, 794 `Resume` controls) and measured at dock widths 360 and 520 with zero horizontal overflow — but that is a machine's reading, not the owner's eye, and Windows stays unverified (Gate C). Session history still sits on `src/ui/sessions/`, an untracked copy of an unmerged branch                                                                                                                                                                                                                                                                                                                                      |
| Session restore resumes agent conversations                             | `building` | unverified | Landed 2026-08-15, suite/build evidence only (`npm test` 2619 green); no native macOS run, no owner eye review of the rail row; Windows unverified (Gate C); gemini/agy are best-effort by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The agent rail replaces the repository rail                             | `building` | partial    | Landed 2026-08-16 and reshaped through DL-27.12/spec §2.7: the rail is project → tab only, with 34px flat rows, direct pane-focus glyphs, no tab disclosure or nested pane rows, one project-level collapse, and the same header for singleton and multi-tab projects. Targeted rail/design tests pass 70/70; production build, Electron build, menu check and diff check exit 0. An isolated native Electron window restored four live tabs across two projects and measured two headers, zero tab disclosures, zero pane rows and zero horizontal overflow, with open/collapsed screenshots captured. The owner has not eye-approved that screenshot; Tauri and Windows are unverified. The last full-suite run is red from the repository-wide Phosphor/Vitest QName fault (2,574 pass, 277 fail), not from a rail assertion. `RepositoryRail` stays parked until the owner review closes the replacement gate                                                                                                                                                                                                                  |
| The rail row shows the agent's newest turn                              | `building` | unverified | Tier 3 (`session_tail`) landed 2026-08-17 (new DL-27.15), then the same day the turn took the agent name's slot so every row is one line, and the tab strip's chips print the same sentence (DL-18.10/DL-20.1 amended). Suite evidence: rail, strip and design-language suites green, plus gallery screenshots at 276px — every row 34px, chips 2px/11px/≤210px. `claude`, `codex` and (since later that day) `opencode` produce a real tail; `gemini`, `agy` and custom agents keep the name. `npm run build` clean; the four owning suites 95/95; the full suite's 4 failures at 15:57 all belong to a concurrent session in the same checkout. **No native `electron:dev` pass and no owner eye review of either surface.** Electron only for the tail itself; the one-line shape is renderer-only and reaches Tauri, where nothing has been run                                                                                                                                                                                                                                                                                |
| The blurred modal scrim is native-verified                              | `building` | unverified | Landed 2026-08-16 with DL §29 and DL-1.3's `backdrop-filter` exception. Suite/build plus a browser measurement — the gallery specimen photographed over a synthetic terminal ground, which is where `blur(10px)` was chosen over 6px and 14px. A gallery is a browser, not a host: how the blur composites in a packaged app over a real xterm canvas is unverified, and the frugality claim behind the exception (a transient compositing layer) is reasoned, never profiled. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The collapsed feature toolbar is native-verified                        | `building` | unverified | Landed 2026-08-16 (new DL-23.8): the pane group moved off the bar into `More`, leaving one `Ellipsis` control at the stage strip's trailing end. Suite/build evidence only — no native `electron:dev` pass and no owner eye review of the running toolbar or of the menu in top-tab mode, where the pane group and the DL-28.4 rows share one popover for the first time. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dragging `New` onto a pane docks an agent pane there                    | `building` | unverified | Landed 2026-08-16 (new DL-27.14). Suite/build evidence: the drag controller's 9 cases, `dropAgentPane`/`activeSlotRects`'s 6, `agentForWorkspace`'s 8, `npm run build`, `npm run electron:build` and `generate:menu:check` all green. **Nothing here has been dragged by a hand**: every drop is a synthesized pointer sequence against fabricated rects, so the drag has never been seen over a real xterm canvas, over a `WebContentsView` or the Settings screen (where the inert path matters most), or over a zoomed pane (where the slot list collapses to one rect). No owner eye review. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The quick picker opens into a chosen worktree                           | `building` | unverified | Landed 2026-08-16 (new DL-29.7). Suite/build plus a gallery specimen — **no worktree has actually been opened into**: every test feeds `worktreeDestinations` a fabricated scan, so nothing here proves `git_repository`'s real output resolves to the destinations the row lists, nor that a tab tagged with a chosen worktree files under the right rail row. Electron-only in effect; the row is omitted on Tauri, which has no such channel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| One click on the open board opens the workspace                         | `current`  | unverified | Landed 2026-08-16 with the config view's deletion. Evidence is one gate: `npx tsc --noEmit` exits clean over the whole tree. **No `npm test`, no `npm run build`, no native pass** — the board's suites were rewritten in the same pass and have never executed. Unproven by anything: that the awaited probe actually closes the fast-click race in a real window, that a remembered `null` agent opens a Shell rather than an agent, and that the notice line is the only reachable failure surface. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The icon set is Phosphor everywhere                                     | `current`  | unverified | Swapped 2026-08-16 (DL-1.1's exception moved, DL-14.1 rewritten): `lucide-preact` uninstalled, 41 source files and 31 class assertions rewritten, `.lucide` → `.deck-icon`. Evidence is `npx tsc --noEmit` alone — **no `npm test`, no `npm run build`, no native pass**, and DL-1.1's gzip ceiling has not been re-measured against the new package (§10 ledger). The owner eye-reviewed a gallery specimen and picked `regular` from it, but four marks were chosen AFTER that review and have never been seen rendered: `GitFork`, `FolderDashed`, `TreeView` and the mirrored dock toggle. Renderer-only, so it reaches the Tauri host too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A preset can be renamed or deleted                                      | `current`  | **false**  | Was true until 2026-08-16 and is now unreachable: the layout cards were the only call sites of `renamePreset` / `deletePreset`, and they went with the config view. `presets-store` still exports both. Creating (⌘⇧N / menu) and overwriting (⌘⇧S) still work. Named and accepted at removal time, not an oversight — restoring it needs a new home, most likely a settings section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The neutral chrome ink is native-verified                               | `building` | unverified | Landed 2026-08-17 (new DL-3.6; DL-2.3's hairline carve-out closed). The four built-in `foreground` literals became luminance-matched grays and `--hair`/`--hair-strong` moved from `--fg` to `--tone`. Evidence: `npm test` 3009/3011 (both reds are a concurrent session's uncommitted `agents-section` / `prompt-popover` work, files last written 2026-08-16 23:34, zero theme references), `npm run build` clean, and a Chrome pass against the running `prototype:gallery` reading the live `--fg`, `--hair` and `--text-*` values and photographing the window-chrome specimen under two palettes. **No `electron:dev` pass, no `tauri dev` pass, and no owner eye review** — a browser harness is the weakest evidence class there is for a colour decision. Renderer-only plus a data change, so it reaches both hosts. See [the section above](#chrome-ink-goes-neutral--2026-08-17) `current`                                                                                                                                                                                                                            |
| A multi-agent tab's frame is native-verified                            | `building` | unverified | Landed 2026-08-20 (new DL-27.19): a rounded `--hair-strong` outline closes the rows of one multi-agent tab, drawn on the `data-headless` seam `PANE_TREE_HIDDEN` already produces — CSS only, no component or model change. Shipped first with a bled border, which put 255px of content in the 254px rail list and shifted the sidebar in the owner's running app; redrawn as an `outline`, whose left stroke the list clipped, and finally as DL-1.3's inset hairline, which paints inside and joins no layout. Evidence: `design-language` + `agent-rail` suites 57/57, a browser measurement showing `scrollWidth === clientWidth` (254px) and a framed row landing on the same x as an unframed one (287px both), and a screenshot of the real rail. **No full `npm test` and no `npm run build`** — a concurrent session's `terminal-links.ts` is mid-edit and red under `tsc`, so neither can be attributed cleanly. No `electron:dev` pass, no `tauri dev` pass, no owner eye review. Presence chrome, so Electron in effect; Tauri keeps the flat rows. See [the section above](#one-tab-one-frame--2026-08-20) `current` |
| The new chrome typography and the stateless toggles are native-verified | `building` | unverified | Landed 2026-08-16: group labels went to 14px `--text-muted` (DL-4.4/DL-3.4) and `.iconbtn.is-active` was deleted (DL-21.8). Evidence is `npx tsc --noEmit` clean plus CSSOM/computed-style measurements taken in `npm run dev` — the group labels read 14px/560/muted, `.iconbtn.is-active` is absent from the stylesheet, and a collapsed sidebar leaves its button transparent with `aria-pressed="true"`. **No suite run and no owner eye review**: every component test that draws an icon is currently red under vitest with `InvalidCharacterError: "[object Object]"`, which predates this work and belongs to the in-flight Phosphor migration. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                         |
| Opening a path an agent printed is native-verified                      | `building` | unverified | Landed 2026-08-20 (new DL-14.7, DL-23.11; three new Electron-only channels; `editorId`/`editorCommand` replaced by `externalAppId`). Evidence: `npm test` 3356/8 with all eight failures attributed to a concurrent session's uncommitted `agent-catalog.ts`/`action-registry.ts`, `npm run build`, `npm run electron:build` and `generate:menu:check` all clean, and 133 targeted assertions across the ten owning suites. **Nothing has been clicked in a running host**: no file opened at a real line, no app launched, no bundle icon ever rendered. No owner eye review of the split-button. Windows is Gate C, and `listExternalApps` answers empty off macOS by design. Detection reaches both hosts; routing degrades on Tauri to today's `open_editor` behaviour, also unrun. See [the section above](#opening-a-path-an-agent-printed--2026-08-20) `current`                                                                                                                                                                                                                                                                                                      |
| Ctrl+C copies or interrupts on Windows                                  | `building` | unverified | Landed 2026-08-20 (new module [`action-performable.ts`](../src/terminal/action-performable.ts) `current`; `copy-or-interrupt` is the 53rd registry action). Evidence: `npm test` 3375 passed / 10 failed with every one of the ten reproduced identically on a pristine `HEAD` worktree (three other sessions' in-flight work — agent launch-command strings, the rail's remembered-projects model, `toggle-sessions` absent from `PLACEMENT`), `npx tsc --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`, `npm run build` and `npm run generate:menu:check` all clean, plus 4 new chord tests driving the real capture-phase `window` listener. **The Ctrl+C keystroke has never been pressed on Windows (Gate C)**, and no host run or owner eye review has happened. Renderer-only, so the mechanism reaches both hosts; macOS is untouched by design. See [the section above](#performable-keybindings-and-ctrlc--2026-08-20) `current` |

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                                                  | Intent    | Status         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Code comments no longer cite `FR-…` … or `ADR …`" (History note)      | `current` | `contradicted` | 3 comments remain, all `FR-032`: [action-registry.ts](../src/terminal/action-registry.ts) `current` and two in [tab-manager.chord-actions.test.ts](../src/terminal/tab-manager.chord-actions.test.ts) `current`. The `FR-025` / `ADR 0028` citations this row used to list are gone — the Rust ones with the 2026-08-16 comment sweep, and `open-board.tsx`'s with the config view it sat in                                                                                                                                                                                                                |
| "Deck renders the Native balanced treatment on screen"                 | `current` | `unverified`   | Landed 2026-08-16 in the shared renderer. Evidence: `npm test` 2710 passed / 1 failed of 2711 (the one red pre-dates this work), `build` / `generate:menu:check` / `electron:build` exit 0, plus a `npm run prototype:gallery` browser pass (type variables resolve at 14 / 12.5 / 11 / 10.5px, 72/72 contrast cells safe, no compact-width overflow) — but that is a dev harness on stub IPC, not the app. **No owner eye review**, no `npm run electron:dev` pass. Packaged runtime not claimed; Windows unverified (Gate C). See [the section above](#the-native-balanced-rollout--2026-08-16) `current` |
| "Both docked seams close by drag, and the sidebar collapses to a rail" | `current` | `unverified`   | Landed 2026-08-16 (new DL-18.9, DL-19.4 amended). Evidence: `npm test` 2804 passed / 1 failed of 2805 (the one red outside this work), `npm run build` and `npm run generate:menu:check` exit 0, five new/extended suites, and a Chrome pass against `npm run dev` measuring the collapse, the drag and both controls. **No owner eye review**, no `npm run electron:dev` pass, no `npm run tauri dev` pass though the code is shared with that host. Windows collapse floor unverified (Gate C). See [the section above](#panel-seams-that-close--2026-08-16) `current`                                    |
| "One click on the open board opens the workspace"                      | `current` | `unverified`   | Landed 2026-08-16 with the config view's deletion. Evidence: `npx tsc --noEmit` clean over the tree, and nothing else — **no `npm test`, no `npm run build`, no `npm run dev` pass, no `electron:dev` pass, no owner eye review**. The board's three suites were rewritten in the same pass and have never run. Renderer-only, so it reaches the Tauri host too, where nothing has been run. See [the section above](#the-open-board-stops-asking--2026-08-16) `current`                                                                                                                                    |
| "A preset can be renamed or deleted"                                   | `current` | `contradicted` | True until 2026-08-16. `renamePreset` / `deletePreset` are still exported from [presets-store.ts](../src/presets/presets-store.ts) `current` and have no caller: the board's layout cards were the only one. Create (⌘⇧N) and overwrite (⌘⇧S) are unaffected. Disclosed and accepted when the config view was removed                                                                                                                                                                                                                                                                                       |

The historical comment drift was found on 2026-07-27. The delivery-state drift
found by the [2026-08-01 audit](review/2026-08-01-doc-drift.md) `current` was
resolved the same day by rewriting the Delivery state bullets above.

Gates W1-W4, the real-device checklist, screenshots, and signed distribution are
NOT listed above: per the docs convention, `decided`/`building` claims are
backlog rather than drift. They are tracked in the Delivery state bullets above,
and no pending gate is inferred as passed.

The 2026-07-30 pre-ship audit's code blockers (A1-A8) were remediated on
2026-07-31; the `current` claims above were re-checked against that code. The
audit's delivery blocker B1 (no installer can be produced from a public repo)
was overtaken on 2026-07-31 by the published prerelease; B3 (gates never run)
still stands and remains in the Delivery state bullets.

Known residuals from that remediation, recorded here so they outlive the working
notes — none contradicts a `current` claim above, so none is a drift row:

- The remediation now RUNS on Windows in CI, not only on macOS: run 30613282200
  (2026-07-31, `windows-check`) executed 125 Rust tests on `windows-latest` —
  124 passed, and the one failure was the UNC assertion replaced below. That run
  carries the first real-host proofs of the branch: Windows PowerShell 5.1 parses
  the prompt integration and emits a real ESC byte, and a Job Object tracks and
  releases a grandchild process (Gate W3). Overtaken 2026-08-01: the preview
  installer is published and was field-installed by an end user; structured
  manual QA has still not run.
- `has_rejected_root` rejects UNC and verbatim roots, not mapped drive letters. A
  stale `Z:\` still reaches the filesystem — the audit's own "non-adversarial"
  example, missed by both the audit's code analysis and the remediation plan.
- `builds_profile_loading_prompt_integration` is a substring check on the Rust
  literal, so it cannot tell a working prompt from a broken one: renaming
  `Global:prompt` reproduces the original A1 failure with the suite green.
- Clickable UNC links were GIVEN UP for the A3 guard, deliberately and with a
  cost. `\\localhost\C$\...` resolved on Windows and CI proved it green until
  2026-07-31; `resolve_one` now shares `has_rejected_root` with
  `retain_valid_cwd`, so any `\\` root returns `None` before the filesystem is
  touched. The trade: hovering is passive and unintentional, while a probe into
  a host that terminal output named stalls the resolve on an unreachable share
  and offers the interactive user's NTLMv2 credentials to whoever chose that
  name. A UNC path stays copy-pasteable; mapped drive letters are unaffected
  (and still unguarded, per the residual above)
  ([resolve_one](../src-tauri/src/links.rs#L83-L104) `current`).
