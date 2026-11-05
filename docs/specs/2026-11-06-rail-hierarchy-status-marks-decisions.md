# Rail hierarchy and status marks: decision ledger (2026-11-06)

Source: grilling session with the owner, screenshots of the project rail (`src/ui/project-rail/`),
and the mock built from it on branch `worktree-rail-marks-mock` (section `mock · rail hierarchy`
of the gallery, `src/gallery/sections/rail-hierarchy-*`). The owner closed the grilling with
"ok chốt".

Rows marked (default) were not answered in the owner's own words and take the recommended answer
that the owner accepted with "ok" / "ok chốt". A row marked REVISED or SUPERSEDED replaces the
text an earlier draft of this ledger carried under the same ID.

Goal: the agent row is the main thing on the rail; the workspace is orientation. The status mark
takes less room and every status has its own shape. Reference for the research: Orca (principles
only).

## Decisions

| ID | Decision | Owner words / status |
|----|----------|----------------------|
| RH-1 | Hierarchy: the agent row is the loudest tier; the workspace header is quieter. Scanning for unread agents is the primary task; telling which workspace an agent belongs to must also work well | "người dùng quét rail để tìm agent đang unread, nhưng phân biệt agent nào đang ở workspace nào cũng phải tốt" |
| RH-2 | REVISED. The rail has no status mark column: an agent row is pad 8, the 16px logo box, then the text 8px after it, so the text starts at the same x as the workspace name (32px from the row's edge). The 12px slot / 9px glyph the earlier rounds converged on (mark left edge under the workspace logo's) stays the size for any surface that still draws a mark (RH-5) | "q2-d" + "giảm size của status icon … thẳng hàng với logo workspace" + "tăng size lên cho staus icon đi" + "chốt phương án status icon: off" |
| RH-3 | The rail draws no status shapes (RH-25). Every surface that keeps a mark (RH-5) draws the set the owner reviewed in the mock: working braille spinner; needs-input solid dot with a radiating ring; unread solid dot; done a solid green circle with a check cut into it; failed a ✕; ended a small square; idle a short dash; never a hollow ring | "không được dùng icon rỗng, cần các loại icon thể hiện nhận diện tốt" + "agent checked thì dùng icon checked có vòng tròn bên ngoài ấy" + "1 dùng bộ mới như trong mock" |
| RH-4 | Reference for the research is Orca; take principles (shape-distinct statuses, attention aggregated upward, agents attached to their worktree), copy no layout | "q4-orca" |
| RH-5 | DECIDED. The strip tab, pane header and dock keep a status mark and take the new set (RH-3) as drawn in the mock; the rail has none (RH-25) | "q5-b" + "1 dùng bộ mới như trong mock" |
| RH-6 | If a surface keeps a mark, one component draws every shape and each surface sets its own size through a token; no surface redraws the mark | (default) |
| RH-7 | REVISED. Workspace header: name in `--text-primary` (white on the dark themes), 12px, weight 600; the agent title is also `--text-primary`, so weight, size and position carry the hierarchy | "text của name workspace cho màu white" + (default 23a) |
| RH-8 | REVISED. With no mark, an unread row is carried by its 600 title and the status ink on its branch icon and branch text (RH-21), no tint; needs-input adds the `STATE_NEEDS_YOU` tint | (default) + "chốt phương án status icon: off" |
| RH-9 | REVISED. No indent and no guide line: agent rows run from the same left edge as the header, and the agent's text starts at the same x as the workspace name (measured equal). The header is sticky at the top of the scroll area while its agents scroll past. A short horizontal line joins the workspace logo to its name across the gap | "bỏ thanh rail này, cho text của agent message thẳng hàng với workspace name" + "giữa logo workspace và name workspace thêm một line ngang để cảm giác liên kết" + (default sticky) |
| RH-10 | REVISED. A folded workspace shows only the total agent count, as a small circle on the logo's corner, and only while folded; the per-status circles are off with the status icons. A folded workspace with an unread, running or waiting agent therefore reads like any other (risk accepted) | "số agent thì cho hiển thị kiểu 1 góc của logo và bọc circle vào" + "chỉ khi header gập mới hiển thị số agent ở logo workspace" + "chốt phương án status icon: off" + "2 chấp nhận" |
| RH-11 | REVISED. Agent row height 32px, the existing `--row-32` token (no `--row-36`, so no new row-scale fork) | (default 22a; supersedes "13b") |
| RH-12 | REVISED. Agent title 11px, weight 400 (normal); unread and needs-input titles 600. The meta line (branch and date) 10px. These two sizes sit below the type scale's lowest step (12px): a fork resolved by the owner, alternative turned down: keep 12px | "20b" + "giảm size date và name branch nhỏ hơn đi xuống nữa đi" + "message agent đổi về font-weight normal đi" |
| RH-13 | Remembered rows share `ROW_LAYOUT`, so they follow RH-2, RH-11, RH-12, RH-19, RH-20 | (default) |
| RH-14 | This ledger supersedes RL-2 and RL-5 of `2026-11-06-rail-type-scale-decisions.md` for agent rows only (workspace header and search stay as that spec says; workspace row stays 28); that spec is edited in the same change | (default) |
| RH-15 | An empty workspace is one header line: no "No sessions" line, no icon, no count. No auto-fold or reordering | (default) |
| RH-16 | Accessibility: the mark stays `aria-hidden`; the row button's accessible name carries the agent and `statusLabel`; the folded circles carry an `aria-label` such as "1 unread, 3 working"; the corner count is labelled "N sessions" | (default) |
| RH-17 | Acceptance goes through the mock: real tokens and real parts in the gallery, dark and light, owner eye approval, then the spec with its traceability table and the plan | (default) + "làm mock phải có nhiều workspace agent đang hoạt động lúc đó mới thấy được worstcase" |
| RH-18 | Mock data (worst case): 10 workspaces (7 open, 3 folded); 37 agents covering all 7 statuses and all 12 agent logos; one workspace with 6 live agents; a folded workspace holding all four attention kinds; a very long workspace name, a one-word name, a long Vietnamese title, a long branch; one workspace without logo, one with a real logo, one empty, one without git | "thêm thử một vài agent với các logo agent khác thử" + (default) |
| RH-19 | Agent logo: a 12px glyph in a 16px box (from a 28 box and 16 glyph) | "logo agent quá lớn" + "18b" + "logo của agent giảm size nữa đi" |
| RH-20 | REVISED. Gaps inside an agent row: row pad 8, logo to text 8px (so the text lines up with the workspace name). The mark-to-logo gap of 2px applies only where a mark is drawn | "gap giữa các status icon, logo agent, text đang quá lớn" + "gap giữa logo agent và text message giảm nữa" + "gap giữa logo agent và status cũng giảm đi" + "chốt phương án status icon: off" |
| RH-21 | The meta line takes the row's status colour on the branch icon and the branch text: needs-input and unread `--ink-need`, failed `--ink-fail`, done `--ink-ok`, working `--status-working`, ended and idle faint. The date keeps the faint ink whatever the status | "thêm màu cho text branch theo màu của status icon" + "cả icon và date nữa" + "giữ màu cũ riêng cho date" |
| RH-22 | A working (pending) row: its branch text is a thinking line, dim with a bright band gliding across it left to right (1.8s); its date is replaced by three dots that rise in turn. Both loop only while the state exists and stop under reduced motion (U5) | "pending thì branch có dạng sóng lướt trên text giống mấy kiểu thinking text" + "kiểu text đang thinking giống của cursor agent" + "pending là agent đang chạy ấy" + "khi agent đang run thì date nên đổi thành ... đang run" |
| RH-23 | A workspace without a logo shows the fallback folder at 13px inside the 16px logo box (13 is the smallest step a Phosphor icon draws at) | "logo folder này giảm size đi" |
| RH-24 | DECIDED. A workspace without git has no branch, so its meta line keeps the folder icon in the branch's place with the words **"folder only"** after it, in the status ink (RH-21) | "workspace không git, hiển thị từ gì đó … no git được không" + "hoặc là folder only" + "thêm text folder only ấy" + "chọn folder only" |
| RH-25 | REVISED. Status icons are **off** in the rail: no mark column in the rows and no per-status circles on a folded header. The on/off button in the mock was a trial and does not ship | "thử bỏ luôn các icon status đi tôi xem" + "chốt phương án status icon: off" |

