# OpenBoard hai cột native — rail recents + detail Layout/Agent

**Spec**: mock đã duyệt bằng mắt trong session (scratchpad `open-board-mock.html`, ảnh chốt 2026-07-27); các ràng buộc rút từ 3 báo cáo agent (state/keyboard/design) cùng ngày.
**Goal**: thay bố cục OpenBoard hiện tại (logo panel + cột phải 520px) bằng hai cột trong stage — rail 300px (recents xoá được, Open Folder ghim đáy) và detail (header workspace, lưới Layout thumbnail terminal-mini, hàng Agent, footer) — giữ nguyên toàn bộ đường bàn phím cũ.
**Architecture**: thuần Preact + CSS trong các file hiện có; một API xoá recent mới trong store; không đổi schema `workspaces.json` (version giữ 2); không đụng cơ chế preset/split-tree/PTY. LogoPanel bị xoá, `logoDataUrl` được re-home vào đầu rail nên tính năng App logo trong Settings vẫn sống.

## 1. Kết quả mong đợi

- Board hiển thị hai cột đúng mock trong stage 900×658 (cửa sổ mặc định 1100×720) — verify bằng screenshot `npm run dev` so với ảnh chốt.
- Mỗi hàng recent có icon thư mục, tên, path tildify, thời gian đọc được, nút × xoá khỏi recents; hàng missing icon vàng, path gạch ngang, vẫn xoá được — verify bằng test `removeRecent` trong `workspace-recents.test.ts` và thao tác chuột thật.
- Nhóm Missing đứng cuối rail kèm nút "Remove N" xoá một lần — verify bằng test `partitionRecents` và click thật.
- Hover thẻ preset (không built-in) hiện nút ✎/×; built-in chỉ hiện chấm; rename/delete hoạt động bằng chuột — verify thao tác thật + test hiện có của presets-store vẫn pass.
- Toàn bộ phím cũ giữ nguyên hành vi: ↑↓, Tab/←→, 0–9, ⌘O, Enter, Esc, R, ⌫ — verify bằng `npm test` (test board mới) + thao tác thật.
- Xoá recent đang chọn không làm nó "sống lại"; selection nhảy sang hàng kế — verify bằng test `open-board.removal.test.tsx`.
- `npm run build` và `npm test` xanh toàn bộ.

## 2. Nguồn dữ liệu chuẩn

**Canonical data**: `workspacesData` ([workspaces-store.ts](../../src/open-board/workspaces-store.ts)) cho recents; `presetsData`/`boardPresets()` ([presets-store.ts](../../src/presets/presets-store.ts)) cho thẻ Layout; `detectAgents()` ([pty-client.ts](../../src/terminal/pty-client.ts)) cho chip Agent; `logoDataUrl` ([logo-store.ts](../../src/settings/logo-store.ts)) cho logo đầu rail.

**Lấy từ**: các signal/store trên + `dirs_exist` IPC (đã dùng sẵn trong board).

**KHÔNG lấy từ**: `$SHELL` (không có nguồn phía UI), bộ đếm số lần mở (schema không có — không hiển thị "Opened N times"), `git_branch` (spawn process theo mỗi phím mũi tên — loại khỏi scope).

## 3. Business rules & invariants

- **Xoá recent là hành vi mới trong store, không phải filter UI**: `removeRecent(path)` ghi lại `workspaces.json`; hàng bị xoá không quay lại sau restart — verify bằng test store + mở lại app.
- **Hàng ma không hồi sinh**: khi xoá đúng `selectedPath`, selection phải được gán lại TRƯỚC khi entry rời danh sách, vì `displayRecents` bịa entry sống cho `selectedPath` không nằm trong recents ([open-board.tsx](../../src/open-board/open-board.tsx) dòng 155-159) — verify bằng test `open-board.removal.test.tsx`.
- **Không button lồng button**: hàng recent đổi từ `<button>` sang `<div role="option">` + nút × là `<button>` riêng; hàng missing không dùng `disabled` nữa (để × còn bấm được) — verify bằng đọc DOM trong test render.
- **Phím và chuột ngang hàng (di sản ADR 0006)**: mọi hành vi chuột mới (× recent, Remove N, ✎/× preset) đều có đường phím tương đương đã tồn tại (⌫ xoá recent đang chọn; R/⌫ cho preset) — verify bằng test keyboard.
- **Accent đặc chỉ cho selection recents + nút primary**: thẻ Layout/Agent giữ ring `inset 0 0 0 1px var(--accent)`; chữ trên nền accent dùng `var(--bg)`, chữ phụ 82% — không hardcode màu — verify bằng grep `#0f1219\|#0b0b11` ra 0 kết quả trong diff.
- **Thumbnail theo token**: nền rãnh `var(--bg)`, pane `color-mix(bg 80%, tone)` — theme sáng tự lật — verify bằng đổi `colorOverrides.background` sáng trong Settings và nhìn.
- **FR-025 di sản**: `detectAgents` fail → chỉ còn Shell only, board vẫn mở được — hành vi hiện có, không phá — verify test hiện có của `workspace-recents` pass nguyên.

