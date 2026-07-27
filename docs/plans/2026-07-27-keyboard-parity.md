# Keyboard Parity — đóng khoảng cách chuột/bàn phím theo nguyên tắc chuột và bàn phím đều first-class

> **For agentic workers:** REQUIRED SUB-SKILL: dùng `superpowers:subagent-driven-development`
> (khuyến nghị, Task 1/2/4 độc lập nhau và chỉ cần action-registry.md Task 1–3; Task 3 (`copy-cwd`)
> cũng độc lập về code nhưng cần action-registry.md Task 1–6, nên có thể bắt đầu muộn hơn ba task
> kia) hoặc `superpowers:executing-plans` để chạy plan này theo
> từng task. Mỗi task có checklist Build/Verify riêng, chạy xong task nào verify ngay task đó
> trước khi sang task sau.

> **Cập nhật sau khi viết plan này**: `eef3f4a` đã gỡ toàn bộ pipeline ADR-first của repo
> (`PIPELINE.lock`, `docs/decisions/` — gồm cả ADR 0006 và 0016 dưới đây — và 6 doc phái sinh, gồm
> `REQUIREMENTS.md`/`UX-DESIGN.md`). Các trích dẫn bên dưới và trong toàn bộ plan đã được viết lại:
> giữ nguyên lập luận/nội dung quyết định (chúng vẫn đúng), bỏ liên kết tới file không còn tồn tại.

**Nguồn**: brief team lead (audit phím tắt toàn repo, xem lịch sử hội thoại) · nguyên tắc "chuột và
bàn phím đều first-class" (trước đây ADR 0006, file đã gỡ) · nguyên tắc pane-swap dùng lại đúng
neighbor-resolution của focus-direction, kèm busy-guard cho cross-window move (trước đây ADR 0016,
cũng đã gỡ — nội dung cụ thể liên quan được viết thẳng vào §1b/§3/Task 1 dưới đây, không cần file
gốc nữa) · FR-030…FR-036 và mục "Pane swap"/"Move a pane to another window" (trước đây
`docs/REQUIREMENTS.md`/`docs/UX-DESIGN.md`, cùng bị gỡ) ·
[action-registry.md](2026-07-27-action-registry.md) (plan song song, xem §0 — plan này XÂY TRÊN nó) ·
[findings-doc-reality-drift-2026-07-26.md](../review/findings-doc-reality-drift-2026-07-26.md)
(vẫn còn trong `docs/review/`).

**Goal**: Đóng những khoảng trống "chỉ tới được bằng chuột" mà audit phát hiện, đúng tinh thần
nguyên tắc chuột và bàn phím đều first-class. Chỉ implement action nào có thiết kế đã đủ rõ (có
quyết định/spec sẵn — trước đây ghi ở ADR/FR, nay chỉ còn sống trong plan này, xem §1b/§3 — hoặc
chỉ có đúng một cách làm hợp lý) — action nào còn mở về UX hoặc phụ thuộc hạ tầng chưa tồn
tại thì nêu rõ và tách khỏi phạm vi thực thi, không tự thiết kế cho có.

**Architecture**: Mọi action mới đăng ký một lần trong `src/terminal/action-registry.ts`
(`ACTION_REGISTRY` + `DEFAULT_KEYMAP`, xem action-registry.md) — plan này viết trên giả định 9 task
của plan đó đã merge (`overlayBlocksAction` đọc `scope` từ registry, `KeyBinding` là union
`CharKeyBinding | PhysicalKeyBinding` — xem §0 về luật chọn cái nào). Mỗi action mới là phần mở rộng
mỏng của một method có sẵn trên `TerminalManager`/`TabManager`, hoặc một signal chia sẻ mới trong
`tabs-store.ts` — tái dùng nguyên các primitive hình học/cây layout đã có (`nearestInDirection`,
`swapLeaves`) thay vì phát minh cơ chế mới. 3/4 action (swap, tab options, scrollback) là JS-only,
không menu item, giống `focus-left/right/up/down` đã có. `copy-cwd` là ngoại lệ đã được người dùng
chốt: có menu item ở **Edit** (cạnh Find…/Clear Buffer), đi qua đúng cầu `action:`/`runAction` sẵn có
— không tạo Tauri event riêng — nên Task 3 (và chỉ Task 3) có chạm `menu.rs`.

**Tech Stack**: TypeScript/Preact, `@preact/signals` (`useSignalEffect`, đã dùng trong `app.tsx`),
không thư viện mới. Rust/Tauri chỉ đổi ở `menu.rs` cho menu item `copy-cwd` (Task 3) — không crate
mới, không capability mới.

## §0. Phụ thuộc vào `action-registry.md` — đọc trước khi bắt đầu

`docs/plans/2026-07-27-action-registry.md` đã tồn tại (agent khác viết song song), hiện có **9
task**, vẫn đang chờ người dùng duyệt — chưa ai thực thi nó. Nó gộp `ShortcutAction`/
`DEFAULT_KEYMAP`/`commands`/`overlayBlocksAction`/`menu.rs` thành một `ACTION_REGISTRY` duy nhất.
Plan này **không làm lại việc đó** — mọi task dưới đây giả định `src/terminal/action-registry.ts` đã
tồn tại với hình dạng Task 1 mô tả (`ActionDefinition` có `id/label/scope/menu?`, `KeyBinding` là
union `CharKeyBinding | PhysicalKeyBinding` lift nguyên từ `keymap.ts` hôm nay).

**Kiểm tra bắt buộc trước Task 1**: `test -f src/terminal/action-registry.ts`. Nếu file chưa tồn
tại (action-registry.md chưa chạy), DỪNG và báo — không tự dựng lại registry trong plan này.

**Luật chọn `key` (`CharKeyBinding`) vs `code` (`PhysicalKeyBinding`) cho binding mới** (quyết định
của team lead, áp dụng cho MỌI action thêm sau này — không suy diễn từ tiền lệ riêng lẻ): action
**CÓ menu item** ở `menu.rs` luôn bind theo `event.key` (menu accelerator native tự thân khớp theo
ký tự, hai đường phải cùng một trục để không lệch nhau trên layout không-QWERTY). Action **KHÔNG có
menu item** thì webview là đường duy nhất — bind theo `event.code` chỉ khi ký tự sinh ra phụ thuộc
Shift/layout (điển hình: phím dấu như `[`/`]`); còn lại (chữ cái, phím có tên như Arrow/Enter/
PageUp/Home/End — `event.key` của chúng đã ổn định qua mọi layout/Shift) giữ `event.key` như
`CharKeyBinding`, đúng tinh thần JSDoc hiện có của `CharKeyBinding` trong `keymap.ts`: "Right for
shortcuts users think of by letter — the same character regardless of physical key position." Cả 4
nhóm action trong plan này (swap-arrows, `KeyR`, `KeyC`, PageUp/PageDown/Home/End) đều dùng
`CharKeyBinding` (`key`), không dùng `code` — 3 nhóm không menu item vì không phải phím dấu; `copy-cwd`
(`KeyC`) giờ CÓ menu item (Edit, chốt sau — xem Task 3) nên càng đúng luật theo nhánh còn lại: `key`
là bắt buộc, không phải lựa chọn. Xem §1b và từng task để biết chi tiết.

**Đính chính một finding sai ở bản báo cáo trước**: bản đọc trước của tôi dựa trên
`action-registry.md` phiên bản CŨ (10 task). Bản hiện tại (9 task, viết lại sau khi đọc lại
`09f5c4d`) đã tự sửa đúng vấn đề — Task 4 (hợp nhất `new-preset`/`save-preset`, không còn là Task 5)
**thêm** `{ key: "n", meta: true, shift: true, action: "new-preset" }` vào `DEFAULT_KEYMAP`, khớp
accelerator `⌘⇧N` đã có sẵn ở `menu.rs` từ `09f5c4d` — không xoá gì cả. Không có xung đột nào cần xử
lý; đã sửa lại toàn bộ tham chiếu số task trong plan này cho khớp bản 9-task hiện tại.

## Global Constraints

- Không big-bang — mỗi task tự đứng được, `npm run build`/`npm test` xanh ngay sau task đó, không
  để đỏ chờ task sau.
- Không đổi hành vi shipped của action nào đã có; mọi thay đổi ở đây là ACTION MỚI hoặc METHOD MỚI
  cạnh method cũ (`focusDirection` giữ nguyên, `swapDirection` là hàng xóm mới, không sửa chữ ký cũ).
- 3/4 action (swap, tab options, scrollback — Task 1, 2, 4) không chạm `src-tauri/`. Riêng Task 3
  (`copy-cwd`) có menu item nên chạm `menu.rs` — `cargo check`/`cargo test` là bắt buộc ngay trong
  Task 3, không chỉ chạy như lưới an toàn ở Task 6 nữa.
