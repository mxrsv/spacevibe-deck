# Landing hero stage — mock cửa sổ app thật

**Spec**: [2026-07-16-landing-stage-app-window-design](../superpowers/specs/2026-07-16-landing-stage-app-window-design.md)
**Goal**: Thay hero stage cách điệu của landing (direction A) bằng mock tái hiện đúng cửa sổ Stackgrid v0.6.x — chrome, sidebar, 3 pane agent đang stream, status bar — với animation streaming vô hạn.
**Architecture**: Toàn bộ dữ liệu pane + stream engine nằm trong [product-stage.js](../../marketing/landing-prototype/src/product-stage.js); markup mock nằm trong [a.js](../../marketing/landing-prototype/src/directions/a.js); style dùng token Tokyo Night scope cục bộ trong [direction-a.css](../../marketing/landing-prototype/styles/direction-a.css) và scale tỉ lệ bằng container query units (cqw). Không đụng app source `src/` — chỉ đọc làm tham chiếu.

## 1. Kết quả mong đợi

- Stage render thành cửa sổ app: titlebar 34px + traffic lights + cụm icon phải, sidebar 200px với 4 workspace + nút Open workspace, 3 pane (claude focus, codex, opencode), status bar 28px — verify bằng screenshot so cạnh [screenshot.png](../../.github/assets/screenshot.png) (chrome/sidebar/status giống app thật)
- 3 pane stream text theo chunk với nhịp lệch nhau, loop vô hạn có quãng nghỉ, spinner khi "thinking", cursor nhấp nháy — verify bằng quan sát trực tiếp trên `npm run prototype:landing`
- `prefers-reduced-motion: reduce` → frame tĩnh đã hoàn tất, không stream, không nhấp nháy — verify bằng DevTools emulation "prefers-reduced-motion"
- Đổi locale EN↔VI: nội dung stage giữ nguyên tiếng Anh 100% — verify bằng bấm toggle VI và đọc lại stage
- Không còn tham chiếu tới `agentPanes`, `sequenceSteps`, `stagePreset`, `stageWorkspace`, `stageFocus`, `sampleSessionLabel` — verify bằng `! grep -rq "agentPanes\|sequenceSteps\|stagePreset\|stageWorkspace\|stageFocus\|sampleSessionLabel" marketing/ && echo OK` → `OK`

## 2. Nguồn dữ liệu chuẩn

**Canonical data**: giao diện app thật.

**Lấy từ**:

- Token màu/kích thước: fallback trong [styles.css](../../src/styles.css) (`--bg #16161e`, `--fg #c0caf5`, `--accent #7aa2f7`, titlebar sidebar-mode 34px, sidebar 200px, status 28px, font stack SF Mono/JetBrains Mono)
- Cấu trúc sidebar item: [workspace-sidebar.tsx](../../src/ui/workspace-sidebar.tsx) (`wsitem`: logo tròn, label, path mờ, nút ×; `wsbar__add`: "+ Open workspace")
- Cấu trúc status bar: [status-bar.tsx](../../src/ui/status-bar.tsx) (gitdot + `main` | cwd | phải: `3 panes` | `Tokyo Night` | `split ⌘D new tab ⌘T`)
- Icon cụm titlebar: SVG trong [chrome-actions.tsx](../../src/ui/chrome-actions.tsx) (split row, split column, close pane, expand, gear)
- Chrome tổng thể: [screenshot.png](../../.github/assets/screenshot.png)

**KHÔNG lấy từ**: palette tím hiện tại của landing (stage bỏ hẳn, spec yêu cầu Tokyo Night); không import module nào từ `src/` vào landing (landing là JS thuần, app là Preact/TS).

## 3. Business rules & invariants