## 4. Phạm vi / Ngoài phạm vi

**Làm**:

- API `removeRecent` + `removeRecents` (batch cho Missing) trong store, kèm test.
- Viết lại JSX + CSS của OpenBoard theo mock: rail (logo + title + count, list, Missing group, Open Folder ghim đáy) và detail (header tên/path, Layout grid, Agent chips, footer giữ nguyên).
- Thumbnail terminal-mini vẽ bằng CSS background layers trong `PresetThumb` (giữ đệ quy split hiện có).
- Nút ✎/× hover trên thẻ preset không built-in, nối vào `startRename`/`confirmDeleteId` sẵn có.
- Cho ⌫ xoá recent khi section = workspace (kèm chuyển selection an toàn); giữ ⌫ xoá preset khi section = layout.
- Cho `moveWorkspace` đi tới được hàng missing (bỏ filter), vì hàng missing giờ xoá được bằng phím.
- Xoá `logo-panel.tsx`; logo (`logoDataUrl` hoặc DefaultMark) render ở đầu rail; sửa desc của LogoRow trong Settings nếu lệch.
- Test mới cho removal-flow và partition Missing.

**KHÔNG làm**:

- Ô search/filter recents (giết mô hình bàn phím, 8 mục không đáng — quyết định trong session).
- Nhóm thời gian Today/This Week (list vốn đã sắp theo thời gian).
- "Opened N times", git-branch chip, label shell (`zsh`) — không có nguồn dữ liệu rẻ.
- Đổi schema/`WORKSPACES_VERSION`, migration, nâng `MAX_RECENTS`.
- Sửa hành vi detect-agent muộn (S7) và focus-visible toàn cục (B4) — nợ sẵn có, tách việc riêng.
- Kéo-thả ảnh đặt logo (drop-zone chết theo LogoPanel; đường Settings vẫn còn).

## 5. Rủi ro & Quyết định còn mở

**Đã chốt có rủi ro**:

- Bỏ drop-zone logo — rủi ro: ai quen kéo-thả sẽ không tìm thấy; giảm nhẹ bằng desc rõ trong Settings.
- `moveWorkspace` đi vào hàng missing — rủi ro: Enter trên hàng missing phải bị chặn (footer đã cảnh báo, `workspaceValid` đã chặn Open — giữ nguyên guard đó).
- Hàng recent là `div role="option"` — rủi ro: mất focus mặc định của button; board vốn điều khiển bằng roving selection trên container nên không đổi hành vi thực.

**Chưa chốt cần resolve**: (không còn — mọi quyết định UI đã chốt trên mock)

## 6. Các task

### Task 1: API xoá recent trong lib + store

**File(s)**:

- [workspace-recents.ts](../../src/lib/workspace-recents.ts)
- [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts)
- [workspaces-store.ts](../../src/open-board/workspaces-store.ts)

**Decision**: xoá theo `path` chính xác (không normalize — cùng quy tắc so sánh với `pushRecent` hiện tại); batch nhận mảng path.

**Build**:

- Thêm pure function `removeRecents(recents, paths: readonly string[]): readonly RecentWorkspace[]` vào lib (filter theo Set path).
- Thêm `removeWorkspaceRecents(paths: readonly string[]): void` vào store: gọi lib, ghi signal, persist theo đúng pattern `recordWorkspaceOpen` (kể cả `reportPersistError`).
- Test lib: xoá 1 path giữa danh sách; xoá nhiều path; path không tồn tại → mảng giữ nguyên (same reference không bắt buộc, nội dung bằng).

**Verify**:

- `npm test -- workspace-recents` → các test mới pass, test cũ nguyên.

