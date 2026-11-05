# Launcher: double-click an agent chip to run it — decision ledger

Settled in a grilling session on 2026-11-06. Owner's ask: "bỏ button Run, cho phép user khi
double-click vào agent là mở luôn pane agent", then revised to "hoặc là vẫn giữ button và
double click vào agent cũng có thể run được". The revision wins: `Run` stays.

Surface: the chips row of [`src/launcher/command-bar.tsx`](../../src/launcher/command-bar.tsx).

| ID  | Decision (owner: "ok approve" to each recommendation)                                                                                                                  | Requirement                                                                                                  | Acceptance                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| L1  | "vẫn giữ button và double click vào agent cũng có thể run được" — `Run`, its profile menu, `⇧` multi-pick and the `Enter` rules stay unchanged.                         | The `Run` button, the profile menu and `enterAction` behave exactly as before.                               | Existing `command-bar.test.tsx` cases still pass untouched.                                                   |
| L2  | Double-click runs exactly the double-clicked agent, with the profile picked for that agent, as `Run` would. The first click already narrows the pick to that chip.     | A plain double-click on a chip calls `onRun([id], profileOverrides(...))`.                                   | Test: double-click a chip while two are picked → `onRun` called once with only that agent id.                 |
| L3  | `⇧` + double-click does not run. `⇧` keeps one meaning, add or remove.                                                                                                | A double-click with `shiftKey` never calls `onRun`.                                                          | Test: `⇧` + double-click → `onRun` not called; the pick toggled twice, so unchanged.                          |
| L4  | The chip tooltip gains a secondary line "Double-click to run"; the command line stays.                                                                                 | `TooltipContent` of a chip shows the command and the hint line.                                              | Test: hovering a chip shows both lines. Eye check of the tooltip in the owner's theme.                        |
| L5  | No keyboard equivalent on the chip: `Enter` on a focused chip stays the native button press; the filter field `Enter` and `Run` are the keyboard paths.                 | Chip `Enter` handling is untouched.                                                                          | Test: `Enter` on a focused chip changes the pick and does not call `onRun`.                                   |
| L6  | Scope: every place that renders the chips (this bar, floating, stage launcher, first-run). The `docs/user/` guide changes if it describes how to run an agent.         | A repo-wide search lists every consumer; the change lands in the shared component. Report "changed N of M".  | Search output in the plan; a double-click is inert in `firstRun` / `pending` because the chips are disabled.  |

Implicit from L2: `pending` and `firstRun` already disable the chips, so a double-click is inert
there with no extra code.
