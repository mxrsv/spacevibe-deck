# UI Redesign: Tab bar + Status bar + Multi-session Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay sidebar bằng tab bar Warp-style (multi-session tabs, mỗi tab một split tree + PTY riêng), thêm status bar, chrome phẳng theo theme, settings panel dạng slide-over, và persistence cấu trúc tab/split qua `session.json`.

**Architecture:** `terminal-manager.ts` co lại thành đơn vị per-tab (mất listener toàn cục); `tab-manager.ts` mới là orchestrator duy nhất — giữ một listener `pty:output`/`pty:exit`, một `keydown` (qua `keymap.ts`), một poll 2s gọi lệnh Rust `pty_info`/`git_branch` mới, và persist session (debounce 500ms) qua `tauri-plugin-store`. UI (Preact) đọc từ signals trong `tabs-store.ts`.

**Tech Stack:** Tauri 2 (Rust, `portable-pty`, `libc` bindings cho libproc syscalls), Preact + `@preact/signals`, xterm.js, `@tauri-apps/plugin-store`, Vitest (mới, cho unit tests thuần).

## Global Constraints

- **Text trong code (strings/comments/docs) 100% English** (quy ước repo).
- **Flat chrome: KHÔNG `box-shadow` ở bất kỳ đâu trong `src/styles.css`** — depth chỉ từ background steps + 1px hairline borders. (2 chỗ box-shadow hiện tại — `.select:focus-visible` và `.pane-slot.is-active` — bị thay thế trong Task 11.)
- Immutability, file nhỏ tập trung (< 400 dòng/target), validate mọi dữ liệu external (`session.json`, kết quả `pty_info`).
- Shortcut cũ giữ nguyên phím: `⌘D`/`⌘⇧D`/`⌘⇧W`/`⌘]`/`⌘[`. Mới: `⌘T`, `⌘W`, `⌘⇧]`, `⌘⇧[`, `⌘1…⌘9`.
- Versions: `vitest` `^3` (devDependency, tương thích Vite 6); Rust `libc = "0.2"` (chỉ target macOS). Không thêm dep nào khác.
- Làm việc và commit **trực tiếp trên `main`** (không tự tạo branch — quy ước user).
- Verify mỗi task: `npx vitest run` (khi có test), `npm run build` (tsc + vite), `cargo build` trong `src-tauri` (khi đụng Rust). Smoke test tay qua `npm run tauri dev` ở các task được ghi rõ.
- Mọi commit kết thúc bằng trailer:
  `Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj`
- **Trạng thái repo (baseline đã verify):** plan 2026-07-02 (quit-confirm + keymap) **ĐÃ chạy** (commits `29ad6ab`, `98e54b2`, `8bdbc60`). Cụ thể: `src/terminal/keymap.ts` đã tồn tại (5 pane action cũ); `terminal-manager.ts` đã dùng `matchBinding`; `src-tauri/src/menu.rs` đã tồn tại (menu default + item Quit tuỳ chỉnh id `quit-confirm` phát event `quit-requested`); `lib.rs` đã có `QuitState`/`confirm_quit`/`tauri_plugin_dialog`/`.setup(menu::install)`/vòng `RunEvent::ExitRequested`; `src/lib/quit-guard.ts` đã tồn tại và `app.tsx` đang cài `installQuitGuard`. **Tính năng quit-confirm KHÔNG được phép regress:** mọi bản rewrite `app.tsx` phải giữ `installQuitGuard`; sửa menu phải giữ item Quit tuỳ chỉnh; `lib.rs` chỉ edit cộng thêm.

## File Map

| File | Hành động | Task |
| --- | --- | --- |
| `package.json` | thêm vitest + script `test` | 1 |
| `src/terminal/keymap.ts` | ghi đè (superset: actions cũ + tab actions) | 1 |
| `src/terminal/keymap.test.ts` | tạo | 1 |
| `src/lib/split-tree.ts` | thêm serialize/restore | 2 |
| `src/lib/split-tree.test.ts` | tạo | 2 |
| `src/lib/session-schema.ts` | tạo (validate `session.json`) | 3 |
| `src/lib/session-schema.test.ts` | tạo | 3 |
| `src/lib/process-info.ts` | tạo (agent dot/badge/tildify) | 4 |
| `src/lib/process-info.test.ts` | tạo | 4 |
| `src/settings/settings-schema.ts` | bỏ `sidebarPosition`, thêm `restoreTabs` | 5 |
| `src/settings/settings-schema.test.ts` | tạo | 5 |
| `src/ui/settings-panel.tsx` | bỏ section Sidebar, thêm section Tabs | 5 (redesign đầy đủ ở 12) |
| `src/ui/sidebar.tsx` | type nội bộ (5) → **xoá** (11) | 5, 11 |
| `src-tauri/src/pty.rs` | `child_pid` + `foreground_pids()` | 6 |
| `src-tauri/src/info.rs` | tạo (`pty_info`, `git_branch`) | 6 |
| `src-tauri/src/lib.rs` | đăng ký 2 command mới (edit cộng thêm) | 6 |
| `src-tauri/src/menu.rs` | menu tường minh — giữ Quit confirm, bỏ Close Window | 7 |
| `src-tauri/Cargo.toml` | dep `libc` (macOS) | 6 |
| `src/terminal/pane.ts` | header bar + `setHeaderInfo` | 8 |
| `src/terminal/terminal-manager.ts` | refactor per-tab | 9 |
| `src/terminal/tabs-store.ts` | tạo (signals) | 9 |
| `src/terminal/session-persistence.ts` | tạo (load/save debounce) | 9 |
| `src/terminal/tab-manager.ts` | tạo (orchestrator) | 9 (poll ở 10) |
| `src/ui/app.tsx` | wiring engine (9) → grid layout (11) | 9, 11 |
| `src/ui/tab-bar.tsx` | tạo | 11 |
| `src/ui/status-bar.tsx` | tạo | 11 |
| `src/styles.css` | thêm tối thiểu (8, 9) → viết lại (11) | 8, 9, 11, 12 |
| `src-tauri/tauri.conf.json` | titleBarStyle Overlay | 11 |

Không đổi: `src/terminal/layout.ts`, `src/ui/controls/*`, `src/settings/settings-store.ts`, `src/settings/themes.ts`, `src/lib/quit-guard.ts`, `src/main.tsx`, `index.html`.

---

### Task 1: Vitest + keymap tập trung (kèm tab actions)

**Files:**

- Modify: `package.json` (devDep + script)
- Rewrite: `src/terminal/keymap.ts` (đã tồn tại với 5 pane action — ghi đè bằng bản superset, comment chuyển sang English theo quy ước repo)
- Test: `src/terminal/keymap.test.ts`

**Interfaces:**

- Produces: `ShortcutAction` (union, gồm cả `` `select-tab-${number}` ``), `KeyBinding`, `DEFAULT_KEYMAP: readonly KeyBinding[]`, `matchBinding(event, keymap?): ShortcutAction | null`, `selectTabIndex(action): number | null` (0-based, null nếu không phải select-tab).
- Consumes: không (module thuần).

- [ ] **Step 1: Cài vitest + script test**

Run: `npm install -D vitest@^3`

Rồi thêm vào `package.json` khối `"scripts"` (sau `"preview"`):

```json
    "preview": "vite preview",
    "test": "vitest run",
```

Expected: `package.json` có `"vitest": "^3..."` trong `devDependencies`.

- [ ] **Step 2: Viết test fail trước — `src/terminal/keymap.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { matchBinding, selectTabIndex } from "./keymap";

function keyEvent(
  key: string,
  mods: Partial<
    Pick<KeyboardEvent, "metaKey" | "shiftKey" | "altKey" | "ctrlKey">
  > = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  } as KeyboardEvent;
}

describe("matchBinding", () => {
  it("keeps the existing pane bindings", () => {
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("split-row");
    expect(matchBinding(keyEvent("d", { metaKey: true, shiftKey: true }))).toBe(
      "split-column",
    );
    expect(matchBinding(keyEvent("w", { metaKey: true, shiftKey: true }))).toBe(
      "close-pane",
    );
    expect(matchBinding(keyEvent("]", { metaKey: true }))).toBe("focus-next");
    expect(matchBinding(keyEvent("[", { metaKey: true }))).toBe("focus-prev");
  });

  it("matches the new tab bindings", () => {
    expect(matchBinding(keyEvent("t", { metaKey: true }))).toBe("new-tab");
    expect(matchBinding(keyEvent("w", { metaKey: true }))).toBe("close-tab");
    // On a US layout Shift+] produces "}" and Shift+[ produces "{"
    expect(matchBinding(keyEvent("}", { metaKey: true, shiftKey: true }))).toBe(
      "next-tab",
    );
    expect(matchBinding(keyEvent("{", { metaKey: true, shiftKey: true }))).toBe(
      "prev-tab",
    );
  });

  it("matches Cmd+1..9 to select-tab actions", () => {
    expect(matchBinding(keyEvent("1", { metaKey: true }))).toBe("select-tab-1");
    expect(matchBinding(keyEvent("9", { metaKey: true }))).toBe("select-tab-9");
  });

  it("returns null when modifiers do not match exactly", () => {
    expect(matchBinding(keyEvent("t"))).toBeNull();
    expect(
      matchBinding(keyEvent("t", { metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      matchBinding(keyEvent("d", { metaKey: true, ctrlKey: true })),
    ).toBeNull();
    expect(matchBinding(keyEvent("0", { metaKey: true }))).toBeNull();
  });
});

describe("selectTabIndex", () => {
  it("parses select-tab actions into a 0-based index", () => {
    expect(selectTabIndex("select-tab-1")).toBe(0);
    expect(selectTabIndex("select-tab-9")).toBe(8);
  });

  it("returns null for every other action", () => {
    expect(selectTabIndex("new-tab")).toBeNull();
    expect(selectTabIndex("split-row")).toBeNull();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npx vitest run src/terminal/keymap.test.ts`
Expected: FAIL — `keymap.ts` hiện có chưa export `selectTabIndex` (lỗi import) và `matchBinding` chưa biết các binding tab mới.

- [ ] **Step 4: Ghi đè toàn bộ `src/terminal/keymap.ts`**

```ts
export type ShortcutAction =
  | "split-row"
  | "split-column"
  | "close-pane"
  | "focus-next"
  | "focus-prev"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "prev-tab"
  | `select-tab-${number}`;

export interface KeyBinding {
  readonly key: string; // event.key, lowercased
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ShortcutAction;
}

const TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 9 },
  (_, index): KeyBinding => ({
    key: String(index + 1),
    meta: true,
    action: `select-tab-${index + 1}`,
  }),
);

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  { key: "w", meta: true, shift: true, action: "close-pane" },
  { key: "]", meta: true, action: "focus-next" },
  { key: "[", meta: true, action: "focus-prev" },
  { key: "t", meta: true, action: "new-tab" },
  { key: "w", meta: true, action: "close-tab" },
  // On a US layout Shift+] produces "}" and Shift+[ produces "{",
  // so the bindings match the produced key, not the physical one.
  { key: "}", meta: true, shift: true, action: "next-tab" },
  { key: "{", meta: true, shift: true, action: "prev-tab" },
  ...TAB_SELECT_BINDINGS,
];

/** Exact match on the key and all four modifiers; null when nothing matches. */
export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = DEFAULT_KEYMAP,
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  for (const binding of keymap) {
    if (
      binding.key === key &&
      !!binding.meta === event.metaKey &&
      !!binding.shift === event.shiftKey &&
      !!binding.alt === event.altKey &&
      !!binding.ctrl === event.ctrlKey
    ) {
      return binding.action;
    }
  }
  return null;
}

/** 0-based tab index for a `select-tab-N` action, null for any other action. */
export function selectTabIndex(action: ShortcutAction): number | null {
  const match = /^select-tab-(\d+)$/.exec(action);
  return match ? Number(match[1]) - 1 : null;
}
```

- [ ] **Step 5: Chạy lại test, xác nhận pass**

Run: `npx vitest run src/terminal/keymap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run build`
Expected: pass sạch. `terminal-manager.ts` hiện tại import `matchBinding` và switch trên 5 action cũ — switch không có exhaustiveness check nên union mở rộng vẫn compile. Interim (tới Task 9): các phím tab mới bị match + `preventDefault` nhưng chưa có handler → no-op, chấp nhận được.

```bash
git add package.json package-lock.json src/terminal/keymap.ts src/terminal/keymap.test.ts
git commit -m "feat(terminal): centralized keymap with tab actions + vitest setup

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 2: Serialize/restore cho split tree

**Files:**

- Modify: `src/lib/split-tree.ts` (thêm vào cuối file)
- Test: `src/lib/split-tree.test.ts`

**Interfaces:**

- Produces: `SerializedNode` = `{ type: "leaf" }` | `{ type: "split", direction, ratio, first, second }` (đúng shape spec §3), `serializeTree(node: TreeNode): SerializedNode`, `countLeaves(layout: SerializedNode): number`, `treeFromLayout(layout: SerializedNode, paneIds: readonly number[]): TreeNode`.
- Consumes: `TreeNode`, `Direction`, `leaf()` có sẵn trong cùng file.

- [ ] **Step 1: Viết test fail — `src/lib/split-tree.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  countLeaves,
  leaf,
  leafIds,
  serializeTree,
  splitLeaf,
  treeFromLayout,
  type SerializedNode,
} from "./split-tree";

describe("serializeTree", () => {
  it("drops pane ids and keeps structure + ratios", () => {
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    expect(serializeTree(tree)).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: { type: "leaf" },
      second: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
    });
  });
});

