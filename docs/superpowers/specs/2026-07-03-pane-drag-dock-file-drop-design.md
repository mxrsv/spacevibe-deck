# Stackgrid — Pane drag-dock + File drop vào terminal

**Date:** 2026-07-03
**Status:** Approved design (pending implementation plan)
**Review:** 2026-07-03 — agent review verdict `APPROVE_WITH_NITS`; 2 finding MAJOR
(payload 4-variant của `onDragDropEvent`, vòng đời overlay) đã được gấp vào spec này.

## Bối cảnh

Stackgrid là app terminal desktop (Tauri 2 + Preact + signals + xterm.js, backend Rust
với `portable-pty`). Mỗi tab là một split tree bất biến (`src/lib/split-tree.ts`),
DOM của tree được dựng imperative ngoài render loop của Preact (`src/terminal/layout.ts`),
mỗi pane là một xterm gắn PTY (`src/terminal/pane.ts`), điều phối bởi
`terminal-manager.ts` (per-tab) và `tab-manager.ts` (toàn cục).

Spec này gộp 2 tính năng độc lập nhưng cùng chủ đề "kéo thả":

1. **Pane drag-dock** — kéo một pane bằng thanh header, thả vào nửa trên/dưới/trái/phải
   của pane khác trong cùng tab để sắp xếp lại layout (kiểu VS Code).
2. **File drop** — kéo file/folder từ Finder thả vào một pane, đường dẫn (đã
   shell-escape) được gõ vào PTY của đúng pane đó.

Cả hai đã được chốt qua brainstorming:

- Drag model: **dock kiểu VS Code** (không swap, không floating).
- File drop: **chèn đường dẫn vào prompt** (không auto-cd), nhiều file → cách nhau
  dấu cách.
- Kỹ thuật: **pointer events tự viết** cho pane drag (không HTML5 DnD — Tauri webview
  can thiệp; không thư viện DnD — pane DOM nằm ngoài Preact) + **Tauri
  `onDragDropEvent`** cho file drop (HTML5 drop không bao giờ cho đường dẫn tuyệt đối
  trong webview).

Không thêm dependency mới. Không đổi schema session/settings.

---

## 1. Pane drag-dock

### 1.1. Hàm thuần mới trong `src/lib/split-tree.ts`

```ts
export type Edge = "top" | "bottom" | "left" | "right";

/**
 * Gỡ leaf `sourceId` khỏi tree rồi ghép nó vào cạnh `edge` của leaf `targetId`.
 * Trả về tree mới; trả về tree cũ nguyên vẹn khi thao tác không hợp lệ.
 */
export function movePane(
  node: TreeNode,
  sourceId: number,
  targetId: number,
  edge: Edge,
): TreeNode;
```

Hành vi:

- `sourceId === targetId` → trả về `node` nguyên vẹn.
- `sourceId` hoặc `targetId` không có trong tree → trả về `node` nguyên vẹn.
- Ngược lại: `removeLeaf(node, sourceId)` (split cha collapse như hiện tại — không
  thể ra `null` vì target vẫn còn, nhưng vẫn phải guard `null` cho TypeScript vì
  chữ ký `removeLeaf` là `TreeNode | null`), rồi thay leaf `targetId` bằng split mới:
  - `edge` `left`/`right` → `dir: "row"`; `top`/`bottom` → `dir: "column"`.
  - Source nằm nhánh `a` khi `edge` là `left`/`top`, nhánh `b` khi `right`/`bottom`.
  - `ratio: 0.5`.
- ⚠️ KHÔNG tái dùng `splitLeaf` cho bước ghép: `splitLeaf` hardcode leaf cũ ở nhánh
  `a`, leaf mới ở nhánh `b` — chỉ đúng cho cạnh `right`/`bottom`. Viết helper
  replace-leaf riêng bên trong `movePane` để đặt source vào đúng nhánh theo `edge`.
- Bất biến: không mutate node cũ, giống mọi hàm hiện có trong file.

### 1.2. Module mới `src/terminal/pane-drag.ts`

Controller drag cho một tab, tạo trong `createTerminalManager`:

```ts
export interface PaneDragController {
  dispose(): void;
}

export function createPaneDragController(
  container: HTMLElement, // container của tab (nơi renderTree dựng DOM)
  opts: {
    paneCount(): number;
    onMove(sourceId: number, targetId: number, edge: Edge): void;
  },
): PaneDragController;
```

Cơ chế (event delegation — gắn **một** listener `pointerdown` lên `container`,
sống sót qua mọi lần `renderTree` rebuild DOM):

1. `pointerdown` bắt qua `closest(".pane__bar")` (bỏ qua nếu trúng
   `.split__divider`). Nếu `paneCount() < 2` → không làm gì. Ghi nhận điểm bắt đầu,
   **chưa** vào trạng thái drag.
2. `pointermove` vượt ngưỡng **5px** → bắt đầu drag: `setPointerCapture` (cùng
   pattern với divider trong `layout.ts`), thêm class `is-pane-dragging` lên
   `container`, tạo **ghost** (div mờ hiện cwd/badge của pane nguồn) bám theo con trỏ.
