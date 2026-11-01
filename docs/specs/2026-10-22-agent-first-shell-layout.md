# Agent-first shell layout (project rail and agent dock)

Date: 2026-10-22
Status: Direction under evaluation. The owner chose to explore a hybrid of two gallery mocks
on 2026-10-22 and, after a rail-specific scout, picked rail option C (project-first) with its
Organize menu the same day; nothing is accepted for production, and no layout decision below is
final until the owner's eye review (AC-1). This specification does not claim shipped behavior.
Parent: [Deck-wide shadcn and Base UI migration](2026-10-21-shadcn-base-ui-migration.md), which
owns component technology, preset styling and the contrast floor. This record owns the shell
layout only.

## Purpose

The shadcn pilot's screens were an agent proposal: a chat transcript with a right-hand
inspector. Deck hosts live PTYs, so that template misstates the product. Before reworking the
shell, the owner asked for a scout of how about six reference apps that run several coding
agents lay out agents, agent state and switching. The scout notes stay outside the repository
because they name the studied apps.

The findings that shaped this direction:

- Most reference apps list a task container (a worktree or a thread); Deck already lists one
  row per agent, so the agent stays the organizing axis.
- Parallel agents are handled by routing attention, not by showing everything: a "next agent
  needing me" key, plus a view of the queue. Deck has the key (⌘⇧A) and lacks the view.
- Most apps draw "finished, not yet seen" apart from "waiting for your answer". Deck folds both
  into `asked`, although its source signals (`requested`, `warning`, `completed`) are separate.
- Review sits beside the agent and is scoped to its checkout, in every app studied.

## Options explored

Three mocks were built on one shared fixture so they differ in layout only:
[`src/gallery/layout-mocks/`](../../src/gallery/layout-mocks/) (a standalone gallery document,
`index.html?option=inbox|ribbon|filmstrip&mode=dark|light`).

| Option    | Shape                                                                                                  | Status                       |
| --------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Inbox     | Rail grouped by what each agent needs; attention switcher on ⌘⇧A                                        | Superseded as the rail by C  |
| Ribbon    | No rail; agents as a chip row in the top bar; agent-scoped dock                                         | Dock taken into the hybrid   |
| Filmstrip | Project column; stage keeps its split; every other agent as a text-snapshot card in a right column    | Not pursued for now          |

The first hybrid was Inbox with Ribbon's dock. Surface boards then compared options per
functional surface (`?surface=dock|changes|diff|browser|rail|settings`); after the owner's
picks the unchosen options were removed from the gallery (they stay in git history) and the
overview at `index.html` composes the picks into one shell. The rail board holds four options built
from a scout of how thirteen reference apps build their sidebar: A flat inbox with lifecycle,
B list with an Organize menu, C project-first, D compact with an icon rail. The owner picked C
and asked for B's Organize menu on it (`?surface=rail&option=c`). The overview is the stacked-sections dock holding the folder-tree Changes, the hunk review
queue on the stage, the browser beside the focused agent's terminal (`?stage=diff|browser`),
rail C and the Command-style Settings.

## Requirements of the hybrid

- **LAY-1 Project-first list.** The rail lists projects, each folding over its agent rows. A
  folded project speaks with its loudest agent (failed, needs input, working, unread) and a
  count. Inside a project rows are pinned first, then newest first (or loudest first under the
  Priority sort). Attention never rearranges the list; it is routed by the pill in LAY-3 and the
  switcher in LAY-7.
