# Launcher bar takes over worktree creation: decision ledger

Status: decided (grilling 2026-11-06). Source: the owner's answers in session, quoted below.
Ledger IDs are cited by the spec, plan, build prompts and acceptance. Every line needs a
requirement and an acceptance check before the spec is committed (W20).

## Starting point

The corner popover from the rail's `Worktree` button and the bar's `New worktree…` menu entry
(`OpenBoardWorktreeForm`) sits in a corner of the screen. Three copies of the form exist:
`src/ui/rail-worktree-form.tsx`, `src/ui/project-rail/project-rail-worktree-form.tsx`,
`src/open-board/open-board-worktree-form.tsx`.

## Decisions

| ID | Decision | Owner's words |
| --- | --- | --- |
| L1 | Worktree creation leaves the corner popover and lives in the existing launcher command bar (`command-bar.tsx`, behind `stageLauncher`). | "tôi muốn tận dụng kiểu UI này, xong thêm các action khác vào trong đó như branch,worktree" |
| L2 | The surface is a centred, Raycast-like popup, as in Orca. | "orca là 1 popup hiển thị ra giữa màn hình, chúng ta làm vào trong kiểu này rất ok, khá giống popup kiểu raycast" |
| L3 | The surface covers create, jump and clean-up, not create only. | "q7-c" |
| L4 | Filter icons sit at the right of the input. With none selected the results are the merged set. | "thêm các icon lọc vào right input để user chọn, nếu không chọn gì thì là tổng hợp kết quả luôn" |
| L5 | Four filter icons: Agents, Projects, Worktrees, Branches. A branch without a worktree is a branch, an existing checkout is a worktree. `New worktree` and `Clean up` belong to Worktrees; there is no separate Actions icon. | "ok approve" (Q18) |
| L6 | Icons toggle independently, so several can be on; none on means all. Each has a tooltip name instead of a visible label. | "ok approve" (Q19) |
| L7 | The bar stays compact by default. The result list opens when the owner types or turns an icon on; an icon on with no text shows recent worktrees and projects. | "ok approve" (Q20) |
| L8 | Enter on a result only sets the destination (agent, project, worktree, branch, or `New worktree "x" from <base>`). `Run`, or Enter on an empty field, executes. | "ok approve" (Q21) |
| L9 | The chip `<project> ⎇ <branch>` is the destination of the run. Choosing a new worktree makes `Run` create it and then launch the agent in it, in one step. A `Create only` entry in the same dropdown creates without launching. The new branch name is typed into the filter field, with no second input. | "ok approve" (Q15) |
| L10 | Clean-up lives in the chip dropdown (one row per checkout with status, `⌫` removes) and in the Worktrees group (bulk). A clean, merged worktree needs one inline confirm; a dirty or unmerged one needs a confirm that names the uncommitted file count; never force; bulk covers only clean and merged rows and shows the list before it runs. | "ok approve" (Q16, Q13) |
| L11 | The rail's `Worktree` button opens the bar with the destination preset to `New worktree…` and focus in the filter field. | "ok approve" (Q17) |
| L12 | One surface replaces the three form copies. The work extends `stageLauncher` with no new switch; the three forms are deleted when the owner approves the result by eye at cut-over. | consequence of L1 and "ok approve" |
| L13 | The creation step has no agent or prompt fields, because the bar already carries the agent row. | consequence of L1 |

## Open facts (looked up at spec time, not owner decisions)

- Which chord opens the bar today, and whether `⌘K` collides with the terminal's clear.
- The default base branch: `origin/HEAD` or a fixed `main` (`useWorktreeForm` did not show it).
- Whether the `agent-launch-page` run logic can be shared without a second copy.

## Superseded during the grilling

- Standalone popup with its own form and three mock variants: replaced by L1.
- "Separate surface" for workspace management (Q3 "có cần surface riêng"): the separate surface is the
  extended bar itself, not a new page.