3. Hit-test mỗi `pointermove`: duyệt `container.querySelectorAll(".pane-slot")`,
   dùng `getBoundingClientRect()` tìm slot chứa con trỏ. Cạnh đích chọn theo
   **đường chéo** (so `dx/width` với `dy/height` để tìm cạnh gần nhất) — không có
   vùng chết ở giữa pane.
4. **Overlay** (`.drop-overlay`, một div duy nhất tái sử dụng): phủ đúng nửa pane
   đích tương ứng cạnh sẽ dock. Hover lên chính pane nguồn → không hiện overlay.
   Ghost và overlay đều append vào `document.body` với `position: fixed` + tọa độ
   viewport (từ `getBoundingClientRect`) — KHÔNG append vào container của tab, vì
   `renderTree` dùng `container.replaceChildren(...)` sẽ xóa chúng nếu một render
   xảy ra giữa lúc kéo.
5. `pointerup`:
   - Có target hợp lệ khác nguồn → `opts.onMove(sourceId, targetId, edge)`.
   - Không có target (thả lên divider, ra ngoài, hoặc lên chính nguồn) → hủy êm.
6. Hủy drag khi: phím `Escape`, `pointercancel`. Dọn ghost + overlay + class.
7. **Pane close/exit GIỮA lúc kéo** (shell chết → `handleExit` → `closePane` →
   `render()` chạy giữa chừng): an toàn theo thiết kế —
   - Hit-test chạy lại mỗi `pointermove` trên tập `.pane-slot` hiện tại, pane đã
     đóng không còn match; ghost/overlay nằm trên `body` nên không bị render wipe.
   - Khi thả, `movePane` tự no-op nếu source/target không còn trong tree (trả về
     tree cũ nguyên tham chiếu) — `terminal-manager` thấy tham chiếu không đổi thì
     bỏ qua render/persist.
8. `dispose()`: gỡ mọi listener + dọn ghost/overlay còn sót (gọi từ
   `TerminalManager.dispose`).

Text selection trong terminal không bị ảnh hưởng — drag chỉ khởi động từ
`.pane__bar`, không từ vùng xterm.

### 1.3. Thay đổi `src/terminal/terminal-manager.ts`

- Tạo `PaneDragController` trong `createTerminalManager`; `dispose()` khi manager
  dispose.
- `onMove` callback: `tree = movePane(tree, sourceId, targetId, edge)`; nếu tree
  đổi tham chiếu → `render()`, `setActive(sourceId)`, focus pane nguồn,
  `callbacks.onLayoutChange()` (persist session đi đường có sẵn — serialize
  structure-only, không cần đổi schema).

### 1.4. CSS (`src/styles.css`)

- `.pane__bar` thêm `cursor: grab` (chỉ khi tab có >1 pane — class
  `has-multiple-panes` trên container, toggle trong `render()` từ cùng nguồn
  `panes.size > 1` đang dùng cho `highlightActive`, để cursor và gate drag không
  lệch nhau); khi đang kéo `cursor: grabbing`.
- `.pane-drag-ghost`: div nhỏ mờ (opacity ~0.8, nền panel, bo góc) bám con trỏ,
  `position: fixed`, `pointer-events: none`, con của `document.body`.
- `.drop-overlay`: `position: fixed` + tọa độ viewport, con của `document.body`
  (xem mục 1.2.4 — không được nằm trong container của tab), nền accent mờ (~25%),
  border accent, `pointer-events: none`, transition ngắn khi đổi vị trí.
- `.is-pane-dragging`: đặt `cursor: grabbing` toàn container và tắt
  `pointer-events` cho iframe/canvas của xterm nếu cần (quyết khi implement —
  hit-test dùng rect math nên không phụ thuộc `elementFromPoint`).

---

## 2. File drop vào pane

### 2.1. Hàm thuần mới `src/lib/shell-escape.ts`

```ts
/** Escape một path để dán an toàn vào dòng lệnh shell (kiểu iTerm2). */
export function shellEscapePath(path: string): string;

/** Escape + nối nhiều path bằng dấu cách, thêm một dấu cách cuối. */
export function shellEscapePaths(paths: readonly string[]): string;
```

- Path chỉ chứa ký tự an toàn (`[A-Za-z0-9/._+:@%,=~-]`) → giữ nguyên.
- Ngược lại: **backslash-escape** từng ký tự ngoài tập an toàn (space, quote,
  `$`, `&`, `(`, `)`, ký tự unicode giữ nguyên — chỉ escape ký tự shell đặc biệt
  và khoảng trắng).
- `shellEscapePaths([])` → chuỗi rỗng (caller bỏ qua, không ghi PTY).

### 2.2. Module mới `src/terminal/file-drop.ts`

```ts
export function installFileDrop(handlers: {
  onOver(x: number, y: number): void; // tọa độ logical (CSS px)
  onDrop(x: number, y: number, paths: string[]): void;
  onLeave(): void;
}): Promise<UnlistenFn>;
```

