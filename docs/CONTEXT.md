# SpaceVibe Deck — working context

## Docs layout

- `docs/DESIGN-LANGUAGE.md` — canonical rulebook for chrome UI: tokens, color
  roles, typography, motion, copy. Rules are numbered (`DL-3.2`) and cited from
  code comments. Single source of truth for the app's visual language.
- `docs/specs/`, `docs/plans/` — per-feature design notes and implementation
  plans, dated `YYYY-MM-DD`.
- `docs/review/` — audit and drift-review findings.
- `docs/intent/`, `docs/archive/`, `docs/CONTEXT-archive.md` — historical
  material, kept for provenance, not authoritative. **The full, uncompacted prose of
  every entry below lives there**: this file was compacted on 2026-08-22 and each
  entry keeps its decisions, its reasons and its verification state, not its
  original length.
- Domain glossary: repo-root `CONTEXT.md`.

## The board stops running an agent it did not name — 2026-09-04

A recents row printed its remembered agent unconditionally
(`describeCombo`) and then opened whatever happened to stand first on `$PATH`
if that agent was gone: `resolveAgentChoice` ended in
`return agents[0]?.id ?? null`, with a bare shell as the last resort. One
click, the wrong agent, nothing said — and on a machine with no agent CLI at
all, which is the first run of anyone who installs Deck before installing an
agent, a plain shell with no explanation. The board already owned a notice
line (`.board-home__notice`) and used it for a folder that had vanished; this
case never reached it. `AgentQuickPicker` had handled the same failure
correctly since 2026-08-19 — `is-missing`, `not on $PATH; opens Settings`, and
a route to Settings instead of a launch — so one bug had two opposite
behaviours in one app (MXR-7, from MXR-5's UX review).

**A resolution now says what it DID, not just what it produced.**
[`resolveAgent`](../src/lib/workspace-recents.ts) `current` answers one of
three kinds: `chosen` (the remembered agent runs, an explicit Shell-only
memory, or a folder with no memory taking the first detected agent — a row
that promised nothing cannot be contradicted), `substituted` (naming the id it
could not honour), or `shell-fallback` (nothing runnable at all, `wanted` null
on a first run). `resolveAgentChoice` survives as the id-only call for
`agentForWorkspace`, whose caller — the `New` row dropped onto a pane — has no
surface to say anything on.

**The board asks instead of substituting.** A non-`chosen` resolution is held
as a `PendingOpen` payload rather than launched: the sentence names both
halves ("Claude Code is not installed — this workspace will open with Codex
instead."), and `Open anyway` / `Manage agents…` stand under it in a
`role="alert"` block. The payload carries the resolved agent, so a discovery
refresh landing between the question and the answer cannot swap the agent out
from under the sentence the user just read. Clicking another row clears it —
a stale `Open anyway` must never open a workspace nobody is looking at — and
so does `Manage agents…`, whose whole point is that the answer is about to
change. The question is raised on **home** even when the launch came from the
worktree form, which would otherwise ask behind a subview and simply never
open.

Two smaller consequences. The row says it BEFORE the click: `staleAgent`
prints `Not installed` in `--yellow` (DL-3.2 — attention a person must act on,
one step below `--red`, which is right because the workspace still opens), and
says nothing at all until discovery has answered once, so an unanswered probe
cannot mark every row. And an agent switched OFF in Settings is a substitution
too, because `agentOptions` already drops it — the user's remembered pick
cannot run either way.

Friction is bounded by the recents write: a first open with nothing installed
records `lastAgent: null`, an explicit Shell memory, which resolves `chosen`
forever after. So the plain-shell question is asked once per folder, and only
while no agent CLI exists.

A medium code review over the first commit found five real defects, all in
how the board HELD the question rather than in the resolver, and all fixed
before the branch stood: the decision read a discovery list snapshotted at
mount, so the `Manage agents…` → install → Refresh → Back recovery this change
invented did not actually work (it reads the live `detectedAgents` signal now,
and asks the cache again on every click — Settings' own Refresh writes that
store, and this board is still mounted underneath Settings); the
missing-folder early return fired BEFORE the question was cleared, leaving two
messages on screen with `Open anyway` pointing at a workspace nothing named;
`openWorktreeForm` and `removeRecentRows` did not clear it either, so it
survived a trip to the worktree form or the deletion of its own row; the
confirmed launch skipped the liveness check the first click had passed, so a
folder that went away while the question stood could still be spawned into;
and both the sentence and the badge said "is not installed" for an agent that
was merely switched OFF, contradicting the catalog the button leads to.
`unavailabilityOf` now separates the two — `Turned off` /
`is switched off in Settings` against `Not installed` / `is not installed` —
and the badge and the sentence are built from ONE reason, so the row and the
decision line cannot disagree. Fixing that surfaced a sixth, mine: the home
view still hard-coded the badge text while `staleAgent` had started returning
it, rendering `title="Turned off is not installed"`.

**No new DL rule** — the block is built from DL-3.2's yellow, DL-1.3's inset
hairline, DL-3.1's accent on the acting control and the board's own
`.gsep button` text-action shape. Renderer-only, so it reaches BOTH hosts.
Verified by `npm test` (3887 passed, 0 failed), `npx tsc --noEmit`,
`npm run build`, `generate:menu:check`, the design-language gate and 21 new
assertions across `open-board.views` and `workspace-recents` — but **no
`electron:dev` or `tauri dev` pass and no owner eye review**: no substitution
has been confirmed in a running app.

## The rail marks the agent holding the keyboard — 2026-08-23

The owner sent a screenshot of the rail and said there was no active item in
it. There was not. DL-27.8 puts the selection wash on `.asr-row--tab`, and a
tab running several agents renders **headless** — DL-27.13, "it marks selection
with nothing" — so a window whose active tab held three agents drew a column of
framed rows with nothing selected anywhere. A shell or single-agent tab still
lit up, which is why the gap read as arbitrary rather than absent.

Two things were missing, not one. The first is the rule: DL-27.22 gives the
focused pane's row **DL-21.1's own wash**, `--tab-active-bg`, so a one-agent tab
marks its ROW and a several-agent tab marks its LEAF. That is deliberately not a
second signifier — the rail still shows exactly one selected thing, and the two
cases read as one language. Reversing DL-27.13's clause is safe because that
ruling was made while the pane TREE was on screen and meant _nothing covers the
tree_: with the tree behind `PANE_TREE_HIDDEN` a leaf IS a row, so washing it
covers no guides and reinstates no tree.

The second is that **nothing in the renderer knew which pane held the
keyboard.** `TabView`/`PaneView` carried no such field, and the manager's
`activePaneId()` was read only by the close coordinator.
[`PaneView.focused`](../src/terminal/tabs-store.ts) `current` is that id
projected per pane inside `syncViews` — one comparison, since the id is already
read there for the header info — and
[`ManagerCallbacks.onActivePaneChange`](../src/terminal/terminal-manager-types.ts)
`current` is what tells the tab layer the id moved. The existing focus paths
could not stand in for it: `onPaneFocus` is suppressed while `focusPane` drives
the focus (so a rail click never reached it), it is gated on the window being
foreground, and its one consumer syncs only when `tracker.acknowledge` returns a
CHANGED snapshot — `null` for a pane with nothing latched, which is the ordinary
case. `activateForAttention`'s same-tab branch returns before its own
`syncViews` for the same reason it was written: it must not ack a second pane.
Firing from `setActive` instead covers every FOCUS path at once — a user click,
a rail click, ⌘-navigation — and costs nothing on a repeat, because that
function already early-returns when the id is unchanged. **It is not the only
writer of `activeId`, and does not need to be:** split, close, respawn and
adoption assign the id directly (a split deliberately, since `setActive` would
apply ratios to a DOM the just-split tree does not match yet) and then focus the
pane, which reaches `setActive` with the id already equal. Those paths end in
`onLayoutChange`, whose consumer syncs as well, and the pane poller calls
`syncViews` every cycle regardless — so the projection self-heals even on the
one path that raises neither (`respawn`).

**At most one row in the whole rail is marked.** Every tab has an active pane of
its own, so reporting each tab's local answer would light one row per tab and
say nothing; [`paneRows`](../src/ui/agent-rail-model.ts) `current` ANDs the
pane's flag with its tab's `active`, and the invariant lives in the pure model
where a test can assert it. **A document or the browser on the stage does not
clear the mark** — the active pane is unchanged, and the row then reads as where
the keyboard returns to; clearing it would blink the rail on every file opened.

**The frame's gutter was fixed the same day, from the owner's screenshot of the
running app.** DL-27.19's block paid its 3px inside on the vertical only, which
cost nothing while every row in it was transparent: the first row washed made a
100%-wide rectangle paint over the frame's left and right hairline and eat its
rounded corners, while 3px of air stayed above and below — the selected row read
as sticking OUT of the block that contains it. The gutter is 3px on all four
sides now, and the horizontal half is **charged to the row's own padding**
(7px/8px → 4px/5px inside a frame) rather than added to it, so the mark, the
sentence and the glyph sit on exactly the x they sat on before. Measured after
the change: all four gutters 3px, `framedMark` 272 / `framedText` 293 /
`framedGlyphRight` 516 — the identical numbers as before it. The washed row also
drops to `--radius-tight`, since a 10px corner inset 3px inside a 10px corner
reads fatter than its frame.

Verified by `npx tsc --noEmit`, `npm run build`, prettier and five suites —
156 tests green across `agent-rail`, `agent-rail-model`, `terminal-manager`,
`tab-manager.tab-lifecycle` and `tabs-store` — plus a gallery pass on the REAL
rail: exactly one
leaf at `rgb(61, 66, 70)` — `--tab-active-bg` — carrying `aria-current="true"`,
inside DL-27.19's frame, on `deck-dark`. **Owed: a native `electron:dev` pass,
a light-theme look and the owner's eye review** — no pane has been focused in a
running app. Two failures seen in the same runs belong to other sessions'
uncommitted work (`tab-manager.file-surfaces.test.ts` mid-edit for the markdown
view; a settings row for the telemetry work), and the design-language radius
gate is red on a peer's `.asr-leaf__hit { border-radius: inherit }`, which does
not exist at `HEAD`. Plan:
[rail focused-pane marker](plans/2026-08-23-rail-focused-pane-marker.md)
`building`.

## Markdown opens rendered — 2026-08-23

Opening a `.md` or `.markdown` file from the tree now shows the **rendered
document** instead of Monaco. One control at the surface's top-right corner —
and ⌘⇧V — flips it to source and back. Editing still only happens in source
mode; the rendered view is a read-only picture of the buffer as it currently
is, saved or dirty. `.mdx` opens as source, because its JSX renders as broken
prose. Spec:
[markdown rendered view](specs/2026-08-23-markdown-rendered-view-design.md)
`decided`; plan: [markdown rendered view](plans/2026-08-23-markdown-rendered-view.md)
`building`.

The loop it serves is the file explorer's own — *read what the agent changed* —
so reading costs zero clicks and the flip is the exception.

### Two passes, not one parse

[`markdown-render.ts`](../src/files/markdown-render.ts) `current` is
synchronous and pure once `marked` has landed: every fenced block, mermaid
fence and local image comes out as a PLACEHOLDER carrying `data-md-*`
attributes, and [`markdown-enhance.ts`](../src/files/markdown-enhance.ts)
`current` walks the mounted node afterwards. Two things fall out of that. The
whole §6 policy is assertable as strings with no jsdom, no Monaco and no
mermaid — which is what
[`markdown-render.test.ts`](../src/files/markdown-render.test.ts) `current`
does. And first paint happens on the parse rather than after two async round
trips, which is what makes a debounced re-render of a file an agent is
streaming cheap enough to do at all (150ms, `RENDER_DEBOUNCE_MS`).

Fenced code is tokenized by **Monaco's own colorizer** against the enumerated
`EDITOR_LANGUAGES` set — no new dependency and no new cost, since opening a
`.md` already lazy-loads Monaco and source mode needs it anyway. A fence's
short name is mapped through `languageForPath` (`fence.<lang>`) rather than
through a second table that would drift from the editor's. Anything outside
the set stays plain monospace. `mermaid` is imported only when the rendered
document actually holds a ` ```mermaid ` fence, so most documents never pay
for it; a diagram that will not parse keeps its code block and gains the error
beneath it — never a blank hole.

### The policy that keeps the CSP question closed

Adding a CSP later invalidates the packaged Monaco smoke and forces a rerun, so
the surface was designed to need none.
[`markdown-policy.ts`](../src/files/markdown-policy.ts) `current` is the whole
of it, as pure functions:

- **Raw HTML is escaped and shown verbatim**, block and inline. Not
  sanitized-and-allowed: escaping needs no allowlist to maintain and no
  sanitizer dependency, and agent-written docs lose nothing.
- **A link carries no `href` at all.** The decision rides in
  `data-md-target` and the destination in `data-md-href`, so there is no
  default navigation to intercept — a stray click Deck's delegated handler
  missed cannot replace the renderer's own document. `javascript:`, `data:`
  and every other scheme Deck does not hand to the OS render as PLAIN TEXT,
  and so does a relative path resolving outside the workspace root (new
  DL-31.3: a blue underline that does nothing reads as Deck being broken).
- **`http(s)`/`mailto` go out through `shell_open_url`**, which re-validates
  the scheme in main. **A relative link inside the root raises the same
  `requestPathOpen` a ⌘+click on an agent-printed path raises**, so `App`'s
  single routing decision is not copied here.
- **Images are local-only and the surface never fetches.** A remote URL is a
  labelled placeholder.

### The image read, and where it departs from the spec

Spec §6 named "the existing `FileClient.read` IPC — so the main-process path
guard answers containment". `read_file` cannot serve it: `looksBinary` refuses
any file with a NUL byte in its first 8 KiB, which is every PNG, JPEG and
WebP. Both halves of the requirement still hold through two channels that
already exist ([`markdown-image-source.ts`](../src/files/markdown-image-source.ts)
`current`): `workspace_for_path` answers containment main-process side through
`resolveInsideRoot`, the explorer's own guard, and `read_image_as_data_url`
carries the bytes under its extension allowlist and 1 MB cap. **No new IPC**,
so spec §9 stands and no contract in `scripts/electron-ipc-contract.test.ts`
moves. The picture arrives as a `data:` URL rather than the spec's blob URL —
equivalent, with no revoke lifecycle to leak, and the shape the logo and
sidebar-banner stores already run on.

### The seam, and why ⌘⇧V is macOS-only

No R4 seam moved. `SurfaceStrip` gained two OPTIONAL methods beside `orderKey`
and `runEditCommand` — `canToggleView()` and `toggleView()` — so TabManager
learns that a surface may have two views, never that one of them is a parsed
document, and every `SurfaceStrip` fake written before this keeps compiling
with "no second view". `toggle-markdown-view` is the 54th registry action, in
`isSurfaceRoutedAction` (it reaches the surface) and gated by
[`isActionPerformable`](../src/terminal/action-performable.ts) `current`
BEFORE the keystroke is consumed, so ⌘⇧V over a terminal, over a `.ts` file or
with an overlay up reaches whatever holds focus untouched.

**There is deliberately no Windows binding.** Ctrl+Shift+V is already `paste`
there, and a performable action that declines the key does not fall through to
a second binding — it stops consuming and the event goes to whatever holds
focus. Binding both would break paste in a terminal rather than share the
chord. Same shape as `save-file`, which is bare ⌘S with no Windows twin; the
toggle control is the reachable half on Windows.

`viewMode` lives per absolute path in `file-surface-store.ts`, session-scoped
and dropped with the document — NOT a settings field. Persisting it was
considered and dropped: the default is right on nearly every open, and a
remembered "source" would quietly turn the feature off for the one file the
user once inspected.

### Verification state

`npm test` 3755 passed / 8 failed, with **every one of the eight reproduced as
belonging to other sessions' uncommitted work in this shared checkout** —
`tab-manager.file-surfaces.test.ts`'s "T21: the last SURFACE does close the
window" (the 2026-08-22 `disposeTab` reversal, whose five siblings fail only
because T21's `vi.waitFor` throws before `tm.dispose()`), the design-language
radius gate on `.asr-leaf__hit: border-radius: inherit`, and
`settings-screen.test.tsx`'s row count against the telemetry work's "Share
usage stats". All three pass on a pristine `HEAD` worktree. This change's own
files: `src/files` 278/278, the action/keymap/performable suites and the three
new ⌘⇧V chord cases green.

`npx tsc --noEmit`, `tsc -p tsconfig.electron.json --noEmit`,
`npm run build` and `npm run generate:menu:check` are all clean, and `marked`
(43.75 kB) and `mermaid` (687.74 kB) both land as their own lazy chunks rather
than in the entry bundle — which is the §5 requirement measured.

**Owed: a native `electron:dev` pass and the owner eye review.** Nothing has
been rendered in a running host: no diagram has been drawn, no image has been
read off disk, no link has been clicked and no colorized fence has been seen
in either theme. Tauri is unaffected by inheritance — the file surface has no
Tauri implementation — and Windows is Gate C as always.
## The landing stage draws the shipped app — 2026-08-20

The landing's window mock had drawn the July app for a month (avatar sidebar, status bar,
dock, Open board panel). Since 2026-08-20 the hero is one still, living
[`.a-appwin`](../marketing/stage/appwin.js) `current` in `deck-dark`'s plane order: a rail
of project clusters with per-pane sentence rows, one unified tab strip (terminal + file +
browser chip), a frame row of traffic lights + sidebar toggle + `New`, three streaming
panes, and **no status bar and no dock** — `showStatusBar: false` / `dockOpen: false` are
the shipped defaults. The tour's `grid` panel is cut with its whole render chain; four
panels are rebuilt and two are new (Usage → Overview, Settings → Agents). Twenty-one tasks
over six phases, to the [plan](plans/2026-08-20-landing-stage-redesign.md) `current`; the
[spec](specs/2026-08-20-landing-stage-redesign-design.md) `decided` is unchanged.

- **No `src/` or `electron/` file was touched**, and no DL rule moved — DL binds app
  chrome and this is a drawing of it. The only reach into `src/` is a test import:
  `stage-markup.test.js` reads `BUILTIN_AGENTS` from `src/lib/agent-catalog.ts` so the
  landing cannot drift behind a seventh built-in.
- **Colours are re-derived, not re-picked.** Ten `--sg-*` tokens changed value and eleven
  were added, each named after the app token it mirrors (`--sg-rail` = `--sidebar-bg`'s
  pinned `#272d31`). Every token NAME was kept because `video.css` reads them. The plane
  order inverts — stage `#17181c` is deepest, rail above it: 2026-08-19's dark-sidebar
  decision arriving on the landing.
- **A pane's script moves its own rail row and tab chip.** Each `stagePanes` step may
  carry a `tail` and a `state`, written by
  [`mountStageStream`](../marketing/landing-prototype/src/product-stage.js) `current` to
  every `[data-tail]` / `[data-dot]` node the pane owns. Two rules pinned by tests: the
  lookup is `querySelectorAll`, never `querySelector` (one pane, several nodes per hook),
  and it is scoped to the root it was handed, never `document` (the page mounts several
  stages). `tail` and `state` seed from **two independent scans** — a single scan pairs a
  working spinner with a finished sentence for ~4s of every loop.
- **Two deliberate divergences.** The active chip echoes the FOCUSED pane's sentence where
  the app's `tabTail` prints the LOUDEST by `STATE_RANK` (a cross-pane scheduler the mock
  lacks); and **the video keeps drawing the July shell by choice** — `stage-driver.js`
  hard-requires `[data-ws-avatar]`, so `stageSidebar` / `renderStageSidebar` /
  `renderStageStatus` survive as video-only. Nothing was deleted from `marketing/stage/`.
- **The stage gained its first test**, 41 assertions over seams a rewrite can silently
  break ([`stage-markup.test.js`](../marketing/landing-prototype/src/stage-markup.test.js)
  `current`), mutation-checked with seven deliberate regressions each failing one named test.

**Evidence.** `build:landing` clean; `vitest run marketing/` **159/159 across 10 files**
(baseline 38 across 5); [`capture-landing-stage.mjs`](../scripts/capture-landing-stage.mjs)
`current` served the BUILT `dist` to headless chromium for 42 images at 1440 / 768 / 390 in
both motion modes, every in-page check PASS (no page overflow, no sideways rail, no rail
text under 9px at 1440/768 or 7px at 390, every catalog command on one line), boxes
reproducing the plan's D10 figure exactly, and a live probe counting **207 animating nodes
with motion allowed against 0 under `prefers-reduced-motion: reduce`**.

**Not established, some of it structural.** `marketing/**` has **NO lint signal at all** —
it sits in `.prettierignore` AND `.oxlintrc.json`'s `ignorePatterns`, so `oxlint` answers
"No files found" and `prettier --check` reports clean WITHOUT reading the file (proven with
`--ignore-path /dev/null`); every "prettier clean" claim over this tree is vacuous, and
`--write` is not the fix because the sheets are 80-col against prettier's 100. Full
`npm test` is red (3482 / 10 failed) entirely under `src/`, which this branch left
byte-identical. Gate 3 (`frontend-design-bar`) and gate 5 (owner eye review) are owner-side
and were NOT run. The rendered video is stale in colour as well as shape — `tokens.css`'s
`:root` is shared, `marketing/video/out/` is not re-rendered (spec §7). `.a-appwin__chips`
clips 1–2px vertically at 390 (line-box, not ink; nothing focusable inside, so the
overflow-moves-the-shell trap cannot fire) — recorded, not fixed. No native host run, and
reduced motion was Chromium emulation on Linux headless, not macOS type.

### The hero grows a fleet rail and four scene tabs — 2026-08-20

Owner-asked the same day (onorca.dev the named reference): the hero should read as a fleet
mid-flight and show more than one capability before the panels. Marketing-only.

- **The rail fixture densified to six clusters**
  ([`stageRail`](../marketing/stage/stage-data.js) `current`) — a red `failed` codex row, a
  quiet `done` `cursor-agent` row (the monogram path's first appearance), two remembered
  headers, and all six built-in agents on the hero.
- **The stage cycles four scenes on a timer**
  ([`HERO_SCENES`](../marketing/landing-prototype/src/directions/a.js) `current`): agents
  (14s) / restore / surfaces / usage (9s each), swapping which `.a-appwin__stage` region
  shows behind the ONE live rail, which sits outside every region so its stream keeps
  painting. The three alternates are the tour panels' own bodies (`stageRegion()`), so hero
  and panel cannot drift. It shipped as click pills; the owner replaced them hours later
  ("the workspaces run one after another"), **knowingly amending the 2026-08-19
  no-decorative-loops decision** — this timer shows work, it is the page's only one, and
  reduced motion arms none. `hidden` is the mechanism, the animation gate widened to
  `:is(.panel, .a-appwin__stage).is-revealed` (one class, two writers), and the cycle pauses
  on its own IntersectionObserver under the fold.
- **The window went native on the owner's screenshot review.** Pane grids are FLUSH — a 1px
  `--sg-seam-divider` between panes, no card border, radius, gap or focus ring
  (`06-stage-panes.css` is the reference) — and transcript inks went neutral (`t-tool`
  purple and `t-ok` green died, `t-agent` blue became dim bold), because the CLIs print
  plain foreground.
- **Every `var()`-carrying animation moved to LONGHANDS.** A shorthand holding `var()` is
  stored pending-substitution and Chromium restarts it on ANY global style recalc —
  Playwright's caret-hiding stylesheet caught two delayed restore panes at width 0 in every
  capture, though the steady state was always correct.

Evidence: `vitest run marketing/` 165/165, `build:landing` clean, the capture rerun clean
at all three widths in both motion modes, plus scene screenshots. Same caveats as above.
## Performable keybindings and Ctrl+C — 2026-08-20

`handleShortcut` consumed the keystroke the moment `matchBinding` returned an action, and
only then let `overlayBlocksAction` decide whether the action could run. That ordering cost
two things. It cost a working chord: every `scope: "pane"` action (`find`, `clear-buffer`,
the `zoom-*`/`scroll-*`/`focus-*`/`swap-*` families, `copy-selection`, `paste`,
`next-tab`/`prev-tab`) was swallowed and then blocked while a file surface or overlay owned
the stage — Monaco escapes the `isChromeTextField` early return because with `editContext`
it focuses a plain `<div>`, so Ctrl+Shift+C over an open document copied nothing AND denied
Chromium's own copy. It also cost a feature: bare Ctrl+C could not be bound on Windows at
all, because a binding here always consumed.

[`isActionPerformable`](../src/terminal/action-performable.ts) `current` is asked BEFORE
`preventDefault()`; a false answer leaves the event alone so it reaches whatever holds
focus. `dispatchAction` keeps `overlayBlocksAction` unchanged — it still guards the macOS
menu path, which never passes through `handleShortcut`.

**The predicate is keyed on the ACTION, not the binding.** Ghostty's `performable:` prefix
on a bind cannot work here: Deck stores user overrides per action and replaces an action's
whole chord set ([`resolveKeymap`](../src/lib/keybindings.ts) `current`), so two chords of
one action cannot differ in conditionality and a user who had rebound `copy-selection` would
never receive the new Ctrl+C. kitty's compound-action shape fits, so
[`copy-or-interrupt`](../src/terminal/action-registry.ts) `current` is a second action, with
no `menu` field on purpose — a Cocoa accelerator is consumed before the webview and would
force the action regardless of whether it could be performed.

The two differ in exactly two ways. `copy-selection` (Ctrl+Shift+C) is stage-conditional
only; inside a terminal it keeps consuming even with nothing selected, because leaking that
chord into an agent TUI has unspecified behaviour. `copy-or-interrupt` (Ctrl+C, Windows
keymap only) is stage- AND selection-conditional and is the only one that CLEARS the
selection, so the next press interrupts — the clear runs synchronously after the text is
read, never in the clipboard write's callback, which could erase a newer selection.

**Deck writes no interrupt byte.** Not consuming is what lets xterm encode the interrupt; a
literal `\x03` through `pty.writePty` would pin one encoding against a terminal that may have
negotiated a different keyboard protocol. Two costs taken deliberately: **cancelling after a
selection takes two presses** (Windows Terminal behaves the same, but it costs more here
because agent CLIs use Ctrl+C as a routine cancel), and `stageOwner()` reads
`browserSurfaceActive` beside `surfaces.activeIndex()` so answering "terminal" under a web
view cannot consume a key the page wanted. macOS is untouched — ⌘C stays the native Cocoa
Copy role and `copy-or-interrupt` ships unbound there. Renderer-only, so it reaches BOTH hosts.

**Evidence:** `npm test` 3375 passed / 10 failed, every one of the ten reproduced identically
on a pristine `HEAD` worktree (three other sessions' in-flight work); both typechecks,
`npm run build` and `generate:menu:check` clean; 4 new chord tests driving the real
capture-phase `window` listener through the pane's own textarea. **The Ctrl+C keystroke has
never been pressed on Windows (Gate C); no host run, no owner eye review.**

**Known gap, unresolved.** macOS menu-bound actions (`find`, `clear-buffer`, `zoom-*`,
`split-*`, `toggle-*`) still die over a file surface — Cocoa consumes their accelerators
before the webview and no renderer-side reorder can reach them. Ghostty's answer is to give
performable binds no menu shortcut, which trades away the menu's role as the place chords are
learned. The remaining ~18 pane-scoped actions are deliberately unregistered; the table takes
them later as a data change. See
[spec](specs/2026-08-20-performable-keybindings-design.md) `decided` and
[plan](plans/2026-08-20-performable-keybindings.md) `current`.
## One tab, one frame — 2026-08-20

A tab running three agents printed three rows and nothing said they belonged together.
DL-27.13's parent row and elbow guides used to say it, and they have been behind
[`PANE_TREE_HIDDEN`](../src/ui/agent-rail.tsx) `current` since 2026-08-16 — the fourth time
in a week the owner took tab-tier chrome off this rail. The grouping problem survived every
removal because each removal took away a ROW, and a row was the rail's only vocabulary for
"these belong to one tab".

**The answer is an edge, not a row.** A multi-agent tab's panes stand inside a rounded
`--hair-strong` hairline at `--radius-control` (new [DL-27.19](DESIGN-LANGUAGE.md)
`current`): no name, no count, no indent, nothing a previous pass had already rejected.

**It is CSS only.** `data-headless` on `.asr-item` already means "several panes, no parent
row", so [the headless-item rule](../src/styles/04b-agent-rail-rows.css) `current` is the
whole implementation — no component, model, IPC or R4 seam moved, and reverting is deleting
one rule block.

**It took three shapes and the owner caught two.** A `border` is layout: it pushes rows 1px
inward or is bled back with `margin: 0 -1px`. The bleed shipped first and within minutes the
owner reported the sidebar shifting — `.asr-rail__list` held 255px of content in a 254px box,
and `overflow-x: hidden` hides the bar while KEEPING the scroll container, so the first
`scrollIntoView` slides the whole column (the `#root` Known trap). An `outline` fixed that
(`scrollWidth === clientWidth` at 254px) and lost the frame's left edge: the item fills the
list's content box exactly, so the outline paints on the 1px outside and the same
`overflow-x: hidden` clips it. The third shape is DL-1.3's `box-shadow: inset 0 0 0 1px` —
paints inside, follows `border-radius`, joins no layout, nothing to clip; a leaf inside a
frame and a tab row outside one both start at x = 287. Vertically 3px inside + 3px outside
stacks with `.asr-cluster`'s 4px gap into 10px between framed tabs against 7px between a
frame and a bare row.

**Colour was offered and turned down.** The gallery drew the frame in the tab's own
[`TabView.dotColor`](../src/lib/tab-colors.ts) `current` (column B4). Neutral won for two
reasons: the status dot owns red and yellow (DL-27.3), and nothing has been able to SET
`dotColor` since `TabPopover` was deleted, so a per-tab colour would ship as a frame nobody
can change. All five gallery columns stay in
[`multiAgentGroupingSpecimen`](../src/gallery/agent-rail-variants.tsx) `current`.

**Evidence.** `design-language` + `agent-rail` suites 57/57; a browser measurement against
the running gallery (radius 10px, `scrollWidth === clientWidth`, the x-alignment above) plus
element and real-`AgentRail` screenshots. **Not established:** no full `npm test` and no
`npm run build` — a concurrent session's `src/lib/terminal-links.ts` is mid-edit and fails
`tsc` — no host pass, no owner eye review. The frame needs `showAgentPresence`, so it is
Electron-only in effect, and it rides `PANE_TREE_HIDDEN`.
## The dock header says what it is, and its third tab gets a chord — 2026-08-19

The docked column's header is four icon-only controls (File explorer, Token usage, Session
history, panel toggle) and nothing said what any of them was beyond a native `title` — which
appears after an OS-owned delay and never appears at all for a keyboard. New DL-23.10;
DL-14.2 widened.

**The tooltip already existed, locked to one surface.** `ActionTooltip` /
`useTooltipVisibility` were written for the feature toolbar in the 2026-08-14 pass; the dock
header draws the same component through the same hover/focus rules and the native `title`
came off both. §23 said "at the toolbar layer" in two places, so a rule that is now general
has to say so. `useTooltipVisibility` is a hook, so the chip became a component
(`DockTabChip`, the reason `ToolbarControl` exists) — with no unavailable branch, since
`availableDockTabs` OMITS a surface the host cannot answer (DL-19.7).

**The third tab had no chord to print, so it got one.** The file-explorer spec §3.1 shipped
session history with no shortcut and no menu item, invisible until two of three chips could
say ⌘⇧B and ⌘⇧U. `toggle-sessions` is an action now at ⌘⇧Y / Ctrl+Shift+Y (`y` verified free
at every modifier combination on both keymaps; ⌘⇧H is Cocoa's Hide Others). `toggle-dock`
had a menu item with no accelerator and took ⌘⇧J / Ctrl+Shift+J, the panel chord VS Code
trains — also Chromium's DevTools console chord, the same trade already accepted for
`toggle-browser` on Ctrl+Shift+I. Two things the new action needed: a **guard** (
`revealDockTab("sessions")` on a host with no `sessions_list` falls back to explorer, so an
unguarded chord named "Session History" would open the file explorer — it reports
unavailability instead), and entries in `COMMAND_ACTIONS` / `isChromeScopedAction` so it can
be reached while a document holds the stage.

**Glyphs went 13px → 15px** — `FEATURE_ICON`, an existing rung, not a new size. The
`.iconbtn` box stays 24px. The panel toggle takes the size as an explicit prop rather than
deriving it from `open`, and its stage-strip mount keeps 13px. The chord is read from the
action id through `shortcutLabel` at render, never stored in `DOCK_TABS` — that is what makes
a rebind reach the tooltip and stops one platform's notation shipping to the other.

Renderer plus the shared registry, so both hosts; `generate:menu` regenerated
`menu_registry.rs`. Targeted suites, `tsc`, the full bundle and a gallery pass — **no native
`electron:dev` or `tauri dev` run, no owner eye review**. Still true and out of scope: the
navigation sidebar's own toggle has neither tooltip nor chord.
## The quick picker grows keys, and every project gets a `+` — 2026-08-19

One pass over `AgentQuickPicker` and the one thing around it that decided _where_ it opens.
New DL-27.18 and DL-29.8; DL-27.17 and DL-29.5 amended.

**Escape moved off the panel.** `Modal` read Escape from a handler on the dialog element, so
it only answered while focus was still inside — and focus leaves (a scrim click, a native
`<select>` handing focus to the body), leaving the modal on screen while Escape travelled
into the terminal behind it: the exact failure DL-29.5's `stopPropagation` was written to
prevent. It is a document listener in the CAPTURE phase now, installed once at mount and
reading the current `onDismiss` through a ref. The Tab trap, the scrim's press-and-release
rule and `onKeyDown` stay on the panel. This reaches `PresetEditor` and `SavePresetDialog`
too, without either changing.

**The rows answer arrows, and the keys are stated.** ArrowUp/Down/Home/End move roving focus;
Enter is the browser's own button press, so no new activation path exists. Focus still starts
on the PANEL (DL-29.2) — first-row focus would put a reflexive Enter after ⌘T one keystroke
from launching Claude Code. The `<select>` guard that stopped digit keys inside the worktree
menu stops the arrows there too. One `--text-faint` line under the rows names every key,
because the digit badges came off on 2026-08-16 while the digits kept working.

**A row whose binary is gone opens Settings.** Only a declared custom agent reaches this
state (`agentOptions` omits an undetected built-in entirely); it used to spawn a shell that
printed `command not found`. Routing applies to the digit key as well as the click, so the
digit is not a way around the check. The row is not disabled — DL-19.7 prefers omission to
inertness, and this control is neither.

**Every project header carries a `+`.** The strip's `+` and ⌘T always mean "the ACTIVE tab's
workspace", so launching into a visible-but-unselected project meant switching tabs first —
the one thing a rail exists to make unnecessary. Three consequences:

- The header is a **row of two controls**: `.asr-cluster__head` became a `div` holding
  `.asr-cluster__toggle` (folder, name, caret) and `.asr-cluster__add`, because a `+` nested
  inside the collapse button would be a button inside a button. **Re-amended hours later on
  the owner's ask:** the `+` sits one slot INSIDE the caret, so DL-27.17's trailing caret
  stands as written. The header is a GRID — `minmax(0, 1fr) 17px 17px`, the tab rows' own two
  trailing slots — with the collapse button spanning every track, the launcher pinned into
  the middle one, and the caret reserving that track from inside the button with a `7 + 17`
  margin gated by `:has(.asr-cluster__add)` so DL-19.7's launcher-less project opens no dead
  slot. The same pass closed a real defect: `.asr-cluster__head` was `width: 100%` beside its
  own padding with no `border-box` — the repo's standing percentage-plus-padding trap — so
  the header measured 11px wider than every row and BOTH trailing controls hung past the
  rail's edge. Measured after: caret box and rows' agent-glyph box are the same 17px slot.
- The destination is carried by `quickPickerWorkspace`, a signal beside `agentQuickPickerOpen`
  in `chrome/events.ts` rather than inside `App`, because `newTab()` lives outside `App`'s
  closure and has to CLEAR it — otherwise the next ⌘T inherits the last rail target. Cleared
  on cancel, on select and on the Settings route.
- A folder git knows nothing about is stated by `plainFolderDestination` (DL-29.7 renders it
  as a readout) rather than by the panel's "Runs in this workspace" line, which becomes a lie
  the moment the target is not the active workspace.

Renderer-only, so it reaches BOTH hosts — on Tauri the worktree list is always empty and the
synthetic folder destination is what the row shows. Verified by targeted suites (`agent-rail`
41, `agent-quick-picker` 34, `modal` 20, `worktree-destinations` 16, `app` 33,
`design-language` 12, plus a 362-test tab-manager/settings/gallery batch) and `tsc` clean.
**No `npm test`, no `npm run build`, no host pass, no owner eye review.**
## The agent catalog — 2026-08-19

Settings → Agents is the catalog of everything Deck can launch, and each row states the
command that agent will actually run with.

**The commands ship with the app.** `BuiltinAgent` carries `defaultCommand` and `url`, so a
fresh install shows `claude --dangerously-skip-permissions` on first open. Three earlier
builds that day all left the list empty until the user typed something, and each time the
owner's answer was the same — _the command is not showing_. A recommendation the app ships
is not a setting the user forgot to fill in. Flags are verbatim from each CLI's own `--help`
on the owner's machine: `codex --dangerously-bypass-approvals-and-sandbox`,
`agy --dangerously-skip-permissions`, `gemini --yolo`, `cursor-agent --force`. `opencode`
ships bare — its `--auto` is opt-in per session. Several of these skip the agent's own
confirmations, which is the point, and also why each is spelled out on screen and why a row
can be disabled.

**A user preset replaces the shipped command** for that agent; nothing merges. Resolution
order: starred preset → catalog recommendation → bare binary.

**The list splits on `$PATH`.** Installed is what the probe found, with a count and a
Refresh (a CLI installed in another terminal will not appear until the 30s cache expires);
Available to install is everything else Deck knows how to launch, so "can Deck run X" is
answered on screen. Two settings fields carry the row's controls: `disabledAgents`, because
a built-in cannot be deleted (the probe finds it again) and the switch is the only thing
that takes one out of the pickers; and `defaultAgent`, offered on installed rows only, since
starring a binary that is not on `$PATH` names a default that cannot run.

### A preset is a command line, not a set of options

Two discarded shapes explain why the third validates the way it does. **Enum options per
agent** stored closed enums plus a validated model token and composed the command; the
argument was safety, since `AgentLauncher.arm` writes its string VERBATIM into a live
interactive shell — but every flag became a modelling exercise and `gemini --yolo`, in the
owner's reference from the first minute, was unreachable. **A row per agent with nested
alternatives** was closer, but adding was still a form.

What shipped is `{ id, command }` and one text field.
[`commandProblem`](../src/lib/launch-profile.ts) `current` carries the safety rule directly:
it refuses `;` `|` `&` and newlines (separators), `$` and backticks (substitution), `>` `<`
(redirects), quotes and backslash, and subshell/glob punctuation — what survives is what
binaries, flags, paths and model names are made of, and the refusal says why. A pipeline
belongs in a wrapper script declared as a custom agent. The agent is the command's first
word, computed on read: two fields would let a preset claim `claude` while typing `codex`.

### Restore stores the command, not the id

Editing or removing a preset must not rewrite a session already running under the old one.
Only `claude` is re-flagged on resume — its flags sit beside `--resume`, whereas
`codex resume` and `opencode -s` take theirs in positions this repo does not model, so those
are returned untouched rather than guessed at. **That compatibility claim comes from
`claude --help`, not from an observed resume.** Two limits recorded, not fixed: a pane
detached into another window loses its recorded command (the map is per TabManager), and a
RESTORED pane is not re-tagged (restore's intent carries `paneCommands` and no `agent`), so
a session restored twice loses its command on the second boot.

### cursor-agent, the sixth built-in

Appended LAST to `BUILTIN_AGENTS` (owner-approved fork — the list reaches process
classification). Order is the digit-key contract in `AgentQuickPicker` and the Open board, so
appending leaves every existing key on its agent. **No Cursor session scanner exists**, so
`resume_lookup` answers null and `COMMAND_TABLE`'s `bare` form is what gets typed; the
`--resume`/`--continue` forms are in the table anyway, so adding a scanner later is one file.

### Not built

**Drag-to-reorder** and the **per-row expand caret**, both of which the owner's reference
shows.

**Evidence.** `npm test` 3250 passed / 3 skipped / 0 failed, `npm run build` and `tsc`
clean, and a gallery pass on the REAL component in both palettes. **No native
`electron:dev` or `tauri dev` pass.**
## Open Board is the start surface — 2026-08-19

Open Board starts or resumes work and no longer tries to summarize live work and history at
the same time. Home is headed `Start a workspace`: one primary `Open workspace…`,
capability-gated Worktree and Sessions actions, and recent rows exposing their remembered
preset/agent, last-opened time and a visible `Open` state when that workspace already has a
live tab. Activation and remove are sibling buttons, so keyboard access does not depend on a
nested interactive element ([`OpenBoardHome`](../src/open-board/open-board-home.tsx)
`current`). Missing workspaces collapse behind a count; pending and failure feedback appears
on the board itself.

Session rows left Home: `Resume a previous session…` enters a third board view that reuses
the Sessions body and returns Home on Back or Escape
([`OpenBoard`](../src/open-board/open-board.tsx) `current`). A successful resume closes the
board, a failure leaves it visible; Sessions stays Electron-only, so unsupported hosts omit
the action.

The shell states the same ownership. The Agent Rail projects only `tabViews` — archived
workspace inputs, rows, callbacks and CSS are gone
([`buildAgentRail`](../src/ui/agent-rail-model.ts) `current`, DL-27.16). With no live tab,
[`sidebarEffectivelyCollapsed`](../src/ui/app-policy.ts) `current` suppresses the rail, its
toggle and resize seam without writing the saved sidebar choice; while the board is open,
[`dockVisible`](../src/ui/app-policy.ts) `current` unmounts the dock without changing
`dockOpen` or `dockTab`.

Evidence: the final focused Open Board / Agent Rail / App policy / sidebar shell / Sessions /
Design Language run is 169/169; `npx vite build` and `npm run build` exit 0 after 5,565
modules; `generate:menu:check` and `git diff --check` exit 0. **No gallery server, native
host, screenshot or owner eye review**, so the visual direction is unverified; Tauri Sessions
unsupported, Windows unverified.
## The Agent Rail stops looking disabled — 2026-08-19

The owner withdrew state-based dimming from every live agent row: a clickable `working`,
`done` or `idle` item was visually indistinguishable from a disabled control. The
`data-quiet` attributes and their text/glyph overrides are gone; names, turns and agent marks
keep full legibility in every state.

The trailing status vocabulary is exception-first.
[`RailStatusMark`](../src/ui/agent-rail.tsx#L123-L133) `current` renders one static 9px dot —
red `failed`, yellow `asked`, neutral `working` — while `done` and `idle` paint nothing. The
semantic five-state model, fold precedence, `title` and accessible wording are unchanged.
This retires the halo, turning arc, green check, idle ring and every looping animation the
rail owned. The shared trailing slot stays reserved, so the hover close and row geometry do
not shift when a mark is absent.

The project header reads folder → name → trailing caret
([`AgentRail`](../src/ui/agent-rail.tsx#L493-L510) `current`); the folder names the group
genre and the caret keeps the far edge as the expand/collapse affordance. The same-day
follow-up removed the redundant `Workspace` caption from the launcher row, which then moved
intact into [`SidebarFrameActions`](../src/ui/sidebar-toggle.tsx) `current` after the hide
control, so the rail starts with its live project rows. The folder had already risen 13px →
15px and the name 11px → 13px through
[`--type-project`](../src/styles/01-tokens.css#L84-L86) `current`.

Evidence: `agent-rail.test.tsx` 38/38. **No build, native host, screenshot or owner eye
review of the running result.** Renderer-only, so it reaches both hosts.
## The dark sidebar rises off the stage — 2026-08-19

The owner picked `#272D31` for the dark sidebar, and it is **lighter** than the stage, which
reverses the plane the side columns have stood on since 2026-08-14. `--sidebar-bg` was `bg`
mixed 24% toward black — the darkest surface in the window; it is now the FIRST surface above
the stage, so the terminal is the deepest plane and every piece of chrome stands on top of
it. Light themes are untouched, so the two modes recede in opposite directions from the same
rule (DL-18.7, amended).

**The ladder had to move with it.** At +8% the sidebar landed between `--chrome-1` (+5%) and
`--chrome-2` (+9%), so a popover read as a smudge of the column behind it. Dark chrome
surfaces are measured from `--sidebar-bg` now rather than from `--bg`
([`deriveChromeColors`](../src/lib/derive-colors.ts) `current`), which makes the separation
structural for every dark theme including imports. The steps are 3/6/10 against light's
5/9/15, chosen against DL-3.5's floors rather than by eye: at 4/8/14 One Dark's active row
measures **7.13:1** against white, under the 8:1 floor, so `ensureContrast` would flatten
every chrome tone to plain white and `checkChromeTextContrast` would start rejecting imports
Deck accepts today. At 3/6/10 the tightest preset still measures 8.07:1.

Three forced consequences:

- **`--input-bg` sinks instead of climbing** — an input is a recessed surface, and `bg + 12%`
  is now mid-ladder. It sits half-way from the sidebar back to the stage: below every chrome
  plane, still above the terminal.
- **`--seam-raised` moved onto the ladder too.** Measured from `--bg` it fell BELOW
  `--chrome-2` on deck-dark (0.0397 against 0.0409) — a popover framed in a line darker than
  its own body.
- **`#272d31` is a literal**, not reachable by mixing `#17181c` toward white (hue 228° →
  204°, saturation up), so [`PINNED_SIDEBAR_BG`](../src/lib/derive-colors.ts) `current` pins
  it — keyed on the BACKGROUND, not a preset id, because `deriveChromeColors` is a function
  of `(bg, fg)` and its four callers hold nothing else. Overriding that background drops the
  pin. DL-2.2 carries the exception.

Renderer-only plus a derivation change, so it reaches BOTH hosts. **Verified by a
colour-relationship smoke only** — a `tsx` script re-checking every preset and override case
against the new derivation (contrast floors, ladder ordering, seam ladder, ascending dark
ladder). **No `npm test`, no build, no typecheck, no native pass, no owner eye review.**
## Light, Dark, and Settings as a document — 2026-08-19

Appearance offers **two** values now.
[`ThemeModeSelector`](../src/ui/settings/theme-mode-selector.tsx) `current` is a DL-6.5
`binary` radio group over `deck-light` / `deck-dark`, standing where the theme gallery, the
`Import theme` row, the `Themes folder` row and the four colour-override rows used to be.
Deck exposed four terminal palettes, an import picker and four colour pickers as its FIRST
settings category, which made the app's opening statement "here is a theme workshop".

**Nothing was deleted.** `theme-gallery.tsx`, `theme-card-preview.tsx`,
`color-overrides.tsx`, `custom-themes-store.ts` and all four format parsers build, pass
their own tests, and are imported by nothing in Settings. DESIGN-LANGUAGE §24 carries a
retirement banner rather than a deletion, for the same reason: the fork argument records a
decision that was made, not unmade.

### What a legacy profile sees

- **Opening Settings writes nothing.** A stored `tokyo-night`, an imported `file:…` id and a
  saved `colorOverrides` all survive being looked at; `validateSettings` keeps any string id
  verbatim and only a non-string falls back.
- The selected segment comes from [`themeModeOf`](../src/settings/themes.ts) `current`, which
  classifies **the background the app actually resolves** (`resolveTheme`'s output, so an
  override moves the selection with it) against `derive-colors`' own
  `DARK_LUMINANCE_THRESHOLD`. Reading the id instead would let a dark-overridden `deck-light`
  show "Light" over a black window.
- A click is an explicit conversion: it writes the canonical id AND clears `colorOverrides`,
  because an override that survived would keep editing the mode the user just chose from a
  surface that no longer shows it. It asks first when something unrecoverable is on the line
  (`conversionDiscardsData`); a legacy built-in with nothing overridden converts silently.
  **Accepted risk:** once converted, those overrides cannot be restored from Settings.

New installs default to `deck-dark` and `getPreset`'s fallback moved with it — the two
canonical presets lead `THEME_PRESETS`, so an unknown id resolves to what a new install gets
rather than to Tokyo Night. Both seeds shipped with **neutral** foregrounds (DL-3.6 binds six
built-ins now): `#e5e7eb` / `#25272c` became their luminance twins `#e7e7e7` / `#272727`.
`deck-light` is also the first LIGHT background `deriveChromeColors` was ever asked for,
which surfaced a dark-only assumption in its own test — the seam-ladder assertion compared
raw luminance, and every chrome surface sits BELOW its background on a light theme; the
assertion is signed by `--tone` now, the derivation itself was correct.

### Settings became a document

Each category owns a one-sentence `description`, and the section side renders title →
sentence → hairline → one grouped surface (new DL-11.6). The measure moved from each row
(`max-width: 620px`) to the column (`min(680px, 100% - 80px)`, centred). Below 720px the rail
is compact and the document takes edge padding (new DL-11.7); each tab keeps its name in
`aria-label` and `title`, so compact width hides the label, never the accessible name.

Three interaction contracts, none visible in a screenshot: **Tab cannot leave the screen**
(the surface covers the window but does not remove the app from the document, so Tab used to
walk into panes the user could not see); **Escape belongs to the innermost owner** —
`CommitInput` claims it while its draft is dirty, reverting and stopping the event, so one
press no longer costs both the edit and the screen; and **a loading snapshot cannot overwrite
an edit**, because the section is a disabled `fieldset` until `initSettings` resolves.
Settings chrome is achromatic throughout (new DL-3.7) — the green "on", the accent focus ring
(a DL-21.3 carve-out) and the accent step icons are neutral on this surface only. `--red` on
Restore defaults stays: that is a warning, not a state.

### Two follow-ons the owner asked for the same day

**The rail is text, and the icons are gone** (DL-11.3 retired). Eight categories meant eight
glyphs standing in for words like `Appearance`; a rail item is already one line of text.
`settings-nav-icons.tsx` and its test are DELETED and `SettingsCategory` lost its `Icon`
field — no user data or parser sits behind them, so `git revert` is the whole restore path.
DL-11.7 moved with it: the compact rail had been specified as a 54px ICON rail hours earlier,
which would have left an icon rail with no icons, and is now 132px of truncating text.

**Settings covers the whole window** (DL-11.1 amended): `position: fixed; inset: 0`, over the
sidebar, rail and frame row, with the close X replaced by a **Back** control and Escape
unchanged. This reverses the shared rule keeping full-window surfaces below the stage strip,
and the reversal is Settings-only on purpose — that rule was never "the strip is sacred", it
was "do not strand the user", and a board opened on a window with no tabs cannot be
cancelled. Settings has two exits owing nothing to the chrome underneath. Covering the frame
row means the header inherits its two jobs: the macOS traffic lights' reserved footprint and
the window drag region. `app.test.tsx` asserts the exemption together with both exits.

**Reset is an ordinary category** (DL-11.5 amended). The pinned rail foot is deleted and
`reset` is the last entry in `SETTINGS_CATEGORIES`. The foot treated POSITION as the
safeguard, and position was never carrying it — the native confirm is. What the foot did cost
was legibility: in a 220px rail the row stacked its label over its button and printed a
three-line description in a column sized for one word.

### Verification state

Targeted suites green: `src/ui/settings/` 121/121, `app.test.tsx`, `design-language`,
`modal.test.tsx` 18/18, `icon-system` 6/6. **Browser/gallery evidence only — no
`electron:dev` pass, no `tauri dev` pass, no owner eye review of the RUNNING app**, and the
shipped surface has not been compared side by side against the gallery specimen the direction
was approved from (`src/gallery/sections/settings-direction.tsx`). Renderer-only, so it
reaches BOTH hosts and neither has been run.

**The full-suite and build gates could not be run to green, and not because of this work.**
Three other sessions were editing the same checkout: `npm test` ends with 2 design-language
failures owned by an in-flight `09-open-board.css` redesign plus the two standing timeout
flakes (`search-bar`, `file-tree-view`), and `tsc --noEmit` reports only files carrying
another session's `onResumeWorktree` / `SessionEntry` signature change, so `npm run build`
cannot pass either. **No file this change set touched appears in any of those.** Re-run both
gates once the neighbouring sessions land; do not read this note as a pass.
## Automatic terminal renderer — implemented 2026-08-19

Every pane attempts one WebGL activation after `Terminal.open()` during its first mount.
[`activateWebglRenderer()`](../src/terminal/pane.ts) `current` owns that one-shot lifecycle;
later mounts and `applySettings()` cannot create or replace the addon. Initialization failure
and context loss both dispose the addon, emit distinct warnings, and leave xterm's DOM
renderer active without restarting the pane or PTY. Pane disposal releases a still-active GPU
context through the same lifecycle.

Renderer selection no longer exists in persisted settings or the Settings surface:
[`validateSettings()`](../src/settings/settings-schema.ts) `current` ignores legacy renderer
keys, and the Appearance section exposes no selector or fallback status.

Evidence (macOS, 2026-08-19): the three targeted suites 72/72; `npm run build` and
`npm run electron:build` exit 0; `rg 'terminalRenderer|TERMINAL_RENDERERS|TerminalRenderer'
src` returns no matches. `npm test` exited 1 — 3,123 passed, 2 timed out (`search-bar`,
`file-tree-view`, both outside this change and green in isolation at 23/23 and 16/16), 3
skipped; the full-suite gate is recorded as failed, not converted into a pass.

Native acceptance is deferred — no permission was given to launch either host — so OpenCode
custom glyphs, the missing Settings row and owner eye approval are unverified on both hosts;
Windows likewise. The [plan](plans/2026-08-19-automatic-terminal-renderer.md) `building`
keeps agent detection, focus-driven renderer swaps, retries and WebGL-context pooling out of
scope.
## The icons stayed outline, except the panel toggles — 2026-08-19

[`DeckIcon`](../src/ui/controls/deck-icon.tsx) `current` draws `weight="regular"` for every
icon except the components in its `SOLID_ICONS` set, which today is exactly `SidebarSimple` —
both panel toggles, since the dock draws the same icon mirrored. No dependency changed, no
call site moved; renderer-only, so it reaches BOTH hosts.

**The same-day reversal is the finding.** The ask began as "change Deck's icon set" (library,
not the packaged `.icns`), and the complaint underneath — the chrome reads too heavy — turned
out to be three separable questions: too thick (fixable with `light`/`thin`), too round
(Phosphor rounds every terminal at every weight, so only a new library fixes it), too outline
(fixable with `fill`, same package). A throwaway gallery probe separated them, drawing 29 of
Deck's icons across Phosphor's five weights and five other libraries at every DL-14.2 size;
it was **deleted once the choice was made** and is recoverable only from this entry's commit
range. Candidate SVG was read out of npm packages installed in a **scratchpad** and frozen
into a JSON, so `package.json` was never touched.

The owner picked `fill`, ran the whole app at `fill`, then looked at it RUNNING and reversed:
solid is right for a panel toggle and wrong for everything else. The mechanism is that
Phosphor's `fill` does three different things — icons with a body go solid (folder, trash,
globe, terminal…), stroke figures merely thicken (`ArrowLeft`, `Repeat`, `TreeView`), and
**bare glyphs change SHAPE**: `X`, `Plus`, `Minus` and `Check` become a solid square with the
mark knocked out and carets become solid triangles, so the tab strip's close control and the
font-size stepper turned into filled tiles. A panel toggle survives because its icon is a
picture of a layout, and a filled half IS the layout.

The exception is a set of COMPONENTS in `deck-icon.tsx`, not a `weight` prop, so no call site
can pick its own weight (DL-14.1) — matched by identity, not `displayName`, because a
minifier may drop the name and a silently-empty match would quietly restore the uniform
outline set.

**Two measurements worth keeping.** All 53 icons the app imports do change at `fill` (one
`regular`-vs-`fill` path comparison each). Solid coverage over the probe's 29: Phosphor
29/29, Material Symbols 29/29, Remix 29/29, Tabler 18/29, Iconoir 8/29, **Lucide none at all**
— it is outline-only, which removed the set recommended minutes earlier as the most
SF-Symbols-like. Two counts were wrong on the way here: a guess of "about twelve change", and
the probe's belief that Deck uses 29 icons. It uses 53 — a shell scan missed six multi-line
imports, and the gap surfaced only when the owner recognised the settings rail in a
screenshot. The comparison therefore covers 29 of 53: enough to choose between libraries, not
a census.

**Evidence.** `deck-icon` 8/8 pins both halves; the suite ran green apart from two entries
outside this change (`search-bar`'s timeout, and `icon-system`'s glyph gate failing on
another session's literal `↺`). Owner eye review happened on the app they were running, which
is what produced the reversal; **no packaged build and no `electron:dev` pass of the final
state**, Tauri unverified as always.
## Chrome ink goes neutral — 2026-08-17

The owner read the app's text as faintly blue and asked for gray. The tint was measurable,
not a matter of taste: `deriveChromeColors` builds the entire `--text-*` ladder out of the
theme's `foreground`, and three of four built-in palettes ship a blue-violet one (Tokyo
Night's `#c0caf5` is 73% saturated, Catppuccin Mocha's `#cdd6f4` 64%). Nothing in the chrome
was blue on purpose — every label, path, tab title and menu item was wearing the terminal's ink.

**The fix is at the palettes, not at the derivation** (owner's call, against the alternative
of neutralizing inside `deriveChromeColors`). Each built-in `foreground` became the gray of
MATCHING WCAG relative luminance:

| theme            | fg before | fg after  | contrast on its own bg |
| ---------------- | --------- | --------- | ---------------------- |
| Tokyo Night      | `#c0caf5` | `#cbcbcb` | 11.14 → 11.09          |
| Dracula          | `#f8f8f2` | `#f8f8f8` | 13.36 → 13.41          |
| One Dark         | `#abb2bf` | `#b2b2b2` | 6.57 → 6.60            |
| Catppuccin Mocha | `#cdd6f4` | `#d7d7d7` | 11.34 → 11.40          |

Matching the luminance is what makes this hue-only: every ratio moves by less than 0.06, so
DL-3.5's floors, the `ensureContrast` raise and the ordering guarantee are untouched. The
derived ladder now measures 0–4% saturation instead of 65–71%; the residue is
`textMuted`/`textFaint` mixing back toward a background that is itself faintly blue, which is
why the new test asserts a 6% ceiling rather than a literal gray.

**The ANSI sixteen are deliberately untouched** — they are what makes a palette recognizable
and what program output is supposed to look like. `cursor` followed `foreground` only where
the palette already had the two equal (Tokyo Night, Dracula).

Recorded as **DL-3.6**, binding the built-ins ONLY: an imported theme keeps whatever
foreground its file declares — the file is the user's, and rewriting it would make an import a
suggestion — so chrome under a tinted import is still tinted. **`--hair`/`--hair-strong` came
along** (owner, same ask): they were the last chrome tokens still mixing from `--fg`, so every
input border and config rule was drawn in the palette's blue and would have been the one
coloured thing left. They mix from `--tone` now like the seams, closing the carve-out DL-2.3
carried. Source and job are separate questions now: `--tone` answers the first for every line
in chrome, inside-vs-between-surfaces answers the second.

**Evidence.** `npm test` 3009 passed / 2 failed of 3011 — both reds belong to a concurrent
session's uncommitted work (last written before this task started, zero references to theme,
`--fg` or hair). `npm run build` clean. A Chrome pass against the running gallery confirmed
the live values (`--fg: #cbcbcb`, `--hair: rgba(255,255,255,0.12)`,
`--text-primary: #d9d9d9`) and photographed the window-chrome specimen under two palettes.
**Not established:** no `electron:dev` pass, no `tauri dev` pass, and **no owner eye review** —
a gallery is a browser, and a colour change is exactly what a dev-harness screenshot is
weakest at proving. Renderer-only plus a data change, so it reaches BOTH hosts.
## opencode answers a tail, and its store had moved — 2026-08-17

The owner ran an opencode pane, watched it answer, and saw the rail row still say nothing but
`opencode`. Two causes sat behind one symptom, and the second surfaced only because fixing
the first did not help. **Cause one:** [`session-tail.ts`](../electron/resume/session-tail.ts)
`current` listed opencode as a deliberate v1 absence, its storage layout unconfirmed.
**Cause two, the real one: opencode 1.18 moved its state into SQLite.** Deck's scanner walked
`~/.local/share/opencode/storage/`, now **frozen legacy data** — everything current lives in
`opencode.db` beside it, ids and json blobs unchanged. Nothing failed: the tree still exists
and still parses, so the scan returned old sessions. On this machine its newest file was hours
stale while panes were answering, and no session in it named any workspace the owner had open;
`lsof` on the running process settled it. So the defect was never only cosmetic —
`resolve.ts` reads the SAME scanner, so **session restore was resolving opencode panes
against dead data**, resuming a months-old conversation or none, with no error anywhere.

[`opencode-db.ts`](../electron/resume/opencode-db.ts) `current` uses **`node:sqlite`**, Node's
own driver: no npm dependency, no native rebuild, no packaging or signing consequence — the
fork the owner approved (`better-sqlite3` rejected for its ABI-rebuild cost). Verified present
in the Node that Electron 43 embeds (24.18.1) via `ELECTRON_RUN_AS_NODE=1`, which is also how
to run any Electron-runtime check headlessly on this Mac.
[`opencode.ts`](../electron/resume/opencode.ts) `current` merges both layouts, database first,
and `resolve.ts` did not change a line. Four load-bearing details:

- **The merge dedupes by id.** The migration carried ids over unchanged, so a migrated session
  exists in both stores, and two copies would defeat the greedy `takenByAgent` dedup — pane
  two would "match" the file copy of the session pane one already took.
- **Sub-agent sessions are excluded** (`parent_id IS NOT NULL` — 56 of this machine's 157).
  They share their parent's `directory`, so one would show a delegated task's turn as the
  pane's own.
- **`type = 'text'` exactly, in SQL as in the file walk.** A `reasoning` part carries a `text`
  field of its own and is frequently the NEWEST part of a turn; matching the field's presence
  would print the model's private thinking on the rail. A tool-only turn contributes no row,
  so ordering by time and taking one row IS the walk-back.
- **The connection never outlives the call.** Opening reads a page, not the 290 MB file
  (7 ms measured), and a held handle would sit on a database another process is writing.

The legacy tree still answers when the database does not, for an install that never migrated
(`legacyCandidates` / `legacySessionTailText`, ids `[A-Za-z0-9_-]`-checked before `path.join`,
C7). `TAIL_SOURCES` changed shape from `{ candidates, parse }` to `{ candidates, read }`
because opencode's reader owns the whole read; the `sourcePath === undefined → null` guard
moved INTO the Claude/Codex closures, since opencode's candidates carry no path.

**Verification.** `electron/resume` suites **45/45** and `tsc -p tsconfig.electron.json`
clean. A `tsx` smoke against the owner's real `opencode.db` resolved the live `spacevibe-api`
pane to its own session id and to the exact sentence visible in the terminal, and two panes in
one cwd took two different sessions. **No full suite, no bundle, no native `electron:dev`
pass, no owner eye review.** Electron only; on Tauri the rail keeps its fallback.
## One line, and the sentence takes the agent's name — 2026-08-17

Hours after the section below: the turn stopped being a SECOND line and took the agent name's
slot, so every rail row is one line — and the tab strip's chips print the same sentence. Both
are owner calls made from the shipped rail; [DL-27.15](DESIGN-LANGUAGE.md) and
[DL-18.10](DESIGN-LANGUAGE.md) `current` carry the amendments, and DL-20.1 gained a fourth
radius role for the chip.

**Why the name went.** A project running three `claude` panes printed `claude` three times:
the word was already said by the brand glyph beside it, and the only text telling those rows
apart was the sentence underneath — which was also the text being trimmed hardest. Two
exceptions keep a word that exists nowhere else and let the turn follow it on the same line: a
name the USER typed, and an unlabelled row (no cluster header to carry the project name). A
pane that has said nothing keeps its agent name, so no row is ever blank. **Accepted cost:**
sharing the line with the age and the state mark trims the sentence sooner than a full-width
second line did — roughly 30 characters at the 276px specimen width. The sidebar is resizable
(DL-18.9) and the whole sentence stays in `title` and the accessible name (DL-27.4).

**The model got simpler, not richer.** `RailPaneRow.message` is now the tail or empty — the
custom-name fallback in [`agent-rail-model.ts`](../src/ui/agent-rail-model.ts) `current` is
gone, because the name it fell back to now stands on the row itself. `RailTabRow` gained one
boolean, `named`, which is the whole of the "a typed name is not replaceable" rule.
`.asr-leaf--flat` took the tab row's own height and padding (34px, 6px): with the turn on one
line a leaf and a tab row are the same object seen twice, and 4px of difference read as two
lists.

**The strip quotes the rail, through the rail's own precedence.**
[`tabTail`](../src/ui/agent-rail-model.ts) `current` is exported for `TabStrip`, so "which
pane speaks for this tab" is answered in ONE place. The chip reports no agent STATE —
everything 2026-08-16 took off it stays off. Paying for the longer text: `--radius-flat` (2px,
DL-20.1's new dense-row role), `--type-meta` instead of `--type-body`, `max-width: 210px`, and
the label's own 140px cap removed so the trim lives in one place.

**Verification.** Rail and strip suites green; `design-language.test.ts` green after its
radius gate learned the new role. Gallery screenshots at 276px rail width: every row 34px,
chips at 2px radius / 11px / ≤210px. `paneTails` is now seeded in the gallery
([`SEED_PANE_TAILS`](../src/gallery/seed-data.ts) `current`) — without it no specimen could
show a turn, since a browser has no session log. `npm run build` clean, and the four owning
suites 95/95. The full suite read 2997 pass / 4 fail, **every failure belonging to a session
running concurrently in this same checkout** (files last written 15:49–15:51, importing
nothing from this work); that session also briefly broke `src/ui/app.tsx` mid-run, which is
worth knowing when a build here fails in a file nobody in this task opened. **Owed: the
native `electron:dev` pass and the owner eye review**, on both surfaces.
## The rail says what the agent just said — 2026-08-17

Tier 3 of the agent status rail: every rail row spends its second line on the agent's newest
turn, and a quiet row dims — the HYBRID of the two variants the owner approved from
[`attention-direction.tsx`](../src/gallery/sections/attention-direction.tsx) `current`, not
either alone. New [DL-27.15](DESIGN-LANGUAGE.md) `current`; DL-27.11's "only `asked`/`failed`
may spend a second line" is superseded. Two frozen decisions were overridden on the owner's
explicit ask that day, recorded here rather than edited out of the
[spec](specs/2026-08-16-agent-status-rail-design.md) `decided`: §2.6's "a message line is
exceptional" and §10's sequencing gate ("tier 1 native pass before tier 3 starts").

### Where the sentence comes from

[`session-tail.ts`](../electron/resume/session-tail.ts) `current` reads it off the agent's own
session log, in the main process, over a new flat `session_tail` channel (R6) mirroring
`resume_lookup` request-for-request. It reuses the resume scanners rather than re-walking
disk: `CandidateSession` gained an optional `sourcePath`, which `SessionRecord` already
declared, so **neither `claude.ts` nor `codex.ts` changed at all** (the one deviation from the
plan, which asked for a second name for the same thing).
[`tailBytes`](../electron/resume/head.ts) `current` is `headBytes`' mirror: `lstat`-guarded,
symlink-refusing, reading the LAST 64 KiB. Ranking, the 30-day cutoff and the greedy
`takenByAgent` dedup are `resolveResume`'s, imported rather than copied — without the dedup,
two panes running one agent in one cwd would wear the same sentence. `claude`, `codex` and
`opencode` produce a real tail; `gemini` (no candidate scan), `agy` (protobuf, no schema) and
declared custom agents answer `null`. Every failure answers `null` AT ITS OWN POSITION, so a
batch of eight panes cannot lose seven because one scan tripped.

### When it asks

[`session-tail-store.ts`](../src/terminal/session-tail-store.ts) `current` is a window-scoped
signal store (R5) driven by `tabViews`, **never by a timer**: a 300ms debounce, a fingerprint
of every agent pane's `changedAt`, one batch in flight with the latest fingerprint winning.
Two rules carry its correctness. **Only a pane with `hasRun === true` is asked**, because a
freshly opened pane's cwd may hold yesterday's session and the rail would dress a silent pane
in someone else's sentence. And **a `null` answer keeps the previous tail** — a scan that
raced a write is not evidence the pane never spoke. The sent fingerprint is claimed before the
await and kept on failure: resetting it would turn `pane-info-poller`'s 2s cadence into a
retry loop.

### v1 limits, accepted

A pane spawned in a subdirectory or another worktree drifts from its tab's `workspacePath`, so
its tail stays null; a tail refreshed mid-turn can show a partial sentence; a `failed` pane
shows its last assistant text, not the error line.

### Verification state

Electron only; on Tauri the rail degrades to the custom-name fallback. `npm test` 2968 pass /
253 files, `npm run build`, `generate:menu:check` and `electron:build` all clean on
2026-08-17. **The native `electron:dev` pass and the owner eye review of the running rail are
both OWED** — a gallery pass on the real `AgentRail` is the only visual evidence. Windows
unverified (Gate C).
## `New`, and a pane you can drag into place — 2026-08-16

`New` sits in the sidebar frame immediately after the hide control (owner, 2026-08-19),
leaving the rail for live project rows only. It answers "another one, where?" two ways:
clicked, it opens the Open board; dragged onto a pane, it docks an agent pane at that pane's
nearest edge inside the tab already open
([DL-27.14](DESIGN-LANGUAGE.md#27-the-agent-status-rail) `current`). The frame control is
compact — 24px high, `--type-body` label, `CHROME_ICON` glyph, beside `SidebarToggle`; only
the mount changed when it moved.

**Which agent, and why nobody is asked.** The owner chose spawn-immediately over a picker, so
the drop is the confirmation and the agent comes from memory:
[`agentForWorkspace`](../src/lib/workspace-recents.ts) `current` reads the target tab's
workspace `lastAgent` through `resolveAgentChoice` against a live `detect_agents` probe. The
probe is AWAITED — a resolution against a not-yet-answered list silently spawns a Shell. A
folder never opened takes the first detected agent, a host detecting none opens a plain shell,
and a remembered agent whose binary has left `$PATH` falls back silently, since there is no
step left in which to warn.

**The seam.** [`dropAgentPane`](../src/terminal/tab-manager.ts) `current` is the first agent
launch that adds a pane to a LIVE tab, and therefore the only `arm` call outside
`materialize`. That is safe because `AgentLauncher.arm` merges per pane id rather than
replacing the pending set, which session restore depends on. Underneath it,
[`dockNewPaneAt`](../src/terminal/terminal-manager.ts) `current` follows
`adoptIntoActiveTab`'s shape — NOT `splitLeaf`, which takes a direction and always appends to
branch `b`, so a left or top drop would land on the wrong side. A test pins it: a `left` drop
leaves pane order `[2, 1]`.

**The drag.** [`new-pane-drag.ts`](../src/ui/new-pane-drag.ts) `current` is a new controller
rather than a mode of `pane-drag.ts`: it carries no source pane, so no slot is excluded and a
one-pane tab is a legal target, where the pane drag refuses below two. It reuses that module's
pure `dropTargetAt`/`edgeFor` and its ghost/overlay CSS verbatim, so the two drags cannot look
different. Below the 5px threshold the button's own `click` fires untouched; above it, a click
released back over the row is swallowed once. The drag reports "no targets" whenever the stage
is covered — a browser or document surface (`surfaceActive`) and `panelObscured()` for the
board, Settings and every modal. Both matter: the `WebContentsView` sits above the renderer
DOM (the ⌘T-under-the-picker bug in another shape), and the rail keeps its column while
Settings covers only the stage. A ZOOMED tab is handled rather than excluded —
`slotRects()` collapses to the zoomed pane at the container's rect, because `layout.slotRects()`
keeps returning the hidden grid's geometry while the zoom overlay covers it.

**Evidence.** `npm run build`, `electron:build` and `generate:menu:check` exit 0; 23 new tests
(9 drag controller, 6 `dropAgentPane`/`activeSlotRects`, 8 `agentForWorkspace`) alongside the
rail's own 26. Renderer only, so it reaches Tauri, where nothing has been run. **No hand has
dragged it** — every drop in the suite is a synthesized pointer sequence over fabricated
rects, so the ghost has never been seen over a real xterm canvas or a `WebContentsView`, and
there is no owner eye review.
## The rail speaks the dev's states, and a multi-agent tab is a tree — 2026-08-16

The rail's five states read from the dev's side
([`paneState`](../src/ui/agent-rail-model.ts) `current`, DL-27.3): `asked` (yellow) is
everything needing your eyes — a question, a permission wait, or a finished run you have not
checked; the accent `done` ring folded into it as a TEMPORARY owner call, and the tracker
still keeps `completed` distinct so unfolding is one case label. A quiet pane splits on a new
tracker bit, [`hasRun`](../src/terminal/agent-attention.ts) `current`: `done` (ran, you
checked) versus `idle` (never ran). A tab running several agents listed each pane as an
always-visible leaf row joined by a hairline elbow (new DL-27.13, reversing DL-27.11's
two-level rule the same day); the chip budget, `+N` and the joined `claude + codex` identity
died with it. Owner-picked from
[`agent-rail-variants.tsx`](../src/gallery/agent-rail-variants.tsx) `current`, kept as the
approved record. Typecheck plus a gallery mount only; **no `npm test`, no native pass, no
owner eye review**.

**Superseded in part:** the trailing state vocabulary collapsed to one static dot on
2026-08-19, and DL-27.13's tree went behind `PANE_TREE_HIDDEN` on 2026-08-16 — see
[one tab, one frame](#one-tab-one-frame--2026-08-20). Full prose in
[CONTEXT-archive.md](CONTEXT-archive.md) `deprecated`.
## The icons are Phosphor now — 2026-08-16

Lucide is outline-only and `strokeWidth` is the whole of its expressive range, so a different
look meant a different package. Offered Phosphor, Tabler, Heroicons and "keep Lucide, retune
the weight", the owner chose **Phosphor**, and chose to see it before it was written.

- **The specimen came first and is already gone** — a gallery section drawing all 54 imported
  icons beside their proposed Phosphor names, at the four chrome sizes, under a live weight
  picker. The owner picked **`regular`**. The section was deleted in the swap: it was the last
  module importing `lucide-preact`.
- **Weight replaces stroke width.** Phosphor has no `strokeWidth`; `regular` reads closest to
  the `strokeWidth={1.8}` the retired set drew at.
- **The class the stylesheet targets is Deck's own now.** `.lucide` was a vendor convention
  the app's one icon rule had come to depend on; Phosphor emits no class, so `DeckIcon` emits
  `.deck-icon` unconditionally. A per-icon `.deck-icon--<name>` modifier derived from
  `displayName` exists **for tests only** — 31 assertions identified icons by the old class —
  and nothing in CSS may depend on it, because a minifier may drop a `displayName`.
- **Three icons changed what they depict, under one rule.** Phosphor draws no folder-with-git
  and no branch-with-plus, so the naive mapping put two different actions on one `GitBranch`,
  which DL-14.5 forbids: the live surface kept `GitBranch`, the parked rail's row took
  `GitFork`. `FolderX` → `FolderDashed` (a missing checkout, not a subtracted one),
  `FolderTree` → `TreeView`, `FileJson` → `BracketsCurly`. `PanelRight` is not a second
  drawing: `SidebarSimple` faces left and `DeckIcon` gained a `mirrored` prop.
- **Phosphor is a React package**, reaching Preact through the `preact/compat` alias
  `@preact/preset-vite` installs; `tsconfig.json` gained the matching `paths` entry, which
  changes how the whole repo typechecks from now on, not just icons.
- **Not verified.** `tsc --noEmit` clean (excluding two pre-existing failures another session
  left in `src/files/`) is the only gate that ran: **no `npm test`, no build, no native pass**,
  and DL-1.1's gzip ceiling has not been re-measured. The owner eye-reviewed the specimen, not
  the running app, and four substitutions chosen after that review have never been seen.
## The open board stops asking — 2026-08-16

The owner sent a screenshot of the board's Layout + Agent screen and said it was not needed.
Asked what a click on a recents row should do instead, they chose **open it straight through
with the combo it was last opened with**, over handing off to `AgentQuickPicker`; on the
layout half they chose to keep presets and remove only the board's picker. No spec or plan
document, by their choice.

**What the board is now.** Two views:
[`OpenBoard`](../src/open-board/open-board.tsx) `current` renders home, or the create-worktree
form. `BoardView` lost `"config"` and with it `configView()`, seven signals, the digit- and
arrow-key handling, and `open-board-layout-section.tsx` outright. What is left is one
function, `openWorkspace`, reached three ways — a click on a recents row, a folder from the
picker (⌘O / Ctrl+Shift+O), or a worktree the form just created — all calling `onOpen` with
the same `(workspace, preset, agent)` the config view's Open button used to.

**Where the combo comes from.** `lastPresetId` and `lastAgent` on the recent itself, which the
app already writes on every open. All three `lastAgent` cases are honoured: a string is that
agent, `null` is a remembered Shell-only open, `undefined` means first detected. That reverses
the config view's "Shell is only ever an explicit click", which existed because the chip row
would not pre-select it — without a chip row there is nothing to pre-select and refusing to
remember Shell would just be forgetting. A folder with no memory takes
`presetsData.lastUsedId`, or the first preset.

**The race the change created.** `detect_agents` is async, and one-click-opens makes a click
landing during the probe the normal case; `resolveAgentChoice` FALLS BACK rather than waiting,
so a remembered `claude` resolved against an empty list would have quietly opened a Shell. The
board holds the probe **promise** in a ref and awaits it inside the open path. Covered by a
test that holds the probe open across the click.

**What has no home any more.**

- **Warnings before the fact.** The footer said "X isn't installed — opens with Y"; there is
  no step between the click and the spawn to say it in, so a remembered agent missing from
  `$PATH` now falls back **silently**. Stopping the open to say it would be worse.
- **Preset rename and delete.** The layout cards were the only call sites of
  `renamePreset` / `deletePreset`; both stay exported from `presets-store` and are unreachable
  from the UI. Creating (⌘⇧N) and overwriting (⌘⇧S) are untouched. Named at removal time and
  accepted — restoring it needs a new home, most likely a settings section.
- **`EditorRequest`'s `"board"` source**, whose only producer was the `+ New Layout` card.

**Where a failure is said.** The config footer was the only place the board ever reported one,
and the reason still holds — the manager writes its error into a terminal behind this overlay,
and on a first run there is no terminal at all. Home grew one line, `.board-home__notice`
(`role="status"`, `--yellow` per DL-3.2), carrying both a failed spawn and a click on a row
whose folder is gone. A missing row stays clickable on purpose: an inert row explains nothing,
and the folder may have come back since the scan.

**Verification.** One gate: `npx tsc --noEmit` clean over the whole tree. No `npm test`, no
build, no native pass — the board's three test files were rewritten in this same pass and have
never been executed. The renderer is shared, so this reaches Tauri, where nothing has been run.
## The grab stops at the clipboard — 2026-08-16

The owner asked for react-grab's output to go to the clipboard only and to stop being typed
into an agent pane. Framed as temporary, so it is one constant, not a removal.

**The cut.** [`GRAB_PASTE_DISABLED`](../src/browser/browser-store.ts) `current` short-circuits
`deliverGrab` before it asks for the focused pane, so every non-empty grab reports
`clipboard`. Nothing else moved: `GrabTarget`, the `paste` seam, its wiring in `App`, the
preload's `isTrusted` gesture gate and rate limit, `sanitizeGrabText` and the injected
bootstrap are untouched. Reverting is flipping the constant and restoring two strings.

**What the clipboard holds.** react-grab's own copy, written from the page's copy path — the
component-and-source snippet, and NOT the `Page: <url>` line `formatGrab` appends, which only
ever existed on the paste path. Putting it in would mean Deck writing the clipboard a second
time behind the page's own write; that is the obvious follow-up if the missing URL turns out
to matter in use.

**Copy.** `grabSummary`'s `clipboard` branch stopped being an apology (`Element copied — no
pane to paste into` → `Element copied to the clipboard`), and `failed` reads `could not be
copied`, since with the paste path off the only way to fail is a grab with nothing in it.
`deliverGrab` took a third parameter defaulted to the constant so the kept-for-revert paste
path keeps its tests; the suite exercises both modes.

Evidence: `npx vitest run src/browser` 39 passed, 3 files. The full `npm test` and
`npm run build` were skipped at the owner's instruction, and there has been no native
`electron:dev` pass against a real page.
## One modal shell, and a scrim that closes — 2026-08-16

The owner reported that clicking outside `AgentQuickPicker` did nothing and asked for every
modal to be standardised onto one base component. `DESIGN-LANGUAGE` §29, new, with DL-1.3
amended. No spec or plan document, by their choice.

**What was actually there.** Three components — `AgentQuickPicker`, `SavePresetDialog`,
`PresetEditor` — each with its own scrim, `tabIndex={0}` panel, ref, focus-on-mount effect and
Escape branch; four copies counting the gallery's `ScrimStage`, which painted the wash twice.
None dismissed on a scrim click, and that is the shape of the bug: no single place was
responsible for saying they should. A z-index sweep confirmed the genre is exactly those three
— the full-window screens are §11, the popovers §13.

**The shell.** [`Modal`](../src/ui/modal.tsx) `current` owns the scrim, the `role="dialog"` +
`aria-modal` frame, focus-on-mount and both exits. A modal passes `panelClass`, a label,
`onDismiss`, its own `onKeyDown` and its body — the panel classes did not change, so neither
the stylesheet nor the z-40 ladder moved. `initialFocus` is a selector resolved inside the
panel: `SavePresetDialog` focuses its input, the other two take the panel, because bare digits
and arrows drive them.

**Dismissal reads the press, not the click.** A drag that starts inside the panel releases
outside it and the browser fires `click` on the nearest common ancestor, which is the scrim;
tracking `pointerdown` is what stops the modal closing on the gesture it just asked for
(DL-29.4). `PresetEditor` withdraws scrim dismissal outright (DL-29.3): its draft exists
nowhere else until "Create tab", so a slipped click there would be the one gesture in the app
that silently destroys work.

**The blur is a rule change, not a style tweak.** DL-1.3 banned `backdrop-filter` outright and
the renderer had zero uses; the rule is amended with a second scoped exception, on the
frugality argument that a modal scrim exists only while a modal is open, so its compositing
layer is transient. **That frugality claim is reasoned, not measured.** The blur RADIUS was
measured: `.modal-scrim` is a 42% `--bg` wash (down from 65%) plus `blur(10px)`, picked by
rendering the specimen over a synthetic terminal ground and comparing 6/10/14px — 6px still
let the line rhythm read as text, 14px erased the stage into a flat wash. Reading DL-1.3
closely also turned up three `filter` declarations the ledger never carried; recorded as open
rows in §10 and deliberately left alone.

**Two things rode along.** The `.achip` digit badges came off in BOTH mounts on the owner's
ask — the digits still pick, so order remains the contract, it just is not printed. And
`agentQuickPickerOpen` joined `panelObscured()`: it was already ranked `modal` by
`openOverlayRanks()`, but the list that hides the browser's native view never learned about
it, so ⌘T over an open browser tab drew the picker underneath the `WebContentsView`. It stays
OUT of `overlayCoversPane()` on purpose — that predicate answers "is the focused pane
covered", and the picker opens a new tab.

**Then the panel took the sidebar's ground.** Against the blur, a `--chrome-1` panel read as a
lighter smudge of the same background rather than an object. All three modals moved to
`--sidebar-bg` (DL-29.6, new), the only ground in the app that never appears on the stage,
which is what makes the panel unmistakably chrome.

**And the picker became a destination plus a column of rows** (DL-29.7, new). The target is
stated ONCE in a §5 config row above the list (`menu` value kind, a native `<select>` under
the styled pill per DL-1.4), and the agents are rows in a column rather than the board's
wrapped grid, which reads left-to-right-then-down and leaves "which destination do these
agents belong to" ambiguous. The board keeps its grid: there the chips are a value being set.
Worktree and branch are **one** choice, and that is git's doing — a worktree is checked out on
exactly one branch — so the row prints `folder · branch`. Selecting a branch independently
would mean `git checkout` inside a possibly-dirty worktree with another agent running in it;
the owner was offered that and declined. No new IPC: `git_repository` already returns every
worktree with its branch and `repositories-store` already caches scans for the rail.
[`worktree-destinations.ts`](../src/repositories/worktree-destinations.ts) `current` is the
pure half — it drops bare and prunable entries, computes `primary` on git's first non-bare
entry, and resolves the default through `worktreeForPath`'s longest-prefix rule. Three
deliberate edges: the scan is async, so the component resolves its selection on every render
instead of seeding state at mount; a digit typed while the `<select>` has focus is the
browser's type-to-select and must not launch a tab; and one worktree is not a choice, so it
renders as DL-17.3's readout. `git_repository` is Electron-only, so on Tauri the row is
**omitted**. The one seam that moved is `TabManager.openQuickAgent`, which took a second
argument — a destination overrides BOTH cwd and workspace tag, because tagging the tab with
the worktree it runs in is what files it under the right rail row; passing null reproduces the
old behaviour exactly (owner-approved fork: tab materialization).

**Evidence.** `npm test` 2872 passed / 1 failed — `file-tree-view`'s 10,000-row windowing
case, which times out at 5s under full-suite load and passes in 1.8s alone, in a file dated
2026-08-14 and untouched here. `npm run build` and `generate:menu:check` green;
`design-language.test.ts` resolves every new `DL-29.x` citation. Plus browser measurements
against the gallery specimen (the blur figure, and the destination pill's cap raised from
130px to 240px after the branch was eaten). **Owed: a native `electron:dev` pass and an owner
eye review** — a gallery specimen is a browser, not a host, so nothing establishes how the
blur composites over a real xterm canvas, and no worktree has actually been opened into.
## One strip, one chip, one order — 2026-08-16

The tab strip stopped being two segments. A terminal tab, a document and the browser share one
chip shape and sit in the order they were opened; the `.tabbar__sep` hairline that split
terminal chips from surface chips is gone from the strip (the feature toolbar still uses that
class to group buttons). DL-18.10, with DL-18.6 and DL-18.8 amended in place. Owner-approved
from a screenshot of another editor's tab bar, no spec or plan document.

**What a chip is now.** One 15px glyph slot holding exactly one mark, the label, the close
control — identical for every kind. A terminal chip leads with the agent's brand mark, or
`SquareTerminal` when no agent is recognised; a document takes the file-type icon the tree
already uses; the browser keeps its globe.
[`AgentGlyph`](../src/ui/controls/agent-glyph.tsx) `current` was lifted out of `AgentRail` so a
chip and a rail row cannot disagree about what an agent looks like.

**Then the chip was stripped to one job.** Reviewing it the same day, the owner took off
everything that was not "what is open": the colour dot, the agent attention mark, and the
rename popover. What is left is glyph + label + close, and a click on the chip that already
holds the stage does nothing. Agent state now lives in exactly one place — the rail. None of
the three features was deleted that day; the strip merely stepped out of them. Two
consequences: the strip no longer claims the window-wide popover slot (`tab-popover-slot.ts`,
whose whole point was arbitrating between the rail and the strip), and **⌘⇧R reached nothing
in top-tab mode** — moot since `TabPopover` and the chord were deleted outright later the same
day.

**Every chip got a resting wash, and the selected one a frame.** With the dot, mark and
popover gone the strip read as text floating in the terminal: an idle chip had no background
at all, and DL-21.1's 15% selection wash had nothing to be brighter than. `--tab-rest-bg` (3%
of `--tone`, new DL-21.7) gives every chip a body, so the ladder reads 3% → 6% hover → 15%
selected; the selected chip adds a neutral 1px `--hair-strong` frame (a scoped exception in
DL-21.1, neutral so it is not the retired accent marker DL-21.6 returning), and every chip
carries that border as `transparent` at all times so selection changes a colour and never the
row's geometry. The reason both exist: **a chip has no list around it.** A rail row sits among
rows on a painted column, so "no wash" means _not selected_; a chip floats alone on the stage's
`--bg`, where "no wash" means _nothing is here_.

**The strip closes with a seam.** `.stage__strip` draws the same `--seam-recessed` hairline
along its bottom edge that `.tabbar` always drew in top-tab mode (DL-18.6 amended), so both
layouts mark where chrome ends the same way. It is `box-sizing: border-box`, so the line costs
no height.

**The colour dot lasted one revision.** The first cut kept the per-tab dot as a badge on the
brand mark's corner, to avoid silently retiring the colour picker; the owner removed both the
same day — two marks in one 15px box read as noise. The picker left `TabPopover` **parked, not
deleted**, at the owner's word: `dotColor` still round-trips through settings,
`tab-materialize.ts` and session restore. The only dot left on the strip is the document
chip's unsaved marker. In the same pass the close control's hover dropped its red tint for
DL-21.2's neutral wash — closing a tab has an undo (⌘⇧T), so it was spending DL-3.2's danger
colour on an everyday action; `.wsitem__close` and `.asr-row__action--close` were left alone.

**Order, and why it is not just paint.** Three owners publish chips — `TabManager`, the file
store and the browser store — and none can see the others, so a per-owner counter could only
order that owner's own chips. One window-wide clock
([`open-sequence.ts`](../src/lib/open-sequence.ts) `current`) stamps every open, and
[`mergeStripOrder`](../src/lib/strip-order.ts) `current` merges the two index spaces.
**`TabManager` and `TabStrip` both consume that merge**, which is why it lives in `src/lib/`:
⌘⇧[ / ⌘⇧], ⌘1–9 and ⌘9 count CHIPS, so ⌘2 can land on a document — reversing the 2026-08-14
"digits stay terminal-only" rule on the owner's explicit call.

**The seam held.** `SurfaceStrip` gained exactly one optional method, `orderKey(index)` —
TabManager learns when a surface was opened and still nothing about what a surface IS
(file-explorer spec §2.3). An implementation without it reads as `UNSEQUENCED`, reproducing
the old terminals-then-surfaces strip exactly, so every existing fake keeps compiling. No PTY,
window, materialization or close path changed.

**Two things deliberately did not change.** The green labels in the owner's reference are
another editor's git-status colouring, and Deck's file model has no git status. Sidebar mode
still scopes terminal chips to the active repository — the merge orders whatever that scope
leaves visible.

**Evidence.** `npm test` 2818 passed / 2 failed, both outside this work (`icon-system`
reporting an untracked file from the unmerged session-history branch, and the 10,000-row
`file-tree-view` windowing test that times out only under full-suite parallelism).
`npm run build` and `generate:menu:check` clean. The merged strip was rendered and read in the
gallery, which now seeds a document opened before the terminal tabs and one after them so the
interleave is visible rather than implied. **Owed: a native `electron:dev` pass and the
owner's eye review.** Renderer only, so it reaches Tauri, where nothing has been run.
## The docked column became a side panel with tabs — 2026-08-16

The right column stopped belonging to the file explorer: it hosts three surfaces as tabs —
file explorer, token usage, session history — and one control on the stage strip opens and
closes it.

**What moved.** Token usage and session history left the full-window class (§11) for tabs of
the column, so [`UsageBody`](../src/ui/usage/usage-body.tsx) `current` and
[`SessionsBody`](../src/ui/sessions/sessions-body.tsx) `current` were extracted from their
screens with a `variant` laying them out for a 360–560px column. `ExplorerPanel` became
[`ExplorerTab`](../src/files/ui/explorer-tab.tsx) `current` — the tree and its empty state,
nothing else — while the column, its resize grip and its drag-past-the-floor close moved into
[`DockPanel`](../src/ui/dock/dock-panel.tsx) `current`. The browser did NOT move back: it
stays a stage tab (DL-18.8).

**Why the toggle is on the stage.** The explorer's hide control lived inside the panel's own
header, so closing the column took its only visible way back with it — the failure the owner
caught. It is [`DockToggle`](../src/ui/dock/dock-toggle.tsx) `current`, last in the tab strip,
mirroring `SidebarToggle` first in it. Both are components rather than markup inlined in
`App`, because the gallery composes `DesktopChrome` itself and anything written inside `App`'s
stage JSX is invisible to every specimen.

**Settings and Prompts went the other way**, into a pinned footer at the bottom of the rail
([`SidebarActions`](../src/ui/sidebar-actions.tsx) `current`, new DL §28). Top-tab mode has no
rail, so `DeckToolbar`'s `compact` mode stands the same two rows up in `More`.

**Consequences.** `usageOpen`/`sessionsOpen` are gone: a docked column displaces the terminal
grid rather than covering it (DL-19.1), so those two left `openOverlayRanks()` and
`overlayCoversPane()` along with the three-way mutual exclusion with Settings, and
`toggle-usage` dropped from `scope: "always"` back to `"pane"`. `explorerOpen`/`explorerWidth`
are retired into `electron/settings-merge.ts`'s `RETIRED_KEYS`; `dockWidth` starts at 420 with
a 360 floor, so a user who kept a 180px file tree cannot have one any more — one column
serving three surfaces takes its floor from the widest. **The bottom status row went with it:**
`showStatusBar` ships false and `window--no-status` zeroes `--status-h`, so the grid loses the
band rather than painting 28px of empty chrome; the component is untouched and Settings ▸
Appearance brings it back.

**Two loose ends.** `UsageScreen` and `SessionsScreen` were deleted, but both bodies keep an
unreachable `variant="screen"` branch and their `*-screen__*` CSS — removing them is a
follow-up pass. And `VIEW_PANEL_ID` / `viewTabId()` in
[`usage-views.ts`](../src/ui/usage/usage-views.ts) `current` are unscoped DOM ids shared by the
nav's `aria-controls` and the section — safe only while one usage surface exists at a time.

**Verified by suite and build only.** `npm test`, `npm run build`, `generate:menu:check` and
`electron:build` all pass. Nothing has been run natively, there is no gallery specimen for the
new column, and the narrow usage/sessions layouts have never been seen rendered. Session
history is built on `src/ui/sessions/`, an untracked copy of an unmerged branch at the time.
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
- macOS is the current public release; Windows 11 x64 shipped as an engineering preview and
  now ships unsigned on the Electron tag path (Gate C).
- Surfaces: layout presets and the preset editor, pane swap, multi-window move/join, the Open
  board (reached from the rail's "Open workspace" row), AgentQuickPicker (the tab strip's
  `+`/⌘T fast path — single pane, no workspace/preset step), the file explorer with preview
  and diff, and a full-window Settings screen with a category rail
  ([`SettingsScreen`](../src/ui/settings/settings-screen.tsx) `current`,
  [category registry](../src/ui/settings/settings-categories.ts) `current`) — a new category
  is one registry entry plus one file under `sections/`.
- Agents are user-extensible: beyond the six built-ins, an agent is a label plus a full
  command line declared in Settings → Agents ([catalog](../src/lib/agent-catalog.ts)
  `current`, [section](../src/ui/settings/sections/agents-section.tsx) `current`). A built-in
  id equals its binary name, so a workspace's remembered `lastAgent` resolves without
  migration. Discovery probes only names that pass
  [`is_probe_safe`](../src-tauri/src/agents.rs) `current` — the macOS Tauri probe
  interpolates them into a shell.
- Session persists chrome only, never CWD; presets carry optional per-pane CWDs separately.
  (Session RESTORE of agent conversations arrived 2026-08-15 and is Electron-only.)
- Out of scope: embedding agent UI, SSH, chasing iTerm parity, editing from the sidebar.
## Windows engineering preview — 2026-07-29

Tauri-era boundaries, still the source of every Windows claim Deck makes:

- Windows prefers `pwsh.exe`, falls back to `powershell.exe`, uses `USERPROFILE`, and injects
  session-only prompt/CWD integration
  ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L12-L113) `current`).
- Each Windows pane owns a Job Object; WMI process snapshots expose explicit CWD/process/kind/
  agent truth and fail closed to `unknown`
  ([platform session](../src-tauri/src/platform/windows/mod.rs#L14-L84) `current`).
- Windows paths support drive, relative, Unicode and location suffixes. **UNC candidates are
  recognized but never resolved** — hover and open-in-editor reject a `\\`-root before any
  filesystem call, so a UNC path is copy-pasteable and not clickable
  ([terminal-links.ts](../src/lib/terminal-links.ts) `current`). Editor requests are
  structured and Windows custom templates are argv, not shell commands.
- The Windows keymap, primary modifier, visible labels, clipboard chords and native decorated
  chrome are platform-owned
  ([WINDOWS_KEYMAP](../src/terminal/default-keymaps.ts#L289-L358) `current`).
- Resolved 2026-08-10: the capture-phase listener left `Ctrl+V` unbound, so it reached the
  active agent and Codex treated a text paste as an image paste. Deck now owns `Ctrl+V`,
  `Ctrl+Shift+V` and physical `Shift+Insert` **for text only**. `Alt+V` stays unbound; Explorer
  Copy of a folder (`CF_HDROP`) and smart clipboard routing are unsupported.
- PR CI compiles the Windows desktop without producing an installer; run 30475656139 passed
  Linux and Windows on 2026-07-29.

Delivery state: an unsigned NSIS setup shipped as the
[v0.9.0-windows-preview](https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0-windows-preview)
prerelease (2026-07-31), with the landing resolving its download link at load time. **Gates
W1–W4 and the full real-device checklist remain pending**
([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance)
`decided`), as do real Windows screenshots at `1100x720` / `480x320` in both layouts. First
field report, 2026-08-01: the installer fails with an NSIS "Extract: error writing" when
targeting a secondary drive; the default per-user install to `%LOCALAPPDATA%` succeeds.
Signing is still pending, so SmartScreen warns on install and the landing says so. Full prose
in [CONTEXT-archive.md](CONTEXT-archive.md) `deprecated`.
## Stack

Preact + xterm.js in the renderer, reaching whichever host it runs under through the facades
in `src/host/`. `main` carries two hosts: Tauri 2 + Rust (feature-frozen) and Electron (where
new features land). Signals for state; module stores are window-scoped. The PTY/window
coordinator, tab materialize, layout engine and close-coordinator paths are the load-bearing
seams (R4) on both hosts.
## Cross-platform auto-update — 2026-08-03

The Tauri updater's shape, still the reference for what a release owes:

- Deck checks once after launch and exposes `Update` → `Downloading…` →
  `Install & Relaunch`; download and installation require separate clicks
  ([controller](../src/updater/update-controller.ts#L82-L208) `current`). The macOS App menu
  gained `Check for Updates…` and `Release Notes…` on 2026-08-04; current/error checks receive
  native feedback and never start a download.
- Installation reuses fresh pane inspection with update-specific copy, flushes pending
  settings, and retains retry state on any failure.
- Tauri grants only updater check/download/install and process restart; macOS points at stable
  `latest.json`, Windows at the fixed unsigned preview channel, and updater artifacts are
  enabled only by the release config.
- The tag workflow isolates macOS stable from Windows preview, keeps both drafts until their
  gates pass, and promotes Windows `latest.json` only from an exact-SHA artifact with checked
  digests and release-asset membership
  ([validator](../scripts/verify-updater-manifest.mjs) `current`).
- Every active `feat`/`fix`/`perf` commit must declare `Release-Note: <description>` or
  `Release-Note: skip` before either draft build; reverts are removed, `skip` wins, breaking
  metadata routes into its own section, and a release with no public entry fails rather than
  publishing generic copy ([generator](../scripts/generate-release-notes.mjs) `current`).

Gates left open at the time: the changelog URL returned 404 on 2026-08-04; the real Windows
11 update run was deliberately skipped; and the `1100x720` / `480x320` screenshots in both
layouts never got owner eye approval. Full prose in
[CONTEXT-archive.md](CONTEXT-archive.md) `deprecated`.
## Hardened updater — 0.11.0, shipped 2026-08-05

`0.11.0` is the bootstrap the rest of the update story rests on: from here every later patch
reaches users on its own. The release validator reproduces Tauri's Minisign check in Node —
packet parsing, key-id equality, BLAKE2b-512 prehashing for `ED`, the payload signature and
the trusted-comment global signature — over bytes **re-downloaded from the exact draft**, not
over the staging directory; macOS gained the same collect → re-download → verify → publish
gate Windows already had (before this it only checked that a signature string was non-empty);
and the updater plugin is pinned to a fork revision carrying upstream PR #3516 plus a macOS
transactional swap.

Verified on real hardware, 2026-08-05: macOS `0.11.0-rc.1` → `rc.2` upgraded end to end
through an isolated RC channel, with the installed bundle keeping mode `0755` rather than the
extraction directory's `0700` (upstream #3506 proven fixed at runtime); a manifest advertising
a non-existent `rc.3` with one flipped signature byte was downloaded and refused; both
published channels re-verified against live bytes. **Windows end-to-end was skipped by
decision**, failure injection with it.

**Three things to check before buying signing certificates** — none about the certificates,
all about what gets edited in the same sitting:

1. **Never rotate the updater keypair.** Its public half is compiled into every build already
   in the field, so a new keypair makes old builds refuse new ones and every user reinstalls
   by hand.
2. **macOS: changing the signing identity resets TCC.** Permissions are bound to the code
   signature, so moving from ad-hoc to Developer ID makes macOS treat it as a different app —
   updates still install, the app just forgets it was ever allowed.
3. **Windows: keep `bundle.publisher` byte-identical.** NSIS derives its product identity from
   it, so changing it to match a certificate's legal name makes the installer place a second
   copy beside the first instead of upgrading.
## Reaching updates without a menu bar — 0.12.0

`src-tauri/src/menu.rs` is gated `#[cfg(target_os = "macos")]` end to end, so Windows had no
menu and therefore no `Check for Updates…`; the chrome button only appears once an update has
been found, leaving a Windows user with no pending update unable to ask for one without
restarting Deck. Settings gained an `about` category — two config rows on the existing
`action` kind, so §6's closed set needed no new entry
([section](../src/ui/settings/sections/about-section.tsx) `current`). The running version comes
from the bundle, not the updater, which reports an empty string until a check finds something;
and because sections take no props, `App` publishes its controller through a window-scoped
signal. The same pass gave OpenCode a brand mark — it was the only built-in wearing a letter
avatar beside three brand marks.
## Antigravity CLI becomes the fifth built-in — 2026-08-07

Google announced that Gemini CLI would stop serving free/Pro/Ultra users from 2026-06-18,
replaced by Antigravity CLI — command `agy`, a closed-source Go binary installed by a shell
script rather than npm. Nothing in Deck knew the name, so an `agy` pane classified as `busy`.

- `agy` joined `BUILTIN_AGENTS` and the row was reordered **by reach rather than by history**
  (Claude, Codex, OpenCode, Antigravity, Gemini) — a deliberate break with the digit keys
  people already had in their fingers. Gemini CLI stays: paid Code Assist licences still reach
  the service, and a built-in id equals its binary name, so dropping `gemini` would strand
  every `lastAgent` on disk holding that string.
- `agy` shares Gemini's `--cyan`. A new token sourced from `brightBlue` was the first choice
  and was dropped on evidence: `brightBlue` equals `blue` in three of four presets, so the dot
  would have read as the accent colour.
- Windows identifies it by executable name only — a single Go binary has no node wrapper, so
  there is no npm signature to match.
- Its brand mark is the first RASTER one in `AGENT_LOGOS` (Google publishes the icon as PNG),
  stored at 96px against a 15px chip — 3× headroom at 5.5 kB, checked on dark chrome to
  confirm the alpha channel is real and not a white plate.
- Known-open: its OSC 9;4 behaviour is unobserved — a closed-source binary cannot be read for
  it, so the activity tracker falls back to the sustained-output heuristic.
## Prompt Board — 2026-08-08

A chrome popover of reusable prompt templates: one click pastes a template body (plus optional
skill / subagent reference lines) into the agent session running in the pane that was focused
when the popover opened. ⌘⇧P / Ctrl+Shift+P or View → Prompts…. Zero new dependencies.

- Templates are `{id, label, body, autoSend}` in the settings store beside `customAgents`,
  validated with the same drop-not-repair discipline — a malformed entry is dropped, never
  guessed at, because its body is pasted verbatim into a live PTY.
- Injection rides xterm's **bracketed-paste** path ([`Pane.pasteText`](../src/terminal/pane.ts)
  `current`), the only route that lands a multi-line body in an agent TUI's composer as one
  block. Ordering of "paste frame, then `\r`" is structural, not timed: every write for a pane
  chains behind the previous one's settled promise in a per-pane FIFO queue
  ([`enqueueWrite`](../src/terminal/pane-lifecycle.ts) `current`), so `onData` keystrokes and a
  programmatic submit share one order.
- **`autoSend` is never an unconditional Enter.** Immediately before `\r` is enqueued, a triple
  gate is re-read: the pane still runs the SAME agent it ran at capture (fresh `pty_info`, not
  the 2s poll cache), its attention snapshot is `idle` with nothing latched beyond `completed`,
  and it is still in some tab's layout ([`submitAllowed`](../src/prompts/inject.ts) `current`).
  A failed gate degrades to paste-only and says "Pasted — not sent".
- Detection is a read-only Rust scan — no shell, no PTY. It walks `~/.claude/skills`,
  `~/.claude/agents`, the project's own `.claude/…` found by walking up from the pane's cwd,
  and every active plugin's `installPath`; Codex gets `~/.codex/skills` and
  `~/.codex/agents/*.toml`. Symlinks are refused rather than followed, reads are head-bounded
  at 16 KiB, results capped at 200 per kind, and a missing directory is an empty list rather
  than an error. Frontmatter and TOML are parsed by hand, keeping the zero-dependency rule. A
  Codex agent is named by its **file stem**, not its `name =` field — the stem is what the CLI
  loads by path, so a disagreeing field would send the wrong reference.
- The surface is DL §12 rows inside a new DL §13 anchored popover, plus `CommitTextarea`, the
  multi-line sibling of `CommitInput`. Restore Defaults wipes templates along with declared
  agents — it always did for agents; the confirm sentence now says so.

Verified 2026-08-08: `npm test` 1093 across 96 files, `npm run build` green,
`generate:menu:check` green, `cargo test` 151. **Known-open, deliberately:** nothing has driven
⌘⇧P inside a running desktop build, so a real paste into a live Claude composer, a real
auto-send through the gate, and the popover closing when its target pane's tab closes are all
unobserved outside unit tests. `agy`, `gemini` and `opencode` have no verified asset layout, so
a pane running one of them hides the pickers and pastes the body alone.
## Unified icon system — 2026-08-09

The app's functional icons came from one place for the first time: before this, chrome and the
settings rail carried hand-drawn SVG while rows, tabs and the search bar used typographic
characters (`×`, `▾`, `↹`, `↺`, `‹`, `›`, `↩`), so the same action was a picture in one
surface and a character in the next. The source was `lucide-preact` — **superseded 2026-08-16
by `@phosphor-icons/react`** — drawn through one component owning every presentation default
([`DeckIcon`](../src/ui/controls/deck-icon.tsx) `current`, [rules §14](DESIGN-LANGUAGE.md)
`current`).

Two findings outlived the library. **CSS is where this kind of contract dies**: a
`stroke-width` or `width` rule beats an SVG attribute, and two class rules had both — they
were deleted and their themed colours restated as `color` so `currentColor` resolves as
before. And a filesystem guard ([`icon-system.test.ts`](../scripts/icon-system.test.ts)
`current`) scans `src/**/*.{ts,tsx}` for authored `<svg>` and retired glyphs, with counts as
well as paths, so neither can come back quietly; it earned itself immediately by finding a
delete button the plan had missed. Outside the library on purpose: the Deck brand mark, agent
and OS logos, keyboard/terminal notation, status dots and `WorkspaceSpinner`.

**The marketing stage did NOT change and could not have:** `marketing/stage/appwin.js` draws
its own chrome icons as inline SVG strings and imports nothing from `src/`, so the app and the
film carry two icon sets that agree only because the marketing copies were traced from the
same drawings — `video:render` is a weaker gate than it looks. Visual review closed 2026-08-10
across all four themes through the Vite surface (macOS denied direct window capture for lack
of Screen Recording permission), which proves the rendered frontend, not Windows WebView2
parity. Full prose in [CONTEXT-archive.md](CONTEXT-archive.md) `deprecated`.
## Pane detach — Phase A landed 2026-08-10

Implemented from [the plan](plans/2026-08-10-pane-detach-window.md) `current`: the Rust
transfer transaction, the wave-1 frontend against fakes, the window lifecycle, then the
frontend integration. Sections A, B and C are complete; **section D (cross-window drag) was
not started** and stays behind the plan's §0.7 gate.

**Verified by command:** `cargo test --locked` 239 passed, `cargo fmt --check` clean,
`npm test` 1244 across 105 files, `npm run build` clean, `generate:menu:check` exits 0 with
`menu_registry.rs` regenerated. Bundle 172.68 → 180.40 kB gzip, entirely
`@xterm/addon-serialize` (the one dependency the spec pre-approved).

**One bug the gates could not see, found by pressing the key.** The first ⌘⇧M failed:
`open_pane_window` declared a single `args: OpenPaneWindowArgs` parameter while the frontend
sent the frozen contract's flat `{ token, screenX?, screenY? }`. Tauri resolves each command
parameter by looking its camelCased name up in the invoke payload, so it demanded a key
literally named `args`. **That mismatch compiles, type-checks and passes every unit test** —
Vitest mocks the PTY client, `tsc` has never heard of a Rust signature, and `cargo test`
cannot read `src/`. Fixed by taking the three arguments flat; a sweep of all 30 commands found
no second instance, and the [IPC contract test](../scripts/ipc-contract.test.ts) `current` now
parses both sides — the only gate in this repo that crosses the IPC boundary.

**Verified by hand 2026-08-10, after that fix:** ⌘⇧M detaches a pane into a second window and
**the scrollback arrives intact**, so `prepare` → `stage` → `open_pane_window` → `claim` →
`commit` all run end to end against a real PTY.

**Still NOT verified**, and no automated gate can see any of it — the outstanding manual pass
under `npm run tauri dev`: typing in the new window reaches the **same process**; the route
lock held across `app.emit_to` does not **hang** when a window closes while several panes
write; force-killing the destination webview kills the PTY rather than leaking it; destroying
the destination before it claims returns the source pane **immediately** (a ten-second wait
means `reserve_destination` did not run); ⌘Q with a busy agent in a non-focused window raises
exactly one dialog; closing one window of two kills only its panes and closing the last
actually exits; a setting changed in each window sticks and survives relaunch; and on Windows,
F5 in a detached window does nothing.

**A fork resolved on the day.** ⌘⇧M from a window holding exactly one pane is a **no-op with a
message**: moving that pane to a new window closes this window and opens another holding the
same pane, so the window is swapped, its geometry lost, and the pane risked through a whole
transaction for no observable change. The condition is **window-level, not tab-level** — a
second tab keeps the window alive — and only the new-window target is guarded, since offering
the pane to an existing window merges it and stays meaningful.
## Electron migration — prep opened 2026-08-11

Deck leaves Tauri for an Electron host written in Node/TS. The motivation is ship speed and
DX — the Rust seams are correct, they are just slow to move in — and it buys nothing a user
can see: a larger binary, more RAM, and a one-time loss of every stored setting. **Tauri
feature work froze from this date** (hotfixes still ship), with the token usage dashboard and
pane-detach Phase B re-targeted rather than cancelled. Design in the
[spec](specs/2026-08-11-electron-migration-design.md) `decided`, sequence in the
[prep plan](plans/2026-08-11-electron-migration-prep.md) `current`.

The public "no Electron" proof point is replaced by "no accounts, no telemetry" as the lead,
with "made for agent CLIs" beside it — deliberately NOT a performance claim, since Electron
would make one false and a claim a competitor can disprove is worse than none. **The freeze
ends on gates, not on a calendar**, because the motivation has never been measured in hours,
so any deadline would have been a guess enforced against real work; the accepted cost is that
a hanging gate hangs the freeze.

**Spike baseline — 7/7 passed, and the same script passes inside the packaged universal
`.app`**, which is the only version of the proof that means anything. Four packaging findings
that still bind:

- **`node-pty` 1.1.0 is pure N-API** — 38 `napi_*` imports and zero `v8::`/`node::` internal
  symbols — so its prebuilds are ABI-stable across Electron versions and the plan's stated
  Gate B risk is mostly not real. The loader picks `prebuilds/<platform>-<arch>` **at
  runtime**, so a universal app ships both directories and the addon never needs `lipo`.
- **The npm tarball ships `spawn-helper` without the exec bit** (`0644`), and node-pty's
  `postinstall` only chmods `build/Release/`, never `prebuilds/`. The symptom is
  `posix_spawnp failed` on the first spawn and nothing else. Same failure family as the Tauri
  updater's #3506: **file modes are where this project keeps getting bitten.**
- **`asarUnpack` for `node-pty` is mandatory, not tuning** — `unixTerminal.js` rewrites
  `app.asar` → `app.asar.unpacked` in the `spawn-helper` path, so the module is unusable from
  inside an asar.
- **`mac.x64ArchFiles` is required** for the universal merge: `@electron/universal` refuses
  single-arch Mach-O files identical in both arch builds, which is exactly what node-pty's
  per-arch prebuild directories are.

**Measured size, apples to apples:** the packaged universal spike `.app` is **502 MB** (486 MB
Chromium, 16 MB app code) against the installed universal Tauri build's **33 MB** — roughly
**15×**, the concrete form of the "binary size accepted for DX" decision. RAM was not measured.

Gate status at the time, none passed: **A** (`electron-updater` E2E) blocked on the Apple
Developer Program not being bought, since Squirrel.Mac refuses an app that is not Developer ID
signed and notarized; **B** (`node-pty` universal in CI) partial — a universal `.app` builds
locally and passes the spike from the bundle, but the gate says "in CI"; **C** (Windows
process semantics) blocked on no Windows machine, with ~1,100 audited lines of Rust and no
Node equivalent — the migration's top risk and the trigger for the plan's §0.2 abort
criterion. If Gate C can only be met with a native addon, the "pure Node/TS host" decision was
wrong and gets reopened explicitly.
## Electron MVP built — 2026-08-11

The host is implemented and runs the real app: ~4,100 lines of TypeScript replacing 10,504
lines of Rust, with the renderer unchanged apart from imports now pointing at 277 lines of
facades under `src/host/`. **The gate ordering was overridden by the owner** — both the prep
plan and the spec say an MVP plan may only be authored after gates A, B and C conclude, and A
and C were still open, so **a Gate C abort could still make this branch sunk cost**. Named and
accepted, not an oversight.

**Verified, and the distinction matters.** `npm test` 1383/1383 across 119 files — but the
suite mocks the host, so on its own it proves little about a migration whose whole point is
replacing the host. The evidence that counts is a headed smoke run (`npm run electron:smoke`,
10/10): the preload bridge is exposed, `contextIsolation` holds, **a terminal actually paints**
(34 xterm rows), agent detection finds all five built-ins over IPC, a real PTY echoes back
through `pty:output`, `pty_info` classifies the pane, and `kill_pty` succeeds for its owner.

**`pty_info` reads `ps`, not `node-pty`.** Measured: `.process` returned `"2.1.227"` for a real
`claude` pane — the CLI's version banner — and the executable name instead of argv0 for a
renamed job. Deck classifies panes by argv0, which is why the Rust twin reads
`KERN_PROCARGS2` rather than `p_comm`, so trusting `.process` would have labelled every agent
pane `Busy` and silently killed the agent chip, the dot colour and attention state. One
`ps -A` per poll tick, joined tty → `tpgid` → `pgid`: 69 ms for 717 rows against a 2 s interval.

**Windows is a stub that throws by name, not a port.** Porting ~1,100 audited lines blind
would manufacture confidence exactly where being wrong is worst: a bad classification either
lets quit kill a working agent or leaves the user unable to quit.

**Four bugs the gates caught, each a class rather than a typo:** `offer_transfer` sent
`targetLabel` while the host destructured `label` (caught by the new Electron IPC contract test
on its first run — the same mismatch that shipped `open_pane_window` with four green gates);
the host is CommonJS in an ESM repo, so a `.js` file was loaded as an ES module and died on
`exports` (emitting `.cjs` was the fix; an ESM main process would force interop on every
CommonJS dependency); Vite emitted absolute asset paths, which under `file://` resolve to the
filesystem root, 404, and produce a blank window with nothing on stderr; and a failed
background store write was swallowed (`void this.save()`) — exactly "how a full disk used to
look like a successful write" — now reported through an `onError` hook, with the test checked
by reverting the fix and watching it go red.

**One deliberate behaviour change:** `kill_pty` no longer unregisters the pane route, so the
`pty:exit` following a kill still reaches its owner instead of being dropped as "no route".
Not done at the time: the updater (Gate A), Windows (Gate C), cross-window drag, packaging and
the full manual pass.
## Browser panel + Inspect — 2026-08-12

Electron only. A web view loads a dev server, and Inspect turns any element on that page into
component-and-source context that lands in the focused agent pane. (The docked COLUMN became a
stage tab on 2026-08-15, and the grab stops at the clipboard since 2026-08-16; the machinery
below is unchanged.) The native view, the injected
bootstrap and the address-bar rules live in [`electron/browser/`](../electron/browser/view.ts)
`current`, the page-to-host bridge in
[`browser-preload.ts`](../electron/browser-preload.ts) `current`, react-grab 0.1.50 vendored in
[`electron/vendor/react-grab/`](../electron/vendor/react-grab/SOURCE.md) `current`, and grab
delivery plus sanitising in [`browser-store.ts`](../src/browser/browser-store.ts) `current`.

**Three facts shape all of it.** (1) **The web content is a native view, not an element** — it
paints above every DOM layer, so the renderer measures the hole and sends the rectangle, and
hides the view whenever an overlay opens; CSS cannot put anything in front of it. (2) **The
injection has to run in the page's MAIN world**, because React stores its fiber as an expando
and expandos are per-world; the bundle goes in through `executeJavaScript` and the grab comes
back out through a DOM `CustomEvent` the preload forwards — the only channel two worlds share.
(3) **The page is untrusted** and can dispatch the grab event itself, so the payload is parsed
defensively, length-capped, stripped of every C0 **and C1** control (an embedded `ESC[201~`, or
`U+009B 201~` without the ESC, would break out of the bracketed paste and be read as
keystrokes), and never submitted.

**Verified on a real window (2026-08-12).** `npm run electron:smoke` gained six checks and
they pass: the panel attaches a view and loads a page; the three page-world globals exist; a
grab crosses page → preload → IPC → renderer intact; Inspect arms react-grab; **no request
reaches react-grab.com**; closing destroys the page. Two defects that run found and the mocked
suite could not: `window.__REACT_GRAB__` was never set (disabling the bundle's self-init also
skips its `setGlobalApi` call), and `generateSnippet` can fail to settle in a throttled frame,
which meant no paste and no clipboard with nothing on screen — it now races a 2 s deadline and
falls back to the element's markup.

**The code review changed behaviour in six places.** The preload gates on `isTrusted` — a bit
page script cannot set — within 3 s, and both preload and host rate-limit; the view hides for
every floating surface, not just `overlayCoversPane()` (the Prompt Board popover opened inside
the panel's own column and was invisible); the toggle hides the page rather than destroying
it, which is what "reopening keeps the page" always claimed; grabs are sent from
`onCopySuccess` / `onAfterCopy`, after the bundle's abort race has decided, so a cancelled copy
no longer pastes; `browserHomeUrl` got a Settings category; and the `.js → .cjs` walk skips
`vendor/`. One finding did not survive verification: `webContents.close()` on already-destroyed
contents is a no-op on Electron 43, so the "stranded PTYs" fix became a guard.

**Two traps found while fixing, both now locked by tests.** An escape written `\n` inside
`inject.ts`'s template literal is consumed by TypeScript and emits a real newline into the
generated script — the injection was a SyntaxError and Inspect was dead on every page while
every `toContain` assertion passed; the test now runs `new Function(script)`. And a synthesised
DOM event can never exercise the `isTrusted` gate (`executeJavaScript(..., true)` marks user
activation, not trust) — only `sendInputEvent` into a focused view produces a trusted event,
which is how the smoke run drives a real copy.

**Not verified:** a real React dev server (component names and `file:line` come from react-grab
reading React's fiber; the transport is proven end to end, the richness of what it carries is
upstream behaviour), Windows (Gate C), and the panel under a real compositor.
## File explorer — model merged, surface dropped — 2026-08-12

Electron only. Built against the [plan](plans/2026-08-12-file-explorer.md) `partly-built` from
the [spec](specs/2026-08-12-file-explorer-design.md) `decided` — 34 of 36 tasks — then **split
in half before merge**, with the machinery merging and the chrome not. **Superseded 2026-08-14:
the surface was built on top of this model and host.** The split was a decision, not a
shortfall: the owner was redesigning the Electron chrome completely, and merging a second
docked-panel convention into a frame about to be redrawn would have meant paying for the
surface twice.

**What merged.** The **pure model** (`src/files/`) — tree, preview-slot promotion rules, the §5
external-change table, the dirty model, encoding/EOL, the path bound — none of which knows what
renders the text, so it survives an editor-engine change. The **host** (`electron/fs/`) —
`list_dir`, `read_file`, `write_file`, `stat_files`, `watch_paths`, `set_dirty_files`, every
one bounded to the workspace root by `path-guard.ts`; `writeAtomically` moved out of
`JsonStore` into `fs/write.ts` so there is one atomic writer, which **is a security fix on its
own** (the target branch still wrote settings through a fixed-name tmp file and a
symlink-following `fs.writeFile`). And an inert `SurfaceStrip` seam in `TabManager`, kept
because the invariants it encodes — "last surface, not last tab", the combined cycle index
space, `movePane`'s refusal, the `applySettings`/`focusActive` fan-out — are expensive to
retrofit and cheap to keep proven.

**The exits all changed together**, because any five of the six parts is a hole:
`app.on("before-quit")` returned early on an empty pane list, so a window holding only file
tabs would quit with unsaved edits and no prompt. The census carries `dirtyFiles`, and
installing an update is a **fourth** exit the spec's three did not count — `app_relaunch` calls
`app.exit(0)` and never reaches `before-quit` — so `confirmInstall` passes `dirtyPaths()`
itself. `confirmMessage` names a busy agent and unsaved files in ONE dialog.

**Two defects the new tests caught.** Saving through an existing symlink pointing OUT of the
workspace was allowed, because the link's parent was inside the root and the guard fell through
to its "new file" branch — a real escape, now refused by an `lstat` check. And the first file
tab got an editor with no model, because Monaco's dynamic import resolves after the model
effect has already run and nothing re-ran it.
## Redesign phase 2 — the chrome transfusion — 2026-08-14

The gallery-proven direction reached the app.
[Plan](plans/2026-08-13-redesign-phases-2-5.md) `current`,
[shipping addendum](specs/2026-08-13-direction-token-rebuild-design.md) `decided`, DL §20/§21
written, decisions D1–D12 owner-approved as written.

Ten steps plus the mirrors: the token layer (`--radius-control`/`--radius-surface`,
`--duration`/`--ease`, `--state-hover-bg`); the shell, where `.deck-frame` became the head of
the navigation column and the stage reaches the window's top edge (DL-18.3 rewritten); every
surface swept onto the tokens, closing four DL §10 ledger rows; both hosts' pre-paint grounds
matched to `--bg`; and the marketing mirrors re-shaped by hand — **they import nothing from
`src/`, so the next chrome change owes them another manual pass.**

**This is a cross-host visual change (D9).** `src/styles.css` is shared and Tauri ships it, so
nothing here may be labelled Electron-only.

**Evidence.** All automated gates green at every step (`npm test` 160 files / 1975 tests,
`build`, `generate:menu:check`, `electron:build`). Native macOS Electron screenshots for steps
1–3; a Linux Electron pass under xvfb exercising the real app end to end, with the browser
panel's `WebContentsView` hole measured **pixel-exact** against its DOM rect on both sides of
the IPC. **Still owed:** the owner's eye review of every step (DL §9.6), the `css-audit`
re-read, a native macOS pass over steps 4–10, **any Tauri run at all**, the top-tab layout
render, Windows anything, and light themes.
## Redesign phases 3–5 — toolbar, Gate M path, usage port — 2026-08-14

The same program, continued to the edge of what a Linux cloud session can verify.
[Plan §0.8](plans/2026-08-13-redesign-phases-2-5.md) `current` is the detailed record.

**Feature toolbar shipped (phase 3).** `DeckToolbar` projects registry actions into the
gallery-proven `FeatureToolbar`; `App` builds one element and both layouts mount it, so the
mounts cannot drift. `ChromeActions` is retired. Browser is docked by contract
([productization spec](specs/2026-08-13-browser-productization-design.md) `decided`), and DL
§23 governs the tooltip and the overflow menu, which got roving arrow-key focus.

**Gate M had a complete path (phase 4)** — now maintained as the
[`packaged Monaco smoke`](../electron-builder.monaco-smoke.yml) `current` (unsigned, local,
`--dir --publish never`), with a
[`monaco-smoke.html`](../monaco-smoke.html) `current` harness mounting the real `FileEditor`
plus one real xterm over the real hosts, and the
[`verifier`](../scripts/verify-electron-monaco-smoke-package.mjs) `current`, which checks the
packaged structure with a dependency-free asar reader and then drives typed focus markers,
tokenization, save-to-disk and `file://` asset health over CDP. **Superseded 2026-08-14: Gate M
ran packaged on the verification Mac, PASS 6/6. Retired 2026-08-23 as current explorer
acceptance; the renamed smoke is a packaging regression tool only.**

**The 2026-08-23 retirement pass made the verifier current again.** The old terminal assertion
read `document.body.innerText`, which stopped being evidence when xterm moved to WebGL — cells
paint to a canvas, and this machine's shell also interleaves ANSI autosuggestions with echoed
input. [`monaco-smoke-main.tsx`](../src/files/monaco-smoke-main.tsx) `current` now records the
real xterm→`writePty` input seam and the host→renderer output seam while still forwarding both
through production adapters; the
[`verifier`](../scripts/verify-electron-monaco-smoke-package.mjs) `current` waits for Monaco
tokenization/model changes rather than sampling their first frame. The macOS universal package
completed, the verifier passed twice consecutively, and its cleanup now terminates the detached
process group before deleting the fixture — the universal launcher otherwise left Electron
alive behind it and the next run exited under the single-instance lock. This proves the smoke,
not the reshaped explorer surface or its visual acceptance.

**The usage dashboard is landed and ported (phase 5).** The branch merged over `main` as a true
merge; DL gained §15/§16 in the reserved slots. The ~3,700-line Rust backend has a
module-for-module TypeScript port in `electron/usage/` — reader, discovery, both parsers,
atomic versioned cache (independent version space; cutover is a clean install), single-flight
scan yielding between bounded batches — behind `usage_snapshot`. **The parity gate is the
load-bearing piece:** a redacted JSONL fixture corpus is checked in with a golden snapshot
produced by the RUST scanner itself, and `electron/usage/parity.test.ts` deep-equals the port
against it, cold and warm.

**Browser restore (phase 5 §6.2).** `browserLastUrl` persists committed main-frame navigations
(a dedicated `browser:navigated` event; hash changes deliberately excluded) and the toggle's
cold open restores it, proven live against a real HTTP server across a hard kill. The
compositor manual pass and a real-React Inspect check stay owed.
## Straight-through completion run — explorer surface, board redesign, usage acceptance — 2026-08-14

Executed from the
[straight-through completion plan](plans/2026-08-14-straight-through-completion.md) `current`,
17 tasks in parallel tracks on `main` with no new branch. Full per-task evidence, screenshots
and raw command output live in
[the evidence record](review/2026-08-14-straight-through-evidence.md) `current`.

**Gate M passed packaged, on the owner's verification Mac — 6/6.** A file opens in the packaged
Monaco, syntax tokenization proves the packaged `editor.worker` chunk loaded, a keystroke
mutates the focused document, save reaches disk, no `file://` asset 404s inside DevTools, and
focus moves between Monaco and xterm without either capturing the other's keystrokes
([verifier](../scripts/verify-electron-monaco-smoke-package.mjs) `current`). "Edit marks dirty" is
evidenced as content mutation, not a dirty-badge assertion — the harness has no indicator to
assert on. **This run is historical acceptance only; adding a Content-Security-Policy later
requires rerunning the packaged Monaco smoke.**

**The file explorer surface is built**, gated behind that pass as the spec required: the docked
panel, the virtualized tree at 22px rows, file-tab chips in both toolbar layouts,
`toggle-explorer` (⌘⇧B) and `save-file` (⌘S) with a regenerated menu, a focus guard so pane
shortcuts no longer fire while a file surface holds focus, document-lifecycle fixes (an evicted
preview document is disposed; `closeWorkspaceSurface`/`closeWorkspace` exist and are wired),
and `fs:changed` driving a targeted tree refresh instead of a full reload.
[`SurfaceStrip`](../src/terminal/tab-manager.ts#L278-L322) `current` is no longer inert — a
real strip is passed in. Electron only. **Pending: the owner's eye review (DL §9.6) and native
macOS sign-off.**

**STOP #2 (10k-entry filesystem stall) cleared.** `listDir`'s per-symlink `fs.realpathSync` was
serial and blocking; a bounded async pool (`MAX_REALPATH_CONCURRENCY = 32`) resolves symlinked
entries concurrently without reordering the result ([`read.ts`](../electron/fs/read.ts)
`current`). Two 10k fixtures (mixed symlinks, and the worst case where every entry escapes the
root), 10 reps each, two runs: max sampled event-loop stall 13–16 ms against a 100 ms threshold.

**STOP #3 (bundle size) judged within expectation.** Entry gzip 201.90 kB against a 189.26 kB
baseline — +12.64 kB explained by six further explorer commits — while the lazy `editor.api`
chunk is byte-identical at 674.50 kB, proving no Monaco byte leaked into the eager entry.

**All four close/quit exits driven against the real production path**, intercepting
`dialog.showMessageBox` rather than reading pixels. A structural finding, verified rather than
assumed: **tab-level close guards never aggregate busy + dirty into one dialog, by design** —
only window-close and app-quit do, because a file tab's prompt should not accuse an unrelated
terminal tab of being busy. Both proved the combined message, proved settings flush before
teardown by file mtime, and survived repeated Cancel without silently clearing either cause.
The fourth exit, Install & Relaunch, stays blocked on Gate A.

**Usage §6.1.8 owner-machine acceptance ran on this machine's real `~/.claude`/`~/.codex`
corpus — all 7 rows pass.** An independent hand-reimplemented oracle matched the real scanner
exactly on 6 sampled files. Cold scan 5.76 s / ≈627.5 MiB peak RSS; warm scan 60.5 ms /
≈85.4 MiB — ≈95× faster, ≈7.4× lower peak RSS — with a byte-level proof that zero bytes are
read from any of 2050 unchanged files on a warm poll. The dashboard stayed interactive through
a live cold scan, with event-loop lag peaking at 106–120 ms during the per-batch yields.

**Major finding, fixed 2026-08-18.** [`discoverClaude`](../electron/usage/discover.ts#L199-L223)
`current` walked only ONE level into each session's `subagents/` directory. On this machine 470
of 1906 Claude `.jsonl` files (~25% of the corpus) live one level deeper, at
`<session>/subagents/workflows/<id>/*.jsonl`, and were silently invisible to every count and
total the dashboard shows. **The real-corpus run is what caught it, not the fixture** — the
parity corpus never exercised this depth. Both the Electron port and the Rust twin now walk
`subagents/` recursively up to `MAX_WALK_DEPTH`, with a nested-file case pinning each; the
parity gate is untouched because its golden compares aggregates over a corpus with no nested
files. Windows corpus behaviour is unverified (Gate C).

**Browser panel: compositor pass and a real-dev-server Inspect round trip.** Resize,
drag-to-width and hide-under-overlay are evidenced by DOM state and code citation, not a native
pixel overlay (no Screen Recording permission in that sandbox). Inspect was driven end to end
against this repo's own Vite dev server: react-grab's overlay highlighted a real element, a grab
crossed page → preload → IPC → renderer, and the formatted payload landed in the focused pane's
PTY. Both toolbar layouts were captured with real content — top-tab mode had never been
rendered before this run.

**First `npm run tauri dev` run of this entire program.** Cargo built clean and the native
binary launched against the same shared `styles.css`, but no CDP or screen-capture path exists
for WKWebView in that sandbox, so this is **process/network proof only** — the dev binary's
`com.apple.WebKit.Networking` helper held an ESTABLISHED TCP connection to `localhost:1420`
with real bytes exchanged. No pixel or interaction evidence for the redesigned chrome under
Tauri exists, and `src/styles.css` is shared, so the visual claim is untested on the host most
users actually run.

**The open board was redesigned to one center surface with three views** (home / config /
worktree) and the board's own second sidebar was removed — the app's own `WorkspaceSidebar` is
the one sidebar now. (The config view was deleted entirely on 2026-08-16.) Known gap disclosed
at the time: home had no footer, so a mouse-only user with `canCancel: true` had no visible
dismiss control besides Esc — flagged for the owner, not patched, because the locked contract
specified no footer.

**Create-worktree is an Electron-only flow** gated behind `worktree-host`'s `available` (a
`window.__deckHost` presence check — the same three-way truth table the rest of the host layer
uses). `git worktree add` runs main-process side via `execFile` with an argv array, **never a
shell string**, and raw git error text never crosses IPC — only one of five closed error codes
does ([`electron/git/worktree.ts`](../electron/git/worktree.ts) `current`). The `worktree_add`
channel keeps the flat payload contract, pinned by both the generic scanner and an explicit
fixture. Driven end to end in a real Electron host against a throwaway git repo, including a
real `branch-exists` failure surfacing as friendly copy. Windows unverified (Gate C); the
destination-path builder is POSIX-only.

**Still owed:** the owner's eye review of every rendered change (DL §9.6), the `css-audit`
re-read, native macOS sign-off for phase 2 steps 4–10 / both toolbar layouts / the explorer
surface / the redesigned board, a Tauri-run sign-off, Install & Relaunch (Gate A), every
Windows claim (Gate C), and a packaged Monaco smoke rerun if a CSP is ever added.
## The stage tab strip, and the document off the panel — 2026-08-14

The explorer surface shipped with the editor parked in a `__preview` block at the bottom of
`ExplorerPanel` — the minimum slice that proved click-a-row → document → edit end to end. Spec
§4.2 always put the document **on the stage**, and sidebar layout compounded the gap: file tabs
were nested rows in `RepositoryRail`, so the user's open documents lived in a left column while
the thing they opened rendered in the bottom-right corner of a right one. Both closed on one
shape the owner picked from three:

- **The chips moved into their own component.** [`TabStrip`](../src/ui/tab-strip.tsx) `current`
  holds them; [`TabBar`](../src/ui/tab-bar.tsx) `current` is only top-tab mode's frame around
  it. No coordination moved — same six callbacks, same `FileSurfaceController` calls, so R4's
  seams were untouched and `tab-bar.test.tsx` passed unedited, which is the evidence the
  extraction was presentational.
- **Sidebar mode mounts the same strip on the stage** as `.stage__strip`, in the half of the
  frame row that column 2 owns and that used to be empty — new [DL-18.6](DESIGN-LANGUAGE.md)
  `current`, plus an amendment to DL-18.3: the sidebar frame row has **two** occupants split by
  the shell's vertical seam. It adds an occupant, not a row.
- **The document renders on the stage** as `.stage__surface`, laid **over** `.stage__tabs`
  rather than replacing it, so the terminal grid keeps its measured size and taking the stage
  back costs no xterm reflow and no PTY resize round-trip. The mount condition changed for the
  better: the old preview block inherited `ExplorerPanel`'s `explorerOpen` gate, so ⌘⇧B
  disposed the open document along with the tree. It is `activeFileTab !== null` alone now, and
  the condition lives in [`StageSurface`](../src/files/ui/stage-surface.tsx) `current` rather
  than inline in `App`, because anything written inline in `App` is unassertable.
- **The rail no longer lists documents at all** — removed, not moved, with the "last surface,
  not last tab" fallback group. A rail row says which repository and worktree a session is in;
  the strip says what is open.

**The co-mount class of bug, and the three rounds it took to close.** Sidebar layout mounts the
rail and the strip **together** — the first time two tab surfaces were ever alive at once — and
both reached for module-level state written on the assumption that only one existed. Round one
caught the visible half: ⌘⇧R had two listeners, so one keystroke opened two popovers. Round two
was the half that mattered: `tabPopoverOpen` — the flag that hides the browser's native
`WebContentsView`, because a native view wins over every DOM layer no matter the z-index — was
a plain boolean each surface assigned as `open = mine !== null`, so dismissing either popover
cleared it while the other was still up and the native view came back **over a live popover**,
the same failure the Prompt Board case already cost this repo once. Round three forbade two
popovers at once outright: the shared state became **one slot**, not a set, so claiming it IS
how a surface tells the others to stand down. Two rules carry the contract, both in one hook so
three surfaces cannot drift into three answers: **a surface may only retract its own claim**,
and **an empty slot is not somebody else's** (or an effect ordering would close the popover the
same click just opened). Every test in the repo mounted these components **alone**, which is why
nothing caught any of it; each guard was then confirmed by removing it and watching the test
fail. (`TabPopover` and the slot were deleted on 2026-08-16; the co-mount lesson is why this
paragraph stays.)

**Evidence.** `npm test` 2391 passed / 196 files; `npm run build`, `generate:menu:check` and
`tsc --noEmit` clean. `design-language.test.ts` caught the DL-18.6 citations before the rule
was written, which is the ledger gate working. Shell geometry was eyeballed in the **browser**
preview, which proves row placement, panel insets and the document rectangle and proves nothing
native. **Owed: a real `electron:dev` look, the owner's eye review, native macOS sign-off.** The
shape Gate M covered has changed, so its 6/6 does not carry over to this surface.
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

The tab strip's `+` (⌘T) used to raise the Open board's full workspace ∥ preset ∥ agent flow
via `newTab()`. It now raises [`AgentQuickPicker`](../src/ui/agent-quick-picker.tsx) `current`,
a `.modal-scrim` genre alongside `PresetEditor`/`SavePresetDialog` — same `agentQuickPickerOpen`
signal, same "modal" tier in `openOverlayRanks()`. Picking a chip (click or digit key `1-9`/`0`)
calls [`TabManager.openQuickAgent`](../src/terminal/tab-manager.ts) `current`, which
materializes a single pane in the active tab's **live** cwd — a fresh `pty_info` read of the
focused pane, not the tab's static `workspacePath` — carrying the active tab's workspace tag.
A window with no tabs falls back to `$HOME`, as a bare `newTab()` did.

The Open board's full flow did not go away; its entry point moved to the rail's "Open
workspace" footer row (`onOpenWorkspace`, renamed from `onNewTab`), which sets `boardOpen`
directly. `WorkspaceSidebar` got the identical rename — dead code at the time, kept
prop-identical for a one-line revert. `new-tab`'s action scope stays `"board"`: the reasoning
that keeps ⌘T blocked while a modal-tier draft is open (mount-focus stealing) holds just as
well now that the action's own target is a modal-tier overlay.

**Evidence.** `npm test` 2423 passed / 199 files (the one failure, `file-tree-view`'s
10,000-row windowing timeout, reproduces on an unmodified tree); `npm run build` and
`generate:menu:check` clean. The visual design was eye-approved against a real-component
gallery specimen before being wired in. **Owed:** a native `electron:dev` click-through and the
owner's eye review of the wired flow.
## Theme gallery, and themes as files — 2026-08-15

**Retired as a SURFACE on 2026-08-19** (Settings shows Light/Dark), but every module below
still builds, still passes its own tests and still resolves a stored `file:` id — see
[Light, Dark, and Settings as a document](#light-dark-and-settings-as-a-document--2026-08-19).

The theme setting had been a cycle pill, so the only way to see a theme was to land on it. It
became a grid of cards, each a miniature of Deck painted in that theme
([`ThemeGallery`](../src/ui/settings/theme-gallery.tsx) `deprecated`) inside the existing
`appearance` category. The card is drawn through the same
[`deriveChromeColors`](../src/lib/derive-colors.ts) `current` the running app uses — that is
why it can be trusted, and also why it cannot use `--tokens`, which always resolve to the theme
that is running. On 2026-08-16 the track gained a max (`minmax(108px, 132px)`) so cards stop
growing and stay thumbnails, with every length inside tuned against the NARROW end, which is
the one that overflows.

**Custom themes are imported files, not an editor.** `<userData>/themes` is the model:
[`electron/themes.ts`](../electron/themes.ts) `current` copies files in, lists them and reveals
the folder; **removing a theme is deleting its file**, because two ways to remove one thing is
how they disagree. Four grammars are read in the renderer, dependency-free
([`theme-formats/`](../src/settings/theme-formats/parse-theme-file.ts) `current`): Windows
Terminal JSON, iTerm2 `.itermcolors` (regex rather than `DOMParser`, so it runs outside a DOM),
Ghostty `key = value`, Alacritty TOML. **VS Code themes are deliberately unsupported** — most
do not declare `terminal.ansi*`, so importing one would produce a theme that looks complete and
is not. The extension is a hint, never the decision (Ghostty files are extensionless, half the
Windows Terminal schemes in circulation are `.txt`), so every parser is tried in turn;
`background` and `foreground` are the only required slots, because every derived chrome token
is a function of those two.

**The boot scan is not optional:** `themeId` persists a `file:` id across launches, so without
it `getPreset` would answer with the built-in fallback for the whole session unless the user
opened Settings. It can land after first paint because the theme effect is a `useSignalEffect`
reading `customPresets` through `resolveTheme`. `customPresets` is declared beside `getPreset`
rather than beside its loader, because `getPreset` is the one synchronous lookup `pane.ts`,
`editor-host.ts`, `search-bar.ts` and the status bar all go through; and the extension
allowlist exists twice (main and renderer), with a test failing if the two drift.

**A code review closed two HIGH findings, both the implementation disagreeing with its own
rules.** The gallery compared the raw persisted `themeId` while every other surface goes
through `getPreset`, so deleting a selected imported theme's file left the grid showing nothing
selected. Worse: the picker offers "All files" (it must, for Ghostty), the copy loop screened
nothing, and the listing filtered afterwards — so a `.png` or a 2 GB file copied into
`userData` and then vanished from the UI, exactly what DL-24.6 forbids, **in the diff that
wrote DL-24.6**. Screening moved before the copy and both channels answer with
`{ entries, rejected }`. The copy path had no test at all (the mock answered every picker with
`canceled: true`), which is how both got in — and fixing it surfaced a third bug neither
reviewer named: the folder scan filtered on a known extension, so extensionless Ghostty themes
were invisible even though the parser reads them.

**Evidence** (both passes): suites green apart from pre-existing failures in other sessions'
untracked files; build and menu check clean; screenshots from `npm run dev` through headless
Chromium, which paints chrome truthfully and proves nothing native. **Owed at retirement:** the
owner's eye review and a native `electron:dev` pass — the import picker, the folder round trip
and the card grid never had native evidence. Windows unverified (Gate C); Tauri has no
implementation.
## The browser becomes a strip tab — 2026-08-15

The docked right-hand browser column is gone; the browser is **one chip on the strip** (globe +
page title) whose surface **covers the stage** the way the document editor has since
2026-08-14. New [DL-18.8](DESIGN-LANGUAGE.md) `current`; §19 keeps the docked-panel class with
the explorer as its resident instance.

- [`browser-store.ts`](../src/browser/browser-store.ts) `current` gained
  `browserSurfaceActive` beside `browserOpen` (chip-exists vs holds-the-stage). Closing the
  chip keeps the page — `setVisible(false)`, never `close()`.
- [`composeSurfaceStrip`](../src/ui/stage-surface-strip.ts) `current` wraps the file
  controller's `SurfaceStrip` and appends the browser as the segment's last index.
  **`TabManager` was NOT touched for this (R4):** ⌘W routing, tab cycling, "last surface, not
  last tab" and focus all reach the browser through the seam that already existed. The one
  `tab-manager.ts` change is the `toggle-browser` command and its membership in
  `isSurfaceRoutedAction`, so the chord works while an editor holds the stage.
- [`BrowserSurface`](../src/browser/browser-surface.tsx) `current` is the browser twin of
  `StageSurface`; `BrowserPanel` kept its chrome and lost the width/resize half. Mutual
  exclusion is synchronous on every path, with an `App` effect backstopping file-side
  activations. `browserWidth` and `clampBrowserWidth` are deleted (old persisted values
  ignored); `browserHomeUrl`/`browserLastUrl` and restore-last-page are unchanged.
  `electron/browser/` is untouched — the host still just receives bounds and visibility.

Verified 2026-08-15: focused suites 116/116, `npm run build`, `generate:menu:check` and
`electron:build` clean; full `npm test` 2567 passed with 2 failures both outside this work.
**Owed:** a native `electron:dev` pass and the owner's eye review. One behaviour change for
that pass to eyeball: with the browser chip open and no file tabs, closing the last terminal
tab now lands on the browser surface. Electron only; Tauri never had a browser.
## The daily usage view merges into one row per day — 2026-08-15

The daily table was a row per (day, agent), so a reader wanting one day's number had to add two
rows together. It is **one row per local day** now, with the day's agents stacked inside its
`agent` cell (brand mark, name, that agent's own compact tokens and dollars) while the numeric
columns state the day's totals.

- [`dailyTotals`](../src/lib/usage-aggregate.ts) `current` groups `dailyRows`' output by day
  rather than re-scanning buckets, **and that ordering is the point**: costs roll up per
  (day, agent) and are then summed, because both agents can report the same model string
  (`unknown` does on the real corpus) and flattening their models into one map first would fuse
  two agents' counters into a single priced entry. The priced/unpriced rule carries up one
  level unchanged — a day's `costUsd` is the sum over the agents that have a price, null only
  when none does.
- [`MetricTable`](../src/ui/usage/metric-table.tsx) `current` widened `MetricRow.cells` from
  `string | null` to `ComponentChild`; no second table was forked, and `null` still renders the
  em dash in exactly one place (DL-15.6).
- New [DL-15.9](DESIGN-LANGUAGE.md) `current` governs what a cell may hold: rendered content,
  but still facts — DL-15.2 reaches inside cells, so no button, link, hover treatment or
  tooltip — and sub-lines that align across rows must be one grid with **fixed** tracks,
  because an `auto` track resolves per cell and would stagger identical figures on consecutive
  days.

Verified 2026-08-15: usage suites and the DL citation gate 142/142, `generate:menu:check`,
`npx vite build`. Full `npm test` and `npm run build` each carry pre-existing failures from
other sessions' untracked files. **Owed:** the owner's eye review and a native `electron:dev`
pass with the machine's real corpus.
## Session restore — 2026-08-15

Relaunching Deck reopens every tab that was open when it last quit or lost power, with each
built-in-agent pane's CLI resumed into its exact previous conversation where the CLI supports
that, and the rail gained clickable rows to rebuild a previously-open worktree's session on
demand. This reverses the earlier "no session restore" decision. Electron only.

**The journal.** [`session-journal.ts`](../src/terminal/session-journal.ts) `current` mirrors a
window's live tabs — and, for the main window, its open file surfaces — into `session.json`
through a debounced (1s) effect on `tabViews` / `activeTabIndex` / `fileSurfaces` /
`activeFileTab`. **The debounce is what makes the file survive a hard power-off** rather than
only a clean quit: it is continuously current, not written once at exit. Each window writes its
own `window:<label>` key — `registerLabel` tracks which labels exist, since the renderer-side
`Store` facade has no "list keys" primitive — so secondary windows never clobber the main
record. Every main-window write also folds each tab's workspace into a capped per-workspace
`archive` entry (24 workspaces / 32 tabs), which the rail reads back.
[`session-schema.ts`](../src/lib/session-schema.ts) `current` is the pure validation layer: a
malformed pane or file tab is dropped individually rather than invalidating its whole record.

**Boot restore.** [`session-restore.ts`](../src/terminal/session-restore.ts) `current` runs
before the journal starts writing, so its own first (empty) capture cannot clobber the record
restore is about to read. `restoreSession` is wrapped in a crash-loop marker (the
`update-attempt.json` pattern applied to `session.json`): a marker still set from the previous
launch means that launch crashed mid-restore, so this launch clears it and skips restoring
rather than looping. A liveness pass drops tabs whose workspace no longer exists and nulls out
any individual pane's dead cwd. Every surviving built-in-agent pane then goes into ONE batched
`resume_lookup` call rather than one per pane; on the main side,
[`resolveResume`](../electron/resume/resolve.ts#L102-L131) `current` scans each needed agent's
state dir at most once and **dedups greedily** — a 30-day cutoff and closest-`mtime`-to-
`lastSeenAt` ranking pick the best candidate, whose id joins a `taken` set, so two panes that
both ran `claude` never resume into the same conversation. The ref becomes a literal shell
command through [`buildResumeCommand`](../src/lib/agent-resume.ts#L80-L103) `current`, carried
by the widened `MaterializeIntent.paneCommands` (zipped to leaves left-to-right) and the
retyped `AgentLauncher.arm`, which takes `AgentLaunchEntry[]` instead of one shared command.

**Resume precision, by agent:** claude / codex / opencode get an exact session id scanned from
the CLI's own state dir; **gemini always answers `--resume latest`** (no id-precise form exists,
so `resolveOne` says so before any scan runs); agy is a best-effort byte-scan with an
`--continue` fallback; a custom agent relaunches its declared command verbatim. An id that
fails `SESSION_REF_SAFE` (`/^[A-Za-z0-9._-]{1,128}$/` — a scanned-off-disk id is untrusted
input) degrades to the bare launch form rather than reaching a PTY write.

**Quit vs. close: an intentional asymmetry.** Quitting flushes the journal so the next launch
restores exactly what was open. A deliberate window close does the opposite — it CLEARS that
window's record — because flushing would persist the very tabs the user just closed, and the
next boot's fold-in (or a macOS re-`activate`) would resurrect them as ghost tabs. The two
install separate `flush` callbacks rather than sharing one.

**Fold-in and scope.** A secondary window writes under its own key with `isMain: false`; boot
restore reads every registered label, restores the main window's tabs first then every other
window's newest-first, and clears every non-main record it consumed. A secondary window
destroyed without a flush leaves a stale record until the next boot consumes it.
`Settings.restoreSessions` (default on) is the kill switch.

**What does NOT restore:** pane scrollback (only cwd + agent are captured), unsaved file edits,
window placement/size, and detached secondary windows as their own windows — their tabs fold
into the main window instead.

**Owed evidence:** suite/build only — `npm test` (2619), `npm run build`,
`generate:menu:check` and `electron:build` green. No native macOS manual pass (power-off
recovery, the crash-loop marker, actual CLI resume behaviour), no owner eye review of the
rail's pressable rows, Windows unverified (Gate C). gemini and agy resume are best-effort by
design, not a gap to close.
## The Native balanced rollout — 2026-08-16

The owner-selected Native balanced direction left the Gallery and became the shipping contract:
measured contrast floors inside the colour derivation, four named text roles in place of
repeated px literals, no styled uppercase or artificial tracking in readable copy, and Woven
Flag as the banner's one documented treatment. Twelve tasks, to
[the plan](plans/2026-08-16-native-balanced-rollout.md) `current`; every file belongs to the
shared renderer.

**Contrast became a floor, measured on every surface a tone may sit on.**
[`deriveChromeColors`](../src/lib/derive-colors.ts#deriveChromeColors) `current` raises
`--text-primary` to **8:1**, `--text-muted` to **6:1** and `--text-faint` to **4.5:1**,
replacing the 7 / 5.5 / 4.5 the ladder had carried. New [DL-3.5](DESIGN-LANGUAGE.md) `current`
states the floors and the surface set they are measured against. Meeting the numbers is
explicitly not sufficient — the three tones must stay ordered and visually distinct, and that
was measured: across four presets × four surfaces the minimum primary–muted gap is **1.992**
and the minimum muted–faint gap **1.417**, both wider than the old ladder's 1.5 / 1, so the
raise spread the ladder out rather than compressing it. **What it cost:** three of four presets
now derive a different `textPrimary`, One Dark's the largest (its raw `fg` cleared only
4.05–7.56:1 depending on surface, so the new floor pushes it close to white). Intended, not a
regression; no fixture asserted the old hexes.

**Standard chrome text comes from four named roles** — `--type-title` (14px), `--type-body`
(12.5px), `--type-meta` (11px), `--type-micro` (10.5px) — declared once in `:root`, named by
[DL-4.4](DESIGN-LANGUAGE.md) `current`, with [DL-4.5](DESIGN-LANGUAGE.md) `current` requiring
use sites to read them. After the migration, **117** declarations take their size from a role
variable and **21** px literals remain: 13/14px titles → title; 12/12.5px row labels, buttons,
tabs, nav items, inputs → body; 11/11.5px metadata and keyboard hints → meta; 10/10.5px
microcopy, paths and timestamps → micro. Re-tuning the ladder is now one edit.

**Closed decisions the code no longer shows.** Single-character marks and icon-glyph buttons
keep literal sizes — their size is glyph geometry (§14), not a reading size, and forcing them
onto the ladder would move mark alignment. `.wshead__title` keeps 19px as the app's one
structural screen heading; `.window { font-size: 13px }` is untouched, being the shell's root
default that relative units resolve against. **`letter-spacing` declarations are deleted, never
set to `0`**, and a `font:` shorthand keeps the shorthand with the size substituted rather than
being expanded into longhands, which would silently drop its reset of weight/style/variant.
**DL rule ids are amended in place, never renumbered or deleted** — a test scans for citations
and the fork log cites rule numbers by name.

**Uppercase and artificial tracking are gone from copy** ([DL-4.3](DESIGN-LANGUAGE.md)
`current` retired both the tracking cap and the one sanctioned uppercase), enforced by a policy
test that parses the stylesheet; fourteen violations across ten selectors were closed. One
sanctioned survivor: `.pane__anchor-grip`'s `letter-spacing: -1px`, which pulls two `⋮⋮` glyphs
into a single grip pattern — glyph geometry with no word in it — held to that one selector by
an allowlist. **Woven Flag** is the banner's documented treatment (new §26): one component, one
treatment class, no theme-specific variants, themes supply colour only.

**The Gallery stopped carrying a second design system.** The candidate contrast layer is
deleted and the matrix section measures on raw `deriveChromeColors` output — safe because that
layer had become an **identity function** once the floors moved into production. A residual
remains by necessity: the Gallery writes the three floor numbers down locally in order to
_display_ them, because a floor is an input to the derivation and cannot be recovered from the
colours that come out.

**Three grades of evidence, not interchangeable.** (1) **Implementation — verified:**
`npm test` 2710 passed / 1 failed, the red pre-dating this work and reported rather than fixed
(W3); build, menu check and `electron:build` exit 0. (2) **Rendered behaviour — verified in the
Gallery:** Chrome returns the four `--type-*` values at runtime and the type card prints them
back, so the fallback never fired; the floors hold on all four themes (minimum
primary/muted/faint 8.03/6.00/4.56 Tokyo Night, 8.27/6.00/4.59 Dracula, 8.07/6.06/4.50 One
Dark, 8.04/6.05/4.52 Catppuccin), and the exhaustive 4 × 3 × 6 matrix counts **72 safe, 0
unsafe** read from the DOM. Its limit: a dev harness against stub IPC whose specimens have
fixed inner widths. (3) **Electron native appearance — NOT established:** `electron:dev` was
not launched, because its dev `userData` is not isolated on this machine — a headed run writes
the owner's real `workspaces.json` — so launching it is the owner's call. Packaged runtime is
not claimed at all; Windows unverified (Gate C).
## Panel seams that close — 2026-08-16

The two docked edges of the window learned the same gesture, and the navigation column learned
to resize at all.

**What the owner asked for.** A close control inside the Explorer panel, and for both edges,
"drag the seam out past the edge and it hides". The sidebar half rested on an assumption that
was not true: **it had no seam.** `--sidebar-w` was a fixed 275px with no open/closed state,
and in sidebar layout the frame row — the macOS traffic lights included (DL-18.3/18.4) — lives
_inside_ that column, so hiding it outright would leave the OS painting its window buttons over
the terminal.

- [`resolvePanelDrag`](../src/ui/panel-resize.ts) `current` is one pure function serving both
  seams: it clamps the width and, separately, reports whether the **RAW** pointer width has
  fallen past `min - PANEL_COLLAPSE_SLACK`. Raw, not clamped, is the whole point — clamping maps
  every overdrag onto the floor, so a clamped value cannot tell "resting at the minimum" from
  "dragged 200px past it".
- **The decision lands on release, never mid-drag.** Collapsing under the pointer would unmount
  or resize the element the gesture is captured on, which makes an overshoot unrecoverable. The
  explorer dims (`.is-collapse-armed`) while the sidebar goes compact immediately — the rail IS
  the preview there.
- The explorer's two new exits both go out through `onClose`, which `App` maps to
  `runAction("toggle-explorer")`. The panel never writes `explorerOpen`: that action owns the
  focus guard, and a second way in would bypass it. The collapse path deliberately writes no
  width, so closing does not persist the floor as a preference.
- [`SidebarGrip`](../src/ui/sidebar-grip.tsx) `current` is new — the sidebar's first seam, a
  sibling of the rail rather than part of it, because two components occupy that slot and a seam
  living inside one would vanish with the revert.
- **Hidden means width 0** (revised the same day from collapse-to-icon-rail): rail, frame row
  and seam all go, and the stage strip carries the traffic lights' reserved inset, because that
  inset is a reservation for buttons the OS paints, not a control. What made zero possible was
  emptying the frame row of everything that is not a window control — the hide control moved up
  beside the traffic lights and the feature toolbar moved out to the stage strip's trailing end,
  so the column's width no longer decides how many toolbar controls are visible. While the
  column is hidden the control mounts at the strip's leading edge: **the way back out cannot
  live inside the thing it reopens.**
- One width, one owner: `App` writes `--sidebar-w` and `[data-sidebar-collapsed]` onto `:root`
  the way `applyThemeVars` writes theme tokens. **That is a workaround, not a preference** — see
  the defect below. During a drag the rail paints compact from what the drag is ARMED to do.

**Rules touched.** New DL-18.9; DL-19.4 amended in place (past the floor is a close, not a
clamp).

**A defect found on the way, and not fixed here.** The first implementation put the width and
the collapsed flag on the window shell as `style`/`class` props, and in the running app they
never took effect. Measured with Playwright against both `npm run dev` and the production
build: `DesktopChrome` receives the new props and computes the new class string, its CHILDREN
update — a probe `<span>` inside it flips class on the same render — but **every prop on the
element the component itself RETURNS stays at its mount value**, `class`, `style` and a plain
`data-` attribute alike. The same defect reaches shipped behaviour: flipping **Tab bar
position** in Settings leaves `window--sidebar` on the shell. It does NOT reproduce in an
isolated jsdom render, which is why no unit test catches it. Reported, not fixed (W3); the
sidebar work routes around it by writing to `:root`.

**A hide rule that named a dead class.** The rule hiding the column named `.wsbar`, the rail
class `AgentRail` (`.asr-rail`) replaced the same day. A dead selector fails silently: hiding
the sidebar left the live rail at 8px — its own padding — overhanging the stage instead of
gone. Fixed by naming both classes; **the lesson is recorded because the next rail swap will
break the same way.**

**Evidence.** `npm test` 2804 passed / 1 failed, the red outside this work and already
recorded elsewhere; `npm run build` and `generate:menu:check` exit 0. Rendered behaviour checked
in Chrome against `npm run dev`: shown = `--sidebar-w: 275px` with one button in the frame row
and five toolbar controls on the strip; hidden = `0px`, frame row and rail `display: none`, the
control remounted behind an 86px inset (78px lights + 8px). New suites: `panel-resize.test.ts`
and `sidebar-grip.test.tsx`. **Not established:** no `electron:dev` pass and no owner eye
review; renderer code, so it reaches Tauri, where nothing was launched; the collapsed floor on
Windows is reasoned, not verified (Gate C).
## The rail becomes a list of agents — 2026-08-16

The sidebar rail was shaped like the repository layout: repositories, worktrees, tabs. A probe
of this machine's own Claude/Codex corpus (1145 user-opened sessions since 2026-03-30) says
nobody works that way — **46 of 51 repositories have exactly one working directory, the whole
corpus holds 4 real worktrees, and 83% of sessions return to a project already touched that
day**. The rail was answering a directory question while the owner, asked what they look for
after stepping away, named two agent questions: which agent just finished or is asking, and
what is running. [`AgentRail`](../src/ui/agent-rail.tsx) `current` replaces `RepositoryRail` in
`DesktopChrome`'s `sidebarNavigation` slot
([spec](specs/2026-08-16-agent-status-rail-design.md) `decided`). This section records the
original shape and the four reshapes that followed it the same day; the shipped rail is the
last of them plus the 2026-08-19 changes recorded further up.

**Every visible thing is a way back to a specific pane**, which is why the rail was worth
building. That needed a pane id the renderer never had — `syncViews` publishes
[`TabView.panes`](../src/terminal/tabs-store.ts) `current` beside the per-tab rollup. Focusing
one walks the same `runAttentionFocus` overlay preflight ⌘⇧A walks, with two deliberate
differences: `hasCandidate` is unconditionally true (the user picked a pane, so a resting agent
must not be a silent no-op), and the call is pane-exact rather than `focusNextAttention`, which
would pick the loudest pane in the window. No PTY, window, materialization, close or
process-classification path changed.

**The pane's answering line has two lifetimes (2026-08-19).** A click on a rail row focuses its
exact pane and [`pingPane`](../src/terminal/pane-ping.ts) `current` replays the yellow current
once for 1.5s, even if that agent is idle; its `.pane-ping` is anchored by the target's
positioned `.pane-slot` — without that containing block the absolute line climbs to the tab
ancestor and spans the whole tab. Separately, every agent in tracker phase `working` carries
the same current continuously, pane-exact and without requiring focus. (The original full-pane
accent ring and its DL-27.7 rule were withdrawn on 2026-08-17: the flash read as an accent
event with no visible cause.)

**State model.** `attention: "error"` reads as `failed` and outranks everything; `"warning"`
folds into `asked`. **Attention is read before phase**, because the tracker latches attention
and leaves phase live, so a pane can be `working` while carrying a warning nobody has answered.
Fold precedence: failed > asked > done > working > resting. `unread` gets no mark of its own —
it already drives the tab strip's badge, and a second signifier for one state is DL-21.6's
mistake in a new place. **The row carries no status word**, with the word surviving in `title`
and the accessible name; the known cost is recorded rather than argued away — red and yellow
side by side are harder to tell apart at a glance than a word would be.

**What the first native run caught, and no automated check could see.** jsdom loads no
stylesheet, so every render assertion passed against a rail nobody could see. The rail shipped
without four shell contracts `.wsbar` had carried: **grid placement** (`.wsbar` placed itself
with `grid-column: 1; grid-row: 2`; `.asr-rail` did not, so it auto-flowed under the stage, on
top of the status row, leaving the navigation column empty); **surface** (`transparent` let the
stage's `--bg` into the column, against DL-18.7); **scrollport** (the rail had no list/banner
split, so a long list would grow past the cell instead of scrolling); and **the collapsed
column** (every DL-18.9 collapse rule is `.wsbar`/`.wsitem` scoped, so replacing the rail
dropped all of them silently). `agent-rail.test.tsx` now reads these declarations straight out
of `src/styles.css` — deliberate: the stylesheet is the only layer where this class of defect
is visible to a suite.

**Four reshapes the same day.** _Clusters by project_ — the flat rail printed one project name
four times, none adjacent, and repeated it as each row's message line. Two causes: spec §1's
corpus measured projects touched per hour and never TABS PER PROJECT, so nothing in it spoke to
the case the owner was in ([`RailStreamGroup`](../src/ui/agent-rail-model.ts) `current` moves
the name up one level); and `RailTab.label` derives from the workspace path unless a person
renamed the tab, so the tier-3 fallback was **structurally guaranteed** to repeat the row —
`messageOf` returns `customName ?? ""`. _The pinned block goes, and the list stops moving_ —
the `Needs you` block printed an asking project twice by lifting its tab out of the cluster;
the owner removed it, then ruled out letting an active project climb in its place ("chúng ta đã
có state icon status rồi"). ⌘⇧A still walks to the next waiting pane, which is where a queue
belongs. Order became `sortByOpenOrder` over `TabView.openedAt`, the window's one open clock
that `TabStrip` already sorts by, so **a cluster sits where its OLDEST tab put it** and opening
a second tab never moves that project. The age moved to its own meta line, and the hover pair
with it, reserved **at rest, never on `:hover`** — a padding that appears under the pointer is a
reflow (DL-27.10). _The rail stops at the tab_ — three levels to parse when the tab row's agent
marks already reached those panes; the shape is one compact row and every disclosure and nested
pane row is gone (DL-27.11). _Every project keeps its header_ — a labelled cluster above a
singleton row made one look like a hierarchy and the other unrelated, so
[`LOWEST_LABELLED_SIZE`](../src/ui/agent-rail-model.ts#L347-L348) `current` is one (DL-27.12).

**The stage strip's scope moved with the rail.** `activeRepositoryTabIndexes` joins
`activeWorktreeTabIndexes` in [`repository-model`](../src/repositories/repository-model.ts)
`current`: the rail's rows are tabs in a project, so a strip scoped tighter than the rail would
hide a sibling tab the rail is still listing.

**Evidence.** The rail's own suites 165/165, then 35/35, 61/61 and 70/70 as each reshape
landed; `npm run build`, `electron:build` and `generate:menu:check` exit 0 at each. Isolated
native Electron `BrowserWindow` runs restored live tabs against the built renderer and MEASURED
the result — three 34px rows / one header / zero disclosures / zero pane rows / zero horizontal
overflow, then four rows across two projects with two headers. One caveat from the third
reshape: `npm test` was 2,574 pass / 277 fail on a Phosphor/Vitest integration fault (React
`forwardRef` icon objects externalized before the Preact alias, jsdom rejecting
`[object Object]` as a tag name) across unrelated suites; the bundle and the native render both
resolve the real icons. **No owner eye review of the running rail at any stage.**
`RepositoryRail` and `WorkspaceSidebar` stay in the tree, out of the shell — the repo's
precedent for parked UI. Full prose for every stage in
[CONTEXT-archive.md](CONTEXT-archive.md) `deprecated`.
## TabPopover and its features are deleted — 2026-08-16

The owner sent a screenshot of the tab options popover — a `Name` field and a `Set logo…`
button — and asked for the popover **and the features inside it** to go, by the roots rather
than as an unreachable API; told that `WorkspaceLogo` is only ever rendered by
`WorkspaceSidebar`, a component nothing mounts (so a logo they set appeared nowhere), they
chose to delete the logo system with it.

**Gone.** `tab-popover.tsx`, `tab-popover-slot.ts`, `workspace-logo.tsx`,
`workspace-logo-store.ts`, `workspace-sidebar.tsx` and their tests — with the rail row's
options button and right-click, the `open-tab-options` action and its ⌘⇧R binding in both
keymaps, the `tabPopoverOpen`/`tabPopoverOwner` slot (and its `panelObscured` entry),
`TabManager.renameTab` / `setTabDotColor` and the private `setOverride` they were the only
callers of, the boot-time favicon scan, the drop-an-image-on-a-row path, and the matching
stylesheet blocks.

**What deliberately stayed.** The `TabOverride` plumbing: `tabName` and `dotColor` still ride
the window-transfer payload and the preset snapshot, and `TabView` still carries both fields.
Nothing can put a value in them, so they are dormant, not live — removing them means opening
the materialization and transfer seam (R4) for no behaviour the owner asked about. Two tests
record the dormancy rather than deleting the coverage.

Rules: §13's preamble (the anchored-popover genre has one member left, the Prompt Board),
DL-27.5 amended in place, and §18's "removal from the strip, not deletion of the features" note
superseded for its `TabPopover` half — including the "⌘⇧R reaches nothing in top-tab mode"
consequence, moot now that the chord is gone from both keymaps.

**Evidence.** This work's own files green (`tab-manager` 186, `agent-rail` 24,
`repository-rail` 21, `action-registry` 15, `keymap` 89, `design-language` 9);
`generate:menu:check` green (the action never had a menu item); `npx vite build` green.
`npm run build` does NOT pass, and it is not this work: `tsc` fails on a concurrent session's
test for a function they have not written yet. **Not established:** no `electron:dev` pass, no
owner eye review; renderer-only, so it reaches Tauri, where nothing has been run.
## Opening a path an agent printed — 2026-08-20

Built from [the design](specs/2026-08-19-terminal-path-open-design.md) `decided` in one pass:
detection, routing, the external-app catalog, then ESLint's cross-line grammar.

**What ⌘+click does now.** It asks the main process which open workspace root holds the file. A
root answers → the file opens in **Deck's own editor**, as a preview tab, revealed at the line
and column the terminal printed. No root answers → it goes to the app selected on the toolbar.
There is no kill switch and no second chord: a path inside an open workspace ALWAYS opens in
Deck in v1, and ⌘⌥+click is the obvious later addition if that proves wrong in use.

**Containment is decided main-process side**, in
[`workspace-for-path.ts`](../electron/fs/workspace-for-path.ts) `current`, and this is the part
that would have been a silent bug done the obvious way: `resolve_paths` answers canonical
(realpath'd) absolutes while the renderer holds roots as the raw strings the user opened, so
prefix-matching in the renderer fails the moment a root is itself a symlink — the
`/tmp`-on-macOS case `path-guard.ts` already documents. The new channel reuses
`resolveInsideRoot`, so a ⌘+click passes exactly the guard the explorer's reads and writes
pass, and it answers the root **as the renderer spelled it**: every file-surface lookup is keyed
by that string, and handing back a canonical root would open a tab in a workspace the store has
never heard of.

**Four grammars were added to detection.** tsc's `path(340,15)` — the file linked before, the
LINE did not travel with it; the parenthesised suffix is tried BEFORE the colon one, because
the colon form can match empty and would win the alternation. A quoted path, which is both
Python's traceback and the only route to a path holding a space, since the quotes are a
boundary the printer chose rather than one Deck guessed. git's `--- a/src/foo.ts`, fixed in the
RENDERER by emitting the stripped spelling as a second entry in the same resolve batch and
preferring the verbatim hit — doing it in `resolveOne` would have to be mirrored in `links.rs`
or become a host parity gap, and would reshape a payload R6 freezes. And ESLint's finding rows,
which name a position but no file: the row walks up to its header, and **the header's raw text
is part of the provider's cache key**, because `12:5  error  no-unused-vars` is byte-identical
under two different headers.

Two tradeoffs taken rather than hidden: the quoted rule suppresses the bare path inside a
quoted PHRASE (the price of supporting spaces at all), and single quotes are deliberately not
matched, because an apostrophe in prose would pair with the next one and swallow every path
between them. A candidate can now cost two resolve entries, so a line caps at 48 rather than
24 — still inside the resolver's batch cap of 64.

**The reveal is a stored request, not a call.** Monaco arrives through a dynamic `import()`, so
a click can land before the editor exists; [`pendingReveal`](../src/files/file-surface-store.ts)
`current` is written before the tab opens and consumed by `FileEditor` after the model is
attached. It is gated on `document.file !== null`: on a cold open the model effect runs once
with an empty model while the read is in flight, and revealing line 65 of nothing would spend
the request and park the caret at 1:1 for good. The tests assert a MOUNTED editor's position
rather than a store value, because the failure this feature can have is exactly an editor that
never mounts.

**The external app is a catalog, not a command.** Ten apps in four groups, mirrored across
[`src/lib/external-app-catalog.ts`](../src/lib/external-app-catalog.ts) `current` and
[`electron/external-apps.ts`](../electron/external-apps.ts) `current` with a suite pinning the
halves together. Installed = the `.app` bundle exists, so detection is a `stat`; the icon is
the bundle's own `.icns`, found through `CFBundleIconFile` and converted by `/usr/bin/sips`,
which keeps a dozen third-party logos out of the repo and keeps each current when its app
updates (new DL-14.7). **NOT `app.getFileIcon`**, which the design named: measured on
2026-08-20 (Electron 43.4.1) it returns the generic document icon for every `.app` bundle, and
`{ size: "large" }` crashes the process with SIGTRAP. All 10 catalog apps on this machine
resolve a real logo through the `.icns` path. An app that is not installed is ABSENT from the
menu. Launching is `execFile` with argv (`/usr/bin/open -a <bundle> <target>`), never a shell
string. The three editors keep the existing validated `open_editor` template, because it is the
only route that carries a line — `open -a` can name a file but never a position in it.

**One setting replaced two.** `externalAppId` is what both the toolbar and Settings write, so
chrome and Settings cannot disagree. `editorId` `vscode`/`cursor`/`zed` migrate to the same
catalog app; a stored `custom` does not, and **the custom editor command stops being
reachable** — a real loss, recorded in `AGENTS.md`'s drift table rather than hidden.
`editor-command.ts` and `open_editor` are untouched, which keeps the Rust twin valid.

**Tauri keeps today's behaviour, and one flag is what makes that true.** The first build got it
wrong in a way no gate here can see: the facade fails soft to an EMPTY list, an empty list read
as "nothing is installed", and a ⌘+click that opened VS Code yesterday would have raised an
error bar on the host users are still running. **A host that cannot ANSWER is a third state,
not an empty machine.** `external-apps-host.ts` exports the same `window.__deckHost` presence
flag [`worktree-host.ts`](../src/host/worktree-host.ts) `current` uses, and `resolveExternalApp`
takes it: unanswered means the selection is taken at its word — an editor keeps its validated
template, anything else falls back to VS Code's. The same flag gates the button, which is why
the catalog fallback inside `externalAppChoices` stays Settings-only: the picker must remain
usable where nothing answers, the button must not render ten rows whose clicks all fail.

**The split-button is a new control shape** (new DL-23.11): the app's own icon opens the active
tab's workspace, a caret beside it changes which app that is. It renders immediately before
`More` and is absent where nothing is installed — every Tauri build, since `external_apps` is
Electron-only.

**Evidence.** `npm test` 3356 passed / 8 failed, **none of the eight this work** (seven from a
concurrent session's uncommitted `agent-catalog.ts`, the eighth from the same session's
`action-registry.ts`). The two failures this work DID cause were fixed inside it.
`npm run build`, `electron:build` and `generate:menu:check` exit 0. Targeted suites:
`terminal-links` 33, `link-provider` 17, `link-target` 12, `eslint-positions` 9,
`external-apps` 14, `workspace-for-path` 6, `file-editor` 14, `electron-ipc-contract` 7,
`design-language` 15, `icon-system` 6.

**Not established.** No `electron:dev` pass: nothing here has opened a real file at a real line,
reached a real app, or shown a real icon. No owner eye review of the split-button. Windows
detection, launching and icons are **Gate C**, and `listExternalApps` returns empty off macOS by
design rather than guessing at bundle layouts. Detection is renderer-only and reaches BOTH
hosts; routing degrades on Tauri to exactly today's behaviour, which has also not been run.
## One tag ships two platforms, and Gate A is closed for macOS — 2026-08-20

**Gate A is CLOSED for macOS.** The owner ran a real auto-update check against the published
`v0.12.5-electron.2` on 2026-08-19 and it worked end to end — signed, notarized, Squirrel.Mac
accepted the handover. Earlier sections recording Gate A as open were true when written and
stay as written. Gate C (real Windows hardware) stays open, and the owner elected to ship
Windows without runtime verification.

**The two-platform pipeline**, per the
[spec](specs/2026-08-20-electron-stable-release-design.md) `decided`, its
[plan](plans/2026-08-20-electron-stable-release.md) `building`, and the three parts of the
[workflow design](specs/2026-08-20-development-contribution-release-workflow-design.md)
`building` (a draft for owner review) that the owner adopted the same day (reviewed CHANGELOG notes, the tag-ancestry gate, the run
summary). [`electron-release.yml`](../.github/workflows/electron-release.yml) `current` is four
jobs: **prepare** (refuses a tag not reachable from `origin/main`, validates both
`build/vX.Y.Z` and `build/vX.Y.Z-electron.N` against the package version, one source gate, the
draft); **mac** (sign/notarize/verify plus its own renderer build, since the gate now runs on
ubuntu); **windows** (unsigned nsis x64, publish only, `shell: bash` + `set -euo pipefail`
because pwsh only fails a step on the LAST command's exit code); **promote** (all six served
assets or the release stays a draft; final notes = the fixed unsigned/unverified/no-Intel
header plus the tagged commit's `## <version>` section of [`CHANGELOG.md`](../CHANGELOG.md)
`current` for a stable tag — missing section fails the promote — or the generated commit list
for `-electron.N`). [`release.yml`](../.github/workflows/release.yml) `current` is
`workflow_dispatch`-only; Tauri is retired from tag triggers.
[`electron-builder.release.yml`](../electron-builder.release.yml) `current` gained the win/nsis
blocks under the SHIPPING identity, so the installed Windows `Deck Electron` preview.2 that
auto-updates into it gets a new side-by-side app with fresh userData — a consequence of fork
F1, stated in the config comment. `package.json` is `1.0.0`: the owner named the stable a V1.
**No macOS preview ever shipped publicly**, so this stable is the first public macOS release.

**1.0.0 SHIPPED the same day, and the first tag run is the lesson.** Run 32382369994 had
prepare, mac and windows green and died in `promote` with empty `TAG`/`CHANNEL`: `promote`
listed `needs: [mac, windows]`, and **`needs.<job>.outputs` resolves only for DIRECTLY listed
jobs** — worse, an empty tag made `gh release view ""` quietly audit the LATEST release (the
Tauri v0.12.3) instead of the draft. Nothing went public, which is the fail-closed design doing
its one job. The fix names `prepare` a direct need, refuses empty outputs at the top of the
census, and pins both in the guard test; it was cherry-picked through a clean worktree because
the shared tree carried another session's dirt. Run 32383647050 went green end to end:
**`SpaceVibe Deck 1.0.0` is public, `releases/latest`, eight assets served** — dmg + blockmap,
mac zip + blockmap, `latest-mac.yml`, setup.exe + blockmap, `latest.yml` — with the CHANGELOG
section as its notes. Pre-tag gates on the release commit: `npm test` 3391/0, `npm run build`,
`generate:menu:check`.

**Still unverified after the ship:** the electron.2 → 1.0.0 update hop on a real Mac (the
owner's verified hop was prerelease → prerelease); everything Windows — install, SmartScreen,
self-update (Gate C, unsigned by decision); Intel Mac and Windows ARM are not served.
`GRAB_PASTE_DISABLED` and the preset rename/delete gap shipped knowingly, per the freeze
decision.
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

## The sidebar stopped flashing on every Cmd-Tab — 2026-08-23

Owner-reported: returning to Deck from another app made the rail visibly jump. It was not a
paint artefact — the rail genuinely rebuilt itself several times per focus.

[`installRepositoryRescanOnFocus`](../src/repositories/repositories-store.ts) `current` called
`invalidateRepositoryScans`, whose first act is `repositoryScans.value = new Map()` —
**synchronously, before git is asked anything**. Every consumer therefore rendered a frame with
NO scans, where [`buildRail`](../src/repositories/repository-model.ts) `current` groups by
`plain:<path>` instead of `scan.key`: every cluster re-keys (so Preact unmounts and remounts all
of them), a repository holding two worktrees splits into two clusters, project names fall back
from the repository's own checkout to the tab's folder, worktree suffixes vanish, and a
remembered header folding several worktrees unfolds into one row each. Then each scan landing
re-rendered again, merging back one repository at a time — N+1 renders with different row
counts, ending exactly where it started.

`refreshRepositoryScans` replaces that on focus: **the answer on screen stays until a newer one
replaces it.** Staleness is tracked by a round counter rather than by absence — `answeredAt`
holds the round each path was answered in, so a path is stale while its scan is still painting.
The round is a SIGNAL because emptying the map was also what woke the rails' `useSignalEffect`
into re-reading; nothing empties it now, so the wake-up needed a subscription of its own.
Freshness is kept per repository in `applyScan`: a fresh scan is the whole truth for its own
key, so worktrees the PREVIOUS scan reported and this one does not are dropped — which is the
requirement the emptying existed to serve — while a subdirectory path keeps its entry until its
own read answers. An answer arriving after a newer refresh is discarded rather than published.

`invalidateRepositoryScans` stays as the hard reset for callers that mean "forget what you
know", and now bumps the round too, so a read still in flight cannot repopulate the map it just
left. **Not changed, and flagged rather than fixed:** `RepositoryRail`'s own Rescan button still
calls the hard reset, so it still flashes — that is the legacy rail and out of this task's
scope.

The bug predates the cluster reorder, but reorder made it worse and visible: during the empty
frame a pinned project's `orderKey` flips from its repository key to `plain:<path>`, stops
matching `railOrder`, drops to its unpinned slot and jumps back. The cold-start version of that
was already recorded as a known gap; it was firing on every Cmd-Tab.

Evidence: a new `repositories-store.test.ts` (6 cases, written failing first — five of them red
against the old store, including one that reproduces the focus flash directly), plus the rail
suites it feeds, `npx tsc --noEmit` clean across the repo, prettier and oxlint clean. **Owed:
the owner confirming the flash is gone in a running app** — no host run has happened.

## A project cluster goes where the user puts it — 2026-08-22

Built from the [spec](specs/2026-08-22-rail-workspace-reorder-design.md) `decided`; the rule is
new DL-27.20.

The rail's project clusters sat where their oldest tab put them and the remembered tier below
them sat in MRU order, so a project that matters every day could sit fourth because it was
opened fourth, and a project deliberately parked at the bottom climbed back the moment it was
touched. The header is now the whole cluster's drag handle, and the position survives the
transition the owner named: the cluster's last tab closing.

**The load-bearing decision is an identity that outlives the tier.** `RailStreamGroup.key` is
`scan.key` while a project is live and `remembered:<that same key>` after its last tab closes,
so storing positions against it would lose the position in exactly the case the feature exists
for. `RailStreamGroup.orderKey` is the un-prefixed key, PRODUCED by both branches rather than
derived by stripping a prefix, and [`rail-order.ts`](../src/ui/rail-order.ts) `current` stores
against it and nothing else. Two worktrees of one repository already fold into one cluster, so
they share one position; a folder git does not know is identified by its path, so moving or
renaming it loses its slot — accepted, there is no other identity.

**`orderKey` is not stable until the scan lands**, which is why `applyRailOrder` takes the scan
map and not the list alone: before a history path's scan arrives its cluster reports
`plain:<path>`, afterwards the repository key. A `railOrder` entry matches on either spelling,
and every `plain:<path>` the scan map can resolve is rewritten on WRITE, duplicates collapsing
to the first occurrence — the list canonicalizes itself instead of accumulating both spellings.

**A pinned cluster ignores the live/remembered boundary**, knowingly breaking 2026-08-20's
"live work first, remembered after": the owner asked for a position, not a position within a
tier. Unpinned clusters keep the boundary exactly, and with an empty `railOrder` the model
returns the stream it assembled — the same array, asserted as identity, so a rail nobody has
dragged is byte-for-byte what it was. **A drop pins everything above it too**, or a project
dragged to slot 2 would be pushed around by the open order of whatever sits in slot 1, which is
the ordering the user just overruled; clusters BELOW stay unpinned. The stored list drops
nothing on its own — an entry naming no visible project is the memory that brings a parked
project back — so it is capped at `MAX_RAIL_ORDER = 200`, pruned from the END and only of
entries naming nothing on screen.

**Only the cluster drags.** A tab row, a pane row and a tab row moved between clusters are all
excluded on the owner's instruction, and that exclusion is what keeps the change off the tab
strip: the strip and the rail share one order key by contract, and **that contract is about
TABS** ([`strip-order.ts`](../src/lib/strip-order.ts) `current`). The strip has no notion of a
project cluster, so reordering clusters is invisible to it. No `openedAt` value is rewritten
anywhere, and no R4 seam moves.

The interaction is pointer events with the repo's 5px threshold, not HTML5 drag-and-drop. ONE
controller for the whole list by delegation, not one per header: **a header re-renders whenever
an agent says something, so a per-element controller would be disposed mid-drag.** The collapse
toggle shares the surface and keeps its `click` below the threshold; the `+` and a remembered
cluster's remove control never start a drag. The ghost and the insertion line are
`document.body` children. Escape abandons, a drop in place writes nothing, and the settings
write is one per completed drop. Settings are app-level, so a drag in one window reorders the
rail in every window — named rather than avoided, the way `sidebarWidth` already behaves.

Renderer-only, so it reaches BOTH hosts. **Evidence, all of it targeted:** the four suites
spec §9 names are green — `rail-order` 16, `rail-cluster-drag` 9, `settings-schema` 75,
`agent-rail-model` 47, plus the two reorder cases inside `agent-rail.test.tsx` — and
`npx tsc --noEmit`, `npx prettier --check`, `npx oxlint` and the design-language gate report
nothing against any file this work touches. Four failures elsewhere in those same runs were
each read and attributed to concurrent sessions' in-flight work: `tab-manager.ts`'s unused
import, two `.at()`-on-`Element[]` type errors in the close model's own tests, and
`.asr-leaf__hit`'s off-scale radius. **Still owed: the FULL `npm test`, `npm run build`, an
`electron:dev` or `tauri dev` pass, and the owner eye review** — nothing here has been dragged
in a running app.
Cross-window dragging is phase 2 and out of scope; there is no keyboard equivalent for
reordering, which is a named gap.

### What the review round changed — 2026-08-22

A `/code-review` and a four-angle `/simplify` ran over the feature the same day. Six
correctness findings and two cleanup findings were taken; two were declined.

- **A duplicated `orderKey` deleted a cluster.** `applyRailOrder`'s tail filtered by KEY, so
  two clusters sharing one identity — the case `coveredHistoryPaths` names — meant the first
  was pinned and BOTH were dropped from the output. Membership is by group identity now, and
  a test pins it: pinning may lift one, never remove the other.
- **The auto-scroll never re-answered the drop slot.** It moved `scrollTop` and left
  `insertAt` and the insertion line frozen at the last `pointermove`, so the feature that
  exists to reach off-screen rows dropped onto a gap that had scrolled away.
- **`from` was a positional index frozen at `pointerdown`.** It is `data-order-key` now,
  resolved back to an index at drop time; a project leaving the rail mid-drag writes nothing
  instead of pinning its neighbour.
- **Escape left a click armed.** It cancelled the drop AND the listeners, so the release fired
  a `click` that collapsed the project the user had just decided not to move. Escape now takes
  the drag's chrome only; `pointerup` still swallows the click.
- **`cursor: grabbing` never showed** — `.asr-cluster__toggle`'s `cursor: pointer` beat the
  body class for every descendant of the header. `.is-rail-dragging .asr-cluster` takes the
  clusters out of hit-testing, the way `.is-pane-dragging .pane` already did, which also stops
  rows lighting their hover wash under a passing ghost.
- **Per-frame work is batched.** Measuring and painting happen once per `requestAnimationFrame`
  off the pointer's last position, reads before writes, instead of a `querySelectorAll` + a
  rect read per cluster + a style write on every raw `pointermove`. Nothing is cached across
  frames on purpose: the rail re-renders mid-drag and a cache would answer for elements that
  are gone. The auto-scroll's separate loop folded into the same pass.
- **The drag chrome stopped being a second copy.** The ghost wears `.pane-drag-ghost` plus
  three deltas, and `.is-rail-dragging` joined `.is-pane-dragging` on the one cursor rule.
  Both live in `08-popovers.css` rather than the spec §8 table's `04a-agent-rail.css`, and
  they have to: that partial loads FIRST, so a `.rail-drag-ghost` written there would lose
  every shared declaration to its own base class.

**Declined, both named rather than argued with.** The controller reads the rail's DOM
(`.asr-cluster`, `.asr-cluster__head`, `data-order-key`) where its sibling `new-pane-drag.ts`
takes an injected `slotRects()` — so spec §8's "mirroring `new-pane-drag.ts`'s deps shape" is
aspirational, not true, and renaming a rail class breaks the drag with no compiler error. The
fix is a real refactor of three files and it was not taken in a session that can run no gates;
it is a follow-up. And `onDragStart` stays though no caller supplies it, because it is the
sibling's API shape and that parity is the thing §8 asked for.

`npx prettier --check` and `npx oxlint` are clean over the touched files, with two errors left
in `agent-rail.tsx` — `react(purity)` on `Date.now` and `react(immutability)` on a signal
write — both reproduced on a pristine `HEAD` copy and therefore not this work's.

### A second review, because the first one went stale — 2026-08-22

The review above ran BEFORE the rAF rewrite, the CSS move and the ref change it prompted, so
it had reviewed none of them. A second pass over the current code found three more, two of
them **regressions the cleanup round itself introduced**:

- **A flick collapsed the project it tried to move.** Batching to one frame meant `insertAt`
  is set by `runFrame`, not by the move handler — so a drag that crosses the threshold and
  releases inside the same frame (ordinary at 125Hz) had begun a drag but measured none, and
  the `slot < 0` guard returned BEFORE arming the click swallow. Escape landing before the
  first frame took the same path. `new-pane-drag.ts` swallows on `wasDragging` alone; this
  does now too, and the reasons to abandon are read after.
- **The stale-stream window the oxlint fix opened.** Moving `streamRef.current` out of render
  into a passive `useEffect` put it a render behind the DOM, and the drop resolves its source
  index against the DOM and then splices THAT array — so a rail re-rendering mid-drag could
  splice the wrong element out and pin a project nobody dragged. It is a `useLayoutEffect`
  now, which runs before the browser can dispatch the release.
- **The write side had no defence for a shared `orderKey`.** `applyRailOrder` was taught to
  lift only the first of two clusters sharing a key; `pinAt` still wrote the bare key, which
  resolves to that first cluster — so dragging the remembered twin would move the live one and
  leave the twin where it was. A stored entry cannot address the second of a pair, because the
  identity that would is the tier-scoped `key` this feature exists not to store. `pinAt`
  writes nothing in that case rather than something wrong.

A hand trace of the round trip after those fixes — drop slot → `to` → `pinAt`'s splice →
`railOrder` → `applyRailOrder` → render — reproduces the insertion line's own position for a
drag up, a drag down and a drag to the end, and the live→remembered case is asserted directly.
One visual defect came out of it and is fixed: the insertion line is `position: fixed`, so a
slot whose cluster is scrolled half out of view painted the line ABOVE the list, across the
stage strip and the traffic lights. It is clamped to the scrollport.

### A third pass, from Codex — 2026-08-22

`codex exec` (gpt-5.6-sol) reviewed the same scope afterwards and found the twinned-`orderKey`
hole to be WIDER than the fix above had closed, plus one real gap:

- **The controller resolves the grabbed cluster by key too.** `pinAt`'s guard only refused when
  the DRAGGED group was not the first with its key — but `onPointerUp` resolves `source` with
  `findIndex(dataset.orderKey === fromKey)`, which returns the FIRST twin whatever was actually
  grabbed. So a drag on the remembered twin arrived at `pinAt` already claiming to be the live
  one, and sailed past the guard. The refusal is now "the dragged key is not unique in the
  stream" — which catches it from either end.
- **A pinned prefix spanning both twins wrote one entry for two slots.** `canonicalOrder`
  collapses a repeated key, so dropping a project below a twinned pair shortened the prefix and
  landed it ABOVE the insertion line. A second refusal covers a prefix with a duplicate key.
  Dropping BETWEEN the twins is still expressible and still works — the refusal is scoped to
  what cannot be written, not to any stream containing a twin.
- **A flick was silently discarded.** Batching meant a drag crossing the threshold and
  releasing inside one frame reached `pointerup` with `insertAt` at -1: its click was
  swallowed, but no drop was reported. The release now measures once, synchronously, at its own
  position — the only unbatched measure left, at most once per drag.

**Two Codex findings are accepted as gaps rather than fixed**, both narrow and both
self-correcting, neither producing a WRONG order — only a missing one:

- A scan landing MID-DRAG re-keys the cluster from `plain:<path>` to its repository key, so the
  release cannot find what it grabbed and writes nothing. Teaching the controller to
  canonicalize would put the scan map inside a module that knows nothing about repositories.
- On a cold launch, a project pinned under its repository key reads as `plain:<path>` until its
  scan lands, so it sits at its default position and jumps when the scan arrives. §3.1 closes
  the `plain:` → repository-key direction on read; the reverse is not closeable before the scan
  exists. The spec's claim that its two rules close this is therefore **too strong** for the
  cold-start case.

**The mutation check caught a dishonest test.** Restoring the broken guard left the flick case
GREEN in a full-file run and red in isolation: the click swallow disarms on a
`setTimeout(…, 0)` that never runs inside a synchronous test body, so an earlier test's
swallow was still standing and ate the click. The suite's `afterEach` yields a macrotask now,
and both new cases fail against the broken guard as they should.
## Every rail row closes what it names — 2026-08-22

Built from the [spec](specs/2026-08-22-rail-close-model-design.md) `decided`; the rule is new
DL-27.21. The owner supplied the settled model as a table and it is reproduced there in full.

**The rail drew agents and closed tabs.** A row carrying one agent wore that agent's glyph and
printed that agent's turn, and its ✕ said `Close tab`. A multi-agent tab had no ✕ anywhere —
DL-27.13's parent row is behind `PANE_TREE_HIDDEN`, so its rows ARE the tab, and the component's
own comment admitted the gap ("the rail deliberately offers no close for such a tab"): closing
one of three agents from the rail was impossible. A project header's ✕ existed only on a
REMEMBERED cluster, where it forgot a folder — a different verb from every other ✕ in the
column. Three answers to one gesture.

**One rule replaces them: the control closes the thing its row names.** An agent row closes that
pane, which is ⌘W's own contract, so the tab goes with it only when that pane was its last. That
is decided by [`closePaneAt`](../src/terminal/close-coordinator.ts) `current` from
`manager.paneCount()` — the tab's REAL pane count, never the rail's agent-row count, since
`RailTabRow.panes` holds agent panes only. A row carrying no agent is a plain shell tab and
closes the tab. The knowing consequence, carried on purpose: **a tab holding one agent beside a
plain shell now survives that agent's close** and re-draws as a shell row. "Close exactly that
pane" says precisely this; the alternative kills a shell nobody asked about.

`closePaneAt` is a new coordinator entry point rather than a widening of `closePane()`, because
`closePane()` is ⌘W's and can only ever mean the focused pane of the ACTIVE tab — the rail points
at a pane in a tab that is not selected, a path that had never run.

**The project header closes the project, and that is one act with two halves.**
[`closeTabs`](../src/terminal/close-coordinator.ts) `current` asks the busy guard ONCE over the
union of every pane of every tab: N calls to `closeTab` would raise N dialogs — the user pressed
one control, and answering the same question five times is how a confirmation stops being read —
and would walk stale indexes, since every dispose shifts the list. Entries are pinned by identity
before the first dispose and re-found for each. It answers `boolean`, and a declined dialog
disposes nothing, which is what stops the second half from running.

That second half is why `RailStreamGroup.historyPaths` is populated for LIVE clusters now.
Closing the tabs alone would only demote the cluster to the remembered tier — the header would
stay exactly where it was, under the pointer, and the ✕ would read as broken. The set is what
`rememberedClusters` currently SUPPRESSES for this cluster, by both of its rules: prefix attach
(an entry under one of the cluster's open worktrees) **and same project key** — a worktree of the
same repository with nothing open in it is attached to no live path, so it would build its own
remembered cluster carrying this project's own `orderKey` and the header would come straight
back under the same name. `tabIndexes` is the other new field: every tab index the cluster holds,
ascending, because the caller disposes by index and walks them where a removal cannot shift a
coordinate it has not used yet.

App-side, `workspacesOrphanedByClose` is a genuinely different question from the singular
`workspaceOrphanedByClose`, not a loop over it: the singular asks "does this workspace survive
the loss of ONE tab", and with every tab of a project closing, two tabs of one workspace would
each answer "the sibling survives" and strand the file workspace. The survivor set is computed
once, against everything that is closing.

**`disposeTab` stopped closing the window.** Its empty branch raised `closeWindow()` under
electron-migration spec §9.5's "every window is a peer, the last SURFACE closes THIS window";
it now raises `boardOpen` and returns. The window stays, the rail keeps its project headers,
and the stage shows the Open board — which `App` already makes uncancellable while no tab is
open (`canCancel={tabViews.value.length > 0}`), so the surface cannot be dismissed into an empty
stage. `flushSettingsSave` went with the close it existed for; nothing there is dying any more.
Three things deliberately did NOT change: the `surfaces.total() > 0` branch above it still shows
a document rather than the board, `removeEmptyTab`'s own `closeWindow` still fires on the
pane-MOVED path (a donor window sitting on a board is worse than one that closes), and no pty
exit reaches `disposeTab` at all — a tab's last pane exiting prints
`[Session ended — press Enter to start a new one]` and removes no tab.

**⌘⇧W is untouched.** `close-tab` remains the whole agent group of one tab, and the rail
duplicates it nowhere.

Geometry is DL-27.5's swap in both new places: a leaf's close takes the agent glyph's trailing
slot, and the header's takes the CARET's — the same 17px trailing column, restated by the
header's grid, so no fourth track opens and no control leaves the rows' own edge. The caret
gives that slot up only while the close is up, including the collapsed state that otherwise pins
it visible; at rest, when "folded, not empty" has to be readable, it is unchanged. A leaf stopped
being a `<button>` and became DL-27.1's container plus full-bleed hit layer — the shape
`.asr-row--tab` has always had — because a button cannot hold a button.

Renderer-only apart from that one `disposeTab` branch, so it reaches BOTH hosts.

**A medium code review over the working tree caught three real defects in this work**, all
fixed here: `flushSettingsSave` was left as an unused import once its only call site went,
which is `TS6133` under `noUnusedLocals` and would have failed `npm run build`; a new test used
`Array.at`, ES2022 under this repo's ES2020 `lib`, failing the same gate; and — the substantive
one — `closePaneAt` routed on `paneCount()` BEFORE checking that the tab still holds the pane
the user pressed. `index` is a coordinate the rail read at render time, so a `pty:exit` closing
an earlier tab shifts every later one down, and the stale index could name a different
single-pane tab that `closeTab` would then close outright — silently, since `confirmClose`
answers true when nothing is busy. Membership is asked first now: the pane id is the half of
the gesture that cannot go stale.

Evidence after the fixes: `npx tsc --noEmit` clean, and the six affected suites green (183
tests — close-coordinator, agent-rail, agent-rail-model, app, tab-lifecycle, rail-order).
**Still owed: full `npm test`, `npm run build`, the design-language gate, an `electron:dev` or
`tauri dev` pass, and an owner eye review.** No agent has been closed from a leaf, no project
from a header, and the window-stays branch has never been seen in a running app.

## The GitHub page follows the attention loop — 2026-08-22

The owner-approved [spec](specs/2026-08-22-github-readme-design.md) `decided` replaces the
pre-V1 repository page with [the attention-first README](../README.md) `current`. The first
viewport now states the audience, “Know which agent needs you next,” the moving
`releases/latest` download, macOS Apple Silicon and Windows x64, with the unsigned,
SmartScreen-prone and runtime-unverified Windows limit beside the hero. Launch → Watch → Jump
→ Resume comes before five V1 proof groups; retired Tauri, Stackgrid migration, separate
Windows-preview and no-session-restore copy is gone.

The owner supplied one 2244×1388 capture of the packaged Electron V1 shell with the current
Agent Rail visible. [The tracked hero](../.github/assets/screenshot.png) `current` preserves
that capture as the product proof; [the 1280×640 social preview](../.github/assets/social-preview.png)
`current` composes the same app pixels beside the product name and attention headline. No
gallery, landing mock or generated app surface is substituted. Updating the tracked social
asset does not update GitHub's repository setting.

Public facts were checked against the 1.0.0 changelog, package metadata, shipping Electron
builder config, release workflow, agent catalog and the public `v1.0.0` release with eight
served updater/install assets. GitHub's Markdown API rendered the page, all 14 relative targets
resolve, required/forbidden copy scans pass, the hero matches the supplied source pixel-for-pixel,
both PNG dimensions pass and Prettier plus `git diff --check` are clean; exact commands live in
[the implementation plan](plans/2026-08-22-github-readme.md) `current`. The owner approved the
GitHub-rendered page, hero at inline width and social card on 2026-08-22; updating the tracked
social asset in GitHub's repository settings remains a separate, unauthorised action.

## One sentence on three rows — 2026-08-22

Three rail rows in one project cluster printed the identical sentence, each stamped `now`,
while the panes behind them were unrelated agent sessions. The sentence was not repeated by
three agents: it was said ONCE and copied onto rows it never belonged to.

**Three links made it.** A tail request carried `(agent, cwd, lastSeenAt)` and nothing else,
so [`selectCandidate`](../electron/resume/resolve.ts) `current` guessed the pane's session by
`argmin |candidate.mtimeMs - lastSeenAt|` with a `taken` dedup set that lived for exactly ONE
batch — the pairing was re-guessed every 300ms and permuted freely. `merged` in
[`session-tail-store.ts`](../src/terminal/session-tail-store.ts) `current` kept the previous
sentence whenever the answer was null. And null was the COMMON answer for a working pane, not
a rare one: the reader took only the last 64 KiB, and a streaming session's last 64 KiB holds
no assistant `text` at all. Composed: pane A got file F's sentence, was re-paired to a file
answering null so it KEPT F's sentence, F was released to pane B, which got it too. Nothing
ever cleared it.

Measured on the owner's real corpus while the bug was on screen: three of the four newest
`spacevibe-deck` transcripts answered null, and of the 616 records sitting past the 64 KiB
window, 486 were `user:tool_result` — an agent's own tool traffic burying its last words.
The `now` on every copy came from `pane.changedAt`, which
[`commit`](../src/terminal/agent-attention.ts) `current` bumps only on a VISIBLE state change:
the age and the sentence had no common source, so a twenty-minute-old fossil read as fresh.

**The fix pairs and pins.** A request may carry `preferredId` — the session this pane was
paired with last time — and `resolveSessionTails` resolves a batch in TWO passes: every pin is
honoured first, then `selectCandidate` ranks what is left. One pass in request order would not
do, because an unpinned pane sitting earlier takes the very candidate a later pane is pinned
to and the churn resumes. The answer became `{ id, tail }`: the renderer needs the id to tell
"same conversation, nothing new to quote" (keep the row) from "different conversation now"
(drop it, empty or not) — reading those two as one is what let a sentence outlive its pairing.
`findCandidateById` deliberately skips the 30-day cutoff and the ranking, since both exist to
guess at the answer a pin already states.

**One thing was built, then withdrawn the same day.** `noteResumedPane` was given the resolved
session id and `resumeClaims` became a FIFO queue of ids, so a restored pane would start out
pinned to the conversation it actually reopened. Adversarial review killed it: a mark is keyed
by `(workspace, agent)` and has NO causal link to a pane. It is claimed by the first matching
pane the process poll happens to recognize — refs `[none, B]` leave one mark that the pane
which opened a FRESH conversation takes — and it is left the moment `materialize` resolves,
while the command is only armed and its `writePty` can still fail. Under the old count both
mistakes cost one extra question; under an id they pin a row to a conversation it is not in,
permanently. That is strictly worse than the drift this whole change set out to fix, because a
drift corrects itself and a pin does not. Reproduced as a failing test, then reverted: **a mark
says "ask for this pane", never "this pane is running session X"**. Pinning a restored pane
correctly needs a mark bound to a pane id, which is the tab-materialization seam and therefore
a fork.

**A pairing must not outlive its agent generation either** — the defect the same review found
first, and the one this change had introduced. A pane id outlives its occupants: `claude` →
shell → `claude` reuses it, and without a forget the pairing survives, the pane keeps sending
it as `preferredId`, main keeps honouring it, and the new agent's row wears the old agent's
sentence for as long as the pane lives. Two tells, both already on `PaneView` and both produced
by `agent-attention.ts`'s own generation handling: the agent label changed (covering the `null`
shell step), or `hasRun` went true → false (the gate reopening; the other direction is just the
same agent finally working). `fingerprintOf` gained `hasRun` and now covers EVERY pane, not
only agent panes, so a generation change cannot be skipped as a repeat before the forget runs.

Three smaller review findings went with them: the host facade walks the REQUESTS rather than
the reply, so a host answering with a different length cannot change how many panes get an
answer; `resetSessionTailStore` bumps an epoch that an in-flight answer checks before merging,
so a reply cannot rebuild the state a reset just cleared; and the growing read window lost its
short-read early exit, which looked like an end-of-file test but is not — `tailBytes` makes one
`readSync`, which may legally return fewer bytes than asked for.

The read window now grows 64 KiB → 256 KiB → 1 MiB, stopping at the first that yields a
sentence or when the read comes back short (the whole file, genuinely wordless). Each step is
a fresh read from the end rather than a chunk stitched onto the last: a JSONL record split at a
boundary has to be re-joined, and a bad re-join invents sentences nobody said.

**Not fixed, on purpose** (all three in the
[plan](plans/2026-08-22-rail-tail-pane-pairing.md) `current` §7): a pane that started a FRESH
conversation still gets its FIRST pairing from the ranking — a session file's `birthtime` is
the honest anchor and is unread; the request still carries the TAB's cwd, not the pane's; and
the 300-file scan cap is global and applied BEFORE the cwd filter, which already drops 39 of
this machine's 206 Deck transcripts.

Renderer plus main process, Electron-only in effect (`session_tail` has no Tauri counterpart;
on Tauri the rail keeps its fallback).

**The strongest evidence is the repro replayed.** The deterministic three-batch sequence that
produced three identical rows during the diagnosis was re-run through the FIXED
`resolveSessionTails` against the owner's real `~/.claude` corpus, carrying each pane's pairing
back the way the store now does. Same clocks, same files, and the answer inverted: three
distinct sentences on three rows, pane A holding `cf12b1c4` unchanged across all three batches
instead of being re-guessed each time. The sequence that proved the bug now proves the fix.

Beyond that, `npm test` is 3673 passed / 8 failed, with every failure — six in
`tab-manager.file-surfaces.test.ts`, one in `design-language.test.ts`, one in
`settings-screen.test.tsx` — proven to belong to other sessions by copying this change ALONE
onto a pristine `HEAD` worktree, where those same suites pass **1019/1019** together with the
new ones. Both typechecks and Prettier clean there and here. 24 store tests, 26 tail tests, 7
facade tests, 4 validator cases, plus two named reproductions (`H1`, `H2`) that were written
red against the review's findings and are green now.

**No `electron:dev` pass, no owner eye review, and no rail has been watched for the minutes of
real agent traffic the bug takes to appear.** The repo-wide `docs-compliance` gate is red (36
findings, including README and ARCHITECTURE files untouched here); the new drift row is flagged
for the identical D7 reason as all 30 other `building` rows in that table. Two files crossed
oxlint's 300-line warning (`session-tail.ts` 333, `session-tail-store.ts` 404); both stay
inside the 800-line ceiling and are left as backlog rather than split mid-fix.

## Deck asks before it counts — 2026-08-22

> **Superseded (decided 2026-08-23, committed 2026-08-24):** the consent model below was reversed — see
> [Analytics goes default-on](#analytics-goes-default-on--2026-08-24) `current`.
> The mechanics (channels, service, buffers, payload) are unchanged; only the
> question is gone, and this section stays as the record of what was built.

Opt-in usage analytics, client half, built from the
[spec](specs/2026-08-22-anonymous-usage-telemetry-design.md) `decided` per its
[plan](plans/2026-08-22-anonymous-usage-telemetry.md) `current` after the owner's
"implement this spec". The trust boundary was the design: **nothing counted,
persisted for analytics or sent before the user pressed "Share usage stats"**,
and the payload carries no identifier that can link one day to the next.

**The shape.** Renderer counters ([`usage-counters.ts`](../src/telemetry/usage-counters.ts)
`current`) fire-and-forget over three new flat channels (`telemetry_count`,
`telemetry_state`, `telemetry_set_enabled`, plus a `telemetry:state-changed` broadcast so
one window's decision dismisses every window's row).
[`electron/telemetry/service.ts`](../electron/telemetry/service.ts) `current` owns consent,
per-local-day buffers (fresh random `dailyId` per day, reused across a timezone bounce),
and the sender: initial snapshot on first window ready, dirty sends at most every 15
minutes, a 6-hour heartbeat, 5-second timeout, whole-cumulative-snapshot upserts so a retry
can never double-count, 400/413 terminal, everything else retained under a 7-day cap. State
lives in `telemetry.json` through `JsonStore` — fail-closed and write-locked when
unreadable — deliberately NOT in `settings.json` and NOT in `register-store.ts`'s renderer
allowlist. [`payload.ts`](../src/telemetry/payload.ts) `current` is the human-readable
contract; its snapshot test pins the exact field list, and agent keys fold to the six
built-ins plus one `custom` bucket before anything leaves the renderer. Launches are
counted at `materialize` (catalog-armed panes), `dropAgentPane`, and the two resume paths
that still hold per-pane agent ids — `MaterializeIntent` was deliberately NOT widened
(fork-listed seam, not in the spec's fork list). Surface opens are edge-detected with a
seeded first tick so a boot-persisted open dock is state, not an open.

**The chrome.** The consent question shipped first as DL §30's second instance — a notice
row under the tab strip — and the owner reshaped it the SAME DAY into a full-screen
decision modal: [`UsageConsentModal`](../src/ui/usage-consent-modal.tsx) `current`, new
DL-29.9. The dialog withdraws BOTH of DL-29.3's exits (`Modal` grew a `dismissOnEscape`
prop — Escape is still swallowed at the document, it just no longer closes anything), has
no ✕, keeps focus on the PANEL so a reflexive Enter cannot opt anyone in, and joins
`browserPanelObscured` so it can never draw under the browser's native `WebContentsView`.
It shows at launch over whatever the window opens on — the Open board for a fresh install,
restored tabs otherwise — until either button persists; deliberately NOT gated to the
board, or a restored session would never be asked. `UsageConsentBanner` was DELETED
(component, test, `.usage-banner` CSS) rather than left unmounted; the "What Deck sends"
link style survives as the shared `.usage-link`, which Settings → Privacy also uses. DL §30
is back to one instance (DL-30.1/30.5 re-amended) and `.stage__surface` keeps the
`--notice-h` offset as the genre's rule rather than one instance's; the browser's native
view follows for free since its bounds are measured off the DOM element. Settings gained a
`privacy` category over MAIN-owned state (loading/enabled/off/unreadable; failed writes
surface and the UI never claims an unpersisted change). Copy: README's two "no Deck
telemetry" spots and the landing proof point now say "optional usage analytics — off until
you choose", the tour's `grep -ri telemetry src` proof became `cat src/telemetry/payload.ts`,
and no copy calls the payload "anonymous" (pinned by tests).

**What does not exist.** The Worker, D1, `https://api.deck.spacevibe.dev/v1/ping` and the
privacy page at `https://deck.spacevibe.dev/privacy` are a different repo and session
(rollout §12 steps 1-2); until they land, an opted-in client's POSTs fail silently — which
the failure design makes indistinguishable from health on purpose — and the consent
dialog's "What Deck sends" link 404s. The workspace-level subdomain record is owed in a
workspace session (X1). `USAGE_ANALYTICS_AVAILABLE` ships `true`, so the next release ships
the dialog.

**Verified by NOTHING yet, the modal reshape included** (owner's standing no-unasked-gates
instruction): no `npm test`, no typecheck, no build, no host pass, no owner eye review. The
suites written for this — payload snapshot, service lifecycle/cadence/retry (electron),
notice gate, consent-modal and privacy-section copy pins, the `dismissOnEscape` shell case,
the IPC contract fixture, the categories update, the tour pin — have never executed.

## Analytics goes default-on — 2026-08-24

The owner reversed the day-old consent model in conversation on 2026-08-23
(the commit, `cdc07a0`, landed past midnight on 2026-08-24), after
hearing the counter-case in full (the 1.0.0 "no telemetry" record, the
auto-update optics, the GDPR posture of an Individual-signed app) and two
offered alternatives (opt-out-with-notice, ask-with-default-share): opt-in
yields data too thin to steer by, and the payload counts daily use only —
never code, paths, prompts or agent output.

**The shape of the reversal.** `USAGE_CONSENT_ASKED: boolean = false` in
[`usage-notice.ts`](../src/telemetry/usage-notice.ts) `current` is the whole
switch (the `GRAB_PASTE_DISABLED` shape): `UsageConsentModal`, its tests, its
CSS, `Modal.dismissOnEscape` and the overlay-guard rank all stay in the tree
behind it, so the reversal of the reversal is flipping one constant — which
matters more than usual here because the reason to flip back would be legal,
not technical. DL-29.9 carries a retirement banner (the §24 precedent), not a
deletion. Main-side, [`EMPTY_STATE`](../electron/telemetry/model.ts) `current`
is `enabled` at the current `CONSENT_VERSION`; `parsePersisted` folds every
spelling except `declined` into the default — **off is the one state only a
user can put the app in, so it is never inferred away** — while an unreadable
`telemetry.json` still fails closed to off. The `consentVersion <
CONSENT_VERSION` downgrade-to-`unanswered` gate is deleted: nothing renders
`unanswered` any more, so a future version bump would have stopped collection
silently and permanently; a material payload change is a privacy-notice edit
now. Settings → Privacy is the one place the app says it collects ("On by
default. Turn it off here and Deck stops counting."), and README (both
spots), the landing proof point (EN + VI) and the tour's `cat
src/telemetry/payload.ts` proof were re-worded in the same commit so no
public copy says "off until you choose" about a default that is on.

**Consequences carried, named.** Every install of the next release POSTs, so
the Worker, D1 and the privacy page (other repos/sessions; rollout §12 steps
1-2) stop being follow-ups and become prerequisites — until they land, every
default-on client's POSTs die silently (today at DNS — the hostname does not
resolve; by the failure design nothing in the app can tell) and Settings
links a privacy page that answers 404. The 1.0.0 `CHANGELOG.md` keeps its frozen
"no telemetry" claim; the next release's changelog should state the new
default in one line. A user who enables sharing mid-session still reports
`maxTabs`/`restoredSessions` low for that day (lifecycle review finding #4,
open). Evidence class: `npm test` 3776/0, both typechecks, `npm run build` —
**no host pass, no owner eye review**.

## Verification state ledger

Full evidence behind [`../AGENTS.md`](../AGENTS.md) `current`'s "Chưa khớp thực tế" table.
That table keeps the claim, its intent label and its status; the evidence prose lives here so
the always-loaded file stays small.

| Claim                                                                   | Intent     | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The GitHub README and marketing assets are visually approved           | `current`  | done       | The V1 copy and both tracked PNGs use one owner-supplied packaged Electron capture; automated checks are recorded in the [plan](plans/2026-08-22-github-readme.md) `current`, and the owner approved the GitHub-rendered page, 900px hero and card-size social preview on 2026-08-22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Electron can replace Tauri on both supported platforms                  | `building` | partial    | Gate A is CLOSED for macOS: owner-verified auto-update against `v0.12.5-electron.2`, 2026-08-19. Gate C still lacks a real Windows run, and the owner elected to ship Windows unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Deck ships the Electron host                                            | `current`  | done       | `SpaceVibe Deck 1.0.0` (Electron) is public and `releases/latest` since 2026-08-20 — run 32383647050, four jobs green, eight assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| One pushed tag ships macOS and Windows, both self-updating              | `current`  | partial    | Shipped 2026-08-20 per the [spec](specs/2026-08-20-electron-stable-release-design.md) `decided` — run 32383647050 green end to end after the maiden run's promote fix. The electron.2 → 1.0.0 update hop and all Windows behaviour (install, SmartScreen, self-update) are unwitnessed; Windows is unsigned by decision (Gate C); preview.2 on Windows updates into a side-by-side install; Intel Mac and Windows ARM are not served                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pane detach is complete cross-platform                                  | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| File explorer is available                                              | `decided`  | backlog    | Surface built 2026-08-14 after the historical Gate M run, then reshaped the same day. Gate M was retired as current acceptance on 2026-08-23; the maintained packaged Monaco smoke passed its renamed universal package/runtime path twice that day but proves packaging mechanics only. Owner eye review, packaged both-layout pass and native macOS sign-off remain owed. Electron only, no Tauri implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
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
| Deck sends usage analytics by default                                   | `building` | unverified | Built opt-in 2026-08-22, reversed to default-on (decided 2026-08-23, committed 2026-08-24) — see [the reversal section](#analytics-goes-default-on--2026-08-24) `current`. Suite-verified (`npm test` 3776/0, both typechecks, build); no host pass, no owner eye review. Worker/D1/privacy page do not exist (other repo/session), so every default-on client's sends die silently until rollout §12 steps 1-2 land — now prerequisites |
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
