# Agent Inbox Redesign Mockup — Design

Date: 2026-09-02 · Status: approved by owner 2026-09-02

## 1. Context

**Origin:**

- The owner said Deck still feels too similar to Orca and should develop a more
  distinct interface while keeping the feature set minimal.
- The owner defined the product in one sentence as an easy-to-use UI for
  running many agents.
- The owner confirmed that Deck is for people already comfortable with agent
  CLIs and terminals; Deck coordinates those tools rather than hiding or
  teaching them.
- The owner selected `Agent Inbox` as the structural direction and a separate,
  self-contained HTML mockup as the review surface.

**Problem:**

Deck's current shell presents live-agent coordination beside a mixed strip of
terminal tabs, documents, and the browser, plus secondary tools and docked
surfaces. That makes the primary job less obvious and leaves the product
reading as a general agent workbench close to Orca's category grammar. A direct
production reshape would mix information architecture, visual treatment, and
load-bearing terminal behavior before the owner can judge the direction by
eye.

**Decisions:**

- The first deliverable is mockup-only. It changes no production renderer,
  host, PTY, tab, pane, browser, editor, or restore behavior.
- The product hierarchy is `project -> worktree -> agent` in a persistent
  Agent Inbox beside the terminal stage.
- The Agent Inbox is the primary navigation surface for live agents. It is not
  a file tree, task manager, or automation surface.
- The stage keeps Deck's split-terminal capability. Selecting an agent focuses
  that agent's exact pane; it does not hide sibling panes in the same tab.
- Browser and editor surfaces are absent from the mockup's primary navigation.
  Their eventual production access and retirement policy are outside this
  mockup decision.
- The direction changes composition and visual hierarchy, not Deck's brand or
  terminal-theme system.
- The mockup lives at
  `docs/mockups/2026-09-02-agent-inbox.html`, separate from the existing
  component Gallery.
- The approved
  [Agent Workbench Gallery design](2026-08-12-agent-workbench-gallery-design.md)
  remains the historical record of the earlier three-region exploration. It is
  not the blueprint for this mockup.

## 2. Canonical data

**Canonical:**

- [`TabManager`](../../src/terminal/tab-manager.ts) and
  [`tabs-store`](../../src/terminal/tabs-store.ts) own tab identity, pane
  identity, the active tab, pane focus, and the split-terminal grid.
- [`agent-rail-model`](../../src/ui/agent-rail-model.ts) owns the projection
  from open tabs and repository metadata into project, worktree, tab, and agent
  rows.
- [`repository-model`](../../src/repositories/repository-model.ts) owns project
  and worktree attachment.
- [`session-tail-store`](../../src/terminal/session-tail-store.ts) owns the
  newest known agent response and model pairing by `paneId`.
- [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) owns Deck's semantic tokens,
  typography, attention colors, density rules, and terminal-first hierarchy.

**Not canonical:**

- Mockup project names, paths, agent prompts, terminal output, timestamps,
  statuses, and model names.
- The mockup's in-memory selection state or simulated terminal panes.
- Orca's proportions, labels, icons, card geometry, features, or palette.
- The existing Gallery's parked comparison candidates.
- A new mockup-only `AgentStore` or second copy of production rail rules.

## 3. Solution architecture

**Components:**

- **Mockup frame:** A self-contained HTML decision surface with no production
  imports, host stub, persistence, network access, or build entry.
- **Direction switcher:** Three materially different visual treatments of the
  same Agent Inbox structure. The fixture and interaction behavior stay
  identical so the owner compares treatment rather than content.
- **Viewport switcher:** Wide and compact desktop frames on the same page.
  Compact mode removes secondary metadata before it weakens attention or
  terminal legibility.
- **Agent Inbox:** A persistent left rail grouped by project, then worktree,
  then agent. It uses sections and hairlines rather than nested rounded cards.
- **Agent row:** A row with agent identity, meaningful status, recent response,
  and a clear selected state. Selecting it updates both the rail selection and
  the corresponding focused terminal pane.
