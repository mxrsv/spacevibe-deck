# Changelog

User-facing release notes. The release workflow's `promote` job publishes the
`## <version>` section matching a stable tag verbatim (under the fixed
platform-limitations header), so each section is written for users, reviewed in
the release PR, and frozen at the tag — never an auto-generated commit list.

## Unreleased

- **See your dev servers from the strip (macOS).** A **Dev servers** chip
  [beside the tabs](src/ui/dev-servers/dev-servers-strip-chip.tsx) counts the
  servers running for the project you are in and opens a popover listing them,
  including ones you started in Terminal or VS Code, before or after Deck
  opened. Open one in Deck or your browser, or copy its address. A server
  shows as Running only while something is listening on its port, so a page
  that errors still reads Running, and one that stops reads Unknown, then
  Stopped. Windows does not list dev servers yet.

## 2.9.0

This update lets you send feedback from inside Deck and makes Update go
straight to the newest release.

- **Send feedback from inside Deck.** **Send Feedback…** in the app menu, or
  the Feedback row in Settings → About, opens the
  [feedback page](src/lib/feedback-url.ts) in your browser with your Deck
  version and system already filled in.
- **Update installs the newest release in one step.** When several releases
  ship while Deck is open, **Update** now
  [checks again](src/updater/update-controller.ts) and downloads the latest one,
  and the update notice moves to the newest version on its own, so you no
  longer step through each release in turn. It applies to updates after 2.9.0;
  reaching 2.9.0 itself may still take a step per release.

## 2.8.0

This update lets a split terminal start an agent from its header, lifts the
five-agent cap on quick launch, adds a plain Terminal to it, and gives the
interface bolder icons, softer corners and fewer divider lines.

- **A split terminal can start an agent from its header.** A plain shell pane
  opened with ⌘D or ⌘⇧D now has a header with your pinned agents' logos, so one
  press runs [that agent](src/terminal/pane-quick-agents.tsx) in the pane. The
  header also carries the split, expand and close buttons.
- **Folders under an open folder stay on the rail.** With a space open on a
  folder such as your home directory, a folder inside it you added or opened
  before used to vanish from the rail; it now
  [keeps its own entry](src/repositories/repository-model.ts) unless the project
  above it really includes it.
- **Quick launch has no limit on agents.** The quick launch page and a
  checkout's menu show every available agent, and you can
  [pin](src/settings/quick-agents.ts) as many as you like.
- **A Terminal card sits beside the agents.** It opens a plain shell pane, with
  the same **Split** and **New space** presses, and starts nothing.
- **Agent is the rail's main button.** In the row under the Deck name, **Agent**
  is now the filled button on the right, after Worktree and Folder. Collapsed,
  it stays on top of the column.
- **Icons are bolder and more solid.** Outlines are about half again as thick, so
  they no longer read thinner than the label beside them, and icons with a body
  are [drawn filled](src/ui/controls/deck-icon.tsx). Arrows, carets and layout
  pictures stay outlines.
- **The new-task board matches quick launch.** It shows your pinned agents and
  the Terminal card, the same as the launch page.
- **Fewer lines, one project name.** The hairlines under the Deck name and under
  the space strip are gone, the launch page sits inside the same margin as a
  pane, and the strip prints a space's folder once instead of twice when the
  space has no name of its own.
- **Short buttons are no longer pills.** Labelled controls 28px tall or less take
  the tab's corner radius, so they stop looking fully rounded; square icon buttons
  keep theirs.

## 2.7.0

This update turns the rail into a tree of projects, checkouts and agents, puts
Agent, Worktree and Folder one press away, and lets you collapse the rail to a
column of projects.

- **Agent logos in the rail keep their colour again.** The faded logos 2.6.0
  showed on rows that do not need you are gone; every row keeps its full-colour
  logo, and the badge on its corner still tells the state.
- **The rail is a tree.** Each project lists its checkouts by branch, worktrees
  tagged, and each checkout its agents beneath it — no cards to open or fold,
  and no frame around the project you are in. Rows are flat text on two lines.
  The first leads with what the agent is working on: the space's name, else your
  [first prompt](src/ui/agent-rail-card-model.ts) to it (Claude Code and Codex).
  The second names the agent and what it last said, or its
  [state](src/ui/agent-rail-card-model.ts) — Working, Needs you, Finished,
  Ready — until it has said anything. The model moves into the row's tooltip.