- IME guard (`event.isComposing`, `event.keyCode === 229` ở `tab-manager.ts` `handleShortcut`,
  dòng ~954-971) và `webkit-ime-fix.ts` không đụng tới. Guard này chạy TRƯỚC `matchBinding`
  (đã đọc code xác nhận thứ tự: IME guard → chrome-text-field guard → `matchBinding` → chỉ khi match
  mới `preventDefault()`), nên action mới không cần lo về composition tiếng Việt. Mọi chord mới dùng
  `event.key` (`CharKeyBinding`, xem §0 về luật) — Arrow/`r`/`c`/`pageup`/`pagedown`/`home`/`end` đều
  là phím ổn định qua layout/Shift, không nằm trong luồng gõ IME nào.
- Mọi chord mới đã đối chiếu KHÔNG trùng: `DEFAULT_KEYMAP` hiện có (bảng §1), accelerator trong
  `menu.rs`, và role builder mặc định macOS (`.minimize()/.maximize()/.fullscreen()/.hide()/
.hide_others()/.show_all()/.undo()/.redo()/.cut()/.copy()/.paste()/.select_all()/.services()/
.about()`). Bảng đầy đủ ở §1.
- 3 action (swap, tab options, scrollback) không có menu item macOS — "nửa bàn phím còn thiếu" của
  một hành vi ĐÃ discoverable bằng chuột (drag-dock swap, click tab, trackpad/scrollbar), giống đúng
  lý do `focus-left/right/up/down` không có menu item. `copy-cwd` khác — người dùng đã chốt cho nó
  menu item ở Edit, vì trước khi có quyết định này nó là action DUY NHẤT không có bất kỳ đường chuột
  nào (xem §5).

---

## §1. Bảng chord — nguồn để chọn phím mới (tài sản dùng lại)

### 1a. Đang dùng — đọc trực tiếp từ `src/terminal/keymap.ts` hiện tại (đã gồm `a6ac532` + `⌘G` mới)

Ghi chú field dùng để match: `key` = `CharKeyBinding` (`event.key`, ký tự/named-key ổn định qua
layout); `code` = `PhysicalKeyBinding` (`event.code`, vị trí vật lý — chỉ 4 hàng bracket dưới đây).

| Action(s)                                                                                           | field trùng khớp                 | Modifier   |
| --------------------------------------------------------------------------------------------------- | -------------------------------- | ---------- |
| split-row / split-column                                                                            | `key: "d"`                       | `⌘` / `⌘⇧` |
| close-pane / close-tab                                                                              | `key: "w"`                       | `⌘` / `⌘⇧` |
| focus-next / next-tab                                                                               | `code: "BracketRight"`           | `⌘` / `⌘⇧` |
| focus-prev / prev-tab                                                                               | `code: "BracketLeft"`            | `⌘` / `⌘⇧` |
| toggle-expand                                                                                       | `key: "e"`                       | `⌘`        |
| new-tab / reopen-tab                                                                                | `key: "t"`                       | `⌘` / `⌘⇧` |
| zoom-in                                                                                             | `key: "="` / `key: "+"`          | `⌘` / `⌘⇧` |
| zoom-out                                                                                            | `key: "-"`                       | `⌘`        |
| zoom-reset / select-tab-1…8                                                                         | `key: "0"` / `key: "1"`…`"8"`    | `⌘`        |
| select-last-tab                                                                                     | `key: "9"`                       | `⌘`        |
| toggle-zoom-pane                                                                                    | `key: "enter"`                   | `⌘⇧`       |
| find                                                                                                | `key: "f"`                       | `⌘`        |
| find-next / find-previous                                                                           | `key: "g"`                       | `⌘` / `⌘⇧` |
| clear-buffer                                                                                        | `key: "k"`                       | `⌘`        |
| save-preset                                                                                         | `key: "s"`                       | `⌘⇧`       |
| focus-next-attention                                                                                | `key: "a"`                       | `⌘⇧`       |
| toggle-settings                                                                                     | `key: ","`                       | `⌘`        |
| focus-left/right/up/down                                                                            | `key: "arrowleft/right/up/down"` | `⌘⌥`       |
| new-preset (chỉ ở `menu.rs` hôm nay — chưa vào `DEFAULT_KEYMAP`, action-registry.md Task 4 sẽ thêm) | —                                | `⌘⇧N`      |
| quit (menu.rs)                                                                                      | —                                | `⌘Q`       |

Role builder macOS mặc định (không phải registry, cạnh tranh chord ở tầng OS/Cocoa trước khi tới
webview): `⌘M` (minimize), `⌘H` (hide), `⌘⌥H` (hide others), `⌘Z` (undo), `⌘⇧Z` (redo), `⌘X` (cut),
`⌘C` (copy), `⌘V` (paste), `⌘A` (select all). `.maximize()/.fullscreen()/.show_all()/.services()/
.about()` không có accelerator mặc định.

### 1b. Chord mới đề xuất trong plan này — đối chiếu không trùng bảng trên

Cả 4 nhóm dưới đây đều là `CharKeyBinding` (`key`) — không có menu item, và không phải phím dấu phụ
thuộc Shift/layout (đúng luật ở §0), nên không cần `PhysicalKeyBinding`.

| Action mới                                             | `key` + modifier                         | Trùng gì không?                                                                    |
| ------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `swap-left/right/up/down` (Task 1)                     | `key: "arrowleft/right/up/down"` + `⌘⌥⇧` | Khác `focus-*` (thiếu Shift) — không trùng. Không role builtin nào dùng Arrow.     |
| `open-tab-options` (Task 2)                            | `key: "r"` + `⌘⇧`                        | `r` chưa dùng ở đâu trong bảng 1a hay role builtin.                                |
| `copy-cwd` (Task 3)                                    | `key: "c"` + `⌘⇧`                        | Khác `.copy()` role (`⌘C`, không Shift) — không trùng.                             |
| `scroll-page-up/down`, `scroll-to-top/bottom` (Task 4) | `key: "pageup/pagedown/home/end"` + `⇧`  | Các key này chưa xuất hiện ở đâu trong bảng 1a hay role builtin — hoàn toàn trống. |

`⌘⌥⇧`+Arrow đã đúng chord mà quyết định Pane Swap trước đó (trước đây ghi ở ADR 0016/FR-032, cả hai
file đã bị gỡ ở `eef3f4a`, xem ghi chú đầu plan) chỉ định sẵn — không phải chord tôi tự chọn, xem §5.
`⌘⇧M` (FR-033, "Move pane to…") **không xuất hiện trong bảng trên vì plan này không implement nó**
— xem §3.

---

## §2. Quyết định KHÔNG cấp chord riêng (và bằng chứng)

Theo đúng yêu cầu "đừng đề xuất phím cho có" — với mỗi mục Nhóm B của brief, dưới đây là quyết định
và bằng chứng, không phải suy đoán.

### 2a. Mở workspace bằng `⌘O` toàn cục — KHÔNG cần, đã full-keyboard