- **Stage locale-independent**: mọi chuỗi trong stage là hằng tiếng Anh nằm trong `product-stage.js`, không đi qua `copy.js` — verify bằng grep `stage` trong [copy.js](../../marketing/landing-prototype/src/copy.js) ra rỗng
- **Reduced motion tĩnh hoàn toàn**: khi `prefers-reduced-motion: reduce`, không tạo timer nào, transcript render trạng thái cuối — verify bằng DevTools emulation + không có class `is-blinking`
- **Dispose sạch**: `mountStageStream` trả về hàm dispose hủy mọi timer; đổi locale (re-render toàn trang) không để rò timer — verify bằng đổi locale 3 lần liên tiếp, animation vẫn chạy đúng 1 luồng
- **Catch-up an toàn**: mỗi lần timer bắn, mọi step đã đến hạn được apply trong 1 lần ghi DOM — tab bị throttle rồi quay lại không bị burst animation — verify bằng chuyển tab đi 30s rồi quay lại
- **Flat, không drop shadow**: stage chỉ dùng hairline border qua `color-mix` — verify bằng grep `box-shadow` trong block `.a-appwin` ra rỗng
- **Demo dialog nguyên vẹn**: nút "Watch the 45-sec demo" vẫn mở dialog video — verify bằng bấm nút trên dev server

## 4. Phạm vi / Ngoài phạm vi

**Làm**:

- Viết lại dữ liệu + stream engine trong `product-stage.js` (giữ nguyên `mountDemoDialog`)
- Thay markup `<figure class="a-stage">` bằng mock `.a-appwin` trong `a.js`
- Thay block CSS stage cũ bằng CSS `.a-appwin` trong `direction-a.css`
- Xoá 4 key copy stage khỏi `copy.js` (cả EN lẫn VI)

**KHÔNG làm**:

- Không sửa bất kỳ file nào trong `src/` (app source)
- Không đụng demo dialog, aurora motion, topbar, headline, CTA
- Không đụng phần diff toggle ngôn ngữ đang pending trong `a.js`/`direction-a.css` (commit riêng trước khi commit stage)

## 5. Rủi ro & Quyết định còn mở

**Đã chốt có rủi ro**:

- Scale bằng cqw trên container (design width 1000, ví dụ titlebar = 3.4cqw) — rủi ro: chữ quá nhỏ ở viewport hẹp; chốt kèm: dưới breakpoint 47.5rem sidebar ẩn đi và font pane có sàn `max()`, chỉnh tiếp theo eye review
- Toàn bộ data + engine nằm trong `product-stage.js` theo đúng scope spec — rủi ro: file ~450 dòng (vẫn dưới trần 800); nếu vượt sẽ tách `stage-data.js` ở bước finish
- Nội dung transcript 3 CLI viết tay mô phỏng (Claude Code: bullet `●`, spinner `✳`, status `[Opus 4.8 (1M context)]… stackgrid git:(main*)`; codex/opencode: prompt/status riêng theo phong cách từng CLI) — rủi ro: độ "thật" phụ thuộc eye review, không có nguồn máy kiểm được

**Chưa chốt cần resolve**:

- Eye review cần mở browser — theo quy ước phải được user cho phép trước khi mở

## 6. Các task

### Task 1: Dữ liệu stage mới

**File(s)**:

- [product-stage.js](../../marketing/landing-prototype/src/product-stage.js)

**Decision**: Xoá `agentPanes` + `sequenceSteps`; thêm 3 export frozen: `stageSidebar` (4 item: stackgrid active/close, spacevibe-arena, spacevibe-workspace, spacevibe-api — path dạng tilde rút gọn kiểu app `…rkspace/stackgrid`), `stageStatus` (branch `main`, cwd `~/Documents/Development/spacevibe-workspace/stackgrid`, `3 panes`, `Tokyo Night`, hint `split ⌘D` / `new tab ⌘T`), `stagePanes` (3 pane `claude`/`codex`/`opencode`).

**Build**:

- Mỗi pane có shape `{ id, focused, startOffset, restGap, steps }`; step là `{ kind: "line" | "chunk" | "think" | "rest", text?, cls?, delay }` — `delay` ms tính từ step trước
- Nội dung tiếng Anh, mô phỏng phiên thật: claude có transcript bullet + thinking spinner + status line usage bar + `stackgrid git:(main*)`; codex và opencode mỗi pane có transcript + prompt/status theo phong cách riêng
- Nhịp lệch nhau: mỗi pane có `startOffset` khác nhau (0 / 1200 / 2600 ms) và `restGap` cuối loop (4000–6000 ms)

**Verify**:

- `node --input-type=module -e "import('./marketing/landing-prototype/src/product-stage.js').then(m => console.log(m.stagePanes.length, m.stageSidebar.length))"` → `3 4`

---

### Task 2: Stream engine

**File(s)**:

- [product-stage.js](../../marketing/landing-prototype/src/product-stage.js)

