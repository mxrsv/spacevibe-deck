# Quit confirm + Keymap refactor + gitignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dọn shortcut về một keymap tập trung (giữ nguyên phím), thêm popup confirm native khi thoát app (cover cả nút đóng cửa sổ lẫn ⌘Q), và ignore `docs/` trong git.

**Architecture:** Shortcut tách hai tầng — `keymap.ts` giữ data "phím → action", `terminal-manager.ts` giữ "action → hành vi". Quit confirm quy mọi đường thoát về một hành động `app.exit(0)` phía Rust; cờ `confirmed` (Rust) + guard `prompting` (frontend) đảm bảo chỉ hỏi một lần.

**Tech Stack:** Tauri 2 (Rust), Preact + `@preact/signals`, xterm.js, `@tauri-apps/plugin-dialog`.

## Global Constraints

- Không có test framework trong repo — **không thêm** (theo spec). Verify bằng: `npm run build` (tsc + vite), `cargo build` trong `src-tauri`, và smoke test tay qua `npm run tauri dev`.
- Giữ nguyên phím shortcut: `⌘D`→split-row, `⌘⇧D`→split-column, `⌘⇧W`→close-pane, `⌘]`→focus-next, `⌘[`→focus-prev.
- Versions: `@tauri-apps/plugin-dialog` `^2`, `tauri-plugin-dialog` `"2"`.
- Style: immutable, file nhỏ tập trung (theo coding-style của repo).
- Mọi commit kết thúc bằng trailer `Claude-Session: https://claude.ai/code/session_01Ln74PeETwj9JsWPtzADZK1`.

---

### Task 1: Ignore `docs/` trong git

**Files:**

- Modify: `.gitignore`

`docs/` chưa từng được commit → chỉ cần thêm dòng ignore, không cần `git rm --cached`.

- [x] **Step 1: Thêm dòng ignore vào cuối `.gitignore`**

Nối vào cuối file:

```gitignore

# Local design docs / specs (không track)
docs/
```

- [x] **Step 2: Xác nhận docs/ đã bị ignore**

Run:

```bash
git check-ignore docs/superpowers/specs/2026-07-02-quit-confirm-keymap-refactor-design.md
git status --porcelain docs/
```

Expected: lệnh đầu in ra đúng path (đã ignore); lệnh sau **không** in gì (docs/ không còn hiện untracked).

- [x] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore docs/ directory

Claude-Session: https://claude.ai/code/session_01Ln74PeETwj9JsWPtzADZK1"
```

---

### Task 2: Gom shortcut về keymap tập trung (giữ nguyên phím)

**Files:**

- Create: `src/terminal/keymap.ts`
- Modify: `src/terminal/terminal-manager.ts` (thân `handleShortcut`, hiện ở dòng 269–292; thêm import ở đầu file)

**Interfaces:**

- Produces: `ShortcutAction` (union type), `KeyBinding` (interface), `DEFAULT_KEYMAP` (`readonly KeyBinding[]`), `matchBinding(event: KeyboardEvent, keymap?: readonly KeyBinding[]): ShortcutAction | null`.
- Consumes: `splitActive("row" | "column")`, `closeActive()`, `cycleFocus(1 | -1)` — các closure có sẵn trong `terminal-manager.ts`.

- [x] **Step 1: Tạo `src/terminal/keymap.ts`**

```ts
export type ShortcutAction =
  | "split-row"
  | "split-column"
  | "close-pane"
  | "focus-next"
  | "focus-prev";

export interface KeyBinding {
  readonly key: string; // event.key đã lowercase
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ShortcutAction;
}

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  { key: "w", meta: true, shift: true, action: "close-pane" },
  { key: "]", meta: true, action: "focus-next" },
  { key: "[", meta: true, action: "focus-prev" },
];