`open-board.tsx:335-341` xác nhận `⌘O` nội bộ (`pickFolder()`) chỉ chạy khi board đang mở. Nhưng
`⌘T` (action `new-tab`, đã có sẵn) đã mở board bằng phím trong một lần bấm
(`tab-manager.ts` `commands["new-tab"]`), và board mặc định vào section "workspace" trước tiên
(`open-board.tsx`'s `BoardSection` union thứ tự `"workspace" | "layout" | "agent"`). Vậy toàn bộ
luồng "mở một folder mới" đã 100% keyboard-reachable: `⌘T` → `⌘O` → chọn folder, không cần chuột ở
bước nào. Thêm một `⌘O` global làm alias-y-hệt-`⌘T` sẽ là hai chord cho đúng một hiệu ứng — vi phạm
chính nguyên tắc "chord khan hiếm". Không làm.

### 2b. Đổi `tabBarPosition` / cycle theme / toggle pane bar / toggle agent notifications — KHÔNG

Cả bốn đều là preference toggle tần suất thấp (đổi 1 lần rồi để nguyên hàng tuần/tháng), đã
keyboard-reachable qua `⌘,` (toggle-settings) → điều khiển trong Settings panel
(`settings-panel.tsx`'s `cycleTheme`/`cycleTabBar`, `ToggleRow` cho `showPaneBar`/
`agentNotifications`). Khác các mục Nhóm A (drag/resize/reorder), đây KHÔNG phải "mouse-only" — chỉ
là "không có global shortcut riêng", đúng loại việc mà plan palette/cheat-sheet sau này nên làm
(mỗi entry registry đã sẵn `label` cho việc đó). Không thêm chord ở đây.

### 2c. Respawn pane sau khi session chết — KHÔNG cần, đã hoạt động qua Enter

`terminal-manager.ts:141` — `onWriteWhileExited(id, data) { if (data === "\r") { void respawn(id); }
}`. Dòng chữ "press Enter to start a new one" (`terminal-manager.ts:232`) không phải copy suông —
gõ Enter khi pane đó có focus **đã** respawn nó. Kết hợp với các action focus-pane hiện có
(`⌘]`/`⌘[`/`⌘⌥`+arrows/`⌘1`…`9`), một pane đã-chết ở bất kỳ tab nào cũng tới được và respawn được
hoàn toàn bằng phím. Không phải gap thật — không làm gì thêm.

### 2d. Resize split bằng phím — KHÔNG tự thiết kế trong plan này (đề xuất brainstorm riêng)

Không có quyết định/spec nào định nghĩa sẵn (khác Swap — có một quyết định cụ thể, trước đây ghi ở
FR-032, file đã gỡ). Đã đọc `layout-engine.ts`: ratio sống
trên **path trong split-tree** (`onRatioCommit(path, ratio)`), còn `focusDirection`/swap dùng
`nearestInDirection` — **hình học rects**, không phải path cây. Hai mô hình khác nhau: xác định
"resize theo hướng nào" đòi hỏi tìm split-node tổ tiên chung giữa pane đang focus và neighbor hình
học của nó, một bài toán tra cứu cây **chưa có utility nào giải sẵn** trong repo — khác hẳn Swap
(chỉ cần `nearestInDirection` + `swapLeaves`, cả hai đã có). Ngoài ra còn nhiều câu hỏi UX chưa có
câu trả lời duy nhất hiển nhiên: bước nhảy mỗi lần bấm bao nhiêu, có "resize mode" với chỉ báo trực
quan hay discrete-press, giữ nguyên `RATIO_MIN`/`RATIO_MAX` (0.15/0.85) hay khác. Theo W1 (việc
creative mới → brainstorm trước khi code), plan này **không tự quyết** — đề xuất một phiên
brainstorm riêng (có thể ra một quyết định ghi lại rõ ràng, kiểu cách Swap từng được quyết định
trước đây) trước khi viết plan implementation.

### 2e. Reorder tab bằng kéo-thả + phím — KHÔNG làm trong plan này (net-new, không phải parity)

Xác nhận lại bằng chứng: `grep -rn "draggable|dragstart|reorder" src/ui/tab-bar.tsx
src/ui/workspace-sidebar.tsx` → rỗng. Đây là trường hợp DUY NHẤT thiếu **cả hai** trục (không có
đường chuột nào để "cho phím parity" theo). Phạm vi của plan này là đóng khoảng cách bàn phím cho
hành vi ĐÃ có bằng chuột (nguyên tắc chuột và bàn phím đều first-class đọc đúng nghĩa "cả hai đều
first-class", không phải "phát minh tính năng mới"). Xây cả kéo-thả (mouse) lẫn phím cho reorder là một tính năng trọn vẹn mới, ngoài
"vá khoảng trống parity" — đề xuất brainstorm/plan riêng, không nhét vào đây (W3).

### 2f. Copy CWD / copy path — LÀM (xem Task 3), không cần brainstorm

Khác 2d/2e, đây không có bề mặt thiết kế mở: đúng một target (CWD của pane đang focus, đã có sẵn
qua `poller.infoFor(id)?.cwd`), đúng một hành động (ghi clipboard), không có câu hỏi UX nào cần
người quyết. Xử lý như một task implementation bình thường, không cần brainstorm riêng.

---

## §3. Multi-window / "Move to window" — mức độ hoàn thiện (điều tra theo yêu cầu)

**Kết luận: hạ tầng gần như 0% ở phía dùng được, và có audit rất mới (2026-07-26, hôm qua) đã đề
xuất chính thức hoãn nó khỏi v1 — plan này KHÔNG implement `⌘⇧M`/"Move pane to…" dù trước đây FR-033
đã định sẵn chord này.**

Bằng chứng đã tự xác minh:

- **Rust**: `src-tauri/src/coordinator.rs` có `WindowCoordinator::move_ownership` +
  `#[tauri::command] move_pane_ownership` (dòng 36-45, 77-88) — tồn tại và có unit test
  (`move_ownership_updates_label`). Nhưng `panes_for_window` mang
  `#[allow(dead_code)] // used when multi-window close lands` (dòng 48) — tự nhận chưa dùng.
  `grep -rn "move_pane_ownership" src` (frontend TypeScript) → **rỗng**. Command tồn tại, không ai
  gọi.
- **Frontend**: `grep -rn "WebviewWindow\|moveToWindow\|move_to_window" src` → rỗng ngoài comment.
  Không có UI "Move pane to…" popover nào (`grep -n "Move pane to\|Move to window" src/` → rỗng).
- **Config**: `src-tauri/tauri.conf.json`'s `"windows"` khai đúng MỘT window (`title: "SpaceVibe
Deck"`). Không "New Window" trong `menu.rs` hiện tại (chỉ `quit`/`action:*`/`new-preset`/
  `save-preset`).
- **Docs**: Trước khi bị gỡ, ADR 0012 ("Multi-window workspace model") tuyên bố "v1 is
  multi-window" — mâu thuẫn thẳng với bằng chứng code ở trên. `docs/review/findings-doc-reality-
drift-2026-07-26.md` §3.3 (file này vẫn còn tồn tại trong `docs/review/`, không bị gỡ) đã viết
  sẵn một ADR DRAFT 0030 "Single-window v1; multi-window and cross-window move deferred" (supersede
  0012), với decision text: _"v1 là single-window... Cross-window move và 'Move pane to…' popover
  chuyển sang 'Later'"_ — bản thân file 0030 đó **chưa bao giờ tồn tại** (chỉ là đề xuất trong audit,
  đang chờ người quyết ở §5 của audit đó). **Cập nhật sau khi viết plan này**: `eef3f4a` đã gỡ toàn
  bộ `docs/decisions/` — kể cả ADR 0012 gốc — nên câu hỏi "0012 có superseded hay không" không còn
  đối tượng nào để trả lời nữa. Kết luận thực chất không đổi: bằng chứng code (coordinator.rs/
  tauri.conf.json/menu.rs ở trên) vẫn xác nhận multi-window chưa build gì cả, và khuyến nghị "hoãn
  khỏi v1" của audit đó (file vẫn còn, đọc được) vẫn là đánh giá hợp lý nhất hiện có — chỉ là không
  còn đi qua con đường ADR nào để chính thức hoá.

Kết luận cho plan này: `⌘⇧M`/FR-033 (spec cũ, đã gỡ) không phải "thiếu keyboard access cho tính năng
có sẵn" (khác Swap) — nó là "keyboard access cho một tính năng CHƯA TỒN TẠI". Bind một chord cho một
no-op sẽ tự mâu thuẫn với chính mục tiêu của plan (không đề xuất phím cho có). **Đề xuất cụ thể**:
một khi người dùng chốt giữ single-window cho v1 (hướng phác thảo 0030 ở trên, giờ không còn ADR
nào để nộp) — hoặc ngược lại chọn thật sự build multi-window (đảo hướng ADR 0012 cũ) — tách "Move
pane to…" (`⌘⇧M`, popover, Rust coordinator wiring) thành một plan riêng, độc lập với plan
keyboard-parity này (khối lượng việc lớn hơn nhiều một task phím tắt: cần dựng `WebviewWindow`
creation, popover UI liệt kê destination, wiring `move_pane_ownership` từ frontend, và toàn bộ luồng
di chuyển pane giữa cửa sổ).

---

## §4. Phạm vi

**Làm trong plan này** (Task 1-6 dưới):

- `swap-left/right/up/down` — quyết định trước đó ghi ở FR-032/ADR 0016 (file đã gỡ), `⌘⌥⇧`+arrows.
- `open-tab-options` — mở popover đổi tên/màu dot của tab đang active bằng phím, `⌘⇧R`.
- `copy-cwd` — copy CWD của pane active vào clipboard, qua `⌘⇧C` hoặc menu Edit ▸ "Copy Working
  Directory" — action duy nhất trong 4 cái được người dùng chốt cho có menu item, xem §5. Dependency
  riêng: action-registry.md Task 1–6 (ba action còn lại chỉ cần Task 1–3).
- `scroll-page-up/down`, `scroll-to-top/bottom` — scrollback bằng phím, `⇧PageUp/PageDown/Home/End`.
- Cập nhật `README.md` bảng shortcut.

**KHÔNG làm** (nêu rõ ở §2/§3, để người khác quyết hoặc brainstorm riêng):

- Resize split bằng phím (§2d) — cần brainstorm/ADR riêng trước.
- Reorder tab kéo-thả + phím (§2e) — net-new feature, không phải parity gap.
- `⌘⇧M` "Move pane to…" (§3) — hạ tầng multi-window chưa tồn tại, chờ người dùng chốt hướng
  single-window-v1 (draft 0030) hay build multi-window thật — xem §3.
- `⌘O` global, chord riêng cho tabBarPosition/theme/pane-bar/notifications toggle (§2a, §2b) — đã
  keyboard-reachable, thêm chord là dư thừa.
- Sửa trạng thái FR-032/033 hay tạo ADR mới — các file đó (`REQUIREMENTS.md`, `docs/decisions/`)
  đã bị gỡ hoàn toàn ở `eef3f4a` cùng với toàn bộ pipeline ADR-first, nên câu hỏi này tự nó không
  còn đối tượng; nơi ghi nhận tài liệu tương lai (nếu có) là quyết định của người dùng, không phải
  của plan này. Chỉ cập nhật `README.md` (liệt kê factual, không qua pipeline nào).
- Bất kỳ đổi gì trong `src-tauri/` hay `action-registry.md`.

---

## §5. Quyết định đã chốt, rủi ro

### Quyết định đã chốt

- Chord của `swap-*` (`⌘⌥⇧`+arrows) không phải tự chọn — lấy nguyên từ quyết định "Pane swap" đã có
  từ trước (trước đây ghi ở FR-032 AC-1/UX-DESIGN §"Pane swap", phê duyệt qua ADR 0016 từ
  2026-07-09 — cả ba file đã bị gỡ ở `eef3f4a`, nội dung quyết định giữ nguyên trong Task 1). Task 1
  chỉ là implement, không phải quyết định sản phẩm mới.
- 4 action mới đều KHÔNG có menu item — đúng nhóm với `focus-*`, không cần đường chuột mới vì hành
  vi đích đã discoverable bằng chuột từ trước (§Global Constraints).
- `open-tab-options` dùng lại nguyên `openPopover`/`TabPopover` đã có — không thiết kế UI mới, chỉ
  thêm đường kích hoạt bằng phím cho UI đã tồn tại.

### Discoverability của 4 action mới — đánh đổi có ý thức, không phải hệ quả phụ

"Không có menu item" ở trên KHÔNG có nghĩa là 4 action này đóng trọn nguyên tắc chuột và bàn phím
đều first-class. Nguyên tắc đó đọc đúng nghĩa là parity về CẢ khả năng lẫn khả năng tìm thấy. Với 3 trong 4 action (`swap-*`,
`open-tab-options`, `scroll-*`), điều đó ổn: mỗi action đều đã có sẵn một đường chuột riêng
(drag-dock, click-tab mở popover, trackpad/scrollbar) — phím chỉ là đường THỨ HAI cho hành vi đã
discoverable, đúng khung "parity" của plan, không menu item cũng không mất gì. `copy-cwd` KHÔNG nằm
trong nhóm này — trước khi implement nó là action DUY NHẤT không có bất kỳ đường chuột nào (§2f đã
xác nhận "chưa có" cả hai trục lúc viết task) — để nguyên "không menu item" như 3 action kia sẽ làm
nó hoàn toàn vô hình với người dùng chuột, không phải thiếu nửa discoverability mà là tính năng
không tồn tại với họ.

**Quyết định cuối cùng cho `copy-cwd`, đã người dùng chốt**: KHÔNG còn là ngoại lệ vô hình nữa —
Task 3 cho nó hai bề mặt: `⌘⇧C` và menu item Edit ▸ "Copy Working Directory" (đi qua cầu
`action:`/`runAction` như mọi item khác, không event Tauri riêng). Cái giá: dependency của riêng
Task 3 kéo dài tới Task 1–6 của action-registry.md (cần cầu `action:` hợp nhất từ Task 4, và hạ tầng
đối chiếu `EDIT_MENU_ITEMS`/Rust test từ Task 5–6), khác ba task còn lại của plan này (swap, tab
options, scrollback) vẫn chỉ cần Task 1–3 và có thể chạy sớm, không phải đợi. Với 3 action còn lại,
đường chuột sẵn có (drag-dock/click-tab/trackpad) vẫn là đủ — không thêm menu item, giữ nguyên lập
luận "nửa bàn phím còn thiếu". Một ý tưởng thứ ba (click-to-copy trên CWD text ở pane header) từng
được đưa thẳng vào Task 3 rồi rút lại — đây KHÔNG phải một phần đã duyệt, chuyển thành đề xuất riêng
ở §7, người dùng sẽ quyết độc lập.

Vị trí menu gợi ý cho người thực thi sau, cho 3 action còn lại nếu vẫn muốn thêm menu item — không
làm trong plan này:

- `swap-left/right/up/down` — **không đề xuất thêm** dù có vị trí (View, cạnh Split/Zoom). Lý do:
  đây là 4 biến thể một hướng, giống hệt cấu trúc `focus-left/right/up/down` — chính action đó cũng
  cố ý không có menu item (không ai liệt kê 4 hướng rời rạc trong một menu item đơn), swap nên theo
  đúng tiền lệ của sibling gần nhất, không phải theo split-row/split-column (chỉ 2 biến thể, ghép
  đôi tự nhiên thành một cặp menu item).
- `open-tab-options` → **File**, cạnh nhóm vòng đời tab (New Tab/Reopen Tab) — KHÔNG còn đề xuất
  Window như bản trước, vì người dùng vừa chốt **chuyển cả `new-preset`/`save-preset` từ Window sang
  File** (đúng nhận định HIG đã nêu ở task trước: tạo/lưu thuộc File, Window chỉ nên quản lý cửa sổ
  thuần tuý — minimize/maximize/fullscreen). Rename/dot-color cũng là thao tác trên TAB, không phải
  window, nên cùng logic đó áp dụng: đặt cạnh New Tab/Reopen Tab trong File hợp lý hơn nhét vào
  Window (nơi giờ không còn action nào khác liên quan tab/document cả). Chord `⌘⇧R` không đổi nếu
  thêm sau — vẫn `CharKeyBinding` (`key: "r"`) theo đúng luật §0.
- `scroll-page-up/down`, `scroll-to-top/bottom` — **không đề xuất thêm**, cùng lý do với swap (4
  biến thể directional, trackpad/scrollbar đã là đường chuột đầy đủ và trực quan hơn bất kỳ menu
  item nào có thể diễn đạt).

### Rủi ro

- **OS-level key interception**: không unit test nào (jsdom) phát hiện được nếu macOS/WKWebView giữ
  lại một chord trước khi tới webview. `⌘⌥⇧`+arrows cùng họ modifier với `⌘⌥`+arrows đã shipped ổn
  định (focus-direction) nên rủi ro thấp; `⌘⇧R`/`⌘⇧C`/`⇧PageUp`/`⇧PageDown`/`⇧Home`/`⇧End` không
  thuộc tổ hợp nào biết là bị macOS/Mission Control/VoiceOver (`⌃`+arrows, `⌃⌥`) giữ trước. Vẫn cần
  xác nhận thủ công ở Task 6 (không tin unit test một mình).
- **`⇧Home`/`⇧End` có thể được một số shell/readline dùng cho text selection trong dòng lệnh đang
  gõ** — chấp nhận được: `handleShortcut` chạy ở capture phase TRƯỚC khi event tới PTY (đã đọc code
  xác nhận thứ tự), nên đây là một override có chủ đích giống `⌘F` đã override "find in page" của
  trình duyệt — không phải bug, là trade-off đã biết, ghi rõ trong Task 4.
- **Đối chiếu hai lần với `action-registry.md`**: plan song song đang được viết lại nhiều lần bởi
  agent khác (đã qua 2 đợt commit land giữa chừng, xem chính plan đó §1) và một agent thứ ba
  (`fix-settings-shortcut`) cũng đang sửa `keymap.ts` độc lập (thêm `find-next`/`find-previous`,
  `⌘G`/`⌘⇧G`, uncommitted lúc viết plan này). Rủi ro không phải xung đột cụ thể (đã kiểm chứng lại,
  không còn) mà là bảng chord §1 có thể lệch nếu có commit mới hơn hạ cánh sau khi plan này được
  duyệt. Task 1 phải chạy lại `git log --oneline -5` và đối chiếu `keymap.ts`/`action-registry.ts`
  hiện tại với bảng ở §1 trước khi thêm binding nào — không tin bảng đã viết sẵn nếu có commit mới.
- **Đề xuất click-to-copy CWD ở §7 (chưa duyệt, không thuộc Task 3) sẽ không đi qua
  `dispatchAction`/`overlayBlocksAction`** nếu sau này được triển khai — khác action bàn phím, một
  `click` listener gắn thẳng lên phần tử CWD trong pane header không có scope guard nào. Ghi lại ở
  đây để người quyết có đủ thông tin: chấp nhận được về lý thuyết vì lý do vật lý, không phải bỏ
  sót — `overlayBlocksAction` tồn tại chính vì Open board/Settings/PresetEditor/SaveDialog **che
  phủ** terminal grid, cùng lý do đó khiến phần tử CWD không nằm trong luồng pointer event khi một
  overlay đang mở. Nếu §7 được duyệt và triển khai, cần một bước verify thủ công xác nhận đúng giả
  định này, không chỉ tin logic suông.

---

## §6. Các task

### Task 1: Swap pane theo phím (FR-032)

**File(s)**:

- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)
- [terminal-manager.test.ts](../../src/terminal/terminal-manager.test.ts)
- [action-registry.ts](../../src/terminal/action-registry.ts)
- [action-registry.test.ts](../../src/terminal/action-registry.test.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: action-registry.md Task 1–3 (registry tồn tại, `keymap.ts` phái sinh từ nó,
`overlayBlocksAction` đọc `scope` từ registry).

**Decision**: `TerminalManager` có `swapDirection(dir: FocusDirection): void` — hàng xóm mới cạnh
`focusDirection` đã có (không sửa `focusDirection`). Tái dùng đúng `nearestInDirection` (đã dùng bởi
`focusDirection`, `pane-geometry.ts`) để tìm neighbor, và `swapLeaves` (đã dùng bởi
`pane-drag.ts`'s `onSwap` qua closure ở `terminal-manager.ts:451-464`) để đổi vị trí hai leaf — đúng
yêu cầu FR-032 AC-1 "using the same neighbor resolution as shipped directional focus". Không neighbor
theo hướng đó → no-op (FR-032 AC-3, giống `focusDirection` khi không có target). Focus theo pane
sau khi swap (FR-032 AC-2) — vì `activeId` không đổi (chỉ đổi slot), chỉ cần `render()` rồi
`life.panes.get(activeId)?.focus()`.

**Build**:

`terminal-manager.ts` — thêm vào interface `TerminalManager` (cạnh `focusDirection`, dòng ~80):

```ts
/** Swap the active pane with its neighbor in a direction; no neighbor there → no-op. */
swapDirection(dir: FocusDirection): void;
```

Implementation (cạnh `focusDirection`, dòng ~337-349):

```ts
function swapDirection(dir: FocusDirection): void {
  if (!tree || activeId === null) {
    return;
  }
  const target = nearestInDirection(layout.slotRects(), activeId, dir);
  if (target === null) {
    return; // no neighbor in that direction — FR-032 AC-3
  }
  const next = swapLeaves(tree, activeId, target);
  if (next === tree) {
    return;
  }
  tree = next;
  render();
  // activeId is unchanged (only its slot moved) — focus follows it (FR-032 AC-2).
  life.panes.get(activeId)?.focus();
  callbacks.onLayoutChange();
}
```

Thêm `swapDirection` vào object trả về ở cuối factory (cạnh `focusDirection`, dòng ~490).

`action-registry.ts` — thêm 4 hàng vào `ACTION_REGISTRY` (cạnh nhóm `focus-left/right/up/down`,
không có `menu`):

```ts
{ id: "swap-left", label: "Swap Pane Left", scope: "terminal" },
{ id: "swap-right", label: "Swap Pane Right", scope: "terminal" },
{ id: "swap-up", label: "Swap Pane Up", scope: "terminal" },
{ id: "swap-down", label: "Swap Pane Down", scope: "terminal" },
```

Thêm vào `DEFAULT_KEYMAP` (cạnh nhóm focus-left/right/up/down):

```ts
// Swap the focused pane with its neighbor — same
// direction keys as focus (⌘⌥), plus Shift for the "stronger" operation
// (same pattern as split-row ⌘D vs split-column ⌘⇧D). CharKeyBinding, same
// as focus-left/right/up/down above — no menu item and event.key for
// arrows ("ArrowLeft" etc.) is stable across layout/Shift, so `code` buys
// nothing here (§0's key-vs-code rule).
{ key: "arrowleft", meta: true, alt: true, shift: true, action: "swap-left" },
{ key: "arrowright", meta: true, alt: true, shift: true, action: "swap-right" },
{ key: "arrowup", meta: true, alt: true, shift: true, action: "swap-up" },
{ key: "arrowdown", meta: true, alt: true, shift: true, action: "swap-down" },
```

`tab-manager.ts` — thêm 4 closure vào `commands` (cạnh `"focus-left"`…`"focus-down"`):

```ts
"swap-left": () => activeManager()?.swapDirection("left"),
"swap-right": () => activeManager()?.swapDirection("right"),
"swap-up": () => activeManager()?.swapDirection("up"),
"swap-down": () => activeManager()?.swapDirection("down"),
```

Không sửa `overlayBlocksAction` — 4 action mới không nằm trong danh sách `"always"`, mặc định
`"terminal"` (đúng, vì swap thao tác trực tiếp trên terminal grid).

**Verify**:

- `terminal-manager.test.ts` — test mới:
  - `swapDirection` đổi đúng vị trí hai pane khi có neighbor (dùng `swapLeaves` để assert cây kết
    quả), focus vẫn ở pane vừa gọi swap (id không đổi, chỉ slot đổi).
  - Không neighbor theo hướng đó → cây không đổi, không gọi `render()`/`callbacks.onLayoutChange()`
    thừa (assert bằng spy).
  - `layout.zoomedId() !== null` trước khi swap — xác nhận hành vi giống `focusDirection` (không tự
    unzoom trừ khi `setActive` được gọi; ghi rõ nếu có khác biệt cố ý).
- `action-registry.test.ts` — test không-trùng-chord (đã có từ action-registry.md Task 1) tự động
  bao phủ 4 hàng mới; chạy `npm test -- action-registry` xác nhận vẫn pass (không hàng nào trùng
  `code`+modifier với hàng khác).
- `tab-manager.test.ts` — test mới: `runAction("swap-left")` gọi đúng `swapDirection("left")` trên
  active manager; bị `overlayBlocksAction` chặn khi `settingsOpen.value = true` (giống pattern test
  `save-preset` ở action-registry.md Task 4).
- `npm run build && npm test` pass.

---

### Task 2: Mở popover đổi tên/màu dot của tab active bằng phím (`⌘⇧R`)

**File(s)**:

- [tabs-store.ts](../../src/terminal/tabs-store.ts)
- [tab-bar.tsx](../../src/ui/tab-bar.tsx)
- [tab-bar.test.tsx](../../src/ui/tab-bar.test.tsx)
- [workspace-sidebar.tsx](../../src/ui/workspace-sidebar.tsx)
- [workspace-sidebar.test.tsx](../../src/ui/workspace-sidebar.test.tsx)
- [action-registry.ts](../../src/terminal/action-registry.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: action-registry.md Task 1–3.

**Decision**: Không thiết kế UI mới — dùng lại nguyên `TabPopover`/`openPopover` đã có ở
`workspace-sidebar.tsx:127-130` (hàm đã được extract sẵn ở đó; `tab-bar.tsx` hiện inline logic
tương đương trong `onClick`, task này extract nó ra một hàm cùng tên để hai bên đối xứng). Vì
`TabBar` và `WorkspaceSidebar` chỉ MỘT trong hai được mount tại một thời điểm (theo
`settings.value.tabBarPosition`) và mỗi bên tự giữ `popover` signal riêng (local, không global), một
action bàn phím cần một kênh chung để "yêu cầu mở" mà không cần biết bên nào đang mount — thêm một
signal chia sẻ `requestTabOptionsKey` trong `tabs-store.ts` (cùng chỗ với `activeTabIndex`/
`tabViews` đã có), mỗi chrome component tự `useSignalEffect` lắng nghe và tự tiêu thụ (set về
`null` sau khi xử lý) — không cần ref-forwarding hay imperative handle mới.

**Build**:

`tabs-store.ts` — thêm signal (cạnh `activeTabIndex`, dòng ~74):

```ts
/**
 * Tab whose rename/dot-color popover a keyboard action (⌘⇧R, open-tab-options)
 * wants opened next. Set by TabManager, consumed and reset to null by
 * whichever chrome component (TabBar or WorkspaceSidebar) is currently
 * mounted — only one renders at a time (Settings' tabBarPosition), so there
 * is exactly one consumer per request.
 */
export const requestTabOptionsKey = signal<number | null>(null);
```

`tab-bar.tsx` — thêm `useRef` cho root, extract `openPopover`, thêm `data-key`, thêm
`useSignalEffect`:

```tsx
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import {
  activeTabIndex,
  IDLE_ATTENTION_SUMMARY,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
// ... trong component, cạnh khai báo popover signal:
const rootRef = useRef<HTMLElement>(null);

function openPopover(key: number, anchorEl: HTMLElement): void {
  const rect = anchorEl.getBoundingClientRect();
  popover.value = { key, left: rect.left, top: rect.bottom + 6, anchorEl };
}

useSignalEffect(() => {
  const key = requestTabOptionsKey.value;
  if (key === null) {
    return;
  }
  const anchorEl = rootRef.current?.querySelector<HTMLElement>(
    `[data-key="${key}"]`,
  );
  if (anchorEl) {
    openPopover(key, anchorEl);
  }
  requestTabOptionsKey.value = null; // consumed — reset so it doesn't re-fire
});
```

Gắn `ref={rootRef}` vào `<header class="tabbar" ...>`; thêm `data-key={tab.key}` vào div `role="tab"`
(cạnh `key={tab.key}` hiện có); thay thân `onClick` bằng gọi `openPopover(tab.key, anchorEl)` thay vì
logic inline hiện tại (giữ nguyên nhánh "second click toggles off" và "inactive tab: select"):

```tsx
onClick={(event) => {
  if (index !== active) {
    props.onSelectTab(index);
    return;
  }
  if (popover.value?.key === tab.key) {
    popover.value = null;
    return;
  }
  openPopover(tab.key, event.currentTarget as HTMLElement);
}}
```

`workspace-sidebar.tsx` — cùng pattern, nhưng `openPopover` đã tồn tại sẵn (dòng 127-130) nên chỉ
cần thêm ref + effect:

```tsx
import { useSignalEffect } from "@preact/signals";
import { requestTabOptionsKey } from "../terminal/tabs-store";
// ... cạnh khai báo dragOverKey/popover:
const navRef = useRef<HTMLElement>(null);

useSignalEffect(() => {
  const key = requestTabOptionsKey.value;
  if (key === null) {
    return;
  }
  const anchorEl = navRef.current?.querySelector<HTMLElement>(
    `[data-key="${key}"]`,
  );
  if (anchorEl) {
    openPopover(key, anchorEl);
  }
  requestTabOptionsKey.value = null;
});
```

Gắn `ref={navRef}` vào `<nav class="wsbar" ...>` — `data-key={tab.key}` đã tồn tại sẵn ở dòng 106,
không cần thêm.

`action-registry.ts` — thêm 1 hàng, không `menu`:

```ts
{ id: "open-tab-options", label: "Rename Tab / Dot Color…", scope: "terminal" },
```

`DEFAULT_KEYMAP`:

```ts
// Opens the same rename/dot-color popover the tab click already opens —
// TabPopover itself is unchanged, this only adds the keyboard trigger.
// CharKeyBinding: no menu item, and "r" is a letter mnemonic, not a
// Shift/layout-dependent punctuation char (§0's key-vs-code rule).
{ key: "r", meta: true, shift: true, action: "open-tab-options" },
```

`tab-manager.ts` — `commands`:

```ts
"open-tab-options": () => {
  const tab = tabs[active];
  if (tab) {
    requestTabOptionsKey.value = tab.key;
  }
},
```

(import `requestTabOptionsKey` từ `./tabs-store`, cạnh `activeTabIndex`/`tabViews` đã import.)

**Verify**:

- `tab-bar.test.tsx` — test mới: set `requestTabOptionsKey.value = tab.key` cho tab đang active →
  popover mở đúng anchor; set key của một tab không tồn tại trong DOM hiện tại → không throw, signal
  vẫn reset về `null`; giữ nguyên toàn bộ test click cũ (không sửa assertion).
- `workspace-sidebar.test.tsx` — test tương tự.
- `tab-manager.test.ts` — `runAction("open-tab-options")` set đúng `requestTabOptionsKey.value` bằng
  key của tab active; bị `overlayBlocksAction` chặn khi có overlay mở.
- Regression: `npm test -- tab-bar workspace-sidebar tab-popover` — không sửa assertion nào của test
  click hiện có.
- `npm run build && npm test` pass.
- Manual (`npm run tauri dev`): `⌘⇧R` mở đúng popover của tab đang active ở cả hai chrome mode
  (`tabBarPosition: "top"` và `"left"`); rename input tự động focus (hành vi có sẵn của
  `TabPopover`, không đổi).

---

### Task 3: Copy CWD của pane — phím `⌘⇧C` + menu item Edit

**File(s)**:

- [action-registry.ts](../../src/terminal/action-registry.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)
- [menu.rs](../../src-tauri/src/menu.rs)

**Phụ thuộc**: action-registry.md **Task 1–6** (không phải Task 1–3 như ba task còn lại của plan
này — Task 1, Task 2, Task 4 vẫn chỉ cần Task 1–3, có thể chạy sớm không cần đợi). Lý do cần thêm
Task 4–6: `copy-cwd` có menu item, phải đi qua đúng cầu `action:`/`runAction` (Task 4 — cùng cầu mà
`new-preset`/`save-preset` được hợp nhất vào, không tạo Tauri event riêng theo đúng anti-pattern
Task 4 đang dọn), và Edit là 1 trong 3 submenu pha Cocoa builtin viết tay có Rust test đối chiếu với
`EDIT_MENU_ITEMS` sinh từ registry (Task 5 sinh const, Task 6 wire + test đối chiếu) — thêm item vào
`menu.rs` mà không có hạ tầng đối chiếu đó là tự tạo nợ kỹ thuật, đúng vấn đề gốc mà cả hai plan
đang giải.

**Decision — quyết định của người dùng, không phải lựa chọn của plan**: `copy-cwd` là action DUY
NHẤT trong 4 action của plan này không có sẵn bất kỳ bề mặt chuột nào trước đây — khác
`swap`/`open-tab-options`/`scroll` vốn đã có drag-dock/click-tab/trackpad, nơi phím chỉ là đường thứ
hai. Sau khi được cho biết cái giá cụ thể (dependency Task 1–6 thay vì 1–3, vì phải đi qua cầu
`action:` hợp nhất + hạ tầng đối chiếu Edit menu), người dùng đã chọn: **`copy-cwd` có menu item ở
Edit**, cạnh Find…/Clear Buffer (đúng nhóm ngữ nghĩa "thao tác trên nội dung/pane"), chấp nhận cái
giá đó. Hai bề mặt trong task này: `⌘⇧C` (pane active) và menu Edit ▸ "Copy Working Directory" (đi
qua `action:`/`runAction`, dùng lại đúng `commands["copy-cwd"]` — không có closure/logic riêng cho
đường menu, không tạo Tauri event riêng). Không cần plugin clipboard mới —
`navigator.clipboard.writeText` là Web API chuẩn, hoạt động trong WKWebView với user-gesture context
(`keydown` là user gesture hợp lệ; native menu accelerator KHÔNG qua webview keydown nhưng
`runAction`→`dispatchAction`→cùng `commands["copy-cwd"]` closure nên vẫn cùng code path). CWD đã
được poll sẵn (`poller.infoFor(id)?.cwd`, dùng bởi `freshCwd` ở `tab-manager.ts:632`) — không cần
IPC command mới. Lỗi ghi clipboard báo qua `notifyError` đã có trên `TerminalManager`, không nuốt
lỗi lặng lẽ (C5/C6). Không thêm feedback trực quan kiểu "Copied!" — quyết định tối giản có chủ đích
(YAGNI): lỗi đã có `notifyError`, còn thành công thì im lặng giống hành vi `⌘C` chuẩn của hệ điều
hành.

**Ghi chú phạm vi**: một ý tưởng bổ sung (click-to-copy trên CWD text ở pane header) từng được đưa
vào task này rồi rút lại — đây là đề xuất CHƯA được duyệt, tách riêng ở "Đề xuất ngoài phạm vi" cuối
plan (§7), không phải một phần của Task 3.

**Build — phần phím (`⌘⇧C`)**:

`action-registry.ts` — thêm 1 hàng, CÓ `menu` (khác bản nháp trước — giờ đã chốt có menu item):

```ts
// Cạnh hàng "clear-buffer" (cùng submenu Edit).
{
  id: "copy-cwd",
  label: "Copy Working Directory",
  scope: "terminal",
  menu: { submenu: "Edit" },
},
```

`DEFAULT_KEYMAP`:

```ts
// "Copy" family cousin of ⌘C (bare Cmd+C stays the macOS Copy role) — same
// pattern as ⌘D split-row vs ⌘⇧D split-column: Shift makes it the pane-scoped
// variant instead of the text-selection one. CharKeyBinding: no menu item,
// "c" is a letter mnemonic (§0's key-vs-code rule).
{ key: "c", meta: true, shift: true, action: "copy-cwd" },
```

`tab-manager.ts` — extract một helper dùng chung cho cả phím lẫn click (cần `poller` đã sẵn có
trong closure — xác nhận bằng `poller.infoFor` đã dùng ở dòng 275/285/310):

```ts
/** Copy `id`'s polled CWD to the clipboard; no-op if unknown/not polled yet. */
function copyPaneCwd(id: number): void {
  const cwd = poller.infoFor(id)?.cwd ?? null;
  if (cwd === null) {
    return; // pane unknown, or CWD not polled yet — nothing to copy
  }
  navigator.clipboard.writeText(cwd).catch(() => {
    activeManager()?.notifyError("Couldn't copy the working directory");
  });
}
```

`commands` gọi helper với pane active (đường phím):

```ts
"copy-cwd": () => {
  const paneId = activeManager()?.activePaneId() ?? null;
  if (paneId !== null) {
    copyPaneCwd(paneId);
  }
},
```

**Build — phần menu (Edit ▸ Copy Working Directory)**:

`menu.rs` — thêm item vào `edit_menu` bằng `action_item()` sẵn có (đã hỗ trợ `Option<&str>` từ
action-registry.md Task 4), cạnh `find`/`clear_buffer`:

```rust
let copy_cwd = action_item(
    handle,
    "copy-cwd",
    "Copy Working Directory",
    Some("CmdOrCtrl+Shift+C"),
)?;
let edit_menu = SubmenuBuilder::new(handle, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .separator()
    .item(&find)
    .item(&clear_buffer)
    .item(&copy_cwd)
    .build()?;
```

Cập nhật `HAND_WRITTEN_EDIT` const trong `#[cfg(all(test, target_os = "macos"))] mod tests` (do
action-registry.md Task 6 tạo) — thêm đúng một dòng, giữ nguyên comment cảnh báo "sửa ở đây phải
cập nhật cả `action-registry.ts`":

```rust
const HAND_WRITTEN_EDIT: &[(&str, &str, Option<&str>)] = &[
    ("find", "Find…", Some("CmdOrCtrl+F")),
    ("clear-buffer", "Clear Buffer", Some("CmdOrCtrl+K")),
    ("copy-cwd", "Copy Working Directory", Some("CmdOrCtrl+Shift+C")),
];
```

Không sửa `app.tsx` — listener `menu:action` chung (từ action-registry.md Task 4) đã route mọi
`action:`-prefixed id, gồm `copy-cwd`, vào `tabsRef.current?.runAction(event.payload)` →
`dispatchAction` → `commands["copy-cwd"]` đã viết ở phần phím trên. Không tạo Tauri event riêng.

**Verify**:

- `tab-manager.test.ts` — test mới:
  - `runAction("copy-cwd")` gọi `writeText` với đúng CWD của pane active.
  - Không có pane active → không gọi `writeText`.
  - CWD chưa poll (`infoFor` trả `undefined`) → không gọi `writeText`, không throw.
  - `writeText` reject → `notifyError` được gọi với message không rỗng.
  - Bị `overlayBlocksAction` chặn khi có overlay mở (cả phím lẫn menu — cùng đi qua
    `dispatchAction`/`commands["copy-cwd"]`, nên cùng guard).
- `npm run build && npm test` pass.
- `cargo check --manifest-path src-tauri/Cargo.toml` pass.
- `cargo test --manifest-path src-tauri/Cargo.toml` pass, gồm `edit_menu_matches_registry` (từ
  action-registry.md Task 6) xanh với `HAND_WRITTEN_EDIT` đã cập nhật. Cố tình bỏ dòng `copy-cwd`
  khỏi `HAND_WRITTEN_EDIT`, chạy lại `cargo test`, xác nhận test đỏ — rồi thêm lại đúng (chứng minh
  lưới an toàn thực sự bắt được lệch, không phải test rỗng).
- Manual (`npm run tauri dev`):
  - `⌘⇧C` ở pane đang focus, dán ra ngoài — đúng path tuyệt đối.
  - Menu Edit ▸ "Copy Working Directory" — click item, dán ra ngoài — đúng CWD của pane active;
    accelerator hiện đúng `⇧⌘C` cạnh label trong menu bar.
  - Mở lần lượt Open board/Settings/PresetEditor/SaveDialog — xác nhận cả `⌘⇧C` lẫn menu item đều
    no-op đúng (overlay guard áp dụng cho cả hai đường như nhau).

---

### Task 4: Scrollback bằng phím (`⇧PageUp`/`⇧PageDown`/`⇧Home`/`⇧End`)

**File(s)**:

- [pane.ts](../../src/terminal/pane.ts)
- [pane.test.ts](../../src/terminal/pane.test.ts) (mới — đã xác nhận `test -f
src/terminal/pane.test.ts` → không tồn tại, chưa có suite nào cho module này)
- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)
- [terminal-manager.test.ts](../../src/terminal/terminal-manager.test.ts)
- [action-registry.ts](../../src/terminal/action-registry.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: action-registry.md Task 1–3.

**Bước 0 — xác minh hiện trạng trước khi viết code** (đã tra `node_modules/@xterm/xterm/lib/xterm.js`:
`PageUp`/`PageDown` chỉ xuất hiện như enum key-code, `scrollLines`/`scrollPages`/`scrollToTop`/
`scrollToBottom` chỉ là **public API method** trên `Terminal`, không thấy wiring mặc định nào từ
`_keyDown` sang các method đó — khác các terminal app khác (VS Code, Hyper) tự thêm binding này).
Kết luận nghiên cứu: khả năng cao xterm.js KHÔNG tự bind Shift+PageUp/Down/Home/End ra scroll theo
mặc định trong bản đang dùng. Nhưng grep tĩnh không thay thế được test runtime thật — **việc đầu
tiên của task này là xác nhận bằng `npm run tauri dev`**: mở một pane, in đủ output để có
scrollback, thử `⇧PageUp`/`⇧PageDown`/`⇧Home`/`⇧End` TRƯỚC khi sửa gì. Nếu xterm đã tự scroll đúng —
DỪNG task này, không thêm binding trùng, chỉ ghi lại phát hiện trong README/báo cáo thay vì code.
Phần dưới đây là đường triển khai cho trường hợp (nhiều khả năng hơn) xác nhận đúng là thiếu.

**Decision**: Thêm 2 method trên `Pane` — `scrollPage(dir: 1 | -1): void` và
`scrollToEdge(edge: "top" | "bottom"): void` — bọc mỏng quanh xterm's `Terminal.scrollPages`/
`scrollToTop`/`scrollToBottom` (public API đã xác nhận tồn tại), cùng pattern với `clear()` đã bọc
`term.clear()`. Không giữ tham chiếu `Terminal` ở tầng `TerminalManager` — theo đúng ranh giới hiện
có (`Pane` sở hữu xterm instance, `TerminalManager` chỉ gọi qua interface `Pane`).

**Build**:

`pane.ts` — thêm vào interface `Pane` (cạnh `clear()`, dòng ~47):

```ts
/** Scroll the viewport by one page; positive = down, negative = up. */
scrollPage(dir: 1 | -1): void;
/** Jump to the very top (oldest) or bottom (latest output) of scrollback. */
scrollToEdge(edge: "top" | "bottom"): void;
```

Implementation (cạnh `clear()`):

```ts
scrollPage(dir) {
  term.scrollPages(dir);
},
scrollToEdge(edge) {
  if (edge === "top") {
    term.scrollToTop();
  } else {
    term.scrollToBottom();
  }
},
```

`terminal-manager.ts` — thêm vào interface `TerminalManager` (cạnh `clearActive`):

```ts
/** Scroll the active pane's viewport by one page (⇧PageUp/⇧PageDown). */
scrollActivePage(dir: 1 | -1): void;
/** Jump the active pane's viewport to the top or bottom of scrollback. */
scrollActiveToEdge(edge: "top" | "bottom"): void;
```

Implementation (cạnh `clearActive`):

```ts
function scrollActivePage(dir: 1 | -1): void {
  if (activeId === null) {
    return;
  }
  life.panes.get(activeId)?.scrollPage(dir);
}

function scrollActiveToEdge(edge: "top" | "bottom"): void {
  if (activeId === null) {
    return;
  }
  life.panes.get(activeId)?.scrollToEdge(edge);
}
```

Thêm cả hai vào object trả về ở cuối factory.

`action-registry.ts` — thêm 4 hàng, không `menu`:

```ts
{ id: "scroll-page-up", label: "Scroll Up a Page", scope: "terminal" },
{ id: "scroll-page-down", label: "Scroll Down a Page", scope: "terminal" },
{ id: "scroll-to-top", label: "Scroll to Top", scope: "terminal" },
{ id: "scroll-to-bottom", label: "Scroll to Bottom (Latest Output)", scope: "terminal" },
```

`DEFAULT_KEYMAP`:

```ts
// Scrollback navigation — idiomatic terminal-app convention (iTerm2, VS
// Code integrated terminal both use Shift+Page*/Home/End for this). Plain
// PageUp/PageDown/Home/End are left untouched — they still reach the PTY
// for the shell/readline's own cursor handling. CharKeyBinding: no menu
// item, and event.key for these named keys ("PageUp" etc.) is stable
// across layout/Shift, same as "enter" above (§0's key-vs-code rule).
{ key: "pageup", shift: true, action: "scroll-page-up" },
{ key: "pagedown", shift: true, action: "scroll-page-down" },
{ key: "home", shift: true, action: "scroll-to-top" },
{ key: "end", shift: true, action: "scroll-to-bottom" },
```

`tab-manager.ts` — `commands`:

```ts
"scroll-page-up": () => activeManager()?.scrollActivePage(-1),
"scroll-page-down": () => activeManager()?.scrollActivePage(1),
"scroll-to-top": () => activeManager()?.scrollActiveToEdge("top"),
"scroll-to-bottom": () => activeManager()?.scrollActiveToEdge("bottom"),
```

**Verify**:

- Nếu Bước 0 xác nhận xterm đã tự làm đúng: KHÔNG chạy các bước Build ở trên; verify duy nhất là ghi
  lại phát hiện (link bằng chứng — bản ghi/mô tả thao tác thủ công) trong PR/commit message của task
  này, và bỏ qua các file `pane.ts`/`terminal-manager.ts`/`action-registry.ts`/`tab-manager.ts` khỏi
  diff. README (Task 5) vẫn thêm dòng shortcut vì hành vi vẫn đúng, chỉ nguồn gốc khác (xterm default
  thay vì code tự viết) — không thay đổi trải nghiệm người dùng.
- Nếu Bước 0 xác nhận thiếu (kỳ vọng chính, theo nghiên cứu tĩnh): chạy đủ code ở trên, rồi:
  - `pane.test.ts` (mới nếu chưa có) hoặc file test hiện có của `pane.ts`: `scrollPage`/
    `scrollToEdge` gọi đúng method tương ứng trên fake/mock `Terminal` (`scrollPages(1)`,
    `scrollPages(-1)`, `scrollToTop()`, `scrollToBottom()`).
  - `terminal-manager.test.ts`: `scrollActivePage`/`scrollActiveToEdge` no-op khi không có active
    pane; gọi đúng pane khi có.
  - `tab-manager.test.ts`: 4 action mới route đúng qua `commands`, bị `overlayBlocksAction` chặn khi
    có overlay.
  - `npm run build && npm test` pass.
  - Manual lại trong `npm run tauri dev`: `⇧PageUp`/`⇧PageDown`/`⇧Home`/`⇧End` scroll đúng; phím
    trần (không Shift) `PageUp`/`PageDown`/`Home`/`End` vẫn đi vào shell như trước (gõ trong một
    `less`/`vim` để xác nhận không bị app nuốt mất).

---

### Task 5: Cập nhật `README.md`

**File(s)**:

- [README.md](../../README.md)

**Phụ thuộc**: Task 1–4 (cần biết chord cuối cùng, gồm cả kết quả Bước 0 của Task 4).

**Decision**: Chỉ thêm dòng vào các bảng đã có (Panes/Tabs/Terminal & view — hoặc bảng tương đương
tại thời điểm implement, nếu README đã đổi cấu trúc giữa lúc viết và lúc chạy plan này) — không tạo
bảng mới, không đổi cấu trúc. Không tạo ADR/sửa file requirement nào — pipeline đó đã bị gỡ, lý do
ở §4.

**Build**:

Bảng "Panes" (`README.md`, sau dòng `⌘⌥ + ←→↑↓ | Focus pane by direction`):

```markdown
| ⌘⌥⇧ + ←→↑↓ | Swap pane with neighbor in that direction |
```

Bảng "Tabs" (sau dòng `⌘⇧S | Save layout as preset` đã có từ task trước):

```markdown
| ⌘⇧R | Rename tab / change dot color |
```

Bảng "Terminal & view" (sau dòng `⌘K | Clear buffer`):

```markdown
| ⌘⇧C | Copy pane's working directory |
| ⇧PgUp / ⇧PgDn | Scroll scrollback by page |
| ⇧Home / ⇧End | Scroll to top / latest output |
```

(Nếu Task 4's Bước 0 xác nhận xterm default đã đúng thay vì code tự viết, giữ nguyên 2 dòng scroll —
hành vi người dùng thấy giống hệt nhau, README mô tả trải nghiệm chứ không mô tả nguồn gốc
implementation.)

**Verify**:

- `rg -n "⌘⌥⇧|⌘⇧R|⌘⇧C|⇧PgUp|⇧Home" README.md` trả đủ 5 dòng mới.
- Đọc lại toàn bộ mục "## Keyboard shortcuts" — không dòng nào mô tả sai hành vi (đặc biệt: không
  ghi "Move pane to window" hay bất kỳ gì về multi-window — §3 đã loại khỏi phạm vi).

---

### Task 6: Xác minh toàn bộ

**File(s)**: Không sửa file trong task này.

**Phụ thuộc**: Task 1–5.

**Decision**: Không chấp nhận "unit test xanh" nếu chưa chạy build/test toàn repo và chưa xác minh
thủ công OS-level không giữ chord nào (rủi ro đã nêu ở §5, không unit test nào bắt được).

**Verify**:

- `npm run build` pass.
- `npm test` pass (toàn bộ suite, không chỉ file đã sửa — xác nhận không phá vỡ suite nào khác
  import `tabs-store`/`tab-manager`/`terminal-manager`/`pane`/`action-registry`).
- `npx tsc --noEmit` pass.
- `cargo check --manifest-path src-tauri/Cargo.toml` pass — **bắt buộc**, không chỉ lưới an toàn:
  Task 3 tự nó đã đổi `menu.rs` (menu item `copy-cwd` ở Edit).
- `cargo test --manifest-path src-tauri/Cargo.toml` pass, gồm `edit_menu_matches_registry`.
- `git status --porcelain=v1` — danh sách file đổi khớp đúng `File(s)` của Task 1–5 (cộng Task 4's
  file bị bỏ nếu Bước 0 kết luận không cần code), không file nào ngoài dự kiến bị chạm — riêng
  `menu.rs` CHỈ đổi ở đúng chỗ Task 3 mô tả (thêm `copy_cwd`/`.item(&copy_cwd)`/`HAND_WRITTEN_EDIT`),
  không lẫn với thay đổi khác của action-registry.md nếu nó cũng đang chạy song song.
- Chạy `npm run tauri dev`, xác minh thủ công đủ 4 nhóm:
  - `⌘⌥⇧←→↑↓` swap đúng pane, focus theo đúng pane vừa swap; không neighbor theo hướng đó → không
    có gì xảy ra (không log lỗi, không giật hình).
  - `⌘⇧R` ở cả hai `tabBarPosition` (`top`/`left`) mở đúng popover của tab active, rename + đổi màu
    dot hoạt động y hệt khi mở bằng chuột.
  - `⌘⇧C` và menu Edit ▸ "Copy Working Directory" đều copy đúng CWD của pane đang focus; thử ở một
    pane vừa `cd` sang thư mục khác — verify clipboard theo kịp CWD mới (không phải giá trị stale).
  - Scrollback (nếu Task 4 implement code): `⇧PageUp/PageDown/Home/End` hoạt động; phím trần vẫn
    vào shell bình thường.
  - Không có action nào trong 4 nhóm trên chạy được khi Open board/Settings/PresetEditor/SaveDialog
    đang mở (overlay guard áp dụng đúng cho cả phím lẫn menu — thử từng overlay một).
  - Gõ tiếng Việt (Telex) trong một pane — không phím mới nào ở trên vô tình chặn hay làm sai composition
    (đặc biệt `⇧Home`/`⇧End`/`⇧PageUp`/`⇧PageDown` không phải phím ký tự nên rủi ro thấp, vẫn xác
    nhận bằng mắt).

---

## §7. Đề xuất ngoài phạm vi — chưa được duyệt

Mục này ghi lại một ý tưởng nảy sinh trong lúc viết plan, **không phải một phần đã duyệt của Task
3** — từng bị đưa nhầm vào Task 3 rồi tách ra theo yêu cầu team lead. Không tự triển khai; chỉ nêu
đủ chi tiết để người dùng quyết độc lập, tách khỏi quyết định "menu Edit" đã chốt ở Task 3.

### Click-to-copy CWD trên pane header

**Ý tưởng**: pane header đã hiển thị CWD làm text tĩnh (`cwdEl` khi `showPaneBar: true`,
`anchorCwd` khi `false` — cả hai đã tồn tại trong `pane.ts:78-98`, không phải UI mới). Biến text đó
thành click-to-copy: click vào CWD ở header của BẤT KỲ pane nào (không chỉ pane đang focus) copy
đúng CWD của pane đó vào clipboard.

**Ưu điểm thật, không có ở `⌘⇧C`/menu Edit**: cả phím lẫn menu chỉ copy được CWD của pane **đang
active** — muốn copy CWD của một pane khác phải focus nó trước. Click-to-copy trên pane header xoá
bước đó: nhắm đúng pane muốn copy, không cần chuyển focus trước. Chi phí implementation thấp — 2
click listener + 1 CSS class trên element có sẵn, không đụng `menu.rs`/Rust, không plugin mới
(`navigator.clipboard.writeText`, cùng cơ chế Task 3 đã dùng).

**Rủi ro đã phát hiện, cần cân nhắc trước khi duyệt**: click listener gắn thẳng lên `cwdEl`/
`anchorCwd` sẽ KHÔNG đi qua `dispatchAction`/`overlayBlocksAction` — khác mọi action bàn phím/menu
trong plan này. Về lý thuyết vẫn an toàn vì lý do vật lý (overlay che phủ terminal grid nên phần tử
CWD không nằm trong luồng pointer event khi overlay mở), nhưng đây là giả định cần verify thủ công
trước khi coi là an toàn, không chỉ tin logic suông — xem bullet rủi ro tương ứng ở §5.

**Nếu được duyệt**: implement như một task riêng (không gộp vào Task 3), thêm `onCopyCwd?(id)` vào
`PaneEvents` (`pane.ts`), forward qua `PaneLifecycleDeps` (`pane-lifecycle.ts`) và
`ManagerCallbacks` (`terminal-manager.ts`) đúng pattern `onAttentionSignal` đã có, wire ở
`tab-manager.ts` gọi lại đúng helper `copyPaneCwd(id)` mà Task 3 đã tạo cho `⌘⇧C`/menu — không viết
logic copy CWD lần thứ hai.
