# Pane drag-dock + File drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép kéo một pane bằng thanh header thả vào nửa trên/dưới/trái/phải của pane khác để sắp lại layout (kiểu VS Code), và kéo file/folder từ Finder thả vào một pane để chèn đường dẫn (đã shell-escape) vào PTY của đúng pane đó.

**Architecture:** Pane drag là **pointer events tự viết**, gắn một listener `pointerdown` lên container tab ổn định (`.tab-stage` — chỉ children bị `replaceChildren`, listener sống sót mọi lần `renderTree`); ghost + overlay là con của `document.body` với `position: fixed` để render-wipe không xoá. Logic sắp cây tách thành hàm thuần bất biến `movePane` trong `split-tree.ts`. File drop dùng Tauri `onDragDropEvent` (HTML5 drop không cho path tuyệt đối trong webview), đăng ký một lần trong `tab-manager.init()`, route xuống tab đang hiển thị; đường dẫn được escape bằng hàm thuần `shellEscapePaths` rồi ghi qua command `write_pty` sẵn có.

**Tech Stack:** Tauri 2 (`@tauri-apps/api` v2 — `webview`, `window`, `dpi`, `core`, `event`), Preact + `@preact/signals`, xterm.js, TypeScript, Vitest 3.

## Global Constraints

- **Không thêm dependency mới**, **không đổi schema session/settings** (spec §mở đầu + §5). Toàn bộ nằm ở frontend, dùng lại command `write_pty` — **không đụng backend Rust**.
- **Bất biến (immutable):** mọi transform trong `split-tree.ts` trả về cây mới, không mutate cây cũ (theo mọi hàm sẵn có trong file).
- **Ghost + overlay LUÔN là con của `document.body`** (`position: fixed` + toạ độ viewport từ `getBoundingClientRect`) — KHÔNG append vào container tab, vì `renderTree` dùng `container.replaceChildren(...)` sẽ xoá chúng nếu một render xảy ra giữa lúc kéo (spec §1.2.4, §1.2.7).
- **Mapping payload `onDragDropEvent` đúng 4 variant** (xác minh trong `node_modules/@tauri-apps/api/webview.d.ts`): `enter { paths, position }`, `over { position }` (KHÔNG có paths), `drop { paths, position }`, `leave`. Bắt buộc: `enter` + `over` → `onOver`, `drop` → `onDrop`, `leave` → `onLeave` (spec §2.2).
- **Đổi toạ độ physical → logical bằng `position.toLogical(scaleFactor)`** (ưu tiên hơn `window.devicePixelRatio` — tránh lệch multi-monitor/fractional scaling, spec §2.2).
- **Flat design:** file `src/styles.css` có quy tắc "no drop shadows anywhere". Dùng `border` / `outline` / `background` tinted accent, KHÔNG `box-shadow`.
- **Verify:** `npm run test` (vitest run), `npx tsc --noEmit` (typecheck nhanh) hoặc `npm run build` (tsc + vite build), và `npm run tauri dev` cho smoke test tay.
- Style: file nhỏ tập trung, `type` thay `interface` cho type thuần khi hợp, import dùng đường dẫn tương đối như code hiện có (repo này không dùng path alias).
- Mọi commit kết thúc bằng trailer `Claude-Session: https://claude.ai/code/session_015Ky5cf3H1Cq9u2kbgXkfqG` (executor thay bằng session URL của mình nếu khác).

---

### Task 1: Hàm thuần `movePane` trong `split-tree.ts` (TDD)

Sắp lại cây split khi dock một pane: gỡ leaf nguồn rồi thay leaf đích bằng một split mới chứa nguồn ở đúng nhánh theo cạnh. **KHÔNG tái dùng `splitLeaf`** — `splitLeaf` hardcode leaf cũ ở nhánh `a`, leaf mới ở nhánh `b` (chỉ đúng cho cạnh right/bottom). Viết helper replace-leaf riêng để đặt nguồn vào đúng nhánh theo `edge`.

**Files:**

- Modify: `src/lib/split-tree.ts` (thêm `Edge` type + `movePane` + helper `dockIntoLeaf`; tái dùng `removeLeaf`, `leaf`, `leafIds` sẵn có)
- Test: `src/lib/split-tree.test.ts` (thêm `describe("movePane", ...)`)

**Interfaces:**

- Produces: `export type Edge = "top" | "bottom" | "left" | "right";` và `export function movePane(node: TreeNode, sourceId: number, targetId: number, edge: Edge): TreeNode;`
- Consumes: `removeLeaf`, `leaf`, `leafIds`, các type `TreeNode`/`Direction` — đã có trong cùng file.

- [ ] **Step 1: Viết test thất bại cho `movePane`**

Thêm vào cuối `src/lib/split-tree.test.ts`. Cập nhật dòng import ở đầu file để gồm `leaf` và `movePane`:

```ts
import { describe, expect, it } from "vitest";
import {
  countLeaves,
  leaf,
  leafIds,
  movePane,
  serializeTree,
  splitLeaf,
  treeFromLayout,
  type SerializedNode,
} from "./split-tree";
```