- **The rail is tighter and plainer.** The tree starts closer to the edge, the
  project name is bright and bold with its count in light text, the agent you are
  in is a solid inverted row, and a row's second line always starts with the
  agent's name, and the usage pills at the foot are one quiet line such as
  `Claude 42% · 7d`.
- **A project says how many agents need you.** Its header shows `N need you`,
  red when one of them failed, instead of how many are running.
- **Agent, Worktree and Folder, side by side.** One
  [row of three buttons](src/ui/rail-create-row.tsx) under the Deck name
  replaces `New Workspace`. **Agent** opens the launcher on the checkout you are
  working in — it splits beside your pane, or
  [opens a new space](src/terminal/agent-launch-target.ts) when you are
  elsewhere, and says which before you press Run — and you can still drag it
  onto a pane. **Worktree** creates a worktree right in the sidebar and
  **Folder** adds a folder to the rail; neither starts anything. A checkout with
  nothing open is one press on its name away from the launcher. Collapsed, the
  three stack above the project avatars.
- **Pick where an agent starts without leaving the launcher.** Its
  [top row](src/launcher/agent-launch-context.tsx) shows the project, the
  branch and whether the agent splits beside your pane or opens a new space.
  Change the project or the checkout right there, or choose **Open folder…**;
  nothing starts until you press an agent.
- **The strip shows where you are.** It reads project › branch › space › session
  for the focused pane, and its marks — with ⌘1–9 and switching between spaces —
  cover the current project; other projects are a click away in the rail.
- **Collapse the rail to a column of projects.** The toggle, a drag past the
  rail's edge or **⌘B** (Ctrl+Shift+L on Windows) shrinks it to one avatar per
  project instead of hiding it. A badge counts the agents waiting on you, red
  when one failed. Press an avatar to open that project's sessions beside the
  column, and arrow keys walk the avatars. Switching never moves the pane you
  are typing in.
- **Your tools sit at the foot of the rail.** Session history, Token usage,
  Explorer, Prompts, Browser and Settings are
  [one row of icons](src/ui/sidebar-actions.tsx) above the usage line, each with
  its name and shortcut on hover or focus. Collapsed, they fold into a single
  Tools button that opens them beside the column. `More` keeps only the pane
  actions.
- **Split, expand and close from the pane itself.** An agent pane's header shows
  [Split, Focus expand and Close](src/terminal/pane-agent-header.tsx) when you
  hover or focus the pane, and each acts on that pane — not on whichever one has
  focus.

## 2.6.0

This update shows which agents need you from the strip, moves each agent's state
onto its logo in the rail, and stops a busy start from hiding installed agents.

- **See every agent that needs you from the strip.** A
  [chip](src/ui/attention/attention-chip.tsx) at the strip's trailing end counts
  the agents waiting on you; it opens a list of them, failures first, and
  choosing one takes you to its pane.
- **A row's state sits on its logo.** The rail's agent rows carry their state
  [badge](src/ui/worktree-card-row.tsx) on the logo's corner, and rows that do
  not need you show a quieter logo. On the strip, a space with a question is
  marked yellow and a space with a failure red.
- **Agents are found on a busy start.** When Deck opened with many restored
  panes, a slow login shell could make the launcher say no agent is installed;
  the [probe](electron/agents.ts) now waits longer and retries instead.

## 2.5.0

This update keeps Deck responsive while agents in other spaces are printing,
simplifies the rail's checkout cards, and tidies the toolbar and usage view.

- **Deck stays smooth while hidden spaces print.** A terminal in a space you are
  not looking at no longer redraws itself on every new line, which could keep
  the window busy and, with many agents running, freeze it for seconds at a
  time. [Hidden panes](src/terminal/hidden-pane-render-fix.ts) now catch up
  once, when you switch to them.
- **Droid shows its logo.** The agent was drawn as a letter in 2.4.0; it now wears
  Factory's [mark](src/lib/agent-logos.ts) like the other built-in agents.
- **A project's only checkout has no second collapse.** When a project has one
  checkout, its [card](src/ui/worktree-card.tsx) stays open and pressing its head
  focuses it, so the header's caret is the only fold. The active checkout's head
  is a quiet band instead of an inverted fill, and the focused workspace is
  framed as a whole.
- **Worktree colours are removed.** Every checkout shares one look; the
  Worktree color item and the saved choices are gone.