**Phụ thuộc**: Task 1

**Decision**: Thêm export `mountStageStream(gridRoot)` chạy bằng `setTimeout` + mốc `performance.now()`, trả về hàm dispose.

**Build**:

- Mỗi pane chạy máy trạng thái riêng: đọc `steps`, append node vào vùng transcript của pane (`[data-stream]`), step `think` bật/tắt element spinner, hết steps → chờ `restGap` → xoá transcript, lặp lại từ đầu
- Lịch chạy tính theo thời điểm tuyệt đối (mốc + tổng delay): khi timer bắn muộn (tab throttle), apply mọi step đã đến hạn trong 1 vòng rồi mới đặt timer kế — không burst
- Transcript đầy thì xoá node cũ nhất (giữ tối đa N dòng khớp chiều cao pane) để dòng mới đẩy dòng cũ lên
- `matchMedia("(prefers-reduced-motion: reduce)").matches` → không tạo timer, render thẳng toàn bộ text của mọi step vào transcript (frame hoàn tất), không gắn class blink
- Dispose: clear mọi timeout đang treo qua danh sách id

**Verify**:

- Chưa chạy được end-to-end ở task này; kiểm tra tĩnh: `! grep -q "setInterval" marketing/landing-prototype/src/product-stage.js && echo OK` → `OK` (chỉ dùng setTimeout theo mốc)

---

### Task 3: Markup cửa sổ app trong a.js

**File(s)**:

- [a.js](../../marketing/landing-prototype/src/directions/a.js)

**Phụ thuộc**: Task 1, Task 2

**Decision**: Thay toàn bộ `<figure class="a-stage">…</figure>` (gồm stage bar, sequence, crosshairs, focus frame, hàm `renderPane` cũ) bằng `<figure class="a-appwin">`; giữ nguyên topbar/copy/CTA.

**Build**:

- Cấu trúc: `.a-appwin__titlebar` (3 chấm traffic light + cụm 5 icon SVG port nguyên vẹn path từ chrome-actions.tsx) → `.a-appwin__body` (`.a-appwin__sidebar` render từ `stageSidebar` + `.a-appwin__grid` render từ `stagePanes`: cột trái 2 pane chồng dọc claude/codex, cột phải opencode full-height) → `.a-appwin__status` render từ `stageStatus`
- `figure` mang `aria-label="Stackgrid app window preview"` tĩnh tiếng Anh; toàn bộ `.a-appwin__body` đặt `aria-hidden="true"` (decorative, không aria-live)
- Pane focus (`claude`) mang class `is-focused` (border accent); vùng transcript mỗi pane mang thuộc tính `data-stream` để engine bám vào
- Trong `mount()`: gọi `mountStageStream(section.querySelector(".a-appwin__grid"))`, thêm hàm dispose của nó vào cleanup trả về

**Verify**:

- `! grep -q "a-stage\|renderPane\|sequenceSteps\|agentPanes" marketing/landing-prototype/src/directions/a.js && echo OK` → `OK`
- `grep -c "mountStageStream" marketing/landing-prototype/src/directions/a.js` → `≥ 2` (import + gọi)

---

### Task 4: Dọn copy.js

**File(s)**:

- [copy.js](../../marketing/landing-prototype/src/copy.js)

**Phụ thuộc**: Task 3

**Decision**: Xoá `stagePreset`, `stageWorkspace`, `stageFocus`, `sampleSessionLabel` khỏi cả `en` lẫn `vi`.

**Build**:

- Xoá 4 key ở cả 2 locale; giữ nguyên các key còn lại và `resolveLocale`

**Verify**:

- `! grep -rq "stagePreset\|stageWorkspace\|stageFocus\|sampleSessionLabel" marketing/ && echo OK` → `OK`

---

### Task 5: CSS khung cửa sổ — titlebar, sidebar, status bar

**File(s)**:

- [direction-a.css](../../marketing/landing-prototype/styles/direction-a.css)

**Phụ thuộc**: Task 3

**Decision**: Xoá toàn bộ block CSS stage cũ (`.a-stage*`, `.a-sequence*`, `.a-pane*`, `.a-focus-frame`, `.a-stage__crosshair*` — cả trong 2 media query 70rem/47.5rem và block reduced-motion); thêm block `.a-appwin` mới với token Tokyo Night scope cục bộ.