- **Stage context:** One restrained header naming the selected context and
  exposing only new-agent and overflow actions. It replaces the mixed surface
  strip in the mockup.
- **Terminal stage:** A dominant terminal grid with one visibly focused pane
  and any sibling panes still present.

**Visual direction:**

- The signature composition is an agent inbox beside a deep terminal stage,
  not a three-column workbench.
- Project and worktree labels provide hierarchy; agent rows carry activity and
  attention. Repeated card shells do not restate that hierarchy.
- Chrome remains neutral and theme-derived. Semantic color is reserved for
  attention, failure, keyboard focus, and active terminal ownership.
- The stage remains the deepest plane. The rail rises from it through existing
  Deck surface relationships rather than a new fixed palette.
- The mockup uses English UI copy, the production UI's sans-serif/monospace
  roles, and no decorative animation loop.

**Data flow:**

1. The fixture defines two projects, their worktrees, eight agents, and a
   terminal layout containing both single-pane and split-pane tabs.
2. A treatment switch changes CSS presentation only; fixture identity,
   ordering, and status do not change.
3. Selecting an agent resolves its tab and pane, marks that row selected,
   activates the matching terminal layout, and focuses the exact pane.
4. A viewport switch changes the review frame without replacing the fixture or
   silently changing hierarchy.

## 4. Failure modes

- If the selected rail row and focused terminal pane disagree, the mockup
  fails; both must update from the same agent identity.
- If an agent has no recent response, the row must retain truthful identity and
  status instead of inventing fallback conversation text.
- If a workspace is not a Git repository, it must remain a normal project and
  must not display fabricated branch or worktree metadata.
- If compact width is short on space, optional model, age, and response detail
  collapse before attention state, agent identity, or terminal content.
- If a tab contains multiple panes, selecting one pane must not remove or
  reflow its siblings.
- If a treatment needs Orca-specific proportions, labels, icon order, cards,
  or features to read clearly, that treatment fails the distinct-identity
  goal.
- If the mockup imports production modules or creates another Vite entry, it
  fails the isolated decision-surface boundary.
- If the mockup implies that browser or editor code has been deleted, it fails
  the agreed scope; only their absence from primary navigation is decided.
- If a wide or compact frame clips content, overlays the terminal, or requires
  horizontal page scrolling, that treatment fails.

## 5. Done and excluded

**Done:**

- `docs/mockups/2026-09-02-agent-inbox.html` opens directly in a browser with
  no server and no network access.
- One page presents three Agent Inbox treatments using the same two-project,
  eight-agent fixture at wide and compact desktop widths.
- The fixture includes working, needs-attention, failed, completed, and quiet
  agents plus at least one split-terminal tab.
- Agent selection visibly synchronizes the selected rail row, active tab, and
  focused terminal pane.
- Browser and editor are absent from the primary navigation in every
  treatment.
- The page has no horizontal overflow, honors reduced motion, and keeps basic
  controls keyboard reachable with visible focus.
- The owner receives rendered evidence and selects or rejects a treatment by
  eye before any production redesign begins.
- The mockup links back to this spec so the new artifact is not orphaned.

**Not done:**

- Any production change under `src/`, `electron/`, or `src-tauri/`.
- Removing or deprecating browser, editor, usage, session history, file
  explorer, or mixed-surface implementation code.
- Changing PTY ownership, tab or pane data models, attention tracking, session
  tails, session restore, worktree discovery, or launch behavior.
- Adding a task manager, automation system, file explorer, remote runtime,
  account system, or Orca feature equivalent.
- Redesigning Tauri; new product work remains Electron-directed.
- Replacing Deck's theme system, brand, icon system, or terminal typography.
- Treating a browser mockup or passing build as native Electron acceptance.

## 6. Open questions

- None for the mockup phase. Production access to hidden secondary surfaces,
  exact dimensions, and the winning treatment are deliberately decided after
  owner eye review rather than guessed in this document.
