# Launcher in the stage

Status: `decided` (owner, 2026-11-04). The intent was confirmed in conversation, and the owner picked
direction A, "Command bar", by eye on the mock `~/scratch/spacevibe-deck/launcher-flow-2026-11-04/index.html`.
The project menu's long-list handling was revised on the mock the same day. This spec replaces the
Open board as the start surface and the agent launch page as the launcher, behind a release switch,
until a cut-over the owner approves by eye.

## Problem

A normal boot lands on a full-window Open board with the rail hidden. Two rules combine to cause it:
the rail renders only while a tab is live ([`liveRailAvailable`](../../src/ui/app-policy.ts)), and
since 2026-09-27 launch no longer restores tabs. So the start screen and the working app read as two
different apps.

Starting an agent also works differently at each entry point: the board, ⌘T, the rail's Agent
button and the checkout menu. The most common case, a project used today with its usual agent, takes
two choices (folder, then agent tile) on a surface of eleven equal-weight buttons.

The owner's CLI corpus (measured 2026-08-16) shows why that common case matters:

- 83% of sessions return to a project already touched that day.
- The five most recent projects cover 88% of sessions.
- 65 of 175 day×repo pairs used both Claude Code and Codex.

## Users

- **First run:** a new user with no workspace yet.
- **Daily returner:** someone who opens agents dozens of times a day.

## Requirements

- **LCH-1 Boot with the rail.** A normal window boots with the rail visible whatever its live tab
  count, and the stage shows the launcher. A window booted to adopt a pane opens on that pane and
  never shows the launcher at boot, as today.