- Dùng `getCurrentWebview().onDragDropEvent()` (`@tauri-apps/api/webview`,
  đã xác minh tồn tại trong `@tauri-apps/api@2.11.1`) — Tauri config hiện tại đã
  bật drag-drop mặc định (`dragDropEnabled` không tắt), permission `core:default`
  nhiều khả năng đủ cho event listener (verify runtime lúc implement, thiếu thì
  thêm vào `capabilities/default.json`).
- ⚠️ Payload có **4 variant**, không phải 3 (xác minh từ `webview.d.ts` bản đã cài):
  `enter { paths, position }` · `over { position }` (KHÔNG có paths) ·
  `drop { paths, position }` · `leave`. `enter` bắn ĐẦU TIÊN khi drag đi vào
  webview; drop nhanh trên WKWebView có thể chỉ thấy `enter` → `drop`.
  Mapping bắt buộc: `enter` + `over` → `onOver`, `drop` → `onDrop`,
  `leave` → `onLeave`.
- Đổi tọa độ **physical → logical**: dùng
  `position.toLogical(await getCurrentWindow().scaleFactor())` (ưu tiên hơn chia
  `window.devicePixelRatio` — tránh lệch trên multi-monitor/fractional scaling).
  Lúc implement phải kiểm chứng gốc tọa độ drop (top-left webview) trùng gốc
  `clientX/clientY` của `getBoundingClientRect` (với `titleBarStyle: "Overlay"`
  webview phủ full window nên nhiều khả năng trùng).

### 2.3. Routing trong `tab-manager.ts` + `terminal-manager.ts`

- `tab-manager.init()` đăng ký `installFileDrop` **một lần** (giống listener
  `pty:output`), push unlisten vào `unlisteners`.
- Route xuống **tab đang hiển thị**: `activeManager()`. TerminalManager thêm 3
  method:
  - `fileDragOver(x, y)`: tìm `.pane-slot` chứa điểm đó (rect math trên
    container của tab), toggle class `is-drop-target` lên slot đó.
  - `fileDragLeave()`: bỏ mọi `is-drop-target`.
  - `fileDrop(x, y, paths)`: tìm pane dưới con trỏ; nếu không trúng pane nào →
    chỉ dọn highlight. Nếu trúng:
    - Pane đã exit (`exited.has(id)`) → bỏ qua (không ghi PTY chết), dọn highlight.
    - Ngược lại: `invoke("write_pty", { id, data: shellEscapePaths(paths) })`
      (catch + log như `paneEvents.onData` hiện có), `setActive(id)` + focus
      pane đó, dọn highlight.
- Drop khi con trỏ nằm ngoài mọi pane (tab bar, status bar) → bỏ qua.

### 2.4. CSS

- `.pane-slot.is-drop-target`: outline/inner-glow màu accent để báo pane sẽ nhận
  file.

---

## 3. Tương tác giữa hai tính năng & ràng buộc

- Không xung đột: pane drag là pointer events nội bộ (OS drag từ Finder không
  sinh pointer events), file drop là Tauri webview event (drag nội bộ không kích
  hoạt nó).
- Không đụng keyboard path → các fix IME tiếng Việt (`webkit-ime-fix`,
  `ime-trace`, keyCode 229 guard) giữ nguyên.
- Session persistence: move pane đi qua `onLayoutChange` → `scheduleSessionSave`
  sẵn có; layout serialize structure-only nên restore hoạt động không đổi.
- Hai pane không thể cùng id giữa các tab (id là PTY id toàn cục) — file drop chỉ
  route vào active tab nên không nhầm tab.

## 4. Kiểm thử

**Unit (vitest, có sẵn):**

- `split-tree.test.ts` — `movePane`: dock đủ 4 cạnh (kiểm tra `dir` + thứ tự
  nhánh + ratio 0.5), `source === target` trả tree cũ, id không tồn tại trả tree
  cũ, split cha collapse đúng sau khi gỡ nguồn, tree cũ không bị mutate.
- `shell-escape.test.ts` — path sạch giữ nguyên, space/quote/`$`/`&` được escape,
  unicode (tiếng Việt) giữ nguyên, nhiều path nối đúng + trailing space, mảng
  rỗng → chuỗi rỗng.

**Manual (`npm run tauri dev`):**

- Dock đủ 4 cạnh giữa 3+ pane; nội dung terminal không mất sau move; layout lưu
  và restore đúng sau khi quit/relaunch.
- Hủy drag: Esc, thả lên divider, thả lên chính pane nguồn, tab 1 pane không
  drag được.
- Kéo từ Finder: 1 file, nhiều file, file có space + ký tự đặc biệt trong tên,
  folder; drop vào pane không active (pane đó nhận + được focus); drop vào pane
  exited (không có gì xảy ra); drop khi có nhiều tab (chỉ tab hiển thị nhận).

## 5. Phạm vi & không làm

- ❌ Kéo pane **sang tab khác** (drop lên tab bar) — ngoài phạm vi, có thể làm sau.
- ❌ Swap pane / floating pane — đã chốt chỉ dock.
- ❌ Auto-`cd` khi thả folder — đã chốt chỉ chèn path.
- ❌ Thay đổi backend Rust — toàn bộ tính năng nằm ở frontend, dùng lại
  `write_pty` sẵn có.
