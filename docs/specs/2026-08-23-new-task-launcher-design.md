# New task launcher — Open Board composer and contextual quick launch

Date: 2026-08-23  
Status: `approved behavior and Gallery treatment`; implementation plan pending  
Target: Electron renderer; Tauri remains feature-frozen  
Supersedes: the launch behavior in
[Open Board agent launch](./2026-07-15-open-board-agent-launch-design.md) and the explicit
prompt-composer exclusion in
[Open Board start surface](./2026-08-19-open-board-start-surface-design.md)

## 1. Decision summary

`New` means **start a task**, not create a technical object.

A task is described by five independent values:

1. the first prompt to send to the agent;
2. the workspace folder or worktree in which it runs;
3. the enabled agent CLI that receives it;
4. the model used for this launch;
5. the model's reasoning effort.

Model and reasoning effort remain separate draft values but appear as one compact composite
select, for example `GPT-5.6 Sol · Low`.

Deck presents those inputs through two surfaces with one shared draft and one launch
contract:

- **Open Board** is the full, first-class composer for deliberate task creation;
- **Quick Launch** is a non-modal floating popover for starting another task while the user
  keeps reading or interacting with live agent output.

Neither choosing a workspace nor creating one starts an agent. A session materializes only
after the user explicitly presses `Start task` or `Open agent`.

## 2. Problem

The current product splits one intent across several unrelated flows:

- Open Board recent rows immediately launch a remembered preset/agent combination;
- the Tab Strip `+` and `⌘T` open
  [`AgentQuickPicker`](../../src/ui/agent-quick-picker.tsx), which is a modal agent-first
  flow;
- the project-header `+` opens that same picker with a destination override;
- opening an existing folder and creating a worktree can immediately continue into launch;
- custom agent definitions and launch commands are both managed in Settings but read as
  competing meanings of “add an agent”.

This makes `New` ambiguous, hides defaults, and makes a workspace choice carry the surprising
side effect of starting a process. It also forces users who prefer to write the task first to
open a terminal session before they can state the task.

## 3. Product model

### 3.1 Task

The task field is the agent's **first prompt**, not a task title and not a shell command. Its
surface label is `What do you want the agent to do?`.

When a non-empty prompt is submitted, Deck opens the selected agent session, waits for the
existing launcher-ready seam, and sends the exact prompt once. A successful submission clears
the draft. A failed materialization or send keeps the draft and exposes an actionable error.

### 3.2 Workspace

A workspace is a real directory. Deck does not create a separate workspace entity.

- `Open folder…` selects an existing directory.
- `Create workspace…` creates a new empty directory from a parent directory and name, then
  selects it.
- `Create worktree…` uses the existing Git worktree form and selects the resulting directory.

Creating or selecting any of these returns to the composer. It never launches an agent by
itself.

### 3.3 Agent

An agent is an enabled, runnable CLI identity. Choosing an agent means choosing which CLI will
own the new session; the session itself does not exist until the final launch action.

Declaring a custom CLI is a Settings operation, not inline task creation. The launcher offers
`Manage agents…` as a recovery path, preserves its draft while Settings is open, and selects
the newly added or enabled agent on return.

### 3.4 Launch command

Each agent may keep several saved commands in Settings, with exactly one selected default.
Examples include a normal command, a bypass command, or a plan-mode command.

The launcher never exposes a `Command` field. It uses the selected agent's default command
from Settings as the base, then applies the selected model and reasoning effort for this
launch. Choosing those runtime values does not edit the saved default command.

### 3.5 Model and reasoning effort

Model availability and reasoning-effort values are agent-specific. Changing Agent selects
that agent's default model and effort before launch; unsupported values are never carried
across agents.

The data remains independent so the launch adapter can validate and compose the correct CLI
arguments. The presentation combines both values into one select because they are secondary
runtime context, not separate setup steps. An agent that does not support reasoning effort
lists model-only options rather than inventing an effort value.

## 4. Two surfaces, one contract

### 4.1 Open Board composer

Open Board remains a full stage surface. Its focal artifact is a generous prompt composer,
not a logo or an `Open workspace…` button.

The reading order is:

1. `What do you want the agent to do?` prompt composer;
2. one compact context toolbar: workspace, agent, `model · effort`, secondary action, primary
   action;
3. Recent Workspaces below the composer.

The toolbar shows folder icon + workspace name and agent logo + agent name. It does not print
the redundant labels `Workspace`, `Agent`, `Model`, or `Effort`. The composite runtime select
shows only its current value and disclosure affordance.

The prompt is always visible on Open Board. `Start task` requires a non-empty prompt.
`Open agent first` creates the selected agent session without sending a prompt.

Selecting a recent workspace only fills the `Workspace` field and returns focus to the
composer. It does not launch, and it does not silently overwrite an explicit agent selection.