Rồi thêm block test:

```ts
describe("movePane", () => {
  // Hai pane cạnh nhau theo hàng: { split row, a: leaf 1, b: leaf 2 }
  const twoRow = splitLeaf(leaf(1), 1, 2, "row");

  it("docks source to the LEFT of target → row, source in branch a", () => {
    expect(movePane(twoRow, 1, 2, "left")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(2),
    });
  });

  it("docks source to the RIGHT of target → row, source in branch b", () => {
    expect(movePane(twoRow, 1, 2, "right")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(2),
      b: leaf(1),
    });
  });

  it("docks source to the TOP of target → column, source in branch a", () => {
    expect(movePane(twoRow, 1, 2, "top")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(2),
    });
  });

  it("docks source to the BOTTOM of target → column, source in branch b", () => {
    expect(movePane(twoRow, 1, 2, "bottom")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(2),
      b: leaf(1),
    });
  });

  it("collapses the source's parent split after removal", () => {
    // row( leaf 1, column( leaf 2, leaf 3 ) )
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    // Gỡ leaf 1 → outer row collapse thành column(2,3); dock 1 vào phải của 3.
    expect(movePane(tree, 1, 3, "right")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(2),
      b: {
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf(3),
        b: leaf(1),
      },
    });
  });

  it("returns the same tree reference when source === target", () => {
    expect(movePane(twoRow, 1, 1, "left")).toBe(twoRow);
  });

  it("returns the same tree reference when an id is not in the tree", () => {
    expect(movePane(twoRow, 99, 2, "left")).toBe(twoRow);
    expect(movePane(twoRow, 1, 99, "left")).toBe(twoRow);
  });

  it("does not mutate the original tree", () => {
    const snapshot = JSON.parse(JSON.stringify(twoRow));
    movePane(twoRow, 1, 2, "bottom");
    expect(twoRow).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: FAIL — `movePane` chưa tồn tại (`movePane is not a function` / lỗi import TS).

- [ ] **Step 3: Cài đặt `movePane` + `Edge` trong `src/lib/split-tree.ts`**

Thêm ngay sau `splitLeaf` (trước `removeLeaf` hoặc cuối file — miễn cùng module). Đặt `Edge` gần đầu file cạnh các type khác nếu muốn; ở đây gộp cùng khối hàm cho gọn:

```ts
export type Edge = "top" | "bottom" | "left" | "right";

/**
 * Gỡ leaf `sourceId` khỏi cây rồi ghép nó vào cạnh `edge` của leaf `targetId`.
 * Trả về cây mới; trả về cây cũ NGUYÊN THAM CHIẾU khi thao tác không hợp lệ
 * (source === target, hoặc một trong hai id không có trong cây).
 */
export function movePane(
  node: TreeNode,
  sourceId: number,
  targetId: number,
  edge: Edge,
): TreeNode {
  if (sourceId === targetId) {
    return node;
  }
  const ids = leafIds(node);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) {
    return node;
  }
  const withoutSource = removeLeaf(node, sourceId);
  if (withoutSource === null) {
    // Không thể xảy ra khi target vẫn còn, nhưng removeLeaf trả TreeNode | null.
    return node;
  }
  const dir: Direction = edge === "left" || edge === "right" ? "row" : "column";
  const sourceFirst = edge === "left" || edge === "top";
  return dockIntoLeaf(withoutSource, targetId, sourceId, dir, sourceFirst);
}