## Not decided, to settle in the spec (not silently assumed)

- Hover and focus actions (pin, archive, more) over the trailing edge with the new 32px row.
- Animation budget (DL-20) when several rows pulse, shimmer and bounce at once; pause while the window is hidden.
- Legibility of the 9px glyph and 11px / 10px text on both themes and for colour-blind users (shape carries the meaning, colour is secondary).
- Search field and the Archived section: do they follow RH-7, RH-11, RH-12?
- The size of the mark on the strip tab, pane header and dock (RH-5): each slot is set through a token at build and passes an eye review; the mock draws only the rail.
- Docs that name the old marks: DL-27.3, RCP-15, `docs/internals/agent-rail.md`; user guide only if a visible label changes.
- W21 sweep: every `AgentStateMark`, `ROW_LEAD`, `--mark-slot`, `--mark-dot`, `--mark-ring`, `--mark-square` site, ending with "changed N of M".
- Build in a worktree: the primary checkout holds other sessions' uncommitted `project-rail-*` edits.

## Acceptance (draft, one line per ID; the spec makes each checkable)

- RH-1, RH-8: with the icons off, the mock shows an unread row distinguishable from its neighbours at arm's length in the worst-case data, owner eye approval.
- RH-2, RH-19, RH-20: measured in the running dev app: no mark in the row, logo box 16 / glyph 12, row pad 8, logo to text 8, agent text x equal to workspace name x (W22).
- RH-3: the rail draws no status shape; where a mark survives (RH-5) the shapes are the set listed, none is a ring alone.
- RH-5, RH-6: W21 sweep, changed N of M: the strip tab, pane header and dock draw the new set from one component and no surface draws its own mark; the rail draws none.
- RH-7, RH-9: header name colour and size read from the running app; agent text x equals workspace name x; the header stays pinned while its agents scroll under it; the logo-to-name line is present.
- RH-10: a folded workspace shows the total count on the logo corner and nothing per status; an open workspace shows no corner count.
- RH-11, RH-12, RH-13: computed row height 32, title 11px weight 400 (600 when unread or needs-input), meta 10px; remembered rows match.
- RH-14: the type-scale spec no longer contradicts this one.
- RH-15, RH-16: an empty workspace is one line; accessible names carry status.
- RH-17, RH-18: the mock exists with this data and the owner approved it by eye before any production change.
- RH-21: branch icon and text take the status ink in both themes; the date is faint on every row.
- RH-22: a working row shows the shimmer and the dots; with reduced motion on neither moves; no other state animates in the row.
- RH-23: the fallback folder renders at 13px in the 16px box.
- RH-24: a non-git workspace row shows the folder icon and "folder only" in the status ink; never a blank second line and never the workspace's own name repeated.
- RH-25: no status mark in any rail row or folded header; no toggle ships.
