# Rail hierarchy and status marks

Status: draft for the owner's review of the traceability table. Decisions: [decision ledger](2026-11-06-rail-hierarchy-status-marks-decisions.md) (`RH-n`). Mock: gallery section `mock · rail hierarchy`, branch `worktree-rail-marks-mock` (`src/gallery/sections/rail-hierarchy-*`).

## Problem

In the project rail the status mark, the agent logo and the text sit in three wide columns, and the workspace header and the agent row weigh about the same. The owner scans the rail for unread agents and must also see which workspace an agent belongs to; today the mark spends the width and the hierarchy is flat.

## Requirements

- **SR-1 Row layout.** An agent row is 32px high (existing `--row-32`), with a row pad of 8 (the header's pad), a 16px logo box holding a 12px agent glyph, and the text 8px after the logo box. The agent text starts at the same x as the workspace name. Remembered rows share this layout. (RH-2, RH-11, RH-13, RH-19, RH-20)
- **SR-2 Type.** Agent title 11px, weight 400, and 600 when the row is unread or needs the owner; meta line (branch, date) 10px; workspace name 12px, weight 600, `--text-primary`. The 11px and 10px steps are new steps below the type scale's lowest (12px), declared as tokens: a fork the owner resolved (alternative turned down: keep 12px). (RH-7, RH-12)
- **SR-3 No mark in the rail.** No agent row and no folded workspace header in the project rail draws a status mark or a per-status circle. (RH-25)
- **SR-4 Status through ink and motion.** The branch icon and branch text take the row's status ink: needs-input and unread `--ink-need`, failed `--ink-fail`, done `--ink-ok`, working `--status-working`, ended and idle faint. The date stays faint on every row. A needs-input row keeps the needs-you tint; unread has no tint. A working row's branch is a dim line with a bright band gliding across it (1.8s) and its date is replaced by three dots that rise in turn. These animations run only while the working state exists and stop under reduced motion. (RH-1, RH-8, RH-21, RH-22)
- **SR-5 Workspace header.** The header is sticky at the top of the scroll area while its agents scroll under it; there is no indent and no guide line; a short horizontal line joins the logo to the name; a workspace without a logo shows the fallback folder at 13px inside the 16px box; a folded workspace shows its total agent count as a small circle on the logo's corner and nothing per status; an open workspace shows no count; an empty workspace is one header line with no "No sessions" line. (RH-9, RH-10, RH-15, RH-23)
- **SR-6 No git.** A row of a workspace without git shows the folder icon and the words "folder only" in the meta line, in the status ink. (RH-24)
- **SR-7 Mark on the other surfaces.** The strip tab, pane header and dock keep a status mark and draw the new set from one component: working braille spinner; needs-input solid dot with a radiating ring; unread solid dot; done a solid green circle with a check cut into it; failed a ✕; ended a small square; idle a short dash; never a hollow ring. Each surface sets its size through a token. (RH-3, RH-5, RH-6)
- **SR-8 Accessibility.** A row's accessible name carries the agent and the status; the folded count is labelled "N sessions"; no status is carried by colour alone in a surface that keeps a mark. (RH-16)
- **SR-9 Supersession.** This spec supersedes `RL-2` and `RL-5` of [the rail type scale ledger](2026-11-06-rail-type-scale-decisions.md) for agent rows only; that ledger is edited in the same change. (RH-14)
- **SR-10 Process.** Before any production change the mock is approved by eye by the owner, in both themes, on the worst-case data of RH-18; the change ends with a W21 sweep ("changed N of M") and a W22 runtime check in the owner's dev app. (RH-4, RH-17, RH-18)

## Out of scope

- The old cluster rail (`AgentRail`'s own list) beyond the shared mark in SR-7.
- Reordering, auto-folding or sorting of workspaces and agents.
- Any change to what the actions menu, pin and archive do.

## Traceability

Each decision of the ledger, quoted in short, with the requirement that carries it and the check that proves it.

| Decision (ledger ID, quoted) | Requirement | Acceptance check |
|---|---|---|
| RH-1 "quét … agent đang unread … phân biệt agent … workspace nào cũng phải tốt" | SR-4, SR-1, SR-5 | Mock in worst-case data: an unread row is distinguishable at arm's length; owner eye approval |
| RH-2 "tràn ra bên trái … thẳng hàng với logo workspace" / "status icon: off" | SR-1, SR-3 | Dev app: no mark in a row; agent text x equals workspace name x |
| RH-3 "icon checked có vòng tròn bên ngoài" | SR-7 | Strip tab, pane header and dock each render the set; none is a ring alone |
| RH-4 "orca" | SR-10 | Research recorded in the ledger; no layout copied |
| RH-5 "q5-b" / "dùng bộ mới như trong mock" | SR-7, SR-3 | W21 sweep: three surfaces on the new component, rail has none |
| RH-6 (default) one component, a size token per surface | SR-7 | One component draws every shape; each surface's size is a token |
| RH-7 "name workspace cho màu white" | SR-2 | Computed colour `--text-primary`, 12px, 600 |
| RH-8 (default) unread title 600, no tint | SR-4, SR-2 | Computed weight 600 and no tint on an unread row; tint only on needs-input |
| RH-9 "bỏ thanh rail này … thẳng hàng với workspace name" / "line ngang" | SR-5, SR-1 | Measured text x equals name x; no guide line; header pinned while scrolling; logo-to-name line present |
| RH-10 "số agent … 1 góc của logo" / "chỉ khi header gập" | SR-5 | Folded header shows the corner count and nothing per status; open shows none |
| RH-11 (default 22a) 32px | SR-1 | Computed row height 32 |
| RH-12 "20b" / "giảm size date và name branch" / "font-weight normal" | SR-2 | Computed title 11px weight 400 (600 unread/needs-input), meta 10px |
| RH-13 (default) remembered rows follow | SR-1 | Remembered row matches the live row's geometry |
| RH-14 (default) supersede RL-2, RL-5 | SR-9 | The type-scale ledger no longer contradicts this spec |
| RH-15 (default) empty workspace one line | SR-5 | Empty workspace renders one line, no "No sessions" |
| RH-16 (default) accessible names | SR-8 | Accessible name of a row contains agent and status |
| RH-17 "làm mock phải có nhiều workspace … worstcase" | SR-10 | Mock approved by the owner before any production change |
| RH-18 "thêm … agent với các logo agent khác" | SR-10 | The mock holds the data of RH-18 (10 workspaces, 37 agents, 12 logos) |
| RH-19 "logo agent quá lớn" / "giảm size nữa" | SR-1 | Logo box 16, glyph 12 measured |
| RH-20 "gap … quá lớn" / "giảm" / "status off" | SR-1 | Row pad 8 and logo-to-text 8 measured |
| RH-21 "branch theo màu của status icon" / "cả icon" / "giữ màu cũ riêng cho date" | SR-4 | Branch icon and text take the status ink in both themes; date faint on every row |
| RH-22 "pending … thinking text kiểu cursor" / "date … đang run" | SR-4 | Working row shows the shimmer and the dots; none under reduced motion; no other state loops |
| RH-23 "logo folder này giảm size" | SR-5 | Fallback folder 13px in the 16px box |
| RH-24 "chọn folder only" | SR-6 | Non-git row shows folder icon and "folder only" in the status ink |
| RH-25 "chốt phương án status icon: off" | SR-3 | No status mark or per-status circle in any rail row or folded header; no toggle ships |

## Open before build

- Hover and focus actions (pin, archive, more) over the trailing edge of a 32px row.
- Animation budget (DL-20) with many working rows and the radiating ring on needs-input marks elsewhere; pause while the window is hidden.
- Contrast of the 11px and 10px text and of the `--ink-*` steps on every theme.
- Search field and Archived section: do they follow SR-1 and SR-2?
- The mark's size on the strip tab, pane header and dock, set through a token and eye-reviewed at build.
- Docs that name the old marks (`DL-27.3`, `RCP-15`, `docs/internals/agent-rail.md`); the user guide only if a visible label changes.