**Build**:

- `.a-appwin` khai báo custom properties riêng: `--sg-bg: #16161e; --sg-fg: #c0caf5; --sg-accent: #7aa2f7; --sg-hairline: color-mix(in srgb, #c0caf5 12%, transparent)`, font stack mono giống app, `container-type: inline-size`
- Kích thước theo cqw với design width 1000: titlebar `3.4cqw`, sidebar `20cqw`, status `2.8cqw`, font pane `1.15cqw` có sàn `max(…, 7px)`; bo góc cửa sổ + hairline border, KHÔNG box-shadow
- Titlebar: 3 chấm traffic light (`#ff5f57 #febc2e #28c840`) trái, cụm icon phải màu fg mờ
- Sidebar: item active nền sáng hơn (color-mix), logo tròn, label + path mờ đầu-ellipsis, nút × chỉ ở item active; nút add "+ Open workspace" mờ
- Status bar: gitdot chấm tròn nhỏ, separator dọc hairline, nhóm phải đẩy bằng margin-left auto, `kbd` viền hairline

**Verify**:

- `! grep -q "a-stage__bar\|a-sequence\|a-focus-frame\|a-stage__crosshair" marketing/landing-prototype/styles/direction-a.css && echo OK` → `OK`
- `awk '/^\.a-appwin/{on=1} /^\.a-actions/{on=0} on && /box-shadow/{f=1} END{exit f}' marketing/landing-prototype/styles/direction-a.css && echo OK` → `OK` (quét vùng từ selector `.a-appwin` đầu tiên tới `.a-actions`, không được có box-shadow)

---

### Task 6: CSS pane, transcript, animation, responsive

**File(s)**:

- [direction-a.css](../../marketing/landing-prototype/styles/direction-a.css)

**Phụ thuộc**: Task 5

**Decision**: Grid 2 cột (trái chồng 2 pane, phải 1 pane full-height) bằng CSS grid; hiệu ứng blink/spinner bằng CSS animation gắn class, JS chỉ toggle class.

**Build**:

- `.a-appwin__grid`: grid `grid-template-columns: 1fr 1fr`, cột trái là flex column 2 pane; divider giữa pane là hairline; pane `is-focused` border `--sg-accent`
- Transcript: `overflow: hidden`, dòng mới append cuối, các class màu cho bullet/status/usage-bar/prompt của từng CLI
- Cursor blink: `@keyframes` opacity gắn `.a-appwin .is-blinking`; spinner think: keyframes xoay ký tự `✳`
- `@media (max-width: 47.5rem)`: ẩn `.a-appwin__sidebar`, grid giữ 2 cột
- Block `@media (prefers-reduced-motion: reduce)` hiện có: thêm tắt animation blink/spinner của `.a-appwin`

**Verify**:

- `grep -c "a-appwin" marketing/landing-prototype/styles/direction-a.css` → ≥ 30 (block đầy đủ)
- `grep -n "is-blinking" marketing/landing-prototype/styles/direction-a.css` nằm trong cả block thường lẫn block reduced-motion

---

### Task 7: Verify tổng + eye review

**File(s)**:

- không sửa file — chạy kiểm tra

**Phụ thuộc**: Task 4, Task 6

**Decision**: Eye review là điều kiện hoàn thành (build pass chưa phải xong); mở browser phải được user cho phép trước.

**Build**:

- Chạy `npm run prototype:landing`, mở `http://127.0.0.1:5173/landing-prototype/?direction=A&lang=en`
- Chụp screenshot stage, so cạnh [screenshot.png](../../.github/assets/screenshot.png): chrome, sidebar, tỉ lệ, palette
- Bấm toggle VI → stage vẫn tiếng Anh; bấm CTA demo → dialog video mở bình thường
- DevTools emulate `prefers-reduced-motion: reduce` → frame tĩnh
- Quan sát loop ≥ 2 chu kỳ: nghỉ rồi lặp mượt, không giật

**Verify**:

- Grep tổng: `! grep -rq "agentPanes\|sequenceSteps\|stagePreset\|stageWorkspace\|stageFocus\|sampleSessionLabel" marketing/ && echo OK` → `OK`
- Screenshot đạt eye review theo success criteria của spec (user hoặc agent nhìn trực tiếp xác nhận)