- **LCH-2 Remembered agents on the rail.**
  - **At boot:** the rail lists every agent pane of the previous session under its project, dimmed:
    agent logo, last title (else the agent's name), branch and age. Nothing runs.
  - **Hover:** a dimmed row swaps its age for a resume mark.
  - **Pressing a row** opens that one pane in its project and resumes its conversation. It uses the
    same resolution the last-session restore uses: the exact id where the resolver finds one, else
    that agent's `latest` where the table allows it.
  - **No resolution:** the row reopens the agent with its recorded launch command, or the agent's
    default command when none was recorded, and says it started fresh.
  - **Pressing a running row** shows its pane.
  - **Forgetting:** closing a row (its ✕) forgets it.
  - **Lifetime:** a row survives other rows being resumed, later journal writes and later quits,
    until it is resumed or forgotten.
- **LCH-3 Offer, not restore.** Boot never resumes anything unasked, which keeps the 2026-09-27
  decision. The Open board's **Last session** line and its **Reopen** go away; the rail rows replace
  them. Reopening a whole session at once is out of scope.
- **LCH-4 One launcher, in the stage.**
  - **Placement:** the launcher renders inside the stage, never over the rail.
  - **What opens it:** boot; the window having no live tab; ⌘T (the `new-tab` action keeps its id);
    the rail's Agent button; pressing a project header on the rail, which retargets it to that
    project; and the checkout menu, whose per-agent list becomes one **New agent…** item.
  - **Closing:** Esc closes it back to the previous surface when there is one.
  - **Over a live space:** opened over a live space, it floats at the top of the stage, and the
    panes stay visible and dimmed behind it without resizing (the PTYs keep their size).
- **LCH-5 Command bar.** One bar holds, from the left, the project chip, the filter input and the
  **Run** split button. Below it sit the agent chips, then the destination line.
  - **Project chip:** shows the project's avatar, name and branch.
  - **Project menu, contents:**
    - a search field that takes focus on open, whose placeholder counts the projects;
    - every workspace in history in recency order, in a list about 6.5 rows tall that scrolls
      inside itself;
    - a 1px separator;
    - **Open folder…** (⌘O) and **New worktree…**, fixed below the list.
  - **Project menu, keys and marks:** typing filters all of history and marks the match; ↑↓ moves
    the highlight and keeps it in view, ↵ picks, Esc closes. The current project carries a check,
    and an older one shows its age.
  - **Picking from the menu:** picking a workspace that is not on the rail adds it there and moves
    it to the top of recency.
  - **Agent chips:** one per quick agent, in the order set in Settings → Agents. A chip is icon-only
    and muted until picked; a picked chip shows its name.
  - **Picking agents:** a click picks only that agent; ⇧-click adds it or removes it. The default
    pick is the agent last run in the target project, else the first quick agent.
  - **Chip tooltip:** the exact command the chip runs.
  - **Filter input:** typing narrows the chips and lists up to five matching projects under the bar.
    ↵ runs the first matching agent, otherwise it switches to the first matching project.
  - **Run:** reads **Run** or **Run N**. ↵ anywhere in the launcher outside a button runs it. The
    caret opens the agent's launch profiles for this visit, with today's behaviour.
  - **Destination line:** "New space in ‹project›", or "Beside ‹agent›" when the launcher was opened
    from a live space of the same project.
- **LCH-6 Several agents, one space.**
  - **New space:** Run with N picked agents (N ≤ 4) opens one new space in the target project with N
    panes side by side at equal widths. Each pane types its own agent's launch command, with the
    profile the user chose.
  - **Over a live space:** from a live space of the same project, the N panes split in beside the
    focused pane instead.
  - **What each pane keeps:** each pane is journaled with its own agent and launch command, so the
    rail can remember and resume it (LCH-2), and each counts as one launch in analytics.
  - **No prompt:** no prompt is sent to any of the panes.
- **LCH-7 First run.** With no workspace yet:
  - the rail shows a one-line hint;
  - the bar shows **Open folder** (primary, ⌘O) and **Clone**, and the chips are disabled;
  - dropping a folder anywhere adds it and targets it.
- **LCH-8 Homes for what the Open board held.**
  - **Rail `+` menu:** **Open folder…**, **Clone repository…**, **New worktree…** and
    **Create workspace…**.
  - **Clone and Create workspace forms:** render in the stage in the launcher's place, keep their
    progress and cancel behaviour, and return to the launcher.
  - **Session history** ("Resume a previous session…"): lives in the dock's History view and behind
    the rail foot's history button.
  - **Drop to add a workspace:** keeps its behaviour.
  - **Launcher behaviours that stay:** Install on a missing quick agent, Retry on a failed launch,
    and the pinning of an agent installed from Deck.
- **LCH-9 Little text.** The launcher carries no heading, eyebrow or helper sentence. Its only text
  lines are the destination line, the first-run hint and the menu's empty state ("No project
  matches"). Strings are English. Sizes come from the type scale: 14 for controls, labels and names;
  12 for branch, age, the destination line and key hints.
- **LCH-10 Behind a switch.** A new release switch gates LCH-1 to LCH-9: on in development builds,
  off in a packaged release. With it off, the Open board, the launch page and the Last session offer
  behave exactly as today.
  - **Cut-over:** one change, after the owner approves the running app by eye against mock A. It
    removes the switch, the Open board, the agent launch page and the Last session offer, and
    updates `docs/user/` (getting started, agents) and their translations.

## Journeys

The owner measures the result by these, in actions.

| ID  | Journey                                       | Must take                       |
| --- | --------------------------------------------- | ------------------------------- |
| J-1 | Return after quit, resume a previous agent    | 1 click on its rail row         |
| J-2 | Familiar project with its usual agent         | ↵ at boot, or ⌘T then ↵         |
| J-3 | Another agent in the same project             | 1 click, ↵                      |
| J-4 | Two agents side by side in one space          | ⇧-click, ↵                      |
| J-5 | First run to a running agent                  | Open folder, choose a folder, ↵ |
| J-6 | Switch to a project used weeks ago            | chip, type a few letters, ↵, ↵  |

## Acceptance

| ID    | Check                                                                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | With the switch on, a normal boot shows the rail and the stage launcher, an adopt window boots on its pane, and closing the last tab shows the stage launcher with the rail still visible.                       |
| AC-2  | After quitting with three agent panes open, the next boot shows three dimmed rows. Pressing one opens exactly one pane that types the same resume command the Last session Reopen would have typed for it.         |
| AC-3  | Run with two picked agents opens one new tab with two equal panes. Each pane types its own launch command (profile included), and the journal records both panes with their agent and command.                  |
| AC-4  | ⌘T from a live space, then picking an agent and pressing ↵, splits the new pane beside the focused one. Esc closes the launcher without resizing any pane.                                                        |
| AC-5  | The project menu with 23 workspaces lists all of them in a list that scrolls, keeps Open folder… and New worktree… below a separator, and ↑↓ keeps the highlighted row in view.                                  |
| AC-6  | J-1 to J-6 take no more than the actions in the table, walked in the running app with the switch on.                                                                                                            |
| AC-7  | With the switch off, the Open board, the launch page and Last session work as before (their existing tests pass unchanged).                                                                                      |
| AC-8  | The `scripts/` and `src/styles/` policy suites, lint and the tests beside each changed file pass at every stage.                                                                                                 |
| AC-9  | The owner approves the running app by eye against mock A before the cut-over.                                                                                                                                   |

## Out of scope

- A shared prompt sent to the picked agents. Auto-send still has the known readiness race.
- Resuming at boot, and reopening a whole previous session in one press.
- One worktree per agent, and opening several projects at once.
- Anything inside a pane after launch.
- Directions B ("Ghost panes") and C ("Next up") of the mock.
- Distinct project avatars. The `spacevibe-*` initials collide (SA, SB), and that is a separate
  decision.