/** Thay leaf `targetId` bằng split mới chứa nó và pane `sourceId` (nguồn ở nhánh a khi `sourceFirst`). */
function dockIntoLeaf(
  node: TreeNode,
  targetId: number,
  sourceId: number,
  dir: Direction,
  sourceFirst: boolean,
): TreeNode {
  if (node.kind === "leaf") {
    if (node.paneId !== targetId) {
      return node;
    }
    const source = leaf(sourceId);
    return {
      kind: "split",
      dir,
      ratio: 0.5,
      a: sourceFirst ? source : node,
      b: sourceFirst ? node : source,
    };
  }
  return {
    ...node,
    a: dockIntoLeaf(node.a, targetId, sourceId, dir, sourceFirst),
    b: dockIntoLeaf(node.b, targetId, sourceId, dir, sourceFirst),
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận qua**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: PASS — toàn bộ block `movePane` xanh, các block cũ (`serializeTree`, `treeFromLayout`, `countLeaves`) vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add src/lib/split-tree.ts src/lib/split-tree.test.ts
git commit -m "feat(split-tree): movePane to dock a pane onto an edge of another

Claude-Session: https://claude.ai/code/session_015Ky5cf3H1Cq9u2kbgXkfqG"
```

---

### Task 2: Pane drag-dock — controller + wiring + CSS

Controller drag (DOM/pointer, không unit-test được — chu kỳ kiểm thử của nó là smoke test tay ở cuối task). Gồm module mới `pane-drag.ts`, wire vào `terminal-manager.ts`, và CSS. Làm trọn rồi mới verify + commit một lần vì nửa vời (controller mà chưa wire) không chạy được.

**Files:**

- Create: `src/terminal/pane-drag.ts`
- Modify: `src/terminal/terminal-manager.ts` (import; tạo controller trong `createTerminalManager`; toggle class `has-multiple-panes` trong `render()`; gọi `dispose()`)
- Modify: `src/styles.css` (thêm khối "Pane drag-dock" ở cuối)

**Interfaces:**

- Produces: `export interface PaneDragController { dispose(): void; }` và `export function createPaneDragController(container: HTMLElement, opts: { paneCount(): number; onMove(sourceId: number, targetId: number, edge: Edge): void; }): PaneDragController;`
- Consumes: `Edge` từ `../lib/split-tree` (Task 1); `movePane` từ `../lib/split-tree`; các closure sẵn có trong `terminal-manager.ts` (`tree`, `render`, `setActive`, `panes`, `callbacks.onLayoutChange`).

- [ ] **Step 1: Tạo `src/terminal/pane-drag.ts`**

Cơ chế: một listener `pointerdown` trên `container` (event delegation, sống sót renderTree). Chưa vào drag cho tới khi con trỏ vượt ngưỡng 5px. Khi drag: `setPointerCapture`, thêm class `is-pane-dragging`, tạo ghost + overlay trên `document.body`. Hit-test mỗi `pointermove` bằng rect math trên `.pane-slot` (KHÔNG `elementFromPoint`). Cạnh đích theo đường chéo (nearest edge chuẩn hoá) — không có vùng chết. Hover lên chính pane nguồn → ẩn overlay. `pointerup` có target hợp lệ → `onMove`; không thì hủy êm. Escape / `pointercancel` → hủy.

```ts
import type { Edge } from "../lib/split-tree";

export interface PaneDragController {
  dispose(): void;
}

interface PaneDragOptions {
  paneCount(): number;
  onMove(sourceId: number, targetId: number, edge: Edge): void;
}

const DRAG_THRESHOLD = 5;

export function createPaneDragController(
  container: HTMLElement,
  opts: PaneDragOptions,
): PaneDragController {
  let startX = 0;
  let startY = 0;
  let sourceId: number | null = null;
  let pointerId: number | null = null;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let target: { id: number; edge: Edge } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const el = event.target as HTMLElement;
    if (el.closest(".split__divider")) {
      return; // để divider tự xử lý resize
    }
    const bar = el.closest(".pane__bar");
    if (!bar) {
      return; // chỉ kéo từ thanh header, không từ vùng xterm
    }
    if (opts.paneCount() < 2) {
      return;
    }
    const slot = bar.closest<HTMLElement>(".pane-slot");
    if (!slot) {
      return;
    }
    sourceId = Number(slot.dataset.paneId);
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    // Chưa vào drag — chờ vượt ngưỡng ở pointermove.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function beginDrag(): void {
    dragging = true;
    container.classList.add("is-pane-dragging");
    if (pointerId !== null) {
      try {
        container.setPointerCapture(pointerId);
      } catch {
        // con trỏ đã nhả — bỏ qua
      }
    }
    ghost = document.createElement("div");
    ghost.className = "pane-drag-ghost";
    const slot = container.querySelector<HTMLElement>(
      `.pane-slot[data-pane-id="${sourceId}"]`,
    );
    ghost.textContent =
      slot?.querySelector(".pane__cwd")?.textContent || "pane";
    overlay = document.createElement("div");
    overlay.className = "drop-overlay";
    overlay.style.display = "none";
    // LUÔN append vào body — renderTree replaceChildren(container) sẽ wipe nếu ở trong container.
    document.body.append(ghost, overlay);
  }

  function moveGhost(x: number, y: number): void {
    if (ghost) {
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
    }
  }

  /** Cạnh gần nhất theo khoảng cách chuẩn hoá tới 4 cạnh (chia theo đường chéo). */
  function edgeFor(rect: DOMRect, x: number, y: number): Edge {
    const left = (x - rect.left) / rect.width;
    const right = (rect.right - x) / rect.width;
    const top = (y - rect.top) / rect.height;
    const bottom = (rect.bottom - y) / rect.height;
    const min = Math.min(left, right, top, bottom);
    if (min === left) {
      return "left";
    }
    if (min === right) {
      return "right";
    }
    if (min === top) {
      return "top";
    }
    return "bottom";
  }

  function hitTest(x: number, y: number): void {
    for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
      const rect = slot.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        const id = Number(slot.dataset.paneId);
        if (id === sourceId) {
          break; // hover trên chính nguồn → không dock
        }
        target = { id, edge: edgeFor(rect, x, y) };
        showOverlay(rect, target.edge);
        return;
      }
    }
    target = null;
    hideOverlay();
  }

  function showOverlay(rect: DOMRect, edge: Edge): void {
    if (!overlay) {
      return;
    }
    let left = rect.left;
    let top = rect.top;
    let width = rect.width;
    let height = rect.height;
    if (edge === "left") {
      width = rect.width / 2;
    } else if (edge === "right") {
      left = rect.left + rect.width / 2;
      width = rect.width / 2;
    } else if (edge === "top") {
      height = rect.height / 2;
    } else {
      top = rect.top + rect.height / 2;
      height = rect.height / 2;
    }
    overlay.style.display = "block";
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  function hideOverlay(): void {
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (!dragging) {
      if (
        Math.abs(event.clientX - startX) < DRAG_THRESHOLD &&
        Math.abs(event.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      beginDrag();
    }
    moveGhost(event.clientX, event.clientY);
    hitTest(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    const wasDragging = dragging;
    const dropTarget = target;
    const src = sourceId;
    cleanup();
    if (wasDragging && dropTarget && src !== null) {
      opts.onMove(src, dropTarget.id, dropTarget.edge);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    cleanup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && dragging) {
      event.preventDefault();
      cleanup();
    }
  }

  function cleanup(): void {
    if (pointerId !== null) {
      try {
        container.releasePointerCapture(pointerId);
      } catch {
        // chưa capture — bỏ qua
      }
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, true);
    container.classList.remove("is-pane-dragging");
    ghost?.remove();
    overlay?.remove();
    ghost = null;
    overlay = null;
    target = null;
    sourceId = null;
    pointerId = null;
    dragging = false;
  }

  container.addEventListener("pointerdown", onPointerDown);

  return {
    dispose(): void {
      container.removeEventListener("pointerdown", onPointerDown);
      cleanup();
    },
  };
}
```

- [ ] **Step 2: Wire controller vào `terminal-manager.ts` — import**

Thêm vào khối import từ `../lib/split-tree` (hiện gồm `countLeaves, leaf, leafIds, removeLeaf, replaceLeaf, serializeTree, setRatio, splitLeaf, treeFromLayout` + các type). Bổ sung `movePane` và type `Edge`:

```ts
import {
  countLeaves,
  leaf,
  leafIds,
  movePane,
  removeLeaf,
  replaceLeaf,
  serializeTree,
  setRatio,
  splitLeaf,
  treeFromLayout,
  type Direction,
  type Edge,
  type SerializedNode,
  type TreeNode,
} from "../lib/split-tree";
```

Và thêm import controller (cạnh `import { createPane, ... } from "./pane";`):

```ts
import { createPaneDragController, type PaneDragController } from "./pane-drag";
```

- [ ] **Step 3: Tạo controller trong `createTerminalManager`**

Sau khối khai báo `const panes = ...; const exited = ...; const respawning = ...; let tree = ...; let activeId = ...;` (dòng ~63–67), và SAU khi `render`/`setActive` đã được định nghĩa bên dưới không thành vấn đề vì `onMove` chỉ chạy lúc runtime — nhưng đặt khai báo controller **sau** định nghĩa hàm `render` và `setActive` để tránh dùng-trước-khai-báo trong closure. Đặt ngay trước `return { ... }` (dòng ~315):

```ts
const paneDrag: PaneDragController = createPaneDragController(container, {
  paneCount: () => panes.size,
  onMove(sourceId, targetId, edge) {
    if (!tree) {
      return;
    }
    const next = movePane(tree, sourceId, targetId, edge);
    if (next === tree) {
      return; // no-op: id không hợp lệ, hoặc source/target đã đóng giữa lúc kéo
    }
    tree = next;
    render();
    setActive(sourceId);
    panes.get(sourceId)?.focus();
    callbacks.onLayoutChange();
  },
});
```

- [ ] **Step 4: Toggle class `has-multiple-panes` trong `render()`**

Trong hàm `render()` (dòng ~118), thêm một dòng ngay sau guard `if (!tree) { return; }` để cursor `grab` và gate drag khớp cùng nguồn `panes.size > 1` đang dùng cho `highlightActive`:

```ts
function render(): void {
  if (!tree) {
    return;
  }
  container.classList.toggle("has-multiple-panes", panes.size > 1);
  renderTree(container, tree, {
    // ... giữ nguyên phần còn lại
```

- [ ] **Step 5: Dispose controller khi manager dispose**

Trong method `dispose()` của object trả về (dòng ~371), thêm `paneDrag.dispose();` trước `container.remove();`:

```ts
    dispose() {
      paneDrag.dispose();
      for (const pane of panes.values()) {
        invoke("kill_pty", { id: pane.id }).catch(() => {
          // Session already gone — ignore
        });
        pane.dispose();
      }
      panes.clear();
      container.remove();
    },
```

- [ ] **Step 6: CSS pane drag-dock**

Nối vào cuối `src/styles.css`. KHÔNG dùng `box-shadow` (flat rule). Ghost + overlay `position: fixed`, con của body:

```css
/* ── Pane drag-dock ──────────────────────────────────────── */

.has-multiple-panes .pane__bar {
  cursor: grab;
}

.is-pane-dragging {
  cursor: grabbing;
  user-select: none;
}

/* Chặn pointer events trên terminal khi đang kéo pane — không selection,
   không nhiễu hit-test (hit-test dùng rect math nên vẫn chạy) */
.is-pane-dragging .pane {
  pointer-events: none;
}

.pane-drag-ghost {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  max-width: 240px;
  padding: 6px 11px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--chrome-2);
  border: 1px solid var(--hair-strong);
  border-radius: 6px;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drop-overlay {
  position: fixed;
  z-index: 999;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: var(--radius);
  transition:
    left 0.08s ease,
    top 0.08s ease,
    width 0.08s ease,
    height 0.08s ease;
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: qua sạch, không lỗi TS. (`movePane`/`Edge` resolve từ Task 1; `PaneDragController` khớp.)

- [ ] **Step 8: Smoke test tay (chu kỳ kiểm thử của controller)**

Run: `npm run tauri dev`, kiểm với một tab có ≥3 pane:

- Kéo header một pane → hiện ghost bám con trỏ + overlay phủ đúng nửa pane đích theo cạnh gần nhất (trên/dưới/trái/phải theo đường chéo).
- Thả → pane được dock đúng cạnh; **nội dung terminal không mất** sau move; pane nguồn được focus.
- Hover lên chính pane nguồn → không hiện overlay; thả lên nguồn → không đổi gì.
- Hủy: nhấn Esc giữa lúc kéo → ghost/overlay biến mất, layout nguyên; thả ra ngoài mọi pane / lên divider → hủy êm.
- Tab chỉ có 1 pane → kéo header không khởi động drag (không có cursor grab).
- Selection text trong xterm vẫn hoạt động khi KHÔNG kéo (chỉ khởi động drag từ `.pane__bar`).
- Quit rồi relaunch → layout đã move được restore đúng.

- [ ] **Step 9: Commit**

```bash
git add src/terminal/pane-drag.ts src/terminal/terminal-manager.ts src/styles.css
git commit -m "feat(terminal): drag a pane by its header to dock onto another (VS Code style)

Claude-Session: https://claude.ai/code/session_015Ky5cf3H1Cq9u2kbgXkfqG"
```

---

### Task 3: Hàm thuần `shellEscapePath` / `shellEscapePaths` (TDD)

Escape path để dán an toàn vào dòng lệnh shell (kiểu iTerm2): ký tự an toàn giữ nguyên, unicode giữ nguyên, chỉ backslash-escape ký tự shell đặc biệt + khoảng trắng.

**Files:**

- Create: `src/lib/shell-escape.ts`
- Test: `src/lib/shell-escape.test.ts`

**Interfaces:**

- Produces: `export function shellEscapePath(path: string): string;` và `export function shellEscapePaths(paths: readonly string[]): string;`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/shell-escape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shellEscapePath, shellEscapePaths } from "./shell-escape";

describe("shellEscapePath", () => {
  it("leaves a clean path untouched", () => {
    expect(shellEscapePath("/Users/me/dev/file.txt")).toBe(
      "/Users/me/dev/file.txt",
    );
  });

  it("escapes spaces", () => {
    expect(shellEscapePath("/Users/me/My File.txt")).toBe(
      "/Users/me/My\\ File.txt",
    );
  });

  it("escapes quotes, $ and &", () => {
    expect(shellEscapePath("a'b")).toBe("a\\'b");
    expect(shellEscapePath('a"b')).toBe('a\\"b');
    expect(shellEscapePath("a$b")).toBe("a\\$b");
    expect(shellEscapePath("a&b")).toBe("a\\&b");
  });

  it("escapes parentheses", () => {
    expect(shellEscapePath("a(b)c")).toBe("a\\(b\\)c");
  });

  it("keeps unicode (Vietnamese) but still escapes the space", () => {
    expect(shellEscapePath("/Users/me/Tài liệu")).toBe("/Users/me/Tài\\ liệu");
  });

  it("returns empty string for empty input", () => {
    expect(shellEscapePath("")).toBe("");
  });
});

describe("shellEscapePaths", () => {
  it("joins escaped paths with spaces and adds a trailing space", () => {
    expect(shellEscapePaths(["/a b", "/c"])).toBe("/a\\ b /c ");
  });

  it("returns empty string for an empty array", () => {
    expect(shellEscapePaths([])).toBe("");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/lib/shell-escape.test.ts`
Expected: FAIL — module `./shell-escape` chưa tồn tại.

- [ ] **Step 3: Cài đặt `src/lib/shell-escape.ts`**

```ts
// Ký tự an toàn không cần escape trên dòng lệnh (kiểu iTerm2).
const SAFE_CHAR = /[A-Za-z0-9/._+:@%,=~-]/;

/** Escape một path để dán an toàn vào dòng lệnh shell (kiểu iTerm2). */
export function shellEscapePath(path: string): string {
  let out = "";
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    // Giữ nguyên ký tự an toàn ASCII và mọi ký tự unicode (> 127);
    // backslash-escape phần còn lại (space, quote, $, &, (, ), ...).
    if (SAFE_CHAR.test(ch) || code > 127) {
      out += ch;
    } else {
      out += `\\${ch}`;
    }
  }
  return out;
}

/** Escape + nối nhiều path bằng dấu cách, thêm một dấu cách cuối. */
export function shellEscapePaths(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  return `${paths.map(shellEscapePath).join(" ")} `;
}
```

- [ ] **Step 4: Chạy test để xác nhận qua**

Run: `npx vitest run src/lib/shell-escape.test.ts`
Expected: PASS — toàn bộ xanh.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shell-escape.ts src/lib/shell-escape.test.ts
git commit -m "feat(shell-escape): escape dropped file paths for the command line

Claude-Session: https://claude.ai/code/session_015Ky5cf3H1Cq9u2kbgXkfqG"
```

---

### Task 4: File drop vào pane — module + wiring + CSS

Đăng ký `onDragDropEvent` một lần trong `tab-manager.init()`, route xuống tab đang hiển thị; TerminalManager thêm 3 method để highlight + ghi PTY. DOM/Tauri, verify bằng smoke test tay ở cuối.

**Files:**

- Create: `src/terminal/file-drop.ts`
- Modify: `src/terminal/terminal-manager.ts` (interface + 3 method `fileDragOver`/`fileDragLeave`/`fileDrop`; import `shellEscapePaths`)
- Modify: `src/terminal/tab-manager.ts` (đăng ký `installFileDrop` trong `init()`, push unlisten vào `unlisteners`; import)
- Modify: `src/styles.css` (thêm khối "File drop target")

**Interfaces:**

- Produces (`file-drop.ts`): `export interface FileDropHandlers { onOver(x: number, y: number): void; onDrop(x: number, y: number, paths: string[]): void; onLeave(): void; }` và `export function installFileDrop(handlers: FileDropHandlers): Promise<UnlistenFn>;` (toạ độ x/y là **logical CSS px**, cùng gốc `clientX/clientY`).
- Produces (`TerminalManager`): `fileDragOver(x: number, y: number): void;`, `fileDragLeave(): void;`, `fileDrop(x: number, y: number, paths: string[]): void;`
- Consumes: `getCurrentWebview().onDragDropEvent` (`@tauri-apps/api/webview`), `getCurrentWindow().scaleFactor()` (`@tauri-apps/api/window`), `UnlistenFn` (`@tauri-apps/api/event`), `shellEscapePaths` (Task 3), `invoke("write_pty", ...)` sẵn có, `activeManager()` trong tab-manager.

- [ ] **Step 1: Tạo `src/terminal/file-drop.ts`**

`onDragDropEvent` callback là **đồng bộ** → không await được bên trong. Lấy `scaleFactor` **một lần** lúc install rồi dùng `position.toLogical(scaleFactor)` trong callback. (Hạn chế đã biết: nếu cửa sổ chuyển sang màn hình khác scale factor giữa phiên, giá trị cache có thể lệch — chấp nhận được cho phạm vi này; nếu cần chính xác tuyệt đối, follow-up bằng listener đổi scale. Verify runtime gốc toạ độ drop = gốc `getBoundingClientRect` lúc implement — với `titleBarStyle: "Overlay"` webview phủ full window nên nhiều khả năng trùng.)

```ts
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface FileDropHandlers {
  /** toạ độ logical (CSS px) — cùng gốc clientX/clientY */
  onOver(x: number, y: number): void;
  onDrop(x: number, y: number, paths: string[]): void;
  onLeave(): void;
}

export async function installFileDrop(
  handlers: FileDropHandlers,
): Promise<UnlistenFn> {
  // Callback dưới đây chạy đồng bộ → lấy scaleFactor sẵn ở đây.
  const scaleFactor = await getCurrentWindow().scaleFactor();
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    switch (payload.type) {
      // `enter` bắn ĐẦU TIÊN khi drag vào webview; gộp với `over`.
      case "enter":
      case "over": {
        const { x, y } = payload.position.toLogical(scaleFactor);
        handlers.onOver(x, y);
        break;
      }
      case "drop": {
        const { x, y } = payload.position.toLogical(scaleFactor);
        handlers.onDrop(x, y, payload.paths);
        break;
      }
      case "leave":
        handlers.onLeave();
        break;
    }
  });
}
```

- [ ] **Step 2: Thêm import `shellEscapePaths` vào `terminal-manager.ts`**

Cạnh import `paneHeaderInfo` từ `../lib/process-info`:

```ts
import { shellEscapePaths } from "../lib/shell-escape";
```

- [ ] **Step 3: Thêm 3 method vào interface `TerminalManager`**

Trong khối `export interface TerminalManager { ... }`, thêm (cạnh các method khác, ví dụ sau `notifyError`):

```ts
  /** Highlight pane dưới con trỏ khi kéo file (toạ độ logical CSS px). */
  fileDragOver(x: number, y: number): void;
  /** Bỏ mọi highlight drop-target. */
  fileDragLeave(): void;
  /** Ghi các path (đã shell-escape) vào PTY của pane dưới con trỏ. */
  fileDrop(x: number, y: number, paths: string[]): void;
```

- [ ] **Step 4: Cài đặt 3 method trong `createTerminalManager`**

Thêm các hàm helper + 3 hàm này trước `return { ... }` (ví dụ sau hàm `cycleFocus`). `container` ở đây là container của tab; rect math trên `.pane-slot` bằng toạ độ logical (cùng gốc getBoundingClientRect):

```ts
function slotAt(x: number, y: number): HTMLElement | null {
  for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
    const r = slot.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return slot;
    }
  }
  return null;
}

function clearDropTargets(): void {
  for (const slot of container.querySelectorAll<HTMLElement>(
    ".pane-slot.is-drop-target",
  )) {
    slot.classList.remove("is-drop-target");
  }
}

function fileDragOver(x: number, y: number): void {
  clearDropTargets();
  slotAt(x, y)?.classList.add("is-drop-target");
}

function fileDragLeave(): void {
  clearDropTargets();
}

function fileDrop(x: number, y: number, paths: string[]): void {
  clearDropTargets();
  const slot = slotAt(x, y);
  if (!slot) {
    return; // drop ngoài mọi pane (tab bar / status bar) → bỏ qua
  }
  const id = Number(slot.dataset.paneId);
  if (!panes.has(id) || exited.has(id)) {
    return; // pane đã exit → không ghi PTY chết
  }
  const data = shellEscapePaths(paths);
  if (data === "") {
    return;
  }
  invoke("write_pty", { id, data }).catch((err: unknown) => {
    console.error("write_pty failed:", err);
  });
  setActive(id);
  panes.get(id)?.focus();
}
```

Và thêm chúng vào object trả về (cạnh `notifyError`):

```ts
    fileDragOver,
    fileDragLeave,
    fileDrop,
```

- [ ] **Step 5: Đăng ký `installFileDrop` trong `tab-manager.ts`**

Thêm import (cạnh import từ `./terminal-manager`):

```ts
import { installFileDrop } from "./file-drop";
```

Trong hàm `init()`, sau hai `unlisteners.push(await listen(...))` cho `pty:output`/`pty:exit` và trước `window.addEventListener("keydown", ...)`, thêm:

```ts
unlisteners.push(
  await installFileDrop({
    onOver(x, y) {
      activeManager()?.fileDragOver(x, y);
    },
    onDrop(x, y, paths) {
      activeManager()?.fileDrop(x, y, paths);
    },
    onLeave() {
      activeManager()?.fileDragLeave();
    },
  }),
);
```

(Route xuống `activeManager()` — chỉ tab đang hiển thị nhận; id pane là PTY id toàn cục nên không nhầm tab.)

- [ ] **Step 6: CSS file drop target**

Nối vào cuối `src/styles.css` (KHÔNG box-shadow — flat rule; dùng border + outline accent):

```css
/* ── File drop target ────────────────────────────────────── */

.pane-slot.is-drop-target .pane {
  border-color: color-mix(in srgb, var(--accent) 80%, transparent);
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: -2px;
}
```

- [ ] **Step 7: Kiểm quyền Tauri + typecheck**

`onDragDropEvent` là event listener; Tauri config hiện bật drag-drop mặc định (`dragDropEnabled` không tắt) và `capabilities/default.json` đã có `core:default`. Nếu runtime báo thiếu quyền, thêm `"core:event:default"` vào mảng `permissions` của `src-tauri/capabilities/default.json`.

Run: `npx tsc --noEmit`
Expected: qua sạch — payload 4 variant khớp `DragDropEvent`, 3 method mới khớp interface.

- [ ] **Step 8: Smoke test tay**

Run: `npm run tauri dev`, kéo từ Finder:

- 1 file → path đúng được gõ vào prompt của pane thả (đã escape), pane đó được focus.
- Nhiều file → nối bằng dấu cách + có dấu cách cuối.
- File có space + ký tự đặc biệt trong tên → escape đúng; folder cũng chèn path (không auto-cd).
- Khi rê qua các pane → pane dưới con trỏ sáng viền accent (`is-drop-target`); rời webview → tắt highlight.
- Drop vào pane **không active** → pane đó nhận + được focus (không phải pane đang active trước đó).
- Drop vào pane **đã exit** (shell chết, đang chờ Enter) → không có gì xảy ra, highlight được dọn.
- Nhiều tab → chỉ tab đang hiển thị nhận; drop ngoài pane (tab bar/status bar) → bỏ qua.
- Không xung đột với pane drag (OS drag từ Finder không sinh pointer events; pane drag nội bộ không kích hoạt Tauri drag event).

- [ ] **Step 9: Commit**

```bash
git add src/terminal/file-drop.ts src/terminal/terminal-manager.ts \
  src/terminal/tab-manager.ts src/styles.css
git commit -m "feat(terminal): drop files from Finder to insert their paths into a pane

Claude-Session: https://claude.ai/code/session_015Ky5cf3H1Cq9u2kbgXkfqG"
```

---

### Task 5: Verification tổng + regression tay

Không code — chạy lại toàn bộ verify và đối chiếu các bất biến tương tác giữa hai tính năng (spec §3).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: PASS toàn bộ (gồm `split-tree.test.ts` với block `movePane`, `shell-escape.test.ts`, và các test cũ `settings-schema`/`process-info`/`session-schema`/`keymap`).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: `tsc` + `vite build` qua sạch, không lỗi TS.

- [ ] **Step 3: Regression tay các đường không được vỡ (spec §3)**

Run: `npm run tauri dev`, xác nhận:

- Shortcut `⌘D`/`⌘⇧D`/`⌘⇧W`/`⌘]`/`⌘[` + tab shortcuts vẫn chạy (không đụng keyboard path → IME tiếng Việt Telex/dead-key giữ nguyên: gõ dấu trong terminal bình thường).
- Divider resize vẫn kéo được (pane drag bỏ qua `.split__divider`).
- Pane close/exit **giữa lúc kéo** an toàn: mở 2 pane, kéo một pane, trong lúc kéo gõ `exit` ở pane kia (hoặc để shell chết) → không crash; thả ra vẫn hủy êm hoặc dock hợp lệ (movePane no-op nếu id không còn).
- Session move pane → quit → relaunch: layout restore đúng (serialize structure-only, không đổi schema).

Task 5 không commit gì thêm (chỉ verify). Nếu phát hiện lỗi → quay lại task tương ứng.

---

## Self-Review

**1. Spec coverage:**

- §1.1 `movePane` (4 cạnh, dir + nhánh theo edge, ratio 0.5, no-op invalid, collapse cha, không mutate, không tái dùng `splitLeaf`) → **Task 1** (code + 8 test case). ✅
- §1.2 `pane-drag.ts` (event delegation trên container, ngưỡng 5px, setPointerCapture, ghost + overlay trên body, hit-test rect math, cạnh theo đường chéo, hover nguồn ẩn overlay, pointerup/Escape/pointercancel, pane close giữa drag an toàn, dispose) → **Task 2 Step 1**. ✅
- §1.3 wiring terminal-manager (`onMove` → movePane, so `next === tree`, render/setActive/focus/onLayoutChange, dispose) → **Task 2 Step 2–5**. ✅
- §1.4 CSS (cursor grab qua `has-multiple-panes`, grabbing, ghost, overlay trên body, `is-pane-dragging` tắt pointer-events pane) → **Task 2 Step 4, 6**. ✅
- §2.1 `shellEscapePath`/`shellEscapePaths` (an toàn giữ nguyên, unicode giữ nguyên, escape special + space, mảng rỗng → "") → **Task 3**. ✅
- §2.2 `file-drop.ts` (`onDragDropEvent`, 4 variant mapping enter+over→onOver, toLogical(scaleFactor)) → **Task 4 Step 1**. ✅
- §2.3 routing (installFileDrop một lần trong `init()`, `activeManager()`, 3 method fileDragOver/Leave/Drop, exit-guard, write_pty + focus) → **Task 4 Step 3–5**. ✅
- §2.4 CSS `.is-drop-target` → **Task 4 Step 6**. ✅
- §3 tương tác + ràng buộc (không xung đột, không đụng keyboard/IME, persistence qua onLayoutChange, không nhầm tab) → **Task 5 Step 3** regression. ✅
- §4 kiểm thử (unit movePane + shell-escape; manual đủ kịch bản) → Task 1/3 (unit) + Task 2 Step 8, Task 4 Step 8, Task 5 (manual). ✅
- §5 không làm (cross-tab drag, swap/floating, auto-cd, backend Rust) → không có task nào chạm; giữ đúng phạm vi. ✅

**2. Placeholder scan:** Mọi step có code/lệnh cụ thể + expected output. Không có TBD/TODO/"handle edge cases". ✅

**3. Type consistency:** `Edge` định nghĩa ở Task 1, dùng lại ở Task 2 (`pane-drag.ts` import + `onMove` signature) và terminal-manager. `movePane(node, sourceId, targetId, edge): TreeNode` khớp giữa Task 1 và caller Task 2. `PaneDragController.dispose()` khớp Task 2 Step 1/5. `installFileDrop(handlers): Promise<UnlistenFn>` + `FileDropHandlers` khớp Task 4 Step 1 và caller Step 5. 3 method `fileDragOver`/`fileDragLeave`/`fileDrop` khớp interface (Task 4 Step 3) ↔ cài đặt (Step 4) ↔ caller tab-manager (Step 5). `shellEscapePaths(readonly string[]): string` khớp Task 3 ↔ dùng ở Task 4 Step 4. ✅

**Ghi chú điều chỉnh so với thứ tự gợi ý:** Giữ nguyên thứ tự đề xuất (1 movePane → 2 pane-drag → 3 shell-escape → 4 file-drop → 5 manual). Hai tính năng độc lập, hàm thuần đứng trước phần tích hợp dùng nó (TDD), phần DOM controller không unit-test được nên gộp create+wire+CSS thành một task có smoke test tay làm chu kỳ kiểm thử — đúng nguyên tắc "task nhỏ nhất mang chu kỳ test riêng". Điểm cần lưu ý khi implement: `installFileDrop` cache `scaleFactor` một lần (callback đồng bộ không await được) — đã ghi hạn chế multi-monitor ở Task 4 Step 1; và CSS drop-target dùng `outline` thay `box-shadow` để tôn trọng flat-design rule của repo.