When Open Board is opened with live work, the Agent Rail remains available as established by
the 2026-08-19 start-surface design. At cold start, Open Board cannot be dismissed into an
empty stage.

### 4.2 Quick Launch popover

Quick Launch is a floating, anchored, **non-modal** panel. It has no scrim, blur, focus trap,
or background interaction lock. It must not use the existing modal shell or modal overlay
rank.

The panel contains the same compact workspace, agent, and `model · effort` toolbar as Open
Board. Its prompt section is collapsible:

- expanded: the primary action is `Start task` and a non-empty prompt is sent after launch;
- collapsed: the primary action is `Open agent` and no prompt is sent.

Deck remembers the prompt-section preference for Quick Launch only. Open Board always keeps
the full composer visible.

Clicking or selecting content in the terminal behind Quick Launch does not dismiss it. It
closes only through `Esc`, its close control, the active trigger being pressed again, or a
successful launch. `Open full composer` transfers the complete draft into Open Board.

### 4.3 Shared draft

Both surfaces edit one window-scoped draft:

```ts
interface NewTaskDraft {
  readonly prompt: string;
  readonly workspacePath: string | null;
  readonly agentId: string | null;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
  readonly promptExpanded: boolean;
}
```

The draft survives:

- switching between Quick Launch and Open Board;
- entering and returning from workspace/worktree subviews;
- opening and closing `Settings → Agents` through `Manage agents…`;
- closing and reopening either launcher surface.

Only `Clear` or a successful launch resets it. State updates replace the draft object rather
than mutating it.

## 5. Entry-point mapping

| Entry point | Surface | Workspace context |
| --- | --- | --- |
| Global `New` | Open Board | active workspace; otherwise most recent workspace |
| Cold start with no live task | Open Board | most recent workspace when still live |
| Tab Strip `Create` / `+` | Quick Launch | active tab's workspace |
| Project-header `+` | Quick Launch | that project's workspace |
| `⌘T` / platform equivalent | Quick Launch | active workspace |
| `Open full composer` | Open Board | preserve the whole Quick Launch draft |

All entry points share labels, validation, selection rules, and launch behavior. Contextual
entry points may prefill Workspace, but the user may change it before launch.

## 6. Workspace field and subviews

The Workspace field presents, in order:

1. the contextual workspace, when one exists;
2. recent live directories;
3. `Open folder…`;
4. `Create workspace…`;
5. `Create worktree…` when the Electron Git capability is available.

`Create workspace…` and `Create worktree…` replace the current launcher body with an in-place
subview and a Back action. Success returns to the previous surface, preserves prompt and
agent, and selects the new directory. Failure stays in the subview with an inline error.

The worktree subview reuses the existing behavior in
[`OpenBoardWorktreeForm`](../../src/open-board/open-board-worktree-form.tsx): repository and
branch remain one Git-owned destination choice. This design changes the post-success action
from “open now” to “select and return”.

Folder creation validates the parent, name, resulting path, and host response. It does not
run `git init`, create starter files, or create a Deck-specific record.

## 7. Agent selection and Settings ownership

The Agent field follows these rules:

- disabled agents are absent;
- enabled and runnable agents are selectable;
- enabled agents whose binary is unavailable appear as `Not installed`, cannot be selected,
  and expose `Manage agents…`;
- the last-used runnable agent for the selected workspace is preferred;
- if that agent is disabled or unavailable, the first enabled runnable agent is selected and
  shown before the user can launch;
- if no enabled runnable agent exists, launch actions are disabled and the recovery action is
  `Manage agents…`.

No selection may change after the user activates the final launch action. In particular,
there is no fallback from a missing agent to another agent during materialization.

`Settings → Agents` owns:

- enabled/disabled state;
- custom agent declarations;
- saved launch commands per agent;
- the single default command per agent;
- the default model and reasoning effort where the agent supports them.

`Add agent` means declare a new CLI identity. `Add command` means save another way to launch an
existing identity. Their grouping and copy must state this difference directly.

## 8. Launch and materialization contract

This launcher creates one new task tab containing one agent session. Layout presets and plain
shell creation are not deleted, but they are separate actions and are not fields in this task
launcher.

The launch sequence is:

1. snapshot and validate the visible draft;
2. resolve the selected workspace and agent without fallback;
3. validate the selected model and reasoning effort against that agent's current capability;
4. resolve the agent's default command from Settings and apply the validated runtime values;
5. materialize a single-pane tab in the selected workspace;
6. wait for the existing agent-launch readiness gate;
7. start the agent with the resolved launch command;
8. when a task prompt exists, send it exactly once after the agent is ready;
9. close the launcher and clear the draft only after successful handoff.

If the tab materializes but starting or prompting the agent fails, Deck keeps the tab visible,
reports which step failed, and retains a recoverable copy of the task prompt. It must not type
the prompt into a plain shell as a fallback.