### Task 2: Tách hàng recent khỏi `<button>` + partition Missing

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [workspace-recents.ts](../../src/lib/workspace-recents.ts)
- [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts)

**Phụ thuộc**: Task 1

**Decision**: hàng là `<div role="option" aria-selected>` bấm được cả hàng; × là `<button>` con; danh sách chia hai mảng `alive`/`missing` render nối tiếp, Missing có heading + nút "Remove N" (N = số thật, ẩn khi 0).

**Build**:

- Thêm helper trong file: `partitionRecents(displayRecents, missingSet)` trả `{ alive, missing }`.
- Viết lại markup list: icon SVG folder inline (theo mock), `row__body` (tên + hàng meta path/time), nút ×.
- Nút × gọi `removeSelectedSafely(path)`: nếu `path === selectedPath.value` → gán `selectedPath` sang hàng kế trong `alive` (hoặc `null` nếu hết) TRƯỚC khi gọi `removeWorkspaceRecents([path])`.
- Nút "Remove N" gọi cùng helper với mảng path missing.
- Bỏ `disabled={gone}` — hàng missing vẫn click chọn được, chỉ `confirmOpen` bị guard bởi `workspaceValid` như cũ.
- Đổi copy của `formatRelativeTime` trong [workspace-recents.ts](../../src/lib/workspace-recents.ts) sang dạng đầy đủ theo mock: `just now` / `N minutes ago` / `N hours ago` / `Yesterday` / `N days ago` / `N weeks ago`; cập nhật các assertion tương ứng trong [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts). KHÔNG fork hàm mới.

**Verify**:

- `npm run build` xanh.
- DOM không còn `button` lồng `button`: grep JSX vùng list chỉ có một `<button>` là `row__x`.

### Task 3: Test removal-flow

**File(s)**:

- [open-board.removal.test.tsx](../../src/open-board/open-board.removal.test.tsx) (file mới)

**Phụ thuộc**: Task 2

**Decision**: test render bằng harness Preact sẵn có của repo (theo mẫu `app.test.tsx`).

**Build**:

- Test 1 `removing the selected recent moves selection to the next row`: seed 3 recents, chọn hàng 1, click × → `selectedPath` = hàng 2, list còn 2, KHÔNG có hàng nào mang path vừa xoá (bắt bug hồi sinh).
- Test 2 `remove-all missing clears the group`: seed 2 missing (mock `dirs_exist` trả false) → click "Remove 2" → group biến mất.
- Test 3 `Backspace on workspace section removes the selected recent`: phím ⌫ khi section=workspace → hàng bay, selection sang hàng kế.

**Verify**:

- `npm test -- open-board.removal` → 3 test pass.

### Task 4: Bàn phím — ⌫ cho recents, mũi tên tới được Missing

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)

**Phụ thuộc**: Task 2

**Decision**: ⌫ xoá recent NGAY (không confirm inline — × và ⌫ cùng ngữ nghĩa, undo = mở lại folder); preset giữ confirm như cũ vì xoá preset mất công dựng lại.

**Build**:

- `handleKeyDown` case "Backspace": nếu `section === "workspace"` và có `selectedPath` → `removeSelectedSafely(selectedPath)`; nếu `section === "layout"` giữ nhánh cũ.
- `moveWorkspace`: bỏ filter `!missing.value.has(...)` — duyệt toàn bộ `displayRecents`.
- Footer keys hint: đổi chuỗi thành đúng tập phím thật (`↑↓ select · ⇥ section · 1–9 agent · ⌫ remove · ⎋ close` — chỉ hiện `⎋` khi `canCancel`).

**Verify**:

- Test Task 3 case 3 pass.
- Thao tác thật: ↓ đi xuyên vào hàng missing, footer cảnh báo missing, Enter không mở.

### Task 5: Layout hai cột — rail

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)

**Phụ thuộc**: Task 2

**Decision**: grid `300px 1fr`; Open Folder là nút accent đặc ghim đáy rail; logo app 24px đầu rail (re-home từ LogoPanel).

**Build**:

- `.open-board` đổi `grid-template-columns: 1fr 520px` → `300px 1fr`; xoá `<LogoPanel />` khỏi JSX; xoá [logo-panel.tsx](../../src/open-board/logo-panel.tsx); import `logoDataUrl` render `<img>` 24px (fallback DefaultMark SVG chuyển vào open-board.tsx) cạnh title "Workspace" + count.
- CSS rail theo mock: `.rail`, `.rail__head`, `.rail__scroll`, `.rail__foot`, `.row*`, `.gsep` — selection accent đặc: nền `var(--accent)`, tên `var(--bg)`, phụ `color-mix(in srgb, var(--bg) 82%, transparent)`, icon missing `var(--yellow)`.
- Nút `.workspace-open-folder` cũ đổi thành `.openfolder` accent đặc (chữ `var(--bg)`, viền `color-mix(accent 72%, #000)`), thêm `<kbd>⌘O</kbd>`.
- Kiểm tra file settings có desc "shown on the open board" ([logo-row.tsx](../../src/ui/controls/logo-row.tsx)) — vẫn đúng vì logo vẫn trên board; không sửa.

**Verify**:

- `npm run build` xanh; screenshot dev so mock: rail 300px, Open Folder ghim đáy, logo hiện.
- `grep -n "logo-panel" src -r` → 0 kết quả.

### Task 6: Layout hai cột — detail + thumbnail terminal-mini

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)
- [preset-thumb.tsx](../../src/presets/preset-thumb.tsx)

**Phụ thuộc**: Task 5

**Decision**: header detail = tên 19px + path mono ellipsis (không meta count, không git chip); lưới `repeat(auto-fill, minmax(148px, 1fr))`; thumbnail cao 70px nền `var(--bg)` rãnh 3px, pane vẽ 2 bar + cursor xanh bằng `background-image` layers.

**Build**:

- JSX detail: `.wshead` (h1 tên, path), `.sect` Layout (hint "Hover a card to rename or delete"), `.sect` Agent (hint "Runs in every pane"), footer giữ logic notice/summary/actions hiện có nguyên vẹn.
- `PresetThumb`: leaf render thêm class để CSS vẽ bar layers; giữ đệ quy `ThumbNode` nguyên (chỉ đổi CSS + 1 class).
- CSS: `.lcard*`, `.thumb`, `.pane` (background-image 3 lớp theo mock), `.builtin` chấm, `.achip*` (kbd số, logo agent, Shell `$`), states `.is-selected` ring accent.
- Chip agent: giữ nguyên data (`agents.value`, `effectiveAgent`, digit pick) — chỉ đổi skin.

**Verify**:

- `npm run build` xanh; screenshot so mock: 3 cột thẻ, thumbnail phân biệt được `layout-test-1` vs `layout-test`, thẻ built-in không có nút hover.

### Task 7: Nút ✎/× hover trên thẻ preset

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)

**Phụ thuộc**: Task 6

**Decision**: ✎ gọi `startRename(preset)`, × set `confirmDeleteId` (mở confirm delete/keep sẵn có); cả hai `stopPropagation` để không select/mở thẻ; built-in không render tools (đã guard bằng `isBuiltIn`).

**Build**:

- Thêm `.lcard__tools` (2 `<button>`, hiện khi `:hover`) vào thẻ không built-in; giữ `onContextMenu` rename như cũ (hai đường vào một hàm).
- Confirm delete/keep giữ markup cũ, chỉ re-skin theo thẻ mới.
- `startRename` đã clear `confirmDeleteId`; thêm chiều ngược: mở confirm delete → `renamingId.value = null`.

**Verify**:

- `npm test` toàn bộ xanh.
- Thao tác thật: hover thẻ thường thấy ✎/×; click × → confirm; click ✎ → input rename focus; built-in không có gì.

### Task 8: Dọn + verify tổng

**File(s)**:

- [styles.css](../../src/styles.css)
- [open-board.tsx](../../src/open-board/open-board.tsx)

**Phụ thuộc**: Task 7

**Build**:

- Xoá CSS mồ côi của bố cục cũ: `.board-logo*`, `.workspace-row*`, `.preset-chip*` (phần không còn dùng), `.board-side*` nếu đã thay tên.
- Grep `#0f1219\|#0b0b11` trong `src/styles.css` → phải 0 (không hardcode màu mock).
- Chạy screenshot ở cửa sổ 1100×720 và cửa sổ hẹp ~700px — rail vẫn 300px, detail cuộn được, footer không mất.

**Verify**:

- `npm run build` + `npm test` xanh toàn bộ; dán output.
- `grep -n "board-logo\|workspace-row\|preset-chip" src/styles.css` → 0 kết quả (hoặc chỉ còn tên đã tái dùng có chủ đích).