describe("treeFromLayout", () => {
  const layout: SerializedNode = {
    type: "split",
    direction: "row",
    ratio: 0.3,
    first: { type: "leaf" },
    second: {
      type: "split",
      direction: "column",
      ratio: 0.7,
      first: { type: "leaf" },
      second: { type: "leaf" },
    },
  };

  it("assigns pane ids to leaves left-to-right", () => {
    const tree = treeFromLayout(layout, [10, 20, 30]);
    expect(leafIds(tree)).toEqual([10, 20, 30]);
  });

  it("round-trips through serializeTree, preserving ratios", () => {
    expect(serializeTree(treeFromLayout(layout, [1, 2, 3]))).toEqual(layout);
  });

  it("throws when the id count does not match the leaf count", () => {
    expect(() => treeFromLayout(layout, [1, 2])).toThrow();
    expect(() => treeFromLayout(layout, [1, 2, 3, 4])).toThrow();
  });
});

describe("countLeaves", () => {
  it("counts leaves of nested layouts", () => {
    expect(countLeaves({ type: "leaf" })).toBe(1);
    expect(
      countLeaves({
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      }),
    ).toBe(2);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: FAIL — `serializeTree` is not exported.

- [ ] **Step 3: Thêm vào cuối `src/lib/split-tree.ts`**

```ts
export interface SerializedLeaf {
  readonly type: "leaf";
}

export interface SerializedSplit {
  readonly type: "split";
  readonly direction: Direction;
  readonly ratio: number;
  readonly first: SerializedNode;
  readonly second: SerializedNode;
}

export type SerializedNode = SerializedLeaf | SerializedSplit;

/** Structure-only snapshot for session persistence — pane ids are dropped. */
export function serializeTree(node: TreeNode): SerializedNode {
  if (node.kind === "leaf") {
    return { type: "leaf" };
  }
  return {
    type: "split",
    direction: node.dir,
    ratio: node.ratio,
    first: serializeTree(node.a),
    second: serializeTree(node.b),
  };
}

export function countLeaves(layout: SerializedNode): number {
  return layout.type === "leaf"
    ? 1
    : countLeaves(layout.first) + countLeaves(layout.second);
}

/**
 * Rebuild a tree from a serialized layout, assigning `paneIds` to leaves
 * left-to-right. `paneIds` must hold exactly `countLeaves(layout)` ids.
 */
export function treeFromLayout(
  layout: SerializedNode,
  paneIds: readonly number[],
): TreeNode {
  const [node, used] = buildFromLayout(layout, paneIds, 0);
  if (used !== paneIds.length) {
    throw new Error(`Layout has ${used} leaves but got ${paneIds.length} ids`);
  }
  return node;
}

function buildFromLayout(
  layout: SerializedNode,
  paneIds: readonly number[],
  offset: number,
): [TreeNode, number] {
  if (layout.type === "leaf") {
    const id = paneIds[offset];
    if (id === undefined) {
      throw new Error(`Layout needs more than ${paneIds.length} pane ids`);
    }
    return [leaf(id), offset + 1];
  }
  const [a, afterA] = buildFromLayout(layout.first, paneIds, offset);
  const [b, afterB] = buildFromLayout(layout.second, paneIds, afterA);
  return [
    { kind: "split", dir: layout.direction, ratio: layout.ratio, a, b },
    afterB,
  ];
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/split-tree.ts src/lib/split-tree.test.ts
git commit -m "feat(split-tree): serialize/restore layout for session persistence

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 3: Schema + validation cho `session.json`

**Files:**

- Create: `src/lib/session-schema.ts`
- Test: `src/lib/session-schema.test.ts`

**Interfaces:**

- Produces: `SESSION_VERSION = 1`, `SessionTab { layout: SerializedNode }`, `SessionData { version, activeTab, tabs }`, `validateSession(raw: unknown): SessionData | null` (null = corrupt/missing/version mismatch → caller mở 1 tab mới).
- Consumes: `SerializedNode` từ Task 2.

- [ ] **Step 1: Viết test fail — `src/lib/session-schema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { SESSION_VERSION, validateSession } from "./session-schema";

const validRaw = {
  version: 1,
  activeTab: 1,
  tabs: [
    { layout: { type: "leaf" } },
    {
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
    },
  ],
};

describe("validateSession", () => {
  it("accepts a valid session", () => {
    expect(validateSession(validRaw)).toEqual(validRaw);
  });

  it("rejects missing or non-object input", () => {
    expect(validateSession(undefined)).toBeNull();
    expect(validateSession(null)).toBeNull();
    expect(validateSession("nope")).toBeNull();
  });

  it("rejects a version mismatch", () => {
    expect(validateSession({ ...validRaw, version: 2 })).toBeNull();
    expect(validateSession({ ...validRaw, version: SESSION_VERSION + 1 })).toBeNull();
  });

  it("rejects empty or malformed tab lists", () => {
    expect(validateSession({ ...validRaw, tabs: [] })).toBeNull();
    expect(validateSession({ ...validRaw, tabs: "x" })).toBeNull();
    expect(validateSession({ ...validRaw, tabs: [{ layout: 42 }] })).toBeNull();
  });

  it("rejects corrupt layouts", () => {
    const badRatio = {
      version: 1,
      activeTab: 0,
      tabs: [
        {
          layout: {
            type: "split",
            direction: "row",
            ratio: 1.5,
            first: { type: "leaf" },
            second: { type: "leaf" },
          },
        },
      ],
    };
    expect(validateSession(badRatio)).toBeNull();
    const badDirection = {
      version: 1,
      activeTab: 0,
      tabs: [
        {
          layout: {
            type: "split",
            direction: "diagonal",
            ratio: 0.5,
            first: { type: "leaf" },
            second: { type: "leaf" },
          },
        },
      ],
    };
    expect(validateSession(badDirection)).toBeNull();
  });

  it("clamps an out-of-range activeTab to 0", () => {
    expect(validateSession({ ...validRaw, activeTab: 99 })?.activeTab).toBe(0);
    expect(validateSession({ ...validRaw, activeTab: -1 })?.activeTab).toBe(0);
    expect(validateSession({ ...validRaw, activeTab: "x" })?.activeTab).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run src/lib/session-schema.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Tạo `src/lib/session-schema.ts`**

```ts
import type { SerializedNode } from "./split-tree";

export const SESSION_VERSION = 1;

// Sanity bounds so a corrupt file cannot spawn hundreds of shells
const MAX_RESTORED_TABS = 16;
const MAX_LAYOUT_DEPTH = 8;

export interface SessionTab {
  readonly layout: SerializedNode;
}

export interface SessionData {
  readonly version: number;
  readonly activeTab: number;
  readonly tabs: readonly SessionTab[];
}

function validateLayout(raw: unknown, depth: number): SerializedNode | null {
  if (typeof raw !== "object" || raw === null || depth > MAX_LAYOUT_DEPTH) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (node.type === "leaf") {
    return { type: "leaf" };
  }
  if (node.type !== "split") {
    return null;
  }
  if (node.direction !== "row" && node.direction !== "column") {
    return null;
  }
  if (
    typeof node.ratio !== "number" ||
    !Number.isFinite(node.ratio) ||
    node.ratio <= 0 ||
    node.ratio >= 1
  ) {
    return null;
  }
  const first = validateLayout(node.first, depth + 1);
  const second = validateLayout(node.second, depth + 1);
  if (first === null || second === null) {
    return null;
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first,
    second,
  };
}

/** null = corrupt/missing/foreign version — the caller starts with a fresh tab. */
export function validateSession(raw: unknown): SessionData | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== SESSION_VERSION) {
    return null;
  }
  if (
    !Array.isArray(source.tabs) ||
    source.tabs.length === 0 ||
    source.tabs.length > MAX_RESTORED_TABS
  ) {
    return null;
  }
  const tabs: SessionTab[] = [];
  for (const rawTab of source.tabs) {
    if (typeof rawTab !== "object" || rawTab === null) {
      return null;
    }
    const layout = validateLayout(
      (rawTab as Record<string, unknown>).layout,
      0,
    );
    if (layout === null) {
      return null;
    }
    tabs.push({ layout });
  }
  const activeTab =
    typeof source.activeTab === "number" &&
    Number.isInteger(source.activeTab) &&
    source.activeTab >= 0 &&
    source.activeTab < tabs.length
      ? source.activeTab
      : 0;
  return { version: SESSION_VERSION, activeTab, tabs };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run src/lib/session-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-schema.ts src/lib/session-schema.test.ts
git commit -m "feat(session): session.json schema and validation

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 4: Helpers hiển thị process (dot màu, badge, tildify)

**Files:**

- Create: `src/lib/process-info.ts`
- Test: `src/lib/process-info.test.ts`

**Interfaces:**

- Produces: `PaneProcessInfo { id, cwd: string | null, process: string | null }` (khớp payload `pty_info` từ Rust Task 6), `PaneHeaderInfo { dotColor, cwd, badge, agent }`, `isAgent(process)`, `dotColor(process)`, `tildify(path, home)`, `paneHeaderInfo(info, home)`.
- Consumes: không (module thuần).

- [ ] **Step 1: Viết test fail — `src/lib/process-info.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { dotColor, isAgent, paneHeaderInfo, tildify } from "./process-info";

describe("dotColor", () => {
  it("maps known agents to their theme color vars", () => {
    expect(dotColor("claude")).toBe("var(--magenta)");
    expect(dotColor("codex")).toBe("var(--green)");
    expect(dotColor("gemini")).toBe("var(--cyan)");
  });

  it("falls back to the faint tone for anything else", () => {
    expect(dotColor("zsh")).toBe("var(--text-faint)");
    expect(dotColor(null)).toBe("var(--text-faint)");
    expect(dotColor("toString")).toBe("var(--text-faint)");
  });
});

describe("isAgent", () => {
  it("only recognizes the known agent names", () => {
    expect(isAgent("claude")).toBe(true);
    expect(isAgent("zsh")).toBe(false);
    expect(isAgent(null)).toBe(false);
  });
});

describe("tildify", () => {
  it("shortens paths under home", () => {
    expect(tildify("/Users/kai/dev/app", "/Users/kai")).toBe("~/dev/app");
    expect(tildify("/Users/kai", "/Users/kai")).toBe("~");
  });

  it("tolerates a trailing slash on home", () => {
    expect(tildify("/Users/kai/dev", "/Users/kai/")).toBe("~/dev");
  });

  it("leaves foreign paths and empty home untouched", () => {
    expect(tildify("/opt/tools", "/Users/kai")).toBe("/opt/tools");
    expect(tildify("/Users/kaiser/x", "/Users/kai")).toBe("/Users/kaiser/x");
    expect(tildify("/opt/tools", "")).toBe("/opt/tools");
  });
});

describe("paneHeaderInfo", () => {
  it("builds agent header info", () => {
    expect(
      paneHeaderInfo(
        { id: 1, cwd: "/Users/kai/dev", process: "claude" },
        "/Users/kai",
      ),
    ).toEqual({
      dotColor: "var(--magenta)",
      cwd: "~/dev",
      badge: "claude",
      agent: true,
    });
  });

  it("falls back to a shell badge when the process is unknown", () => {
    expect(paneHeaderInfo({ id: 1, cwd: null, process: null }, "/Users/kai")).toEqual({
      dotColor: "var(--text-faint)",
      cwd: "",
      badge: "shell",
      agent: false,
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run src/lib/process-info.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Tạo `src/lib/process-info.ts`**

```ts
/** Mirror of the `PtyInfo` payload returned by the Rust `pty_info` command. */
export interface PaneProcessInfo {
  readonly id: number;
  readonly cwd: string | null;
  readonly process: string | null;
}

/** Display-ready strings for a pane header bar. */
export interface PaneHeaderInfo {
  readonly dotColor: string;
  readonly cwd: string;
  readonly badge: string;
  readonly agent: boolean;
}

const AGENT_DOT_VARS: Readonly<Record<string, string>> = {
  claude: "var(--magenta)",
  codex: "var(--green)",
  gemini: "var(--cyan)",
};

export function isAgent(process: string | null): boolean {
  return process !== null && AGENT_DOT_VARS[process] !== undefined;
}

export function dotColor(process: string | null): string {
  return (process !== null && AGENT_DOT_VARS[process]) || "var(--text-faint)";
}

/** Replace the home prefix with `~` for display. */
export function tildify(path: string, home: string): string {
  if (home === "") {
    return path;
  }
  const root = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === root) {
    return "~";
  }
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}

export function paneHeaderInfo(
  info: PaneProcessInfo,
  home: string,
): PaneHeaderInfo {
  return {
    dotColor: dotColor(info.process),
    cwd: info.cwd === null ? "" : tildify(info.cwd, home),
    badge: info.process ?? "shell",
    agent: isAgent(info.process),
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run src/lib/process-info.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/process-info.ts src/lib/process-info.test.ts
git commit -m "feat(lib): process display helpers for tabs and pane headers

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 5: Settings — bỏ `sidebarPosition`, thêm `restoreTabs`

**Files:**

- Modify: `src/settings/settings-schema.ts`
- Modify: `src/ui/settings-panel.tsx` (bỏ section Sidebar, thêm section Tabs)
- Modify: `src/ui/sidebar.tsx` (type nội bộ thay vì import)
- Modify: `src/ui/app.tsx` (class tĩnh)
- Test: `src/settings/settings-schema.test.ts`

**Interfaces:**

- Produces: `Settings` mới — `{ fontFamily, fontSize, themeId, colorOverrides, restoreTabs: boolean }`; `DEFAULT_SETTINGS.restoreTabs === true`; `validateSettings` drop key lạ (gồm `sidebarPosition` cũ).
- Consumes: `updateSettings` từ `settings-store.ts` (không đổi).

- [ ] **Step 1: Viết test fail — `src/settings/settings-schema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "./settings-schema";

describe("validateSettings", () => {
  it("defaults restoreTabs to true", () => {
    expect(DEFAULT_SETTINGS.restoreTabs).toBe(true);
    expect(validateSettings({}).restoreTabs).toBe(true);
    expect(validateSettings({ restoreTabs: "x" }).restoreTabs).toBe(true);
  });

  it("keeps an explicit restoreTabs=false", () => {
    expect(validateSettings({ restoreTabs: false }).restoreTabs).toBe(false);
  });

  it("silently drops the legacy sidebarPosition field", () => {
    const validated = validateSettings({ sidebarPosition: "top" });
    expect("sidebarPosition" in validated).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: FAIL — `restoreTabs` không tồn tại trên `Settings`.

- [ ] **Step 3: Sửa `src/settings/settings-schema.ts`**

Xoá dòng `export type SidebarPosition = "left" | "top";`. Sửa interface + defaults:

```ts
export interface Settings {
  fontFamily: string;
  fontSize: number;
  themeId: string;
  colorOverrides: Partial<TerminalColors>;
  restoreTabs: boolean;
}
```

```ts
export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "SF Mono",
  fontSize: 13,
  themeId: "tokyo-night",
  colorOverrides: {},
  restoreTabs: true,
};
```

Trong `validateSettings`, thay khối `sidebarPosition:` (5 dòng cuối của object trả về) bằng:

```ts
    restoreTabs:
      typeof source.restoreTabs === "boolean"
        ? source.restoreTabs
        : DEFAULT_SETTINGS.restoreTabs,
```

- [ ] **Step 4: Sửa `src/ui/sidebar.tsx`**

Thay dòng import đầu file `import type { SidebarPosition } from "../settings/settings-schema";` bằng type nội bộ (file này sẽ bị xoá ở Task 11):

```ts
type SidebarPosition = "left" | "top";
```

- [ ] **Step 5: Sửa `src/ui/app.tsx`**

Thay `<div class={`app app--${settings.value.sidebarPosition}`}>` bằng `<div class="app app--left">`, và `<Sidebar position={settings.value.sidebarPosition}` bằng `<Sidebar position="left"`.

- [ ] **Step 6: Sửa `src/ui/settings-panel.tsx`**

Xoá: import `SidebarPosition` (giữ các import khác của `settings-schema`), hằng `POSITIONS`, và nguyên `<section>` "Sidebar" (khối `settings-section` cuối, trước `<footer>`). Thêm vào đúng chỗ đó section Tabs:

```tsx
      <section class="settings-section">
        <h3 class="settings-section__title">Tabs</h3>
        <div class="field">
          <span class="field__label">Restore on launch</span>
          <div class="segmented" role="radiogroup" aria-label="Restore tabs on launch">
            <button
              type="button"
              role="radio"
              aria-checked={current.restoreTabs}
              class={`segmented__option ${current.restoreTabs ? "is-active" : ""}`}
              onClick={() => updateSettings({ restoreTabs: true })}
            >
              On
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!current.restoreTabs}
              class={`segmented__option ${current.restoreTabs ? "" : "is-active"}`}
              onClick={() => updateSettings({ restoreTabs: false })}
            >
              Off
            </button>
          </div>
        </div>
      </section>
```

- [ ] **Step 7: Test + build**

Run: `npx vitest run && npm run build`
Expected: tất cả test pass, build sạch.

- [ ] **Step 8: Commit**

```bash
git add src/settings/settings-schema.ts src/settings/settings-schema.test.ts \
  src/ui/settings-panel.tsx src/ui/sidebar.tsx src/ui/app.tsx
git commit -m "feat(settings): replace sidebarPosition with restoreTabs

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 6: Rust — `pty_info` + `git_branch`

**Files:**

- Modify: `src-tauri/Cargo.toml` (dep `libc` cho macOS)
- Modify: `src-tauri/src/pty.rs` (lưu `child_pid`, thêm `foreground_pids`)
- Create: `src-tauri/src/info.rs`
- Modify: `src-tauri/src/lib.rs` (đăng ký commands)

**Interfaces:**

- Produces: command `pty_info(ids: Vec<u32>) -> Result<Vec<PtyInfo>, String>` với `PtyInfo { id: u32, cwd: Option<String>, process: Option<String> }` (serialize thành `{id, cwd, process}` — khớp `PaneProcessInfo` Task 4); command `git_branch(cwd: String) -> Option<String>`; method `PtyState::foreground_pids(&self, ids: &[u32]) -> Vec<(u32, Option<i32>)>`.
- Consumes: `MasterPty::process_group_leader()` (portable-pty 0.9), `Child::process_id()`, `libc::{proc_name, proc_pidinfo, proc_vnodepathinfo, PROC_PIDVNODEPATHINFO}` (libc ≥ 0.2.180 có đủ trên macOS — đã verify trên 0.2.186 trong Cargo.lock).

Ghi chú thiết kế: spec nhắc "libproc" — crate `libproc` bản mới **không** export `VnodePathInfo`, nên ta gọi thẳng các hàm libproc.h (`proc_name`, `proc_pidinfo`) qua crate `libc` — cùng syscalls, ít dep hơn. Cả hai command là `async fn` để chạy trên thread pool (git subprocess không block main thread). Mọi lỗi tra cứu → field `None`, không bao giờ `Err` làm gãy polling loop (chỉ `Err` khi poisoned mutex — không xảy ra trong thực tế).

- [ ] **Step 1: Thêm dep vào `src-tauri/Cargo.toml`**

Thêm vào cuối file:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
libc = "0.2"
```

- [ ] **Step 2: Sửa `src-tauri/src/pty.rs` — lưu child pid**

Thay struct `Session`:

```rust
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    child_pid: Option<u32>,
}
```

Trong `spawn_shell`, ngay sau dòng `let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;` thêm:

```rust
    let child_pid = child.process_id();
```

và trong khối `sessions.insert(...)` thêm field:

```rust
        sessions.insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                child_pid,
            },
        );
```

- [ ] **Step 3: Thêm `foreground_pids` vào cuối `src-tauri/src/pty.rs`**

```rust
impl PtyState {
    /// Foreground process id per session: the PTY's foreground process
    /// group leader, falling back to the spawned child pid.
    pub fn foreground_pids(&self, ids: &[u32]) -> Vec<(u32, Option<i32>)> {
        let sessions = match self.sessions.lock() {
            Ok(sessions) => sessions,
            Err(_) => return ids.iter().map(|&id| (id, None)).collect(),
        };
        ids.iter()
            .map(|&id| {
                let pid = sessions.get(&id).and_then(|session| {
                    session
                        .master
                        .process_group_leader()
                        .filter(|pid| *pid > 0)
                        .or_else(|| session.child_pid.map(|pid| pid as i32))
                });
                (id, pid)
            })
            .collect()
    }
}
```

- [ ] **Step 4: Tạo `src-tauri/src/info.rs`**

```rust
use crate::pty::PtyState;
use tauri::State;

#[derive(Clone, serde::Serialize)]
pub struct PtyInfo {
    pub id: u32,
    pub cwd: Option<String>,
    pub process: Option<String>,
}

/// Foreground process name + cwd for each PTY. Lookup failures degrade to
/// `None` fields — the command itself never fails in practice, so the
/// frontend polling loop keeps running.
#[tauri::command]
pub async fn pty_info(
    state: State<'_, PtyState>,
    ids: Vec<u32>,
) -> Result<Vec<PtyInfo>, String> {
    let pids = state.foreground_pids(&ids);
    Ok(pids
        .into_iter()
        .map(|(id, pid)| match pid {
            Some(pid) => PtyInfo {
                id,
                cwd: process_cwd(pid),
                process: process_name(pid),
            },
            None => PtyInfo {
                id,
                cwd: None,
                process: None,
            },
        })
        .collect())
}

/// Current branch of the repo containing `cwd`; `None` when not a repo
/// (or git is missing / the lookup fails).
#[tauri::command]
pub async fn git_branch(cwd: String) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!branch.is_empty()).then_some(branch)
}

#[cfg(target_os = "macos")]
fn process_name(pid: i32) -> Option<String> {
    // proc_name truncates to 2*MAXCOMLEN (~32 bytes); 64 leaves headroom
    let mut buf = [0u8; 64];
    let len = unsafe {
        libc::proc_name(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32)
    };
    if len <= 0 {
        return None;
    }
    String::from_utf8(buf[..len as usize].to_vec()).ok()
}

#[cfg(target_os = "macos")]
fn process_cwd(pid: i32) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if read < size {
        return None;
    }
    let path = unsafe {
        std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr() as *const libc::c_char)
    };
    path.to_str()
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[cfg(not(target_os = "macos"))]
fn process_name(_pid: i32) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn process_cwd(_pid: i32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_branch_is_none_outside_a_repo() {
        let dir = std::env::temp_dir().join("stackgrid-git-none");
        std::fs::create_dir_all(&dir).unwrap();
        let branch =
            tauri::async_runtime::block_on(git_branch(dir.to_string_lossy().into_owned()));
        assert_eq!(branch, None);
    }

    #[test]
    fn git_branch_reads_the_current_branch() {
        let dir = std::env::temp_dir().join(format!("stackgrid-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .env("GIT_AUTHOR_NAME", "test")
                .env("GIT_AUTHOR_EMAIL", "test@test")
                .env("GIT_COMMITTER_NAME", "test")
                .env("GIT_COMMITTER_EMAIL", "test@test")
                .status()
                .unwrap();
            assert!(status.success());
        };
        git(&["init", "--initial-branch=main"]);
        git(&["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"]);
        let branch =
            tauri::async_runtime::block_on(git_branch(dir.to_string_lossy().into_owned()));
        assert_eq!(branch, Some("main".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 5: Đăng ký trong `src-tauri/src/lib.rs` (edit cộng thêm — KHÔNG thay cả file)**

`lib.rs` hiện có `QuitState`/`confirm_quit`/dialog plugin/`.setup(menu::install)`/vòng `RunEvent::ExitRequested` — giữ nguyên tất cả. Chỉ 2 edit:

Thêm `mod info;` vào đầu file, trước `mod menu;`:

```rust
mod info;
mod menu;
mod pty;
```

và mở rộng khối `invoke_handler` hiện có thành:

```rust
        .invoke_handler(tauri::generate_handler![
            pty::spawn_shell,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            info::pty_info,
            info::git_branch,
            confirm_quit
        ])
```

- [ ] **Step 6: Build + test Rust**

Run:

```bash
(cd src-tauri && cargo build && cargo test)
```

Expected: build sạch; 2 tests trong `info::tests` pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/pty.rs \
  src-tauri/src/info.rs src-tauri/src/lib.rs
git commit -m "feat(backend): pty_info and git_branch commands

Foreground process via tcgetpgrp (portable-pty process_group_leader),
name/cwd via libproc syscalls through the libc crate on macOS.

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 7: Menu macOS không có Close Window (giải phóng ⌘W, giữ Quit confirm)

`menu.rs` hiện tại lấy `Menu::default()` rồi thay item Quit bằng item tuỳ chỉnh `quit-confirm` (để ⌘Q đi qua confirm dialog) — nhưng menu default vẫn còn File → Close Window gắn accelerator ⌘W, sẽ nuốt phím trước khi webview thấy, làm `close-tab` không bao giờ chạy. Viết lại `menu.rs` dựng menu tường minh (App/Edit/Window) **không có Close Window**, GIỮ NGUYÊN item Quit tuỳ chỉnh + `on_menu_event`. `lib.rs` không đổi (`.setup(menu::install)` đã có sẵn).

**Files:**

- Rewrite: `src-tauri/src/menu.rs`

**Interfaces:**

- Produces: giữ nguyên contract cũ — `menu::install(app)` set menu + emit `"quit-requested"` khi chọn Quit (id `quit-confirm`). KHÔNG dùng `.quit()` predefined: item Quit mặc định thoát thẳng process không qua `RunEvent::ExitRequested` (tauri-apps/tauri#3124) → sẽ bypass confirm dialog.
- Consumes: `tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder}` (đã verify convenience methods `about/services/hide/hide_others/show_all/undo/redo/cut/copy/paste/select_all/minimize/maximize/fullscreen` + `.item(&…)` tồn tại trên SubmenuBuilder của tauri 2).

- [ ] **Step 1: Viết lại `src-tauri/src/menu.rs`**

Thay toàn bộ file bằng:

```rust
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder},
    App, Emitter, Runtime,
};

#[cfg(not(target_os = "macos"))]
use tauri::{App, Runtime};

#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "quit-confirm";

/// Explicit macOS menu, replacing the default one for two reasons:
/// - The default Quit item (Cmd+Q) exits the process without going through
///   RunEvent::ExitRequested (tauri-apps/tauri#3124), so a custom item keeps
///   the shortcut but emits "quit-requested" for the frontend confirm dialog.
/// - The default File > Close Window item owns Cmd+W, which must reach the
///   webview instead (close-tab shortcut).
#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let handle = app.handle();
    let app_name = handle.package_info().name.clone();
    let quit = MenuItem::with_id(
        handle,
        QUIT_MENU_ID,
        format!("Quit {app_name}"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let app_menu = SubmenuBuilder::new(handle, app_name)
        .about(Some(AboutMetadata::default()))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|handle, event| {
        if event.id() == QUIT_MENU_ID {
            let _ = handle.emit("quit-requested", ());
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install<R: Runtime>(_app: &App<R>) -> tauri::Result<()> {
    Ok(())
}
```

- [ ] **Step 2: Build + smoke test**

Run: `(cd src-tauri && cargo build)` rồi `npm run tauri dev`
Expected: app chạy; menu bar chỉ có Stackgrid / Edit / Window; **không** có item "Close Window"; ⌘C/⌘V vẫn hoạt động trong terminal; nhấn `⌘W` **không** đóng cửa sổ (sau Task 1, JS match `close-tab` nhưng chưa có handler → no-op, đúng kỳ vọng); `⌘Q` và nút đóng cửa sổ **vẫn hiện confirm dialog** như trước (không regress).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/menu.rs
git commit -m "feat(macos): explicit app menu without Close Window so Cmd+W reaches the webview

Keeps the custom quit-confirm item so Cmd+Q still goes through the
confirmation dialog.

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 8: Pane header bar (dot + cwd + badge)

**Files:**

- Modify: `src/terminal/pane.ts`
- Modify: `src/styles.css` (CSS layout tối thiểu — style màu hoàn chỉnh ở Task 11)

**Interfaces:**

- Produces: `Pane.setHeaderInfo(info: PaneHeaderInfo): void`; DOM mới của pane: `.pane > .pane__bar (.pane__dot, .pane__cwd, .pane__badge) + .pane__term` (xterm mở trong `.pane__term`).
- Consumes: `PaneHeaderInfo` từ Task 4.

- [ ] **Step 1: Sửa `src/terminal/pane.ts`**

Thêm import:

```ts
import type { PaneHeaderInfo } from "../lib/process-info";
```

Thêm vào interface `Pane` (sau `applySettings`):

```ts
  /** Update the header bar (dot color, cwd, process badge). */
  setHeaderInfo(info: PaneHeaderInfo): void;
```

Trong `createPane`, thay 2 dòng tạo `element`:

```ts
  const element = document.createElement("div");
  element.className = "pane";
```

bằng:

```ts
  const element = document.createElement("div");
  element.className = "pane";

  const bar = document.createElement("div");
  bar.className = "pane__bar";
  const dot = document.createElement("span");
  dot.className = "pane__dot";
  const cwdEl = document.createElement("span");
  cwdEl.className = "pane__cwd";
  const badge = document.createElement("span");
  badge.className = "pane__badge pane__badge--shell";
  badge.textContent = "shell";
  bar.append(dot, cwdEl, badge);

  const termEl = document.createElement("div");
  termEl.className = "pane__term";
  element.append(bar, termEl);
```

Trong `mount()`, thay `term.open(element); observer.observe(element);` bằng:

```ts
      term.open(termEl);
      observer.observe(termEl);
```

Thêm hàm mới cạnh `applySettings`:

```ts
  function setHeaderInfo(info: PaneHeaderInfo): void {
    dot.style.background = info.dotColor;
    cwdEl.textContent = info.cwd;
    badge.textContent = info.badge;
    badge.className = `pane__badge ${
      info.agent ? "pane__badge--agent" : "pane__badge--shell"
    }`;
  }
```

và thêm `setHeaderInfo,` vào object return (sau `applySettings,`).

- [ ] **Step 2: CSS layout tối thiểu**

Trong `src/styles.css`, thay khối `.pane { ... }` hiện tại:

```css
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

bằng:

```css
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  font-size: 11px;
  flex-shrink: 0;
}

.pane__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.pane__cwd {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane__badge {
  margin-left: auto;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 5px;
}

.pane__term {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

và đổi 6 khối selector xterm hiện có từ `.pane .xterm...` thành `.pane__term .xterm...` (cả khối `.pane .xterm { height: 100%; }`, `.pane .xterm-viewport` và 4 khối scrollbar).

- [ ] **Step 3: Build + smoke test**

Run: `npm run build` rồi `npm run tauri dev`
Expected: build sạch; mỗi pane có thanh header mảnh phía trên (badge "shell"), terminal vẫn gõ/resize/split bình thường.

- [ ] **Step 4: Commit**

```bash
git add src/terminal/pane.ts src/styles.css
git commit -m "feat(pane): header bar with process dot, cwd and badge

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 9: Engine đa tab — terminal-manager per-tab, tab-manager, persistence

Task lớn nhất (một khối chức năng nguyên vẹn — tách nửa chừng sẽ làm app không chạy giữa 2 commit). Sau task này: multi-tab hoạt động **qua bàn phím** (⌘T/⌘W/⌘⇧]/⌘⇧[/⌘1-9), session được lưu/khôi phục; UI chrome vẫn là sidebar cũ.

**Files:**

- Rewrite: `src/terminal/terminal-manager.ts`
- Create: `src/terminal/tabs-store.ts`
- Create: `src/terminal/session-persistence.ts`
- Create: `src/terminal/tab-manager.ts`
- Modify: `src/ui/app.tsx` (đổi sang tab-manager)
- Modify: `src/styles.css` (thêm `.tab-stage`)

**Interfaces:**

- Produces (`terminal-manager.ts`): `ManagerCallbacks { onLayoutChange(): void }`; `TerminalManager { initFresh(), initFromLayout(layout), show(), hide(), splitActive(dir), closeActive(), cycleFocus(step), focusActive(), applySettings(next), serializeLayout(): SerializedNode | null, paneIds(): number[], activePaneId(): number | null, paneCount(): number, handleOutput(id, data), handleExit(id), updatePaneInfo(infos, home), notifyError(message), dispose() }`; factory `createTerminalManager(container: HTMLElement, callbacks: ManagerCallbacks)`. `dispose()` giờ **kill toàn bộ PTY** của tab và remove container.
- Produces (`tabs-store.ts`): signals `tabViews: Signal<readonly TabView[]>` (`TabView { key: number; process: string | null }`), `activeTabIndex: Signal<number>`, `statusInfo: Signal<StatusInfo>` (`{ branch, cwd, agent, paneCount, home }`).
- Produces (`session-persistence.ts`): `loadSession(): Promise<SessionData | null>`, `scheduleSessionSave(build: () => SessionData | null): void` (debounce 500ms).
- Produces (`tab-manager.ts`): `TabManager { init(), newTab(), closeTab(index), selectTab(index), cycleTab(step), splitActive(dir), closePane(), applySettings(next), focusActive(), dispose() }`; factory `createTabManager(host: HTMLElement)`.
- Consumes: keymap (Task 1), serialize/restore (Task 2), session schema (Task 3), `paneHeaderInfo`/`PaneProcessInfo` (Task 4), `settings.restoreTabs` (Task 5), `Pane.setHeaderInfo` (Task 8).

- [ ] **Step 1: Viết lại `src/terminal/terminal-manager.ts`**

Thay toàn bộ file bằng:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import {
  countLeaves,
  leaf,
  leafIds,
  removeLeaf,
  replaceLeaf,
  serializeTree,
  setRatio,
  splitLeaf,
  treeFromLayout,
  type Direction,
  type SerializedNode,
  type TreeNode,
} from "../lib/split-tree";
import { paneHeaderInfo, type PaneProcessInfo } from "../lib/process-info";
import { renderTree } from "./layout";
import { createPane, type Pane, type PaneEvents } from "./pane";

// Placeholder size at spawn — fit() after mount resizes to the real dimensions
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

export interface ManagerCallbacks {
  /** Fired after any structural change (split, close, ratio commit). */
  onLayoutChange(): void;
}

/** One tab's worth of terminals: a split tree of panes sharing a container. */
export interface TerminalManager {
  /** Spawn a single fresh shell. Throws when the spawn fails. */
  initFresh(): Promise<void>;
  /** Spawn one shell per leaf and rebuild the split structure. Throws when any spawn fails. */
  initFromLayout(layout: SerializedNode): Promise<void>;
  show(): void;
  hide(): void;
  splitActive(dir: Direction): Promise<void>;
  closeActive(): Promise<void>;
  cycleFocus(step: 1 | -1): void;
  focusActive(): void;
  applySettings(next: Settings): void;
  serializeLayout(): SerializedNode | null;
  paneIds(): number[];
  activePaneId(): number | null;
  paneCount(): number;
  /** Routed from the tab manager's single pty:output listener; ignores unowned ids. */
  handleOutput(id: number, data: string): void;
  /** Routed from the tab manager's single pty:exit listener; ignores unowned ids. */
  handleExit(id: number): void;
  updatePaneInfo(infos: readonly PaneProcessInfo[], home: string): void;
  /** Write an error line into the active pane (used for tab spawn failures). */
  notifyError(message: string): void;
  /** Kills all PTYs, disposes xterm instances and removes the container. */
  dispose(): void;
}

export function createTerminalManager(
  container: HTMLElement,
  callbacks: ManagerCallbacks,
): TerminalManager {
  const panes = new Map<number, Pane>();
  const exited = new Set<number>();
  const respawning = new Set<number>();
  let tree: TreeNode | null = null;
  let activeId: number | null = null;

  const paneEvents: PaneEvents = {
    onData(id, data) {
      if (exited.has(id)) {
        if (data === "\r") {
          void respawn(id);
        }
        return;
      }
      invoke("write_pty", { id, data }).catch((err: unknown) => {
        console.error("write_pty failed:", err);
      });
    },
    onResize(id, cols, rows) {
      if (exited.has(id)) {
        return;
      }
      invoke("resize_pty", { id, cols, rows }).catch(() => {
        // Session closed mid-flight — ignore
      });
    },
    onFocus(id) {
      setActive(id);
    },
  };

  async function spawnPane(): Promise<Pane> {
    const id = await invoke<number>("spawn_shell", {
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
    });
    const pane = createPane(id, settings.value, paneEvents);
    panes.set(id, pane);
    return pane;
  }

  // Cleans up a freshly spawned pane whose target vanished during the
  // spawn round-trip — otherwise the PTY + xterm instance would leak
  function discardPane(pane: Pane): void {
    invoke("kill_pty", { id: pane.id }).catch(() => {
      // Session already gone — ignore
    });
    panes.delete(pane.id);
    pane.dispose();
  }

  function isInTree(id: number): boolean {
    return tree !== null && panes.has(id) && leafIds(tree).includes(id);
  }

  function render(): void {
    if (!tree) {
      return;
    }
    renderTree(container, tree, {
      getPaneElement: (id) => panes.get(id)?.element,
      isActive: (id) => id === activeId,
      highlightActive: panes.size > 1,
      onRatioCommit(path, ratio) {
        if (tree) {
          tree = setRatio(tree, path, ratio);
          callbacks.onLayoutChange();
        }
      },
    });
    for (const id of leafIds(tree)) {
      panes.get(id)?.mount();
    }
  }

  function setActive(id: number): void {
    if (activeId === id) {
      return;
    }
    activeId = id;
    updateActiveClasses();
  }

  function updateActiveClasses(): void {
    const highlight = panes.size > 1;
    for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
      slot.classList.toggle(
        "is-active",
        highlight && Number(slot.dataset.paneId) === activeId,
      );
    }
  }

  function handleExit(id: number): void {
    const pane = panes.get(id);
    if (!pane) {
      return;
    }
    if (panes.size > 1) {
      // Shell exited (typed exit / process died) → auto-close that pane
      void closePane(id);
      return;
    }
    exited.add(id);
    pane.writeln(
      "\r\n\x1b[33m[Session ended — press Enter to start a new one]\x1b[0m",
    );
  }

  async function respawn(oldId: number): Promise<void> {
    // Guard against a second Enter while spawn_shell is still in flight
    if (respawning.has(oldId)) {
      return;
    }
    const old = panes.get(oldId);
    if (!old || !tree) {
      return;
    }
    respawning.add(oldId);
    try {
      const fresh = await spawnPane();
      if (!isInTree(oldId)) {
        discardPane(fresh);
        return;
      }
      tree = replaceLeaf(tree, oldId, fresh.id);
      panes.delete(oldId);
      exited.delete(oldId);
      old.dispose();
      if (activeId === oldId) {
        activeId = fresh.id;
      }
      render();
      fresh.focus();
    } catch (err) {
      if (panes.has(oldId)) {
        old.writeln(`\r\n\x1b[31mFailed to start shell: ${err}\x1b[0m`);
      }
    } finally {
      respawning.delete(oldId);
    }
  }

  async function closePane(id: number): Promise<void> {
    const pane = panes.get(id);
    if (!pane || !tree) {
      return;
    }
    invoke("kill_pty", { id }).catch(() => {
      // Session already ended on its own — ignore
    });
    panes.delete(id);
    exited.delete(id);
    pane.dispose();

    const rest = removeLeaf(tree, id);
    if (rest === null) {
      // Last pane in the tab — always keep at least one terminal
      tree = null;
      activeId = null;
      await openInitialPane();
      callbacks.onLayoutChange();
      return;
    }
    tree = rest;
    if (activeId === id) {
      activeId = leafIds(tree)[0] ?? null;
    }
    render();
    if (activeId !== null) {
      panes.get(activeId)?.focus();
    }
    callbacks.onLayoutChange();
  }

  async function openInitialPane(): Promise<void> {
    try {
      const pane = await spawnPane();
      tree = leaf(pane.id);
      activeId = pane.id;
      render();
      pane.focus();
    } catch (err) {
      container.textContent = `Failed to start shell: ${err}`;
    }
  }

  async function splitActive(dir: Direction): Promise<void> {
    if (!tree || activeId === null) {
      return;
    }
    const targetId = activeId;
    try {
      const pane = await spawnPane();
      if (!isInTree(targetId)) {
        // Target pane closed while spawning — drop the new session
        discardPane(pane);
        return;
      }
      tree = splitLeaf(tree, targetId, pane.id, dir);
      render();
      setActive(pane.id);
      pane.focus();
      callbacks.onLayoutChange();
    } catch (err) {
      panes
        .get(targetId)
        ?.writeln(`\r\n\x1b[31mFailed to open new pane: ${err}\x1b[0m`);
    }
  }

  function cycleFocus(step: 1 | -1): void {
    if (!tree || activeId === null) {
      return;
    }
    const ids = leafIds(tree);
    const index = ids.indexOf(activeId);
    const next = ids[(index + step + ids.length) % ids.length];
    setActive(next);
    panes.get(next)?.focus();
  }

  async function initFresh(): Promise<void> {
    const pane = await spawnPane();
    tree = leaf(pane.id);
    activeId = pane.id;
    render();
    pane.focus();
  }

  async function initFromLayout(layout: SerializedNode): Promise<void> {
    const total = countLeaves(layout);
    const spawned: Pane[] = [];
    try {
      for (let i = 0; i < total; i += 1) {
        spawned.push(await spawnPane());
      }
    } catch (err) {
      for (const pane of spawned) {
        discardPane(pane);
      }
      throw err;
    }
    tree = treeFromLayout(
      layout,
      spawned.map((pane) => pane.id),
    );
    activeId = spawned[0]?.id ?? null;
    render();
    spawned[0]?.focus();
  }

  return {
    initFresh,
    initFromLayout,
    show() {
      container.style.display = "";
      for (const pane of panes.values()) {
        pane.fit();
      }
      if (activeId !== null) {
        panes.get(activeId)?.focus();
      }
    },
    hide() {
      container.style.display = "none";
    },
    splitActive,
    closeActive() {
      return activeId === null ? Promise.resolve() : closePane(activeId);
    },
    cycleFocus,
    focusActive() {
      if (activeId !== null) {
        panes.get(activeId)?.focus();
      }
    },
    applySettings(next) {
      for (const pane of panes.values()) {
        pane.applySettings(next);
      }
    },
    serializeLayout() {
      return tree === null ? null : serializeTree(tree);
    },
    paneIds() {
      return tree === null ? [] : leafIds(tree);
    },
    activePaneId() {
      return activeId;
    },
    paneCount() {
      return panes.size;
    },
    handleOutput(id, data) {
      panes.get(id)?.write(data);
    },
    handleExit,
    updatePaneInfo(infos, home) {
      for (const info of infos) {
        panes.get(info.id)?.setHeaderInfo(paneHeaderInfo(info, home));
      }
    },
    notifyError(message) {
      if (activeId !== null) {
        panes.get(activeId)?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      }
    },
    dispose() {
      for (const pane of panes.values()) {
        invoke("kill_pty", { id: pane.id }).catch(() => {
          // Session already gone — ignore
        });
        pane.dispose();
      }
      panes.clear();
      container.remove();
    },
  };
}
```

- [ ] **Step 2: Tạo `src/terminal/tabs-store.ts`**

```ts
import { signal } from "@preact/signals";

/** What the tab bar needs to render one tab. */
export interface TabView {
  /** Stable identity for list rendering (not a pane/PTY id). */
  readonly key: number;
  /** Foreground process of the tab's active pane — null until the first poll. */
  readonly process: string | null;
}

/** What the status bar needs. */
export interface StatusInfo {
  readonly branch: string | null;
  readonly cwd: string | null;
  readonly agent: string | null;
  readonly paneCount: number;
  readonly home: string;
}

export const tabViews = signal<readonly TabView[]>([]);
export const activeTabIndex = signal(0);
export const statusInfo = signal<StatusInfo>({
  branch: null,
  cwd: null,
  agent: null,
  paneCount: 1,
  home: "",
});
```

- [ ] **Step 3: Tạo `src/terminal/session-persistence.ts`**

```ts
import { Store } from "@tauri-apps/plugin-store";
import { validateSession, type SessionData } from "../lib/session-schema";

const SESSION_FILE = "session.json";
const SESSION_KEY = "session";
const SAVE_DEBOUNCE_MS = 500;

let store: Store | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Load and validate the persisted session; null means "start fresh". */
export async function loadSession(): Promise<SessionData | null> {
  try {
    store = await Store.load(SESSION_FILE, { autoSave: false });
    const raw = await store.get<unknown>(SESSION_KEY);
    const session = validateSession(raw);
    if (raw !== undefined && raw !== null && session === null) {
      console.warn("Invalid session.json — starting with a fresh tab");
    }
    return session;
  } catch (err) {
    console.warn("Failed to load session, starting fresh:", err);
    return null;
  }
}

/**
 * Debounced save. `build` runs when the timer fires so the snapshot is
 * always current; returning null skips the write.
 */
export function scheduleSessionSave(build: () => SessionData | null): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = build();
    if (data === null || store === null) {
      return;
    }
    store
      .set(SESSION_KEY, data)
      .then(() => store?.save())
      .catch((err: unknown) => {
        console.warn("Failed to save session:", err);
      });
  }, SAVE_DEBOUNCE_MS);
}
```

- [ ] **Step 4: Tạo `src/terminal/tab-manager.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import type { Settings } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import type { Direction, SerializedNode } from "../lib/split-tree";
import { SESSION_VERSION, type SessionData } from "../lib/session-schema";
import { isAgent, type PaneProcessInfo } from "../lib/process-info";
import { matchBinding, selectTabIndex } from "./keymap";
import { loadSession, scheduleSessionSave } from "./session-persistence";
import {
  createTerminalManager,
  type TerminalManager,
} from "./terminal-manager";
import { activeTabIndex, statusInfo, tabViews } from "./tabs-store";

const EVENT_OUTPUT = "pty:output";
const EVENT_EXIT = "pty:exit";

interface OutputPayload {
  id: number;
  data: string;
}

interface ExitPayload {
  id: number;
}

interface TabEntry {
  readonly key: number;
  readonly manager: TerminalManager;
}

/** Owns all tabs: routing, keyboard, persistence and (later) info polling. */
export interface TabManager {
  init(): Promise<void>;
  newTab(): Promise<void>;
  closeTab(index: number): Promise<void>;
  selectTab(index: number): void;
  cycleTab(step: 1 | -1): void;
  splitActive(dir: Direction): Promise<void>;
  closePane(): Promise<void>;
  applySettings(next: Settings): void;
  focusActive(): void;
  dispose(): void;
}

export function createTabManager(host: HTMLElement): TabManager {
  const tabs: TabEntry[] = [];
  const unlisteners: UnlistenFn[] = [];
  const infoByPane = new Map<number, PaneProcessInfo>();
  let nextKey = 1;
  let active = -1;
  let home = "";
  let branch: string | null = null;

  function activeManager(): TerminalManager | null {
    return active >= 0 && active < tabs.length ? tabs[active].manager : null;
  }

  function buildSessionData(): SessionData | null {
    const layouts = tabs
      .map((tab) => tab.manager.serializeLayout())
      .filter((layout): layout is SerializedNode => layout !== null);
    if (layouts.length === 0) {
      return null;
    }
    return {
      version: SESSION_VERSION,
      activeTab: Math.min(Math.max(active, 0), layouts.length - 1),
      tabs: layouts.map((layout) => ({ layout })),
    };
  }

  function persist(): void {
    scheduleSessionSave(buildSessionData);
  }

  function syncViews(): void {
    tabViews.value = tabs.map((tab) => {
      const paneId = tab.manager.activePaneId();
      const info = paneId === null ? undefined : infoByPane.get(paneId);
      return { key: tab.key, process: info?.process ?? null };
    });
    activeTabIndex.value = active;
    const manager = activeManager();
    const paneId = manager?.activePaneId() ?? null;
    const info = paneId === null ? undefined : infoByPane.get(paneId);
    const process = info?.process ?? null;
    statusInfo.value = {
      branch,
      cwd: info?.cwd ?? null,
      agent: isAgent(process) ? process : null,
      paneCount: manager?.paneCount() ?? 0,
      home,
    };
  }

  const callbacks = {
    onLayoutChange(): void {
      syncViews();
      persist();
    },
  };

  /** Create + init a tab; false (and an error note) when spawning fails. */
  async function addTab(layout: SerializedNode | null): Promise<boolean> {
    const container = document.createElement("div");
    container.className = "tab-stage";
    container.style.display = "none";
    host.appendChild(container);
    const manager = createTerminalManager(container, callbacks);
    try {
      if (layout === null) {
        await manager.initFresh();
      } else {
        await manager.initFromLayout(layout);
      }
    } catch (err) {
      console.error("Failed to open tab:", err);
      manager.dispose();
      activeManager()?.notifyError(`Failed to open new tab: ${err}`);
      return false;
    }
    tabs.push({ key: nextKey, manager });
    nextKey += 1;
    return true;
  }

  function selectTab(index: number): void {
    if (index < 0 || index >= tabs.length || index === active) {
      return;
    }
    activeManager()?.hide();
    active = index;
    tabs[index].manager.show();
    syncViews();
    persist();
  }

  async function newTab(): Promise<void> {
    if (!(await addTab(null))) {
      return;
    }
    selectTab(tabs.length - 1);
  }

  async function closeTab(index: number): Promise<void> {
    const entry = tabs[index];
    if (!entry) {
      return;
    }
    const closingActive = index === active;
    entry.manager.dispose();
    tabs.splice(index, 1);
    if (tabs.length === 0) {
      // Never show zero tabs — replace the last one with a fresh tab
      active = -1;
      if (!(await addTab(null))) {
        syncViews();
        return;
      }
      active = 0;
      tabs[0].manager.show();
      syncViews();
      persist();
      return;
    }
    if (index < active) {
      active -= 1;
    }
    if (active >= tabs.length) {
      active = tabs.length - 1;
    }
    if (closingActive) {
      tabs[active].manager.show();
    }
    syncViews();
    persist();
  }

  function cycleTab(step: 1 | -1): void {
    if (tabs.length < 2) {
      return;
    }
    selectTab((active + step + tabs.length) % tabs.length);
  }

  function handleShortcut(event: KeyboardEvent): void {
    const action = matchBinding(event);
    if (action === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const tabIndex = selectTabIndex(action);
    if (tabIndex !== null) {
      selectTab(tabIndex); // out-of-range indexes are a no-op
      return;
    }
    switch (action) {
      case "split-row":
        void splitActive("row");
        break;
      case "split-column":
        void splitActive("column");
        break;
      case "close-pane":
        void closePane();
        break;
      case "focus-next":
        activeManager()?.cycleFocus(1);
        break;
      case "focus-prev":
        activeManager()?.cycleFocus(-1);
        break;
      case "new-tab":
        void newTab();
        break;
      case "close-tab":
        void closeTab(active);
        break;
      case "next-tab":
        cycleTab(1);
        break;
      case "prev-tab":
        cycleTab(-1);
        break;
    }
  }

  function splitActive(dir: Direction): Promise<void> {
    return activeManager()?.splitActive(dir) ?? Promise.resolve();
  }

  function closePane(): Promise<void> {
    return activeManager()?.closeActive() ?? Promise.resolve();
  }

  async function init(): Promise<void> {
    unlisteners.push(
      await listen<OutputPayload>(EVENT_OUTPUT, (event) => {
        for (const tab of tabs) {
          tab.manager.handleOutput(event.payload.id, event.payload.data);
        }
      }),
    );
    unlisteners.push(
      await listen<ExitPayload>(EVENT_EXIT, (event) => {
        for (const tab of tabs) {
          tab.manager.handleExit(event.payload.id);
        }
      }),
    );
    window.addEventListener("keydown", handleShortcut, true);
    try {
      home = await homeDir();
    } catch {
      home = "";
    }

    const session = settings.value.restoreTabs ? await loadSession() : null;
    if (session !== null) {
      for (const tab of session.tabs) {
        await addTab(tab.layout);
      }
    }
    if (tabs.length === 0) {
      await addTab(null);
    }
    if (tabs.length === 0) {
      // Even the fallback tab failed to spawn — errors are already logged
      syncViews();
      return;
    }
    selectTab(
      session === null ? 0 : Math.min(session.activeTab, tabs.length - 1),
    );
  }

  return {
    init,
    newTab,
    closeTab,
    selectTab,
    cycleTab,
    splitActive,
    closePane,
    applySettings(next) {
      for (const tab of tabs) {
        tab.manager.applySettings(next);
      }
    },
    focusActive() {
      activeManager()?.focusActive();
    },
    dispose() {
      window.removeEventListener("keydown", handleShortcut, true);
      for (const unlisten of unlisteners) {
        unlisten();
      }
      for (const tab of tabs) {
        tab.manager.dispose();
      }
      tabs.length = 0;
    },
  };
}
```

Lưu ý: `selectTab(0)` lần đầu chạy với `active = -1` → guard `index === active` không khớp → hoạt động đúng. `infoByPane` được poll đổ dữ liệu ở Task 10 — hiện tại luôn rỗng nên `process` là null (tab label hiển thị "shell").

- [ ] **Step 5: Sửa `src/ui/app.tsx` dùng tab-manager**

Đổi sang tab-manager; GIỮ NGUYÊN quit guard (`installQuitGuard`) và Sidebar/SettingsPanel markup. File đầy đủ sau khi sửa:

```tsx
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { installQuitGuard } from "../lib/quit-guard";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import { createTabManager, type TabManager } from "../terminal/tab-manager";
import { Sidebar } from "./sidebar";
import { SettingsPanel } from "./settings-panel";

export function App() {
  const panelOpen = useSignal(false);
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host);
    tabsRef.current = manager;
    manager.init().catch((err: unknown) => {
      console.error("Failed to initialize terminals:", err);
    });
    return () => manager.dispose();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    installQuitGuard()
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to install quit guard:", err);
      });
    return () => unlisten?.();
  }, []);

  // Apply settings to terminals + app chrome CSS vars whenever settings change
  useSignalEffect(() => {
    const current = settings.value;
    tabsRef.current?.applySettings(current);
    const theme = resolveTheme(current);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--app-bg", theme.background ?? "#16161e");
    rootStyle.setProperty("--app-fg", theme.foreground ?? "#c0caf5");
    rootStyle.setProperty("--accent", theme.blue ?? "#7aa2f7");
  });

  const closePanel = (): void => {
    panelOpen.value = false;
    tabsRef.current?.focusActive();
  };

  return (
    <div class="app app--left">
      <Sidebar
        position="left"
        settingsOpen={panelOpen.value}
        onToggleSettings={() => {
          if (panelOpen.value) {
            closePanel();
          } else {
            panelOpen.value = true;
          }
        }}
        onSplitRow={() => void tabsRef.current?.splitActive("row")}
        onSplitColumn={() => void tabsRef.current?.splitActive("column")}
        onClosePane={() => void tabsRef.current?.closePane()}
      />
      <div class="app__main">
        {panelOpen.value && <SettingsPanel onClose={closePanel} />}
        <div class="terminal-container" ref={stagesRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Thêm CSS `.tab-stage` vào `src/styles.css`**

Ngay sau khối `.terminal-container > * { ... }`:

```css
.tab-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.tab-stage > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 7: Test + build + smoke test đa tab**

Run: `npx vitest run && npm run build` → pass sạch. Rồi `npm run tauri dev`, kiểm:

- App mở 1 tab 1 pane như cũ; gõ lệnh, split ⌘D/⌘⇧D, đóng pane ⌘⇧W, ⌘]/⌘[ như cũ.
- `⌘T` → tab mới (terminal cũ biến mất, shell mới hiện — chưa có tab bar, đúng kỳ vọng).
- `⌘1`/`⌘2` nhảy giữa các tab; tab nền vẫn chạy (để `sleep 5 && echo hi` rồi chuyển tab, quay lại thấy `hi`).
- `⌘⇧]`/`⌘⇧[` xoay vòng tab.
- `⌘W` đóng tab (PTY chết — kiểm bằng `ps aux | grep zsh` giảm); đóng tab cuối → tab mới tinh xuất hiện.
- Restart app (`Ctrl+C` rồi dev lại): cấu trúc tab/split được khôi phục (shell mới). Tắt "Restore on launch" trong Settings → restart → chỉ 1 tab.
- File `~/Library/Application Support/com.kyantran.stackgrid/session.json` tồn tại và chứa layout.

- [ ] **Step 8: Commit**

```bash
git add src/terminal/terminal-manager.ts src/terminal/tabs-store.ts \
  src/terminal/session-persistence.ts src/terminal/tab-manager.ts \
  src/ui/app.tsx src/styles.css
git commit -m "feat(terminal): multi-session tabs with keyboard control and session restore

terminal-manager becomes a per-tab unit; the new tab-manager owns the
single pty event listeners, the keymap listener and session.json.

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 10: Info polling (pty_info + git_branch → signals + pane headers)

**Files:**

- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**

- Consumes: command `pty_info`/`git_branch` (Task 6), `updatePaneInfo` (Task 9), signals (Task 9).
- Produces: `infoByPane` được cập nhật mỗi 2s; `statusInfo.branch/cwd/agent` sống; pane headers sống.

- [ ] **Step 1: Thêm poll vào `src/terminal/tab-manager.ts`**

Thêm hằng sau `EVENT_EXIT`:

```ts
const POLL_INTERVAL_MS = 2000;
```

Thêm state sau `let branch: string | null = null;`:

```ts
  let lastBranchCwd: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollWarned = false;
```

Thêm 3 hàm sau `closePane`:

```ts
  /** Active pane of every tab (tab dots) + all panes of the active tab (headers). */
  function pollTargets(): number[] {
    const ids = new Set<number>();
    for (const tab of tabs) {
      const paneId = tab.manager.activePaneId();
      if (paneId !== null) {
        ids.add(paneId);
      }
    }
    for (const id of activeManager()?.paneIds() ?? []) {
      ids.add(id);
    }
    return [...ids];
  }

  async function updateBranch(): Promise<void> {
    const paneId = activeManager()?.activePaneId() ?? null;
    const cwd = paneId === null ? null : (infoByPane.get(paneId)?.cwd ?? null);
    if (cwd === lastBranchCwd) {
      return; // unchanged since the last poll — skip the git call
    }
    if (cwd === null) {
      lastBranchCwd = null;
      branch = null;
      return;
    }
    try {
      branch = await invoke<string | null>("git_branch", { cwd });
      lastBranchCwd = cwd;
    } catch (err) {
      if (!pollWarned) {
        console.warn("git_branch failed:", err);
        pollWarned = true;
      }
    }
  }

  async function poll(): Promise<void> {
    const ids = pollTargets();
    if (ids.length === 0) {
      return;
    }
    let infos: PaneProcessInfo[];
    try {
      infos = await invoke<PaneProcessInfo[]>("pty_info", { ids });
      pollWarned = false;
    } catch (err) {
      // Keep the last known values; warn once, never break the loop
      if (!pollWarned) {
        console.warn("pty_info failed:", err);
        pollWarned = true;
      }
      return;
    }
    for (const info of infos) {
      infoByPane.set(info.id, info);
    }
    activeManager()?.updatePaneInfo(infos, home);
    await updateBranch();
    syncViews();
  }
```

Trong `init()`, ngay sau dòng `selectTab(...)` cuối cùng, thêm:

```ts
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
```

Trong `dispose()`, thêm dòng đầu tiên:

```ts
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
```

- [ ] **Step 2: Build + smoke test**

Run: `npm run build` rồi `npm run tauri dev`, kiểm:

- Pane header hiện `~/...` cwd thật + badge `zsh` (xanh lá) sau ≤2s.
- `cd` sang thư mục khác → header đổi theo (≤2s).
- Chạy `claude` trong một pane → badge đổi thành `claude` (accent tint), dot đổi màu magenta.
- Console (devtools) không có warning lặp vô hạn.

- [ ] **Step 3: Commit**

```bash
git add src/terminal/tab-manager.ts
git commit -m "feat(terminal): poll foreground process, cwd and git branch every 2s

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 11: Chrome switchover — tab bar, status bar, grid layout, flat styles, overlay titlebar

Task chuyển giao diện: từ sidebar sang đúng thiết kế demo đã duyệt. `settings-panel` giữ markup cũ (được style tạm ở vị trí overlay) — redesign hoàn chỉnh ở Task 12.

**Files:**

- Modify: `src-tauri/tauri.conf.json`
- Create: `src/ui/tab-bar.tsx`
- Create: `src/ui/status-bar.tsx`
- Delete: `src/ui/sidebar.tsx`
- Rewrite: `src/ui/app.tsx`
- Rewrite: `src/styles.css`

**Interfaces:**

- Produces: `TabBar(props: TabBarProps)` — props `{ settingsOpen, onSelectTab(i), onCloseTab(i), onNewTab(), onSplitRow(), onSplitColumn(), onClosePane(), onCycleTheme(), onToggleSettings() }`; `StatusBar()` (không props — đọc signals). CSS vars mới do JS set: `--bg, --fg, --accent, --red, --green, --yellow, --magenta, --cyan` (thay `--app-bg`/`--app-fg`).
- Consumes: `tabViews`/`activeTabIndex`/`statusInfo` (Task 9), `dotColor`/`tildify` (Task 4), `THEME_PRESETS`/`getPreset` (có sẵn), `TabManager` (Task 9).

- [ ] **Step 1: `src-tauri/tauri.conf.json` — overlay titlebar (macOS)**

Trong `app.windows[0]`, thêm 2 key sau `"backgroundColor"`:

```json
        "backgroundColor": "#16161e",
        "titleBarStyle": "Overlay",
        "hiddenTitle": true
```

(Key macOS-only — platform khác tự bỏ qua, giữ decoration native đúng spec.)

- [ ] **Step 2: Tạo `src/ui/tab-bar.tsx`**

```tsx
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import { dotColor } from "../lib/process-info";

interface TabBarProps {
  settingsOpen: boolean;
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  onSplitRow(): void;
  onSplitColumn(): void;
  onClosePane(): void;
  onCycleTheme(): void;
  onToggleSettings(): void;
}

function SplitRowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <line x1="12" y1="4.5" x2="12" y2="19.5" />
    </svg>
  );
}

function SplitColumnIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
    </svg>
  );
}

function ClosePaneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 9.5l5 5m0-5l-5 5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  );
}

export function TabBar(props: TabBarProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  return (
    <header class="tabbar" data-tauri-drag-region>
      {/* Reserved space under the native traffic lights (titleBarStyle: Overlay) */}
      <div class="tabbar__traffic" data-tauri-drag-region aria-hidden="true" />
      <div class="tabbar__tabs" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.key}
            role="tab"
            aria-selected={index === active}
            tabIndex={0}
            class={`tab ${index === active ? "is-active" : ""}`}
            onClick={() => props.onSelectTab(index)}
          >
            <span
              class="tab__dot"
              style={{ background: dotColor(tab.process) }}
            />
            <span class="tab__label">{tab.process ?? "shell"}</span>
            <button
              type="button"
              class="tab__close"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                props.onCloseTab(index);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        class="tab-add"
        title="New tab (⌘T)"
        aria-label="New tab"
        onClick={props.onNewTab}
      >
        +
      </button>
      <div class="tabbar__spacer" data-tauri-drag-region />
      <div class="tabbar__actions">
        <button
          type="button"
          class="iconbtn"
          title="Split vertically (⌘D)"
          aria-label="Split pane vertically"
          onClick={props.onSplitRow}
        >
          <SplitRowIcon />
        </button>
        <button
          type="button"
          class="iconbtn"
          title="Split horizontally (⌘⇧D)"
          aria-label="Split pane horizontally"
          onClick={props.onSplitColumn}
        >
          <SplitColumnIcon />
        </button>
        <button
          type="button"
          class="iconbtn"
          title="Close pane (⌘⇧W)"
          aria-label="Close current pane"
          onClick={props.onClosePane}
        >
          <ClosePaneIcon />
        </button>
        <span class="tabbar__sep" aria-hidden="true" />
        <button
          type="button"
          class="swatch"
          title="Cycle theme"
          aria-label="Cycle theme preset"
          onClick={props.onCycleTheme}
        />
        <button
          type="button"
          class={`iconbtn iconbtn--gear ${props.settingsOpen ? "is-active" : ""}`}
          title="Settings"
          aria-label="Open settings"
          aria-pressed={props.settingsOpen}
          onClick={props.onToggleSettings}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Tạo `src/ui/status-bar.tsx`**

```tsx
import { settings } from "../settings/settings-store";
import { getPreset } from "../settings/themes";
import { statusInfo } from "../terminal/tabs-store";
import { tildify } from "../lib/process-info";

export function StatusBar() {
  const info = statusInfo.value;
  const themeLabel = getPreset(settings.value.themeId).label;
  const cwd = info.cwd === null ? null : tildify(info.cwd, info.home);
  return (
    <footer class="status">
      {info.branch !== null && (
        <>
          <span class="status__seg">
            <span class="status__gitdot" aria-hidden="true" />
            {info.branch}
          </span>
          <span class="status__vsep" aria-hidden="true" />
        </>
      )}
      {cwd !== null && <span class="status__seg">{cwd}</span>}
      {info.agent !== null && (
        <>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg status__seg--accent">{info.agent}</span>
        </>
      )}
      <div class="status__right">
        <span class="status__seg">
          {info.paneCount} {info.paneCount === 1 ? "pane" : "panes"}
        </span>
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">{themeLabel}</span>
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">
          <span class="status__hint">split</span>
          <kbd class="status__kbd">⌘D</kbd>
          <span class="status__hint">new tab</span>
          <kbd class="status__kbd">⌘T</kbd>
        </span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Viết lại `src/ui/app.tsx`** (vẫn giữ quit guard)

```tsx
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { installQuitGuard } from "../lib/quit-guard";
import { settings, updateSettings } from "../settings/settings-store";
import { resolveTheme, THEME_PRESETS } from "../settings/themes";
import { createTabManager, type TabManager } from "../terminal/tab-manager";
import { TabBar } from "./tab-bar";
import { StatusBar } from "./status-bar";
import { SettingsPanel } from "./settings-panel";

export function App() {
  const panelOpen = useSignal(false);
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host);
    tabsRef.current = manager;
    manager.init().catch((err: unknown) => {
      console.error("Failed to initialize terminals:", err);
    });
    return () => manager.dispose();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    installQuitGuard()
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to install quit guard:", err);
      });
    return () => unlisten?.();
  }, []);

  // Push theme colors into terminals and the chrome CSS vars
  useSignalEffect(() => {
    const current = settings.value;
    tabsRef.current?.applySettings(current);
    const theme = resolveTheme(current);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--bg", theme.background ?? "#16161e");
    rootStyle.setProperty("--fg", theme.foreground ?? "#c0caf5");
    rootStyle.setProperty("--accent", theme.blue ?? "#7aa2f7");
    rootStyle.setProperty("--red", theme.red ?? "#f7768e");
    rootStyle.setProperty("--green", theme.green ?? "#9ece6a");
    rootStyle.setProperty("--yellow", theme.yellow ?? "#e0af68");
    rootStyle.setProperty("--magenta", theme.magenta ?? "#bb9af7");
    rootStyle.setProperty("--cyan", theme.cyan ?? "#7dcfff");
  });

  const closePanel = (): void => {
    panelOpen.value = false;
    tabsRef.current?.focusActive();
  };

  const cycleTheme = (): void => {
    const index = THEME_PRESETS.findIndex(
      (preset) => preset.id === settings.value.themeId,
    );
    const next = THEME_PRESETS[(index + 1) % THEME_PRESETS.length];
    // Switching theme clears previous color overrides
    updateSettings({ themeId: next.id, colorOverrides: {} });
  };

  return (
    <div class="window">
      <TabBar
        settingsOpen={panelOpen.value}
        onSelectTab={(index) => tabsRef.current?.selectTab(index)}
        onCloseTab={(index) => void tabsRef.current?.closeTab(index)}
        onNewTab={() => void tabsRef.current?.newTab()}
        onSplitRow={() => void tabsRef.current?.splitActive("row")}
        onSplitColumn={() => void tabsRef.current?.splitActive("column")}
        onClosePane={() => void tabsRef.current?.closePane()}
        onCycleTheme={cycleTheme}
        onToggleSettings={() => {
          if (panelOpen.value) {
            closePanel();
          } else {
            panelOpen.value = true;
          }
        }}
      />
      <main class="stage">
        <div class="stage__tabs" ref={stagesRef} />
        {panelOpen.value && <SettingsPanel onClose={closePanel} />}
      </main>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 5: Xoá `src/ui/sidebar.tsx`**

```bash
git rm src/ui/sidebar.tsx
```

- [ ] **Step 6: Viết lại `src/styles.css`**

Thay toàn bộ file bằng:

```css
:root {
  /* Theme base vars — set from JS on theme change (app.tsx) */
  --bg: #16161e;
  --fg: #c0caf5;
  --accent: #7aa2f7;
  --red: #f7768e;
  --green: #9ece6a;
  --yellow: #e0af68;
  --magenta: #bb9af7;
  --cyan: #7dcfff;

  /* Derived chrome tones — follow the theme automatically */
  --chrome-1: color-mix(in srgb, var(--bg) 90%, white);
  --chrome-2: color-mix(in srgb, var(--bg) 82%, white);
  --hair: color-mix(in srgb, var(--fg) 12%, transparent);
  --hair-strong: color-mix(in srgb, var(--fg) 20%, transparent);
  --text-muted: color-mix(in srgb, var(--fg) 52%, var(--bg));
  --text-faint: color-mix(in srgb, var(--fg) 34%, var(--bg));

  --ui-font:
    -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  --mono:
    "SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Code", Menlo,
    monospace;

  --tabbar-h: 44px;
  --status-h: 28px;
  --radius: 10px;
}

/* Flat design rule: no box-shadow anywhere in this file.
   Depth comes from background steps and 1px hairline borders only. */

html,
body,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

/* ── Window shell: tab bar / stage / status bar ─────────── */

.window {
  height: 100vh;
  width: 100vw;
  display: grid;
  grid-template-rows: var(--tabbar-h) 1fr var(--status-h);
  color: var(--fg);
  font-family: var(--ui-font);
  font-size: 13px;
  background: var(--bg);
}

/* ── Tab bar ─────────────────────────────────────────────── */

.tabbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 0;
  background: var(--chrome-1);
  border-bottom: 1px solid var(--hair);
  min-width: 0;
}

/* Space reserved under the native macOS traffic lights (overlay titlebar) */
.tabbar__traffic {
  width: 78px;
  align-self: stretch;
  flex-shrink: 0;
}

.tabbar__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 6px 0 12px;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
  min-width: 0;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.tab:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 6%, transparent);
}

/* Active tab: background only — no other indicator (flat rule) */
.tab.is-active {
  color: var(--fg);
  background: color-mix(in srgb, var(--bg) 55%, white);
}

.tab__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-faint);
}

.tab__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.tab__close {
  margin-left: 2px;
  width: 16px;
  height: 16px;
  border: none;
  padding: 0;
  border-radius: 5px;
  display: grid;
  place-items: center;
  opacity: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition:
    opacity 0.14s ease,
    background 0.14s ease,
    color 0.14s ease;
}

.tab:hover .tab__close,
.tab.is-active .tab__close {
  opacity: 1;
}

.tab__close:hover {
  background: color-mix(in srgb, var(--red) 22%, transparent);
  color: var(--red);
}

.tab-add {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 17px;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.tab-add:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
  transform: rotate(90deg);
}

.tabbar__spacer {
  flex: 1;
  align-self: stretch;
}

.tabbar__actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

.tabbar__sep {
  width: 1px;
  height: 20px;
  background: var(--hair);
  margin: 0 5px;
}

.iconbtn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.iconbtn:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}

.iconbtn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.iconbtn.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.iconbtn--gear svg {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.iconbtn--gear:hover svg {
  transform: rotate(35deg);
}

.swatch {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--hair-strong);
  background: conic-gradient(
    from 210deg,
    var(--accent),
    var(--magenta),
    var(--cyan),
    var(--green),
    var(--accent)
  );
  transition: transform 0.15s ease;
}

.swatch:hover {
  transform: scale(1.06);
}

/* ── Stage (terminal area) ───────────────────────────────── */

.stage {
  position: relative;
  min-height: 0;
  min-width: 0;
}

.stage__tabs {
  position: absolute;
  inset: 0;
  padding: 8px;
  display: flex;
}

.tab-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.tab-stage > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* ── Split layout ────────────────────────────────────────── */

.split {
  display: flex;
  width: 100%;
  height: 100%;
}

.split--row {
  flex-direction: row;
}

.split--column {
  flex-direction: column;
}

.split__child {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.split__child > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.split__divider {
  flex: 0 0 6px;
  border-radius: 3px;
  background: transparent;
  transition: background 0.15s ease;
}

.split--row > .split__divider {
  cursor: col-resize;
  margin: 0 1px;
}

.split--column > .split__divider {
  cursor: row-resize;
  margin: 1px 0;
}

.split__divider:hover,
.split__divider.is-dragging {
  background: color-mix(in srgb, var(--accent) 60%, transparent);
}

/* While dragging a divider, block mouse events on terminals so text is not selected */
.split.is-resizing .pane {
  pointer-events: none;
}

/* ── Pane ────────────────────────────────────────────────── */

.pane-slot {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius);
  border: 1px solid var(--hair);
  background: var(--bg);
  transition: border-color 0.18s ease;
}

/* Active pane (only when >1 pane): accent-tinted border, no glow */
.pane-slot.is-active .pane {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.pane__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  font-size: 11px;
  color: var(--text-faint);
  border-bottom: 1px solid var(--hair);
  background: var(--chrome-1);
  flex-shrink: 0;
}

.pane__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}

.pane__cwd {
  color: var(--text-muted);
  font-family: var(--mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane__badge {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 5px;
}

.pane__badge--agent {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: color-mix(in srgb, var(--accent) 90%, var(--fg));
}

.pane__badge--shell {
  background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green);
}

.pane__term {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 8px 4px 4px 10px;
}

.pane__term .xterm {
  height: 100%;
}

/* xterm's viewport defaults to a black background — make it transparent so the
   theme background shows through, avoiding a black strip in the leftover space
   at the bottom of a pane (height not divisible by the cell height) */
.pane__term .xterm-viewport {
  background-color: transparent !important;
}

/* xterm scrollbar: thin, transparent, follows the theme */
.pane__term .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.pane__term .xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}

.pane__term .xterm-viewport::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 4px;
}

.pane__term .xterm-viewport::-webkit-scrollbar-corner {
  background: transparent;
}

/* ── Status bar ──────────────────────────────────────────── */

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--chrome-1);
  border-top: 1px solid var(--hair);
  min-width: 0;
  overflow: hidden;
}

.status__seg {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  min-width: 0;
}

.status__seg--accent {
  color: color-mix(in srgb, var(--accent) 85%, var(--fg));
}

.status__vsep {
  width: 1px;
  height: 13px;
  background: var(--hair);
  flex-shrink: 0;
}

.status__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.status__hint {
  color: var(--text-faint);
}

.status__kbd {
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--hair-strong);
  color: var(--text-muted);
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.status__gitdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
}

/* ── Settings panel (interim: old markup as a right-side card;
      final slide-over styling lands with the panel redesign) ── */

.settings-panel {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  width: 300px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--chrome-2);
  border: 1px solid var(--hair-strong);
  border-radius: 12px;
  z-index: 20;
  animation: panel-in 0.18s ease-out;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.settings-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  position: sticky;
  top: 0;
  background: var(--chrome-2);
}

.settings-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.settings-panel__close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
}

.settings-panel__close:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.settings-section {
  padding: 10px 16px 14px;
  border-top: 1px solid var(--hair);
}

.settings-section__title {
  margin: 0 0 10px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}

.settings-panel__footer {
  margin-top: auto;
  padding: 14px 16px;
  border-top: 1px solid var(--hair);
}

/* ── Form controls ───────────────────────────────────────── */

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.field:last-child {
  margin-bottom: 0;
}

.field__label {
  font-size: 12px;
  color: var(--text-muted);
}

.select,
.text-input {
  appearance: none;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 70%, white);
  color: var(--fg);
  font-family: var(--ui-font);
  font-size: 12.5px;
}

.select {
  background-image:
    linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
    linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 55%,
    calc(100% - 11px) 55%;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
}

.select:focus-visible,
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--hair-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 70%, white);
  width: fit-content;
}

.stepper__button {
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--fg);
  font-size: 14px;
  cursor: pointer;
  border-radius: 7px;
}

.stepper__button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}

.stepper__button:disabled {
  color: var(--text-faint);
  cursor: default;
}

.stepper__value {
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
}

.color-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.color-field__label {
  font-size: 12px;
  color: var(--text-muted);
}

.color-field__controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-field__swatch {
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--hair-strong);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.color-field__swatch::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.color-field__swatch::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}

.color-field__hex {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.color-field__clear {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 13px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
}

.color-field__clear:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hair-strong);
  border-radius: 9px;
  background: color-mix(in srgb, var(--bg) 70%, white);
  width: fit-content;
}

.segmented__option {
  border: none;
  padding: 4px 14px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.segmented__option.is-active {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--fg);
}

.btn-reset {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

.btn-reset:hover {
  color: var(--fg);
  border-color: var(--text-muted);
}
```

- [ ] **Step 7: Build + smoke test + eye-check**

Run: `npx vitest run && npm run build` → pass. Rồi `npm run tauri dev`, kiểm:

- Traffic lights native nổi trên tab bar, không đè lên tab đầu tiên; kéo vùng trống của tab bar di chuyển được cửa sổ; click tab/nút KHÔNG kéo cửa sổ.
- Tab bar: click tab chuyển tab, `×` đóng tab, `+` mở tab, cluster phải hoạt động đủ (split dọc/ngang, close pane, swatch xoay 4 theme, gear mở settings).
- Status bar hiện: `● main · ~/dev/... · [agent]` trái; `N panes · Theme name · split ⌘D new tab ⌘T` phải. Vào thư mục không phải repo → segment git ẩn.
- Không còn sidebar. Grid 44px / stage / 28px.
- `grep -c "box-shadow" src/styles.css` → **0**.
- **Eye-check** (frontend-design-bar): mở `stackgrid-demo.html` cạnh app, so sánh từng vùng (tab bar, pane, status bar) trên cả 4 theme (click swatch 4 lần). Chênh lệch chấp nhận: nội dung terminal thật thay vì fake.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/tauri.conf.json src/ui/tab-bar.tsx src/ui/status-bar.tsx \
  src/ui/app.tsx src/styles.css
git rm --cached --ignore-unmatch src/ui/sidebar.tsx 2>/dev/null; git add -u src/ui
git commit -m "feat(ui): Warp-style tab bar, status bar and flat chrome

Replaces the icon sidebar; native traffic lights overlay the tab bar
(titleBarStyle: Overlay). No box-shadows — flat design rule.

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 12: Settings panel redesign — theme grid + slide-over

**Files:**

- Rewrite: `src/ui/settings-panel.tsx`
- Modify: `src/ui/app.tsx` (render panel thường trực với prop `open`)
- Modify: `src/styles.css` (thay block `.settings-panel` bằng `.panel` slide-over + theme grid)

**Interfaces:**

- Produces: `SettingsPanel({ open, onClose })` — luôn mounted, toggle class `is-open` (để transition chạy).
- Consumes: `THEME_PRESETS`, `updateSettings`, `ColorField`, `FontSelect` (không đổi).

- [ ] **Step 1: Viết lại `src/ui/settings-panel.tsx`**

```tsx
import {
  resetSettings,
  settings,
  updateColorOverride,
  updateSettings,
} from "../settings/settings-store";
import {
  clampFontSize,
  COLOR_KEYS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type TerminalColors,
} from "../settings/settings-schema";
import { getPreset, THEME_PRESETS } from "../settings/themes";
import { ColorField } from "./controls/color-field";
import { FontSelect } from "./controls/font-select";

const COLOR_LABELS: Record<keyof TerminalColors, string> = {
  background: "Background",
  foreground: "Foreground",
  cursor: "Cursor",
  selectionBackground: "Selection",
};

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const current = settings.value;
  const preset = getPreset(current.themeId);

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  return (
    <aside
      class={`panel ${open ? "is-open" : ""}`}
      aria-label="Settings"
      aria-hidden={!open}
    >
      <header class="panel__head">
        <h2 class="panel__title">Settings</h2>
        <button
          type="button"
          class="panel__x"
          aria-label="Close settings"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div class="panel__body">
        <section class="panel__sec">
          <h3 class="panel__sec-title">Theme</h3>
          <div class="theme-grid">
            {THEME_PRESETS.map((themePreset) => (
              <button
                key={themePreset.id}
                type="button"
                class={`theme-chip ${
                  themePreset.id === current.themeId ? "is-active" : ""
                }`}
                onClick={() =>
                  // Switching theme clears previous color overrides
                  updateSettings({
                    themeId: themePreset.id,
                    colorOverrides: {},
                  })
                }
              >
                <span
                  class="theme-chip__swatch"
                  style={{
                    background: themePreset.theme.background,
                    borderColor: themePreset.theme.blue,
                  }}
                />
                {themePreset.label}
              </button>
            ))}
          </div>
        </section>

        <section class="panel__sec">
          <h3 class="panel__sec-title">Font</h3>
          <FontSelect
            value={current.fontFamily}
            onChange={(fontFamily) => updateSettings({ fontFamily })}
          />
          <div class="field">
            <span class="field__label">Font size</span>
            <div class="stepper">
              <button
                type="button"
                class="stepper__button"
                aria-label="Decrease font size"
                disabled={current.fontSize <= FONT_SIZE_MIN}
                onClick={() => stepFontSize(-1)}
              >
                −
              </button>
              <span class="stepper__value">{current.fontSize}</span>
              <button
                type="button"
                class="stepper__button"
                aria-label="Increase font size"
                disabled={current.fontSize >= FONT_SIZE_MAX}
                onClick={() => stepFontSize(1)}
              >
                +
              </button>
            </div>
          </div>
        </section>

        <section class="panel__sec">
          <h3 class="panel__sec-title">Colors</h3>
          {COLOR_KEYS.map((key) => (
            <ColorField
              key={key}
              label={COLOR_LABELS[key]}
              value={current.colorOverrides[key] ?? preset.theme[key]}
              overridden={current.colorOverrides[key] !== undefined}
              onChange={(hex) => updateColorOverride(key, hex)}
              onClear={() => updateColorOverride(key, undefined)}
            />
          ))}
        </section>

        <section class="panel__sec">
          <h3 class="panel__sec-title">Tabs</h3>
          <div class="field">
            <span class="field__label">Restore on launch</span>
            <div
              class="segmented"
              role="radiogroup"
              aria-label="Restore tabs on launch"
            >
              <button
                type="button"
                role="radio"
                aria-checked={current.restoreTabs}
                class={`segmented__option ${current.restoreTabs ? "is-active" : ""}`}
                onClick={() => updateSettings({ restoreTabs: true })}
              >
                On
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!current.restoreTabs}
                class={`segmented__option ${current.restoreTabs ? "" : "is-active"}`}
                onClick={() => updateSettings({ restoreTabs: false })}
              >
                Off
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer class="panel__footer">
        <button type="button" class="btn-reset" onClick={resetSettings}>
          Restore defaults
        </button>
      </footer>
    </aside>
  );
}
```

- [ ] **Step 2: Sửa `src/ui/app.tsx` — panel luôn mounted**

Thay dòng `{panelOpen.value && <SettingsPanel onClose={closePanel} />}` bằng:

```tsx
        <SettingsPanel open={panelOpen.value} onClose={closePanel} />
```

- [ ] **Step 3: Thay CSS panel trong `src/styles.css`**

Xoá nguyên block từ comment `/* ── Settings panel (interim: ... ── */` đến hết `.settings-panel__footer { ... }` (bao gồm `@keyframes panel-in`), thay bằng:

```css
/* ── Settings panel: slide-over anchored to the stage's right edge ── */

.panel {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  width: 300px;
  background: var(--chrome-2);
  border: 1px solid var(--hair-strong);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  z-index: 20;
  transform: translateX(calc(100% + 20px));
  opacity: 0;
  pointer-events: none;
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease;
}

.panel.is-open {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  flex-shrink: 0;
}

.panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.panel__x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  width: 26px;
  height: 26px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}

.panel__x:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}

.panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.panel__sec {
  padding: 12px 16px;
  border-top: 1px solid var(--hair);
}

.panel__sec-title {
  margin: 0 0 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: var(--text-faint);
}

.panel__footer {
  padding: 14px 16px;
  border-top: 1px solid var(--hair);
  flex-shrink: 0;
}

.theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  border: 1px solid var(--hair);
  background: color-mix(in srgb, var(--bg) 70%, white);
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--ui-font);
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.theme-chip:hover {
  color: var(--fg);
}

.theme-chip.is-active {
  border-color: var(--accent);
  color: var(--fg);
}

/* Swatch outline uses a real border (accent via inline style) — flat rule */
.theme-chip__swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
  border: 2px solid transparent;
}
```

- [ ] **Step 4: Build + smoke test**

Run: `npx vitest run && npm run build` → pass. Rồi `npm run tauri dev`, kiểm:

- Gear → panel trượt vào từ phải (spring ease), overlay đè lên terminal, KHÔNG đẩy layout; gear có trạng thái active.
- Theme grid 2 cột, chip active viền accent; click chip đổi theme toàn app ngay.
- Font select + stepper, Colors overrides, Tabs On/Off hoạt động như trước; "Restore defaults" reset cả `restoreTabs`.
- Đóng panel → focus trả về terminal.
- `grep -c "box-shadow" src/styles.css` → **0**.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings-panel.tsx src/ui/app.tsx src/styles.css
git commit -m "feat(settings): slide-over panel with theme preset grid

Claude-Session: https://claude.ai/code/session_015ZKu2HjQBCNrxJsgE8GcRj"
```

---

### Task 13: Verification sweep cuối (spec §6)

**Files:** không sửa code trừ khi phát hiện bug.

- [ ] **Step 1: Toàn bộ automated checks**

Run:

```bash
npx vitest run
npm run build
(cd src-tauri && cargo build && cargo test)
grep -c "box-shadow" src/styles.css || true
```

Expected: tests pass hết; builds sạch; grep ra `0`.

- [ ] **Step 2: Manual checklist (`npm run tauri dev`)**

- Tab flows: tạo (⌘T + nút `+`), đóng (⌘W + `×`, tab cuối tự thay mới), chuyển (click, ⌘⇧]/⌘⇧[, ⌘1-9; ⌘9 khi chỉ có 2 tab → no-op).
- Pane flows trong nhiều tab: split/close/focus/drag divider; PTY exit ở tab nền (chạy `exit` rồi chuyển tab): pane tự đóng hoặc hiện "press Enter" nếu là pane cuối của tab đó.
- Restore: xếp 2 tab (1 tab split đôi + chỉnh ratio), quit, mở lại → đúng cấu trúc + ratio, shell mới tinh; corrupt file (`echo '{"broken":1}' > "$HOME/Library/Application Support/com.kyantran.stackgrid/session.json"`) → mở 1 tab mới + console.warn, không crash.
- Theme cycling qua đủ 4 preset từ swatch — chrome + terminal + dots đổi đồng bộ.
- Status bar: mở `claude` ở pane này, `zsh` ở pane kia — label/dot/badge/status agent đúng; branch đổi khi `cd` giữa repo/non-repo.
- Traffic-light spacing đúng, kéo cửa sổ từ tab bar OK, fullscreen vào/ra không vỡ layout.
- Quit-confirm không regress: `⌘Q` và nút đóng cửa sổ đều hiện dialog; Cancel giữ nguyên app, Quit thoát hẳn.

- [ ] **Step 3: Eye-check chốt (frontend-design-bar)**

Screenshot app cạnh `stackgrid-demo.html` (nguồn: scratchpad session trước — nếu mất, dựa mô tả spec §1) trên theme Tokyo Night + Dracula. Cần đạt: nhìn "designed, not generated" — spacing/độ tương phản/bo góc khớp demo.

- [ ] **Step 4: Commit dọn dẹp (nếu có sửa)**

```bash
git status --porcelain   # nếu sạch → xong, không commit gì thêm
```

---

## Self-Review

**Spec coverage:**

- §1 Window shell (grid 44/1fr/28, Overlay titlebar, drag region, ~80px traffic) → Task 11 ✅
- §1 Chrome tones (`--bg/--fg/--accent` + 5 màu từ JS; `--chrome-1/2`, `--hair(-strong)`, `--text-muted/faint` derived; **no box-shadow**) → Task 11 (vars + CSS), verify grep ở 11/12/13 ✅
- §1 Tab bar (dot/label/close, `+`, action cluster, swatch cycle, gear active) → Task 11 ✅
- §1 Terminal stage (8px, pane rounded 10px hairline, active accent border, pane header dot/cwd/badge, divider accent hover) → Tasks 8, 10, 11 ✅
- §1 Status bar (mono 11px, branch/cwd/agent | panes/theme/kbd hints) → Task 11 ✅
- §1 Settings panel (slide-over overlay, Theme grid, Font, Colors, Tabs restore toggle, bỏ Sidebar, giữ Restore defaults) → Tasks 5, 12 ✅
- §2 Frontend (per-tab manager show/hide/serialize/init; tab-manager signals, 1 keydown, 1 pty listener route; tab-bar/status-bar/app grid; serializeTree layout shape) → Tasks 1, 2, 9, 11 ✅
- §2 Backend (`pty_info` tcgetpgrp→libproc fallback child pid, không bao giờ Err phá loop; `git_branch` no-shell) → Task 6 ✅ (dùng libc bindings thay crate libproc — cùng syscalls, lý do ghi trong task)
- §2 Polling (2s một interval; active pane mỗi tab + all panes tab active; git_branch skip khi cwd không đổi; fail → giữ giá trị cũ, warn một lần) → Task 10 ✅
- §3 Persistence (settings bỏ `sidebarPosition`/thêm `restoreTabs`; `session.json` version 1 đúng shape; debounce 500ms trên create/close/switch/split/close-pane/ratio; invalid → fresh tab + warn; version mismatch → discard) → Tasks 3, 5, 9 ✅
- §4 Shortcuts (⌘T/⌘W/⌘⇧]/⌘⇧[/⌘1-9, wrap, no-op index thiếu; last tab close → fresh tab; pane bindings giữ nguyên) → Tasks 1, 9 ✅ (+ Task 7 giải phóng ⌘W khỏi menu mặc định — điều kiện tiên quyết spec không nói rõ nhưng bắt buộc trên macOS; giữ nguyên item Quit tuỳ chỉnh của quit-confirm)
- §5 Error handling (spawn fail → error line vào pane active; poll fail → giữ giá trị; corrupt session → fresh + warn; PTY exit tab nền theo luật cũ) → Tasks 9, 10 ✅
- §6 Testing (unit: serialize round-trip + ratios, session validation corrupt/missing/version, keymap matching; manual eye-check checklist) → Tasks 1-5, 13 ✅

**Placeholder scan:** không còn TBD/TODO; mọi code step có nội dung đầy đủ; điểm "interim" duy nhất (CSS `.settings-panel` ở Task 11) là code hoàn chỉnh chạy được và bị thay có chủ đích ở Task 12. ✅

**Type consistency:** `SerializedNode` (type/direction/ratio/first/second) thống nhất Task 2/3/9; `PaneProcessInfo` (id/cwd/process) khớp `PtyInfo` serde Task 6 và dùng ở Task 4/9/10; `PaneHeaderInfo` khớp Task 4/8/9; `TabManager`/`TerminalManager` methods khớp giữa Task 9/10/11; `matchBinding`/`selectTabIndex` khớp Task 1/9; `restoreTabs` khớp Task 5/9/12. ✅

**Ghi chú rủi ro đã xử lý:** ⌘W bị menu mặc định nuốt (Task 7 — viết lại `menu.rs`, giữ item Quit tuỳ chỉnh `quit-confirm`); quit-confirm không regress — cả hai bản rewrite `app.tsx` (Task 9, 11) giữ `installQuitGuard`, `lib.rs` chỉ edit cộng thêm (Task 6); Preact không được đụng DOM thủ công của tab-stages (tách `stage__tabs` ref riêng, panel là sibling); `vip_path` là `[[c_char;32];32]` trong libc — cast qua `as_ptr()` (Task 6); debounce 500ms có thể mất save nếu quit ngay sau thay đổi cấu trúc (chấp nhận — spec không yêu cầu flush-on-quit).

**Review pass (2026-07-03, plan-reviewer/Opus):** verdict ban đầu NEEDS REWORK do plan viết trên baseline cũ (plan 2026-07-02 đã được chạy giữa chừng bởi session khác). Đã sửa cả 6 findings: (1) cập nhật baseline; (2) Task 7 retarget sang `menu.rs`, giữ quit-confirm; (3) cả hai bản `app.tsx` giữ `installQuitGuard`; (4) Task 6 `lib.rs` thành edit cộng thêm; (5) Task 1 thành ghi đè + sửa expected output; (6) sửa đếm selector Task 8. Các phần reviewer xác nhận OK: reference integrity, task ordering/build-per-commit, type consistency, logic tab index/poll/routing/debounce, Rust API (portable-pty 0.9, libc bindings, Tauri async command constraints).