The implementation should reuse the existing materialization and agent arming seams in
[`TabManager`](../../src/terminal/tab-manager.ts), rather than creating a second process-launch
path.

## 9. Feedback, focus, and keyboard

- Pending state identifies the active operation: opening a folder, creating a directory,
  creating a worktree, opening an agent, or sending the prompt.
- A pending final launch disables competing launch actions but does not erase the draft.
- Errors render beside the field or subview that caused them and use `role="alert"` when user
  action is required.
- `⌘Enter` starts a task when the prompt is visible and valid.
- `Esc` in a subview returns to the parent launcher; the next `Esc` closes the surface when it
  is cancellable.
- Quick Launch does not trap focus. Open Board follows the existing stage-surface focus model.
- Closing a launcher returns focus to its trigger when that trigger still exists.
- Native folder pickers and Settings transitions restore focus to the field that launched
  them.

## 10. Visual direction and mock gate

Signature concept: **the task prompt is the doorway into a live terminal agent**.

The composition stays Deck-native:

- Open Board gives the prompt composer the strongest scale and central position;
- workspace, agent, model, and effort occupy one quiet toolbar attached to the prompt;
- folder/name and logo/name provide identity without redundant field labels;
- model and effort appear as one compact composite select;
- Recent Workspaces form a quieter second rhythm below the composer;
- Quick Launch reads as a raised chrome tool, not a dialog;
- the current semantic color, type, radius, seam, icon, focus, and motion tokens in
  [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) remain authoritative;
- no raw palette, new dependency, scrim, blur, or stock form styling is introduced.

Before production wiring, the Gallery must show:

1. Open Board at cold start with the full composer and recent workspaces;
2. Open Board with live work still present in the Agent Rail;
3. Quick Launch over a readable active-agent terminal;
4. Quick Launch with its prompt collapsed;
5. the workspace creation subview;
6. wide and compact widths for the primary states.

Gallery output is visual evidence only. It does not prove Electron host behavior. The owner
approved the rendered mock and its compact-toolbar treatment on 2026-08-23; native Electron
acceptance remains a separate production gate.

## 11. Architecture boundary

Production implementation should separate:

- a pure draft/validation model;
- a shared launcher controller for workspace, agent, Settings return, and launch state;
- an Open Board presentation;
- a Quick Launch presentation;
- host adapters for folder creation, worktree creation, and materialization.

The two presentations may share field components, but they must not share modal behavior.
Quick Launch is not a variant of [`Modal`](../../src/ui/modal.tsx).

The existing Open Board home/worktree logic is reused where it matches this contract. The
existing `AgentQuickPicker` behavior is superseded only after all contextual entry points use
Quick Launch; it is not deleted during the Gallery mock.

## 12. Priority order

1. **P0 — shared contract:** immutable draft, validation, exact launch handoff, visible errors,
   and no silent fallback;
2. **P0 — Open Board composer:** prompt-first primary flow and recent rows that select rather
   than launch;
3. **P1 — Quick Launch:** contextual non-modal path with shared draft and full-composer handoff;
4. **P1 — workspace subviews:** open/create folder and create worktree return to the launcher;
5. **P1 — Settings Agents clarity:** enabled state, custom identities, saved commands, and one
   default;
6. **P2 — cleanup and hardening:** remove superseded UI paths, keyboard/focus coverage, motion,
   compact layout, and Electron native acceptance.

## 13. Out of scope

- Tauri implementation of the new launcher behavior;
- a Deck-specific workspace database object;
- selecting a non-default launch command inside the launcher;
- creating a custom agent inline;
- assigning different agents or prompts to several panes;
- redesigning layout presets or plain-shell creation;
- changing session restore, Agent Rail ownership, Sessions history, PTY classification, or
  browser architecture;
- treating Gallery screenshots as native Electron acceptance.

## 14. Acceptance criteria

- Global `New` and cold start expose the full Open Board composer.
- Tab/project contextual actions expose Quick Launch without covering or locking live terminal
  content.
- Open Board always shows the prompt; Quick Launch remembers whether its prompt is expanded.
- Selecting or creating a workspace never launches an agent.
- Recent rows fill Workspace rather than opening immediately.
- Agent choices reflect Settings enabled state and use the visible agent's default command.
- Workspace, agent, model, and effort share one compact toolbar without redundant labels.
- Model and effort appear as one composite select while remaining independently validated
  launch values.
- A task prompt is sent exactly once only after the chosen agent is ready.
- Agent-first launch never sends task text.
- Moving between launcher surfaces, subviews, and Settings preserves the draft.
- Missing agents, invalid folders, worktree failures, spawn failures, and prompt-send failures
  remain visible and never trigger a silent fallback.
- Gallery specimens cover the required full and quick states at wide and compact widths.
- The owner-approved Gallery treatment is the visual baseline for production implementation.