- **LAY-2 Row anatomy.** A state mark, the title (the user's name for the session, else the
  agent's latest sentence; one line), then the agent's logo, a branch chip (the folder name for a
  folder without git) and the time in state, right-aligned. Hover reveals pin, archive and a
  more menu (Rename, Pin, Mark unread, Copy path, Copy branch, Open in Finder, Archive); the
  same menu opens on right-click. Double-click or F2 renames in place (Esc cancels, empty
  restores). Nothing uses a native `title` tooltip.
- **LAY-3 Rail controls.**
  - Search is fuzzy over title, branch and project; `/` focuses it and Esc clears it.
  - The Organize menu groups By project (default), By status (Needs you, Unread, Working,
    Quiet) or By time, sorts by Last updated or Priority, and toggles Show archived. Outside By
    project each row names its project.
  - The "+" menu offers New agent, New worktree (a repository select and a branch input) and
    Open folder. A project's hover "+" starts an agent there, and its menu offers Move up, Move
    down, Hide and Remove. Archived and Hidden are collapsed sections at the bottom.
  - A "N need you" pill in the top bar jumps to the next such session and cycles (⌘⇧A while the
    rail has focus).
  - The footer holds Settings, Session history and a Tools menu (Explorer, Prompts, Browser,
    Token usage with their chords).
  - ↑/↓ move between rows, Enter selects.
- **LAY-4 State vocabulary.** `asked` splits into needs input (`requested`, `warning`) and
  unread (`completed` not yet seen), each with its own mark. Explicit/inferred confidence
  stays visible. Derived from existing signals only: no new IPC, hook or store.
- **LAY-5 Stage unchanged in structure.** The focused agent's space fills the stage with its
  existing split tree. The bar above it is the breadcrumb `project / branch / space`, dropping
  the space crumb when it only repeats the project. Each agent pane keeps an identity header
  (logo, name, latest sentence).
- **LAY-6 Agent-scoped dock.** A right column that follows the focused agent, built as one
  scroll of collapsible sections with nothing behind a tab: Ask when it needs input, its
  checkout's Changes as a folder tree whose folders carry roll-up +/− counts, the other agents
  of its space, Usage (tokens, cost, the space's cost, time running), Files and History.
  Toggled from the stage bar.
- **LAY-7 Attention switcher.** An overlay listing only agents in Needs you, Unread and
  Working, each with a text snapshot preview of its pane; ↑/↓ move, Enter focuses the agent,
  Esc closes. It takes over Mission Control's overview role, which is slated for removal.
- **LAY-8 Visual floor.** Stock preset controls per the parent specification's UI-1. Every
  composition-chosen text pair meets WCAG 2.2 AA in light and dark. The only motion that loops
  is the working mark and the needs-input ripple, within the design language's §1 budget.
- **LAY-12 Base components.** The shell is built from one library in two tiers, shadcn style.
  Primitives (in `src/ui/controls`) are generic, carry `variant` and `size`, take `class` for
  layout only and colour only from theme tokens. Blocks (in `src/ui/blocks`) are Deck-aware
  compositions of primitives for patterns used by two or more features: the agent row, the
  foldable section header, the setting row, the selectable theme card and the panel surface;
  data reaches them through props. A feature composes blocks and primitives and adds only its own
  logic; it does not hand-build a pattern the library covers. The primitive set is narrowed to
  the sizes and variants this mock's surfaces use, each with one named role; an option no mock
  surface uses is removed, not kept. Narrowing only removes options: it never changes the
  computed result of one that stays (UI-1, UI-4). The mock and the app import the same
  `src/ui/controls` and `src/ui/preset.css`, so the mock sets the density and there is no second
  copy to drift. Primitives and blocks are reviewed inside the mock's own surfaces in light,
  dark and each theme state; there is no separate specimen catalog.
- **LAY-13 Type scale.** Shell text uses five named steps declared once in one config file,
  never as a literal at a use site: `sm` 14px (what the user reads: row titles, prose), `xs`
  12px (labels, timestamps, counters, secondary lines), `2xs` 11px (captions, uppercase
  labels), `3xs` 10px (badges, pills) and `code` 12px monospace (paths, diff lines, tool
  output). The mock's 51 arbitrary font-size classes move onto these: `11.5px` mono paths become
  `code`, `13px` row titles become `sm`, the `0.6875rem` spelling of 11px becomes `2xs`. Text
  inside a mock web page (the browser stage's fake page) is page content, not Deck chrome, and
  is exempt. A lint rule rejects an arbitrary font-size class in shell code, added as a
  ratchet: existing uses are listed as debt and new ones fail. Because the steps live in one
  file, changing a size later is a one-line edit. Scaling the steps with a user setting and
  tying `--spacing` to them is out of scope: it would change every control's geometry (UI-1)
  and is a separate decision. Decided by the owner 2026-10-24; this rewrites design-language
  §4 typography for shell surfaces, so the design language is updated in the same change as
  the code. Alternative turned down: keeping the 12.5px and 10.5px steps of the existing
  `--type-*` tokens, because the preset and the mock both sit on 12px and 10px.
- **LAY-9 Window sizes.** The layout holds at 1440×900 and at 1280×800 with the dock open.
- **LAY-10 Regions.** The rail and the dock share one surface (the `sidebar` token) with no
  gap between them and the stage. The stage's panes sit flush, each on the terminal background
  and separated by 1px borders: no gap, no corner radius, no card. The breadcrumb bar carries a
  1px border below it and the dock a 1px border on its left.
- **LAY-11 Themes live in Settings.** There is no theme control on the stage or over the
  panes. Settings, opened from the rail footer or ⌘,, uses the Command structure (one search
  field, area chips, live rows); its Appearance area holds the theme gallery: Mode (System,
  Light, Dark), a light and a dark slot when the mode follows the system, cards grouped Light
  and Dark with a live hover preview, import and export. The theme model, the token list and
  the built-in set belong to [the settings and theme overhaul](2026-10-17-settings-theme-overhaul.md);
  the gallery's eight candidates (Deck Dark, Graphite, Midnight, Forest, Dusk, Deck Light, Paper,
  Mist) are mock content, each an explicit map in the gallery's shadcn-style token names (about forty,
  including eight terminal inks). The shipping schema is the one in the overhaul spec: the design
  language's role names, opaque hex, terminal ANSI 16 and editor colours (slice T1); the gallery's
  names and oklch values are converted, not shipped.

## Open decisions

Each decision carries the evidence from a second scout of seven more reference apps
(13 in total, read 2026-10-22). The evidence informs; it decides nothing.

- **OD-1 Tree or inbox.** _Decided by the owner, 2026-10-22:_ option C, the project-first
  tree. The [navigation rail refresh](2026-10-06-navigation-rail-refresh.md)'s 2026-10-06
  choice stands for the structure; what changes is the row (LAY-2), the roll-up on a folded
  project, the pill and the Organize menu, whose By status grouping is the attention-first view
  as an option rather than the structure.
  _Reference evidence (first scout):_ 7 of 13 let the user switch between project and status
  grouping or filter by status; 2 default to status sections; the rest default to a project or
  workspace tree.
  _Rail scout, 2026-10-22 (13 apps):_ the rows are a title plus one meta line, with detail in a
  hover card; archive or done is the lifecycle action most apps weight (nine have it; two
  auto-archive when a pull request merges); pin appears in about eleven; eight let the user
  switch the grouping; about six put search in the rail; only one has an icon-rail collapse,
  most hide the sidebar outright; footers are light and none shows a usage-limit line; none
  except one has arrow-key navigation in the list.
- **OD-2 ⌘⇧A.** Today it jumps straight to the pane that needs you (user guides document
  this). Options: the switcher replaces the jump, or a tap jumps and a hold opens the
  switcher. Either changes a documented shortcut.
  _Reference evidence:_ the most common pair is a tap "next needing me" key plus a separate
  queue view (an inbox, an activity list or a title-bar dropdown). One app has an
  attention-filtered hold-and-release switcher. Four let a permission or question be answered
  from the queue without opening the agent. In Deck that would need a structured reply
  channel per CLI, not keystrokes written into the PTY.
- **OD-3 Dock root.** The Explorer and Changes root today is the selected tab's
  `workspacePath`, fixed when the tab was created; LAY-6 needs the focused pane's checkout.
  Whether that re-rooting touches tab materialization must be confirmed before it is built.
  _Research, 2026-10-22 (origin/main 54eb4e5c):_ chrome-only. The root is the signal
  `activeWorkspace` (`src/files/file-surface-store.ts:293`), written from the selected tab's
  `workspacePath` (`src/ui/app.tsx:903-908`), which is "fixed for the tab's life and never
  re-derived from a pane's cwd" (`docs/internals/terminal.md:131-132`). The focused pane's cwd is
  already a reactive signal, `statusInfo.value.cwd` (`src/terminal/tab-manager.ts:636-640`), and
  the renderer already maps a path to its checkout by longest prefix (`worktreeForPath`, used in
  `src/ui/agent-rail-model.ts`). The dock therefore gets its own derived root signal (focused
  pane cwd → checkout, falling back to `activeWorkspace`) and feeds the existing
  `workspacePath` prop. It must not rewrite `activeWorkspace`: the file watcher and open file
  tabs key on it (`src/files/file-surface-controller.ts:212-219`). It becomes an R4 fork only if
  a cwd field is added to `PaneView` or `TabView` (`tab-manager.ts` `syncViews`). Open edges: the
  cwd is polled every 2 seconds, is null before the first poll or while a file surface has focus,
  and on Windows comes only from OSC 9;9; a cwd outside every known checkout needs a rule
  (Explorer must not fall back to `$HOME`).
  _Reference evidence:_ 11 of 13 scope the review panel to the selected agent or task. The two
  exceptions are a terminal-native app, whose diff is a pane scoped to the terminal's
  repository, and an editor, whose panels are project-wide.
- **OD-4 Dock default and width.** At 1280px the 300px rail and the 340px dock leave 640px
  for the stage. Default open or closed, and whether the dock narrows, are open.
  _Reference evidence:_ defaults are split. Widths cluster at 295–340px. Every app has an
  explicit narrow-window rule: a sheet, a full/split/hidden cycle, an overflow menu, a minimum
  terminal width, or showing only the active session.
  _Owner, 2026-10-22:_ open by default at a fixed 320px with no resize. Under 1360px the dock
  becomes a 32px edge handle that opens it as a sheet over the stage with a scrim. The
  browser's native view paints above every DOM layer, so while that sheet is open over a stage
  holding the browser, the view must yield or hide, as it already yields to the dev-server
  menu.
- **OD-5 Where the rail footer's tools go.** Session history, Token usage, Explorer, Prompts,
  Browser and Settings (design language §28) are not placed in the mock beyond Settings.
  _Reference evidence:_ there is no consensus: sidebar header, sidebar footer, title bar, or a
  right-side tool strip, which is used by the two most tool-heavy apps. A command palette
  exists in nearly all.
  _Owner, 2026-10-22:_ the global tools stay in the rail footer; the dock carries only the
  focused agent's sections.
  _Owner, 2026-10-22 (follow-up):_ Token usage and Session history are global, so the rail
  footer opens each as its own stage view (⌘⇧U, ⌘⇧Y; Esc or Close returns), not as a section of
  the agent-scoped dock. They lose their place in today's tabbed side panel, which the dock
  replaces. Usage shows `—` for the agents the scanner does not read.

- **OD-6 Space marks and ⌘1–9.** The mock's stage bar draws no space marks. Digits keep
  counting spaces unless the owner decides otherwise; routing them to rail rows goes through
  the tab seam and is a fork.
  _Reference evidence:_ 6 of 13 point the digits at the agent or task list, 2 at tabs, 2 at
  panes or tool windows, and 3 bind none.
- **OD-7 Rail features not carried.** Option C drops or defers what today's rail does, and
  each needs the owner's yes or a place before it is built:
  - the checkout level (a `worktree` or `folder` tag, a checkout menu with quick agents, Open
    shell, New split here): C shows the branch on the row instead;
  - the Create row's one-press Agent, Worktree and Folder buttons and dragging Agent onto a
    pane: C has the "+" menu;
  - closing a pane with ✕: C archives (reversible) and has no hard close;
  - collapsing the rail to the 52px avatar column with a flyout, and ⌘B: not in C;
  - dragging project headers to reorder: C has Move up and Move down;
  - the footer's six buttons and the usage-limit line: C has Settings, History and a Tools
    menu.

## Constraints found by research

Read from `origin/main` 54eb4e5c; each line was re-read by the coordinator.

- **Chords (OD-2, AC-4).** `handleShortcut` is one capture-phase listener that swallows a matched
  chord before xterm (`src/terminal/tab-manager.ts:3153-3194`); bare keys are not bindable
  (`src/lib/keybindings.ts:282-320`), so a bare Esc, ←/→ or R must never be global because the
  agent CLIs use them. Collisions in the mock: ⌘⇧D is `split-column`
  (`src/terminal/default-keymaps.ts:88`), ⌘⇧G is `find-previous` (`:160`). Proposed:
  - dock toggle → the shipped `toggle-dock`, ⌘⇧J / Ctrl+Shift+J (`default-keymaps.ts:252`, `:439`);
  - diff open/close → a new registry action on ⌘⇧H / Ctrl+Shift+H, unbound in both keymaps
    (Hypothesis: no agent CLI binds it; check their keybinding docs); fallback ⌘⇧X;
  - ⌘⇧A, ⌘⇧I and ⌘⇧↵ are Deck's own and stay (`default-keymaps.ts:197`, `:213`, `:154`); ⌘⇧A
    changes behaviour only if OD-2 says so;
  - queue ←/→/R are local handlers active only while the diff surface owns focus, never when
    xterm does; each Esc path (switcher, composer, inspect pick, dock) needs an owner so it
    never reaches the PTY of an agent that needs it to interrupt.
- **Browser beside a pane (LAY-5, OD-4): chrome-only.** The renderer measures a placeholder and
  sends `browser_set_bounds` (`src/browser/browser-panel.tsx:55-100`,
  `electron/ipc/register-browser.ts:72-77`), so any element's rectangle can drive the view
  without touching the layout engine. Yield is one predicate, `browserPanelObscured`
  (`src/ui/app-policy.ts:24-34`); the dock sheet needs one more flag there. Limits: the host keeps
  one `WebContentsView` per window (`electron/browser/view.ts:102`), so two simultaneous
  browsers are an R6 fork; the browser is a stage surface, not a split leaf, so "beside the
  terminal" needs a side slot in the stage markup, not a leaf in the tab layout. Below a
  900px stage the preview takes the whole stage and the agent chip in its toolbar returns to
  the terminal (owner, 2026-10-22). Hypotheses: `ResizeObserver` misses a move without a resize (split drag), so the hole may need a position
  poll; a native run decides.
- **Attention states (LAY-4): derivable, no new store.** `completed` is a latched attention kind
  cleared only by `acknowledge`, which runs on pane focus while the window is foreground
  (`src/terminal/agent-attention.ts:1109-1121`, `src/terminal/tab-manager.ts:747-752`), so
  Unread = `attention === "completed"`. Nothing about seen or attention is persisted: after a
  restart nothing is unread. Explicit `requested` and `completed` arrive only for claude, codex
  and opencode (hooks or plugin, `src/lib/agent-signal-map.ts:131-139`); the other 11 agents in
  `src/lib/agents/agent-registry.ts:31-46` get `requested` from OSC 9/777 or bell and
  `completed` only inferred, so their Unread mark is low-confidence. `warning` is explicit for
  every agent but comes only from OSC 9;4 severity warning, never a hook.
- **Dock Usage and History (LAY-6).** Buildable renderer-side: time running
  (`PaneView.startedAt`, `src/terminal/tabs-store.ts:88-95`), the pane's session id when known
  (`PaneView.sessionId`/`lastSessionId`, `:63`, `:104`; reported only for claude, codex hooks),
  History for one pane (`sessions_list` filtered by exact cwd and agent,
  `src/sessions/session-filters.ts:10-25`; Claude and Codex only), and repo-level usage and
  cost from the snapshot filtered by repo. Not buildable without a fork: per-session or
  per-pane tokens (`UsageBucket` has no session dimension, `electron/usage/model.ts:125-136`)
  and any usage for the 12 agents other than claude and codex (`UsageAgent`, `:107`). LAY-6's
  "its tokens" is therefore the repo's tokens for that agent until the owner approves a scanner
  change. A Usage dock tab and a Sessions dock tab already exist
  (`src/ui/usage/usage-dock-tab.tsx`, `src/ui/sessions/sessions-dock-tab.tsx`) and are global.
- **Hunk review state (owner, 2026-10-22).** "Mark reviewed" is session-only in v1: no
  persistence, no new store. It does not conflict with the line-comment composer
  (`2026-10-21-diff-line-comments.md`) if three things hold: the composer's location snapshot
  (DLC2) is untouched when a hunk is marked or the queue advances; the queue's ←/→/R handlers
  ignore keys while the composer or any text field has focus, and Esc discards the composer
  before it closes the queue (DLC13); and the composer's target candidates (DLC6) come from the
  checkout the queue shows, which is the focused agent's checkout, so the preselected target is
  that agent. DLC1's new chord must differ from the diff open/close chord chosen above.

## Out of scope

The terminal grid, layout engine, tab materialization, PTY ownership, persistence and IPC
shapes. Ribbon's chip bar and Filmstrip, kept in the gallery as considered alternatives.

## Acceptance criteria

| ID   | Required evidence                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | The owner has reviewed the hybrid mock by eye (screenshots or the running gallery) and answered OD-1 to OD-7.                                                           |
| AC-2 | Grouping (project, status, time), the roll-up, pin and archive state and the in-group order are a pure projection over existing tab views and attention state, with unit tests for each grouping, order stability and the split. |
| AC-3 | The dock follows the focused agent across spaces and projects, including a pane whose checkout differs from its tab's folder.                                            |
| AC-4 | The switcher and ⌘⇧A behave as OD-2 decides, by keyboard and pointer; the user guides and keyboard-shortcut page match.                                                 |
| AC-5 | Measured text contrast meets AA for every composition-chosen pair in both modes; stock pairs below it follow the parent specification's contrast decision.             |
| AC-6 | No PTY, IPC, persistence or tab-materialization change. The affected design-language patterns (§11 settings, §18.7 and §18.12 regions and panes, §19 dock, §24 theme gallery, §27 rail, §28 footer, §35 spaces) are rewritten in the same change; no invariant (DL §1-4, §7, §20, §21) changes except through the approved theme rewrite.     |
| AC-7 | Rail and dock render on the same surface token; panes are flush with 1px borders, no gap and no radius, in every built-in theme. |
| AC-8 | Every primitive and block is exercised by a surface of the mock and reviewed there; no separate specimen catalog exists; new shell UI contains no raw control or hand-built row, section header, setting row, theme card or panel surface where the library has one (a policy test fails otherwise). |
