# Deck product improvements and priorities

Date: 2026-10-06
Status: Draft — recommended priorities, not implementation approval.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main`, `72b525e5de6b2eaab2df27184d1fd60864c1ee94`, plus shared uncommitted changes.
Host: Electron; shared renderer changes must preserve the frozen Tauri fallback.

## Purpose and authorization

Organize the product proposals from the Claude macOS survey into one prioritized
specification. Reduce friction in managing many agent CLIs before expanding Deck's
execution responsibilities. The owner requested this document; the ordering and
feature decisions below remain recommendations for review.

This specification owns the cross-surface priority order and proposed product
outcomes. It does not authorize implementation, a broad code refactor, launching
agents, changing user settings, or installing integrations. Existing approved
decisions remain valid; proposed alternatives require a new explicit decision.

The earlier survey produced feature and UX proposals, not a detailed refactoring
audit. Interface simplification candidates below are hypotheses to validate in a
prototype. No module deletion or replacement has been justified by that survey.

## Product constraints

- Keep the terminal stage central and support multiple CLI providers. Claude is
  an interaction reference, not a replacement product model for Deck.
- Reuse existing state, actions, session identity, templates and host facades.
  Do not create a parallel agent or task registry merely to rearrange the UI.
- Separate interface restructuring, existing-capability improvements and new
  execution capabilities. A visual change does not implicitly approve the latter.
- Preserve terminal content, exact pane focus, attention acknowledgements,
  launch commands, session restoration and close/quit safeguards.
- Unknown usage, provider capability or session identity stays unknown. Do not
  infer zero usage, full allowance, exact resume support or permission to act.
- Native notifications already exist. Improve their relationship to navigation
  if needed rather than proposing a second notification system.
- Do not automatically approve terminal prompts, delete worktrees, stage, commit,
  push, merge or create PRs from an inferred agent completion state.
- Keep analytics disclosure and the existing host/security boundaries.
- Frontend direction requires an agreed idea, approach and interactive demo
  surface. Visual acceptance and changes to executable design rules remain
  subject to [repository policy](../../AGENTS.md).

## Evidence and confidence

The 2026-10-06 Computer Use survey observed Claude's search palette, sidebar
filters, new-session controls, Customize, Routines/templates, Projects, Artifacts,
Settings, macOS integration, session menus and Changes view. These are observed
interfaces; their underlying execution was not exercised.

Three read-only Deck analyses and one architectural challenge inspected the
current checkout. Deck was not run for this discovery, so usability benefits,
effort and performance improvements are not measured findings. Source references
below identify existing capabilities, not proof that a proposed workflow works.

External references: [Claude Desktop](https://code.claude.com/docs/en/desktop) and
[scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks).

## Recommended priority order

The numeric rank is the recommended order for product evaluation. Tiers describe
value and scope, not a promise that every item must ship or a coding schedule.
Items sharing a tier may be evaluated together; unrelated implementations need
not wait for every earlier item.

| Rank | Tier | Candidate | Change type | Why this position |
| --- | --- | --- | --- | --- |
| 1 | P1: simplify core work | Clarify rail, Spaces and tool navigation | Interface restructuring | Establish which surface owns each user action before adding more entry points |
| 2 | P1 | Needs attention view | Improve existing capability | Help users identify the next agent requiring their involvement |
| 3 | P1 | Clear launch context and placement | Improve existing flow; prompt delivery is a separate extension | Reduce wrong-checkout and wrong-placement launches |
| 4 | P1 | Find and resume sessions consistently | Improve existing capability | Make returning to work predictable and preserve exact identity |
| 5 | P1 | Complete the existing Settings redesign | Existing prototype and capability improvements | Reuse ongoing work instead of introducing another Settings direction |
| 6 | P2: improve discovery | Unified metadata and action search | New surface over existing data/actions | Accelerate navigation once terminology and destinations are clear |
| 7 | P2 | Discover prompts, skills and subagents | Improve existing capability | Make reusable resources easier to find without a marketplace |
| 8 | P2 | Contextual Usage, Sessions and files | Improve existing surfaces | Preserve the selected workspace/agent context across tools |
| 9 | P3: inspect results | Read-only Changes view | New host-backed capability | Let users assess agent output before adding Git actions |
| 10 | P3 | Work recipes launched on demand | Template improvement; multi-step execution is new | Validate repeatable-work demand before building a scheduler |
| 11 | P4: optional expansion | macOS quick access and keep-awake controls | New native capability candidates | Useful convenience, with less direct core-workflow value |
| 12 | P4 | Scheduled routines and run history | New execution capability | Highest execution/lifecycle scope; first validate recipes and user demand |

## Candidate requirements and acceptance criteria

All criteria are proposed product acceptance criteria for a selected delivery
slice. They are not evidence of completion or approved technical approaches.

### 1. Clarify navigation

Compare three treatments: attention-first sidebar, project/worktree-first
navigation, and a smaller shell with tools revealed when needed. Give rail,
Spaces and global tools distinct responsibilities. Consider separating terminal
actions from global tools currently grouped in More.

- **NAV1:** A user can identify the active project, checkout, space and agent and
  reach another agent through one understandable primary navigation path.
- **NAV2:** Simplification preserves access to existing tools, keyboard actions
  and the exact selected pane; redundant entry points are documented before removal.
- **NAV3:** Prototype review covers sparse and dense agent lists, narrow windows,
  keyboard navigation, focus and reduced motion. The owner chooses a treatment.
- Mission Control's hidden toolbar entry and the retired Agent Board are existing
  product decisions, not permission to restore either automatically.

References: [toolbar](../../src/ui/toolbar/deck-toolbar.tsx),
[Spaces](../../src/ui/spaces/space-bar.tsx),
[approved space refinements](../plans/2026-10-03-space-workflow-refinements.md).

The owner chose treatment D (B's tree, C's breadcrumb, attention as a popover) on
2026-10-06; its requirements live in [Navigation rail refresh](2026-10-06-navigation-rail-refresh.md).

### 2. Needs attention

Expose a short filtered view of existing attention information: input requested,
errors/warnings and completion. Show reasons and source confidence where useful.

- **ATT1:** Selecting an entry focuses its exact live pane without acknowledging
  a different pane; stale or unavailable targets are handled explicitly.
- **ATT2:** Observed states remain distinguishable from inferred or stale states.
  Running, idle and unknown are not silently treated as actionable failures.
- **ATT3:** The view reuses attention state and existing notification policy.
  Approve/deny controls and sending replies from this view are outside this slice.

References: [attention](../../src/terminal/agent-attention.ts),
[notification policy](../../src/terminal/agent-notifier.ts).

### 3. Clear launch context and placement

Make the destination and agent command understandable before launch. Preserve
approved Split/New space behavior. Evaluate prompt-at-launch separately from
the interface cleanup; do not enable disabled prompt delivery flags by default.

- **LAUNCH1:** Workspace/checkout, agent and placement are visible or immediately
  discoverable before Run; advanced choices do not obscure the ordinary path.
- **LAUNCH2:** Missing agents and failed launches show clear feedback; creating a
  worktree and launching an agent remain distinguishable actions.
- **LAUNCH3:** Any future prompt delivery defines supported providers and readiness
  behavior. Unknown support never becomes blind keystroke injection or silent loss.

References: [launcher](../../src/launcher/agent-launch-page.tsx),
[disabled prompt delivery](../../src/terminal/task-prompt-send.ts),
[launcher proposal](../plans/2026-09-24-launcher-refresh.md),
[task handoff proposal](../plans/2026-09-24-task-handoff.md).

### 4. Find and resume sessions

Start with search over loaded title, path and session metadata. Selecting a known
live session focuses it; resuming a closed session preserves provider identity.
Full transcript search and additional provider support are separate extensions.

- **SESSION1:** Search states its coverage; loaded-metadata search is not presented
  as a search of all transcripts or all session history.
- **SESSION2:** A session already open is focused instead of duplicated; unavailable
  directories, unsupported resume and errors are visible.
- **SESSION3:** Exact resume and latest-session fallback remain distinct; adding
  providers requires verified identity and capability contracts.

References: [history metadata](../../src/lib/session-history.ts),
[live identity lookup](../../src/ui/sessions/live-session-state.ts),
[resume](../../src/sessions/resume-session.ts).

### 5. Complete Settings redesign

Use the existing Settings prototype and its owning record. Do not create another
category system or independently integrate overlapping Settings changes.

- **SETTINGS1:** Evaluate search, category navigation, basic/advanced choices,
  applied/save/error state and reset scope against the existing prototype.
- **SETTINGS2:** Separate existing controls, newly exposed controls and genuinely
  new capabilities; preserve earlier approvals and identify remaining forks.
- **SETTINGS3:** Owner visual acceptance precedes integration; loading, save errors,
  keyboard access and host availability remain explicit.

Detailed scope stays in [Settings redesign](../plans/2026-10-04-settings-redesign.md)
and [Settings Studio](../plans/2026-10-04-settings-studio.md). The former's handoff
and [gallery registration](../../src/gallery/section-registry.ts) indicate a
prototype exists; its older header/checklist do not establish current acceptance.

### 6. Unified metadata and action search

One entry point finds current agents, workspaces, available session metadata and
existing actions. It routes through established actions rather than a new command system.

- **SEARCH1:** Results identify their type and destination; keyboard navigation,
  empty/error states and unavailable targets are supported.
- **SEARCH2:** Existing shortcuts and launch flows remain accessible. Do not
  silently replace the launcher with a command palette.
- **SEARCH3:** Coverage is explicit; full transcript indexing is excluded initially.

Reference: [action registry](../../src/terminal/action-registry.ts).

### 7. Resource discovery

Improve discovery and preview of prompt templates, skills and subagents. Preserve
available source/provider provenance; do not claim that selecting a resource proves execution.

- **ASSET1:** Users can find and inspect a resource and see which provider/source
  it belongs to where the scanner supplies that information.
- **ASSET2:** Unsupported resource formats and scan failures are visible; prompt
  composition retains provider-specific behavior.
- **ASSET3:** Reuse templates/scanners. Installation, editing external CLI config,
  OAuth and a plugin marketplace are outside this candidate.

References: [Prompt Board](../../src/prompts/prompt-popover.tsx),
[scanner](../../electron/prompt-assets.ts),
[provider phrasing](../../src/prompts/snippet-format.ts).

### 8. Contextual tools

Carry the user's selected workspace/agent context into Usage and Sessions and
make file access understandable without adding another primary navigation rail.

- **CONTEXT1:** Opening a tool from a specific agent/workspace selects matching
  data when supported; fallback to a broader scope is visible.
- **CONTEXT2:** Unknown/stale usage remains explicit and displayed costs retain
  their provenance; estimates are not represented as subscription invoices.
- **CONTEXT3:** Context changes preserve terminal focus semantics and never send input.

References: [shell integration](../../src/ui/app.tsx),
[usage summary](../../src/ui/usage/agent-usage-summary.tsx).

### 9. Read-only Changes

Show checkout-scoped changed files and diffs before considering comments sent
to agents or Git mutations. Reconcile this narrower first slice with the existing proposal.

- **CHANGES1:** The chosen checkout and comparison scope are visible; rename,
  binary, oversized and failed reads have explicit representations.
- **CHANGES2:** Git reads are bounded and errors are visible. Large repositories
  must not trigger unbounded background work.
- **CHANGES3:** No stage/commit/push/merge or implicit prompt submission. Sending
  feedback to an agent requires a separately agreed target and delivery behavior.

Related proposal: [Changes panel](../plans/2026-09-24-changes-panel.md).
Host contracts, refresh policy and visual-rule decisions remain open.

### 10. Work recipes on demand

Start with a reusable prompt plus explicit destination/provider, such as Review
changes or Investigate a bug. Multi-step recipes and agent-to-agent delegation
are separate data-model/execution proposals, not implied by a saved prompt.

- **RECIPE1:** Users inspect the prompt, destination and supported delivery before Run.
- **RECIPE2:** An unsupported provider or failed launch reports the limitation
  without starting an unintended command.
- **RECIPE3:** Recipes do not imply scheduling, verified task completion or
  autonomous orchestration. Reuse templates before adding a new recipe store.

### 11. Native convenience

Evaluate macOS quick access and keep-awake separately. Their value must justify
native lifecycle work; neither changes the core navigation requirement.

- **NATIVE1:** Quick access respects shortcut conflicts and opens an understandable
  destination without launching an agent automatically.
- **NATIVE2:** Keep-awake behavior is explicit and releases its request when the
  selected condition ends; battery/lid behavior is accurately described.
- **NATIVE3:** Electron availability and unsupported-host/platform behavior are clear.

### 12. Scheduled routines

Only select this candidate after validating repeatable recipes and agreeing
which component owns execution. Local and cloud execution are different scopes.

- **ROUTINE1:** Schedule/timezone, target checkout, provider and permission scope
  are explicit; pause and run history are available.
- **ROUTINE2:** App closure, sleep, missed runs, overlapping runs and failures have
  agreed behavior; a local-only routine never promises execution while the app is closed.
- **ROUTINE3:** No timer blindly types into a terminal. Launch isolation, retry,
  credentials and unattended actions require their own approved contracts.

## Deferred adjacent ideas

Full transcript indexing, a separate Artifacts library, cross-provider conversation
forking, multi-account management, agent orchestration, MCP/plugin management and
cloud/SSH hosts remain research candidates. They are not part of the twelve
ranked delivery outcomes and require separate scope decisions before implementation.

## Dependencies and decisions still open

- Choose a navigation treatment and Mission Control's role before selecting NAV1–3.
- Confirm the recommended P1–P4 order or change it based on the owner's main pain point.
- Agree launch prompt delivery and supported providers separately from launch styling.
- Reconcile overlapping launcher, Spaces, Settings and Changes records before delivery;
  this document does not supersede their approved decisions.
- Agree Changes comparison/refresh limits, recipe depth and native convenience scope
  only when those candidates are selected.
- Establish local/cloud ownership, permissions and lifecycle semantics before Routines.

Terminal performance remains a separate scope in
[its specification](2026-10-05-terminal-performance.md) and
[current execution record](../plans/2026-10-05-terminal-performance.md).
Recheck that work before dense-agent UX evaluation; this specification does not
assert a current root cause, benchmark result or authorize an engine change.

## Selection and acceptance boundaries

Choose a small product slice and its criteria before implementation planning.
The next recommended evaluation is navigation plus attention, with launch/resume
as the following flow. Settings continues through its existing prototype review.

Future plans own tasks, code ownership, verification evidence and handoff; this
specification owns requirements and product decisions. Gates and native checks
run when requested under repository policy. No shipped behavior or runtime
acceptance is claimed by saving this document.