/** So khớp phím chính xác cả 4 modifier; trả về action hoặc null nếu không khớp. */
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
```

- [x] **Step 2: Thêm import vào đầu `src/terminal/terminal-manager.ts`**

Thêm cạnh các import hiện có ở đầu file:

```ts
import { matchBinding } from "./keymap";
```

- [x] **Step 3: Thay thân `handleShortcut`**

Thay nguyên khối hiện tại (dòng 269–292):

```ts
function handleShortcut(event: KeyboardEvent): void {
  if (!event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  let handled = true;
  if (key === "d" && !event.shiftKey) {
    void splitActive("row");
  } else if (key === "d" && event.shiftKey) {
    void splitActive("column");
  } else if (key === "w" && event.shiftKey) {
    void closeActive();
  } else if (key === "]") {
    cycleFocus(1);
  } else if (key === "[") {
    cycleFocus(-1);
  } else {
    handled = false;
  }
  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}
```

bằng:

```ts
function handleShortcut(event: KeyboardEvent): void {
  const action = matchBinding(event);
  if (!action) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  switch (action) {
    case "split-row":
      void splitActive("row");
      break;
    case "split-column":
      void splitActive("column");
      break;
    case "close-pane":
      void closeActive();
      break;
    case "focus-next":
      cycleFocus(1);
      break;
    case "focus-prev":
      cycleFocus(-1);
      break;
  }
}
```

- [x] **Step 4: Typecheck**

Run: `npm run build`
Expected: qua sạch, không lỗi TS. (Có thể chạy nhanh chỉ typecheck: `npx tsc --noEmit`.)

- [x] **Step 5: Smoke test tay**

Run: `npm run tauri dev`
Expected: `⌘D` tách pane theo row, `⌘⇧D` tách theo column, `⌘⇧W` đóng pane active, `⌘]` / `⌘[` chuyển focus tới/lui — **y như trước**.

- [x] **Step 6: Commit**

```bash
git add src/terminal/keymap.ts src/terminal/terminal-manager.ts
git commit -m "refactor(terminal): centralize shortcuts into keymap table

Claude-Session: https://claude.ai/code/session_01Ln74PeETwj9JsWPtzADZK1"
```

---

### Task 3: Popup confirm khi quit (dialog native, cover nút đóng + ⌘Q)

Tính năng nguyên khối — nửa vời sẽ làm app **không thoát được** (ExitRequested chặn thoát mà chưa ai lắng nghe). Vì vậy làm trọn backend + frontend rồi mới verify + commit một lần.

**Files:**

- Modify: `package.json` (thêm dep frontend)
- Modify: `src-tauri/Cargo.toml` (thêm dep Rust)
- Modify: `src-tauri/src/lib.rs` (plugin + state + command + RunEvent)
- Modify: `src-tauri/capabilities/default.json` (thêm `dialog:default`)
- Create: `src/lib/quit-guard.ts`
- Modify: `src/ui/app.tsx` (thêm useEffect cài guard)

**Interfaces:**

- Produces (frontend): `installQuitGuard(): Promise<UnlistenFn>`.
- Produces (backend): command `confirm_quit`; event `"quit-requested"` (payload rỗng) emit từ Rust khi có yêu cầu thoát chưa xác nhận.
- Consumes: `getCurrentWindow().onCloseRequested`, `ask` từ `@tauri-apps/plugin-dialog`, `invoke` từ `@tauri-apps/api/core`, `listen` từ `@tauri-apps/api/event`.

- [x] **Step 1: Cài dialog plugin (frontend)**

Run: `npm install @tauri-apps/plugin-dialog@2`
Expected: `package.json` có `"@tauri-apps/plugin-dialog": "^2"` trong `dependencies`, `package-lock.json` cập nhật.

- [x] **Step 2: Thêm dep Rust vào `src-tauri/Cargo.toml`**

Trong khối `[dependencies]`, thêm dòng (cạnh các plugin khác):

```toml
tauri-plugin-dialog = "2"
```

- [x] **Step 3: Viết lại `src-tauri/src/lib.rs`**

Thay toàn bộ nội dung file bằng:

```rust
mod pty;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct QuitState {
    confirmed: AtomicBool,
}

#[tauri::command]
fn confirm_quit(app: tauri::AppHandle, state: tauri::State<'_, QuitState>) {
    state.confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(QuitState::default())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_shell,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            confirm_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<QuitState>();
                if !state.confirmed.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app_handle.emit("quit-requested", ());
                }
            }
        });
}
```

- [x] **Step 4: Thêm permission `dialog:default` vào capabilities**

Thay `src-tauri/capabilities/default.json` bằng:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "dialog:default"
  ]
}
```