- **Crush is withdrawn for now.** It no longer appears in the agent list or the
  [docs](docs/user/agents.md#built-in-agents).
- **The Overview button is hidden from the toolbar.** Mission Control still opens
  with ⌘⇧O and from View ▸ Mission Control.
- **The usage overview leads with the estimated cost.** The remaining allowance,
  range picker and cost timeline now sit below it.

## 2.4.0

This update adds eight built-in agents and an Add agent card to Quick Launch,
redesigns the Appearance and Agents settings, keeps settings changed in one
window from undoing another window's edits, and makes the active checkout
easier to spot in the rail.

- **Eight more agents out of the box.** Deck now
  [recognises](docs/user/agents.md#built-in-agents) GitHub Copilot, Amp, Kimi
  Code, Kiro, Grok Build, Mistral Vibe, Crush and Droid, each with its logo.
  They launch bare, without flag, model or effort controls (Droid keeps its
  autonomy level and spec mode).
- **Add agents from Quick Launch.** An **Add agent** card on the
  [launcher](src/launcher/quick-agent-editor.tsx) picks which agents appear
  there, and it shares one list with Settings → Quick agents.
- **Appearance and Agents settings have a new layout.**
  [Appearance](src/ui/settings/sections/appearance-section.tsx) shows each
  choice as a picture, and [Agents](src/ui/settings/sections/agents-section.tsx)
  previews your changes in a live sample workspace.
- **Settings from different windows no longer overwrite each other.** A
  [save](src/settings/settings-store.ts) now writes only the fields you changed,
  so an edit in one window keeps the preferences another window just set.
- **Clearer settings descriptions.** The
  [descriptions](src/ui/settings/settings-categories.ts) now explain always-on
  analytics, browser page restoration and what resetting to defaults keeps.
- **The active checkout stands out in the rail.** Its
  [card](src/styles/04c-rail-worktree-card.css) header takes the same inverted
  look as the focused agent row, so "focused" has one look at both levels.

## 2.3.0

This update makes Quick Launch a single press, groups the strip's spaces by
project, and brings Deck's window controls, paths, shortcuts and fonts in line
with Windows.

### Spaces and Quick Launch

- **A Quick Launch card is one press, and New space is a quiet icon.** When the
  folder already has a space open, pressing an
  [agent card](src/launcher/agent-launch-cards.tsx) adds the agent beside your
  current panes as before, and the small **+** icon on its right opens it in a
  space of its own; hover it for the **New space** tip. Enter still splits.
- **A start-screen agent card is one press.** On the
  [start screen](src/open-board/board-composer.tsx) each installed agent is a
  card marked with an arrow; pressing it starts the agent, and choosing a folder
  still never does.
- **A space opened with the + icon names itself.** It is called after its folder
  and the agent, such as `spacevibe-deck · Claude Code`. Your own name still
  replaces it, and a long folder name is shortened before the agent's.
- **Spaces group by project in the strip.** The
  [strip](src/ui/spaces/space-bar.tsx) keeps a project's spaces together in one
  capsule, and a repository and its worktrees count as one project.
  [Mission Control](src/ui/mission-control/mission-control.tsx) groups its
  spaces by project the same way. The marks sit centred in the bar, with the
  name at its left.
- **A hidden space that needs you still shows.** When the strip is scrolled so
  that a [mark asking for you](src/ui/spaces/space-edge.ts) is out of sight, a
  red dot appears at the edge on that side.
- **The focused agent stands out.** In the sidebar, the agent you are on is a
  solid, inverted row; a busy agent shows only its loading bars. In a tab split
  into several panes, the focused pane takes the same inverted edge, and its
  header joins the terminal below it.

### Windows

- **Minimize, maximize and close.** Windows' own window buttons now sit at the
  right of Deck's top row, in Deck's colours, and the row leaves room for them,
  so [nothing sits underneath](src/styles/22-caption-overlay.css).
- **Folder names, not full paths.** The sidebar, recent folders and the start
  screen name a workspace by its
  [last folder](src/lib/workspace-label.ts) instead of the whole `C:\…` path.
  The new-worktree form [suggests a path](src/lib/worktree-path.ts) in the
  repository's own separator style.
- **Ctrl+S saves the document you are editing.** In a terminal, Ctrl+S still
  goes to the terminal.
- **Plain confirm dialogs.** Confirmations show two ordinary buttons.
- **Hints name your keys.** The [search bar](src/terminal/search-bar.ts)'s
  Previous and Next match tooltips read Shift+Enter and Enter, in place of the
  Mac symbols.
- **Fonts.** The terminal and the editor fall back to Cascadia Mono or Consolas,
  and the font picker offers them when they are installed. Interface text
  keeps a clear hierarchy on Segoe UI, drawn in regular, semibold and bold.
- **Unavailable settings say so.** In
  [Settings](src/ui/settings/launch-profile-editor.tsx), the Claude Signals
  switch and the
  [Open with](src/ui/settings/sections/links-editor-section.tsx) row are dimmed
  with a "Not available on Windows" tooltip, because Deck cannot do those on
  Windows yet.

## 2.2.0

This update turns terminal tabs into spaces with a Mission Control overview,
starts Deck from a folder-then-Run screen, and stops reopening yesterday's
session on its own.

### Spaces and Mission Control

- **Terminal tabs are now spaces.** The strip shows the current space's folder
  and one mark per space, ahead of your document and browser tabs. A mark
  turns yellow when an agent asks for you and red when one fails; hover it to
  see the space's folder, path, branch and agents. Right-click a mark to close
  it. ⌘1–9 and ⌘⇧[ / ⌘⇧] count the spaces first, then the documents.
- **Switching spaces slides**, by mark, shortcut or a horizontal two-finger
  swipe on the terminal.
- **Space marks stay quiet while you move the pointer.** The hover card opens
  after a short pause instead of instantly, and shows the space's folder,
  branch and agents without the miniature or path. Keyboard focus still opens it
  at once.
- **Mission Control replaces the Agent Board.** ⌘⇧O (Ctrl+Shift+O), View ▸
  Mission Control or the toolbar's **Overview** button zooms your panes out
  into a view of every space. Hover a space to preview its panes, click a pane
  to jump straight to it, or press Esc to go back where you were.
- If you had rebound or unbound the Agent Board's shortcut, that setting is
  dropped: ⌘⇧O now opens Mission Control.
- **Name a space.** Double-click the current space's folder name on the
  [strip](src/ui/spaces/space-bar.tsx), or a space's label in
  [Mission Control](src/ui/mission-control/mission-control.tsx), and type a
  name. Enter or clicking away saves, Esc cancels, and an empty name goes back
  to the folder. In the [sidebar](src/ui/worktree-card.tsx), a named space's
  agents show the name over what each one is doing, and double-clicking one of
  those rows renames it too.
- **Split or New space from Quick Launch.** When the folder already has a space
  open, each [agent card](src/launcher/agent-launch-cards.tsx) offers **Split**,
  which adds the agent beside your current panes as before, and **New space**,
  which opens it in a space of its own. Enter still splits.

### Start screen

- **Choose a folder, then press Run.** The
  [start screen](src/open-board/board-composer.tsx) opens a
  [folder menu](src/open-board/workspace-picker.tsx) with **Open folder…** and
  your recent workspaces, then shows each agent as a card with its own **Run**
  button. Choosing a folder never starts an agent; only Run does.
- **Drop a folder from Finder or Explorer** onto the start screen to use it as
  the workspace. Files, several items at once, or a missing folder are refused
  with a message.
- Create workspace, Create worktree, Resume a session and Manage agents now
  live under **More…**.

### Sessions

- **Deck no longer reopens yesterday's session on its own.** At launch the
  [board](src/open-board/board-composer.tsx) shows a **Last session** line with
  the tab count and workspaces. **Reopen** brings the tabs and agent
  conversations back; dismiss it, or open anything else, and Deck starts clean.
  The *Restore sessions on launch* setting is gone.

### Sidebar

- **A project header counts its running agents.** A live project in the
  [sidebar](src/ui/agent-rail.tsx) shows how many agents are still running in
  it, open or folded, so a folded project still tells you what is going on.
  Plain shell tabs are not counted, and the count is hidden at zero.

### Usage

- **Usage shows the overview only.** The Daily and Breakdown tabs are gone, and
  the [Usage panel](src/ui/usage/usage-body.tsx) opens straight onto the overview.

## 2.1.0

This update tiles quick-launched agents evenly, gives plain folders a sidebar
card, and fixes agents that stopped drawing in narrow panes.

### Sidebar

- **Plain folders get a card like a repository.** A workspace that is not a git
  repository now shows the same [sidebar card](src/ui/worktree-card.tsx) as a
  repository checkout, labelled `Folder`, instead of loose agent rows. A folder
  opened inside a larger repository shows its own name, not the repository's.

- Removed the `Needs me` count button above the
  [sidebar project list](src/ui/agent-rail.tsx). Each agent still shows its own
  status, and the Agent Board's Needs me filter is unchanged.

- **Claude Code limits show in every copy of Deck.** The
  [limit collector](electron/agent-limits/claude-reader.ts) is now shared, so a
  second Deck install no longer shows a dash while another one owns Claude's
  status line. Your own status line command is still preserved.

### Agents

- **Quick Launch tiles instead of stacking columns.** A launched agent now splits the
  [roomiest pane](src/lib/pane-tiling.ts) of the tab along its longer side, so the second,
  third and fourth agent fill the tab evenly instead of halving one pane into ever
  narrower strips. A divider you dragged yourself still decides where the next pane lands.

- **Agents keep drawing in narrow panes.** A terminal never shrinks below 24
  columns; a narrower pane [clips its right edge](src/terminal/pane.ts)
  instead. OpenCode stopped drawing for good once its pane reached 20 columns
  or fewer, even after the pane grew back.

- **Trackpad scrolling in terminals no longer stutters.** Terminal scrolling
  is now instant, instead of switching between animated and instant scrolling
  in the middle of a gesture.

## 2.0.0

### Feedback

- The [feedback page](marketing/landing-prototype/src/feedback.js) supports Google sign-in,
  durable private submissions, owner-approved public descriptions, older feedback pages,
  and approval/progress email updates. Sending remains closed until service configuration
  and rollout verification are complete.

### Usage

- **See remaining allowance before historical cost.** The redesigned
  [Usage overview](src/ui/usage/sections/overview-section.tsx) shows visible reset
  times, a cost timeline for Today / 7 days / 30 days / All, and accessible chart
  and pricing details. API-equivalent estimates distinguish missing history,
  measured zero and unpriced tokens.

### Sidebar

- **Workspace favicons in the sidebar.** [Project headers](src/ui/agent-rail.tsx)
  show the workspace favicon when available, falling back to the folder icon
  when the image is missing or cannot be displayed.

- **Deck identity in the sidebar.** The [top row](src/ui/sidebar-toggle.tsx) now pairs
  the collapse control on the left with the Deck logo, name and running version
  on the right, separated from navigation by a border. The bordered `New Workspace`
  button sits below it, above
  the [scrolling project list](src/ui/agent-rail.tsx).

- **Agent usage replaces Unread.** The [compact sidebar summary](src/ui/usage/agent-usage-summary.tsx)
  shows agent logos and remaining allowance, with reset times on hover.
  Electron reads Codex limits through its CLI and Claude Code limits through a
  status-line collector that preserves your existing status line on macOS/Linux.
  Missing or expired readings show a dash.

### Agents

- **Removed yellow lines above terminal panes.** The [pane overlays](src/styles/06-stage-panes.css)
  no longer animate while agents work or when selecting an agent from the sidebar.
  Agent status indicators and pane navigation keep their existing behavior.

- **Agent context above each terminal pane.** The
  [compact header](src/terminal/pane-agent-header.tsx) shows the agent logo and
  the same latest message as the sidebar. Claude Code panes offer an Effort
  button that opens the CLI's native model/effort picker. Use Left/Right to
  choose effort and S to apply it to this session only; other agents have no
  effort button.

- Fresh Codex panes no longer show busy bars while their startup screen is painting
  before the first input, through the [input guard](src/terminal/agent-attention.ts).

- **Fresh Codex panes keep their own conversation.** The rail
  [requires an exact session identity](src/terminal/session-tail-store.ts), so a new pane
  stays blank until its own conversation is available, even when another Codex is active
  in the same folder.

- **Launch agents side by side.** The compact [agent launch page](src/launcher/agent-launch-page.tsx)
  opens from checkout New agent controls or Cmd/Ctrl+T. Run adds a pane beside the target;
  Back and Escape return without creating a terminal. Right-click actions keep their
  existing new-tab and shell behavior.

- **Signals are off again after upgrading from 1.1.** Deck 1.1 saved every
  agent's reporting switch as on, and 1.2.0 took that as your choice, so it kept
  adding its hooks to your Claude and Codex settings. This update
  [switches reporting off once](src/settings/signal-adapter-choice.ts) and
  removes those hooks at launch. If you turned Signals on yourself in 1.2.0,
  turn it on again under Settings → Agents.
- **Codex no longer asks you to review your own hooks again.** Deck's Codex
  hooks [stay where they are](electron/agent-hooks/codex-hooks.ts) when Deck
  starts, instead of moving behind hooks you added later.
- **Codex rows stop showing the busy bars while Codex is idle.** Codex 0.154
  animates its prompt background, which Deck read as work in progress. Deck now
  [launches Codex with its idle animations off](src/lib/agents/codex.ts); if you
  wrote your own Codex command, add `-c tui.animations=false` or use the new
  "No idle animations" switch under Settings → Agents.

### Updates

- **Update failures are easier to recover from.** Two consecutive failed checks
  show [Update check failed · Retry](src/updater/update-action.tsx). Failed downloads
  and installs point to Release Notes for a manual download.
- **A stalled installer no longer leaves Deck showing Installing indefinitely.**
  [Late staging errors and a fallback timeout](electron/updater/updater.ts) surface
  the failure. After handover, quit and reopen Deck before trying again.
- **Updater diagnostics stay on your machine.** A small, rotated
  [updater.log](electron/updater/error-log.ts) records errors locally without adding
  telemetry fields.

### Privacy

- **Usage stats now count Deck's own update checks.** The daily snapshot adds how
  many update checks and downloads ran or failed and how many installs Deck
  started — counts only, with no error text or version numbers — so a broken
  update feed no longer goes unseen.
  Settings → Privacy and the [privacy notice](https://deck.spacevibe.dev/privacy)
  list the new field.

### Agent Board

- **See only the agents waiting on you.** A bar above the
  [Agent Board](src/ui/agent-board-bar.tsx) switches between All and Needs me:
  agents asking a question, finished runs you have not read, and failures. You
  can also group the cards by project, or switch to a one-line list when many
  agents are running.

## 1.2.0

This update opens shells and quick agents from each checkout, tidies agent
settings, and keeps agent cards steady while their state changes.

### Highlights

- **Open a shell from the checkout menu.** Open shell starts a new terminal tab in
  Deck at that checkout. Choose up to five quick agents in Settings → Agents;
  the menu no longer opens an external terminal app.

- **Deck types the command you chose, and nothing else.** Agent reporting is now
  off out of the box for every agent, so a pane opens with exactly the command
  in your launch profile — no hook settings file, session id, notification
  option or reporting port added to the line. The rail falls back to reading
  status from the terminal and labels it as inferred. Turn reporting back on per
  agent under Settings → Agents; anyone who already set that switch keeps their
  choice.

- **Claude Signals also covers manual launches in Deck.** Enabling Signals registers
  Deck's guarded hooks in your Claude settings; turning it off removes those hooks.
  Claude launch commands no longer receive extra settings or session-ID flags.

- **Clearer agent settings.** Agents start collapsed with their command and availability
  visible. Expanded settings put Command and its reset arrow first, followed by Launch,
  Model and Integrations. Short choices stay visible as segments; agents not yet installed
  offer optional launch configuration.

### Agent Board

- **Cards stay where they are.** Cards keep the order of their numbers instead of
  jumping whenever an agent changes state, so the card you are about to press no
  longer moves away. The state still shows on each card.

- **Codex cards stop loading when a response finishes.** With Codex Signals enabled,
  lifecycle hooks keep terminal repaints from marking a completed turn as working.
  Resumed sessions also stay idle while restoring history, until a new prompt starts.
  Existing hooks and notifications are preserved; reopen the shell and Codex session
  after updating to load the integration.

- **Simpler cards.** Each card shows its repo name at full ink, its checkout in a
  pill badge, and a pending ring while the agent works.

### Rail and panes

- **Linked worktrees stand apart.** A linked worktree's card has a dashed frame, and
  its Worktree badge carries a fork glyph.

- **Recent activity stays in view.** Only the project list scrolls; recent activity
  stays pinned above the footer.

- **Tidier project headers.** Project names are larger, and checkout dots line up
  beneath them.

- **Clearer pane splits.** Splits are drawn at 2px on a heavier seam, so a grid of
  panes no longer reads as one sheet.

- **Less graphics memory.** Only the tab on screen holds a GPU renderer; hidden tabs
  release theirs and pick it back up when shown.

### Removed

- **Cursor CLI is no longer built in.** Deck no longer detects or lists
  `cursor-agent`. To keep using it, add `cursor-agent --force` as a custom agent in
  Settings → Agents. A restored Cursor pane reopens as a plain shell.

## 1.1.1

This update fixes a freeze that could lock Deck right after it opened.

- **No more freeze on restore.** With several agents spread across more than one
  checkout, Deck could stop responding a few seconds after launch and had to be
  force-quit. The rail now settles on its first layout pass.

- **Clearer project breaks in the rail.** More space between projects, and each
  header sits closer to the card it names.

## 1.1.0

This update brings Agent Board, makes starting new work more deliberate,
and improves terminal startup on Windows.

### Highlights

- **Agent Board (⌘⇧O).** See your agents together in one overview. Select a
  card to jump to its terminal tab; the Board also has its own `Agents` tab.

- **Arrange and pin tabs.** Drag terminal, file, browser and Agents tabs into
  place; right-click to pin, unpin, close others or close tabs to the right.
  Pinned tabs keep their icon and name and are skipped by bulk closes.
  Preferences last for the current window session.

- **Focus worktrees from their cards.** Click a card's heading or empty space to
  focus its session; the heading also expands or collapses its agents. A persistent
  chevron shows that state, and the heading highlights on hover or keyboard focus.

- **Agent row messages and compact controls.**
  Agent rows show their latest message
  once available; names you set yourself take precedence.
  State and close share the row's trailing slot:
  hover or keyboard focus reveals close without shifting the message or model.

- **Return to Agent Board.** When session restore is enabled, quitting while viewing Agent
  Board now brings the Board back on screen at the next launch. Switching away before quitting
  keeps only its `Agents` tab open.

- **Return to unread conversations.** Recent activity now filters its latest
  sessions to unread questions, warnings and results from confirmed live sessions.
  Opening one focuses its pane and acknowledges it; View all keeps the complete
  history available. When a live session cannot be confirmed, selecting it resumes
  that conversation instead of focusing a pane guessed from transcript activity.
  Opening shows a loading ring and blocks repeated clicks; unopened sessions no longer carry
  a gray status dot. Time sits before the trailing state indicator.

- **More reliable worktree creation.** Checkouts have up to a minute to finish,
  failures explain invalid branches, access problems and disk space, and an
  interrupted checkout is inspected before suggesting another attempt. Deck
  preserves any branch or worktree left behind.

- **A color for each worktree.** Right-click it and choose **Worktree color**
  to color its dot, selected frame and badge. Choices survive reopening Deck;
  **Default** restores the original treatment.

- **Choose before launching.** Selecting a recent workspace on the Open Board
  fills the visible workspace and agent choices without starting a process.
  Review the selected agent, then open it.
- **Keep the window after the last tab.** Closing the last terminal tab returns
  to the Open Board instead of closing the window.
- ⚡ **Faster Windows terminal startup.** Deck no longer starts a PowerShell/WMI
  process census in front of a new shell, split or docked pane. Background
  inspection stays paused through shell startup and resumes on its normal
  interval after the prompt is ready.
- 📝 **Markdown opens rendered.** Markdown files now open as formatted
  documents; ⌘⇧V switches between the rendered view and source.
- 🎯 **A clearer agent rail.** The rail keeps each row paired with its own
  session, groups each checkout into a card without losing shell tabs, marks
  the pane holding the keyboard, and lets you reorder or close project groups.
- ➕ **One `+` per checkout, and it always asks which agent.** Every checkout
  card carries exactly one create control — the `+` on its strip, or its
  `New agent` row when the card is open — and pressing it lists the agents you
  can run there instead of silently opening a shell. The project header's `+`
  and the tab strip's `+` are gone; `⌘T` (`Ctrl+Shift+T`) opens the same list
  for the checkout you are working in, names that checkout at the top, and
  ends with `Open another project…`. A plain shell is `New split here`.
- 🧹 **The sidebar banner is gone.** The decorative artwork at the foot of the
  sidebar and its Appearance setting have been removed. The sidebar's action
  footer now closes the column, and any banner image you had chosen is no
  longer read.
- 📁 **The file explorer names its folder, and that row acts.** The tree now
  shows the folder it is rooted at as its first row, carrying New File, New
  Folder, Refresh and Collapse All. A new file or folder is created in the
  focused directory, falling back to the workspace root.
- 📊 **Usage analytics are always on, with no opt-out.** Deck reports limited
  daily usage counts — never code, paths, prompts or agent output.
  Settings → Privacy states exactly what is sent.
- 🔍 **The rail asks the agents instead of guessing, and says when it guessed.**
  A Claude pane's session and its "waiting for permission" now come from
  Claude's own session list and from hooks Deck installs for that pane alone
  (never in your `~/.claude`); an opencode pane reports busy, idle, errors and
  permission prompts from its own server; Codex rings its notification whether
  or not the pane is focused. Labels distinguish inferred status from signals
  reported by an agent. An agent whose process ended shows a small square
  instead of reading as a finished run, and Cursor panes count as agents. Each
  adapter can be switched off per agent under Settings → Agents.
- **Agent integration is set up at launch.** Deck adds per-pane hook settings
  and a session id to eligible new Claude launches, and configures a local
  reporting port for opencode. Your saved commands stay unchanged; settings
  supplied in your command are respected.
- **Clearer agent status and loading.** Working agents show three staggered
  loading bars, with a still version when reduced motion is enabled. Status
  dots on worktree cards use solid yellow or gray; inferred
  status is still named in tooltips and accessible labels. Ended agents keep
  their distinct square mark.
- **Quieter single-agent hover.** Only groups of two or more agents open a
  popover on hover or keyboard focus. A single agent stays a direct focus
  button; overflow menus still expose hidden agents.

### Upgrading

- **1.1.0 is the first release that sends usage analytics.** Analytics are
  always on, with no opt-out, starting on the first launch after upgrading.
  No code, paths, prompts or agent output are sent. Settings → Privacy states
  exactly what is sent; 1.0.0 and the older Tauri releases send no analytics.
- **Coming from a Tauri release?** Its update check fails and the published
  build has no migration notice. Download the Electron installer from
  [the releases page](https://github.com/mxrsv/spacevibe-deck/releases/latest)
  and install it manually. Settings and workspaces do not migrate. Old Tauri
  data remains in `~/Library/Application Support/dev.spacevibe.deck` on macOS
  or `%APPDATA%\dev.spacevibe.deck` on Windows, separate from Electron's
  `SpaceVibe Deck` data folder.
- The Windows installer remains unsigned. Windows installation and auto-update
  have not been runtime-verified for this release.
- Intel Macs are not served by this build (Apple Silicon only).

## 1.0.0

**SpaceVibe Deck 1.0 is here.** The terminal built for running many AI agents
at once — now stable, self-updating, on macOS (Apple Silicon) and Windows
(x64).

One window, every agent. Claude Code, Codex, Gemini, opencode, cursor-agent or
any CLI you throw at it — each in its own pane, each in its own worktree, all
visible at a glance.

### Highlights

- 🧠 **See your agents think.** The agent rail shows every pane's live state —
  working, asking, failed — and for Claude Code, Codex and opencode, the
  agent's own latest words. You always know who needs you next.
- ⚡ **An agent in one keystroke.** ⌘T opens the quick picker: pick an agent,
  pick a worktree, it's running. Split panes, drag an agent onto any pane to
  dock it, jump anywhere by number.
- 🔁 **Close Deck, not your conversations.** Relaunching reopens your tabs and
  resumes your agents' sessions — exact for Claude Code, Codex and opencode,
  best-effort for the rest.
- 📁 **The whole project on one stage.** File explorer with a real editor, a
  browser tab beside your terminals, and ⌘+click on any path an agent prints
  jumps straight to that file and line.
- 📊 **Know what you burn.** The token-usage dashboard reads your agents' own
  local session logs. No accounts, no telemetry — nothing ever leaves your
  machine.
- 🌗 **Light and Dark, one switch.** On dark, the terminal is the deepest
  surface in the window — your work sits below the chrome, where it belongs.
- 🚀 **It keeps itself current.** Auto-update ships with 1.0: Deck tells you
  when a release is out, and you choose when to download, install and
  relaunch.

### Upgrading

- Windows preview installs (`Deck Electron`) are a separate app: this release
  installs as `SpaceVibe Deck` alongside it with fresh settings. Uninstall the
  preview manually after moving over.
- Tauri-era installs of SpaceVibe Deck do not migrate settings or workspaces;
  this is a clean install by design.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention.
Only `## <version>` sections are published as release notes, so this one never
reaches a user.)_

Empty: each version section above is frozen at its tag and describes what that
release shipped.