(`core:default` đã bao gồm quyền lắng nghe event nên `listen("quit-requested")` chạy được. Nếu runtime báo thiếu, thêm `"core:event:default"` vào mảng.)

- [x] **Step 5: Tạo `src/lib/quit-guard.ts`**

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

let prompting = false;

async function promptQuit(): Promise<void> {
  if (prompting) {
    return;
  }
  prompting = true;
  try {
    const ok = await ask("Bạn có chắc muốn thoát Stackgrid?", {
      title: "Thoát Stackgrid",
      kind: "warning",
      okLabel: "Thoát",
      cancelLabel: "Huỷ",
    });
    if (ok) {
      await invoke("confirm_quit");
    }
  } catch (err: unknown) {
    console.error("Quit prompt failed:", err);
  } finally {
    prompting = false;
  }
}

/** Cài guard cho cả nút đóng cửa sổ lẫn ⌘Q. Trả về hàm gỡ listener. */
export async function installQuitGuard(): Promise<UnlistenFn> {
  const unlistenClose = await getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    void promptQuit();
  });
  const unlistenQuit = await listen("quit-requested", () => {
    void promptQuit();
  });
  return () => {
    unlistenClose();
    unlistenQuit();
  };
}
```

- [x] **Step 6: Wiring trong `src/ui/app.tsx`**

Thêm import (cạnh các import hiện có):

```ts
import type { UnlistenFn } from "@tauri-apps/api/event";
import { installQuitGuard } from "../lib/quit-guard";
```

Thêm một `useEffect` mới ngay sau `useEffect` khởi tạo terminal (cái kết thúc bằng `}, []);` ở dòng ~28):

```ts
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
```

- [x] **Step 7: Build backend + frontend**

Run:

```bash
npm run build
(cd src-tauri && cargo build)
```

Expected: cả hai qua sạch. `cargo build` biên dịch `tauri-plugin-dialog` + `lib.rs` mới không lỗi.

- [x] **Step 8: Smoke test tay (quan trọng nhất)**

Run: `npm run tauri dev`, kiểm:

- Nhấn nút đóng cửa sổ (red X) → hiện dialog "Thoát Stackgrid". **Huỷ** → app còn nguyên. Mở lại, chọn **Thoát** → app thoát hẳn.
- Nhấn `⌘Q` → hiện dialog. **Huỷ** → còn nguyên. **Thoát** → app thoát.
- Không có trường hợp hiện dialog **hai lần**.
- Các shortcut `⌘D`/`⌘⇧D`/`⌘⇧W`/`⌘]`/`⌘[` vẫn chạy bình thường.

- [x] **Step 9: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src-tauri/src/lib.rs src-tauri/capabilities/default.json \
  src/lib/quit-guard.ts src/ui/app.tsx
git commit -m "feat: confirm dialog before quitting the app

Covers both window close button and macOS Cmd+Q via a Rust ExitRequested
guard and a shared confirmed flag, so the user is only asked once.

Claude-Session: https://claude.ai/code/session_01Ln74PeETwj9JsWPtzADZK1"
```

---

## Self-Review

**Spec coverage:**

- §1 Keymap refactor → Task 2 ✅ (keymap.ts + handleShortcut, phím giữ nguyên).
- §2 Quit confirm (nút đóng + ⌘Q, cờ confirmed, guard prompting, deps/capabilities) → Task 3 ✅.
- §3 gitignore docs/ → Task 1 ✅.

**Placeholder scan:** Không có TBD/TODO; mọi step có code/lệnh cụ thể. ✅

**Type consistency:** `ShortcutAction`, `KeyBinding`, `DEFAULT_KEYMAP`, `matchBinding` dùng đồng nhất giữa Task 2 và spec. `installQuitGuard(): Promise<UnlistenFn>`, command `confirm_quit`, event `"quit-requested"` khớp giữa frontend (`quit-guard.ts`, `app.tsx`) và backend (`lib.rs`). ✅

**Ghi chú:** `confirmed` chỉ set `true` ngay trước `app.exit(0)` nên không cần reset khi user Huỷ (Huỷ giữ nguyên `false`). `onCloseRequested` luôn `preventDefault()` rồi thoát qua `app.exit(0)` để đảm bảo thoát thật (trên macOS đóng cửa sổ đơn không tự thoát process).
