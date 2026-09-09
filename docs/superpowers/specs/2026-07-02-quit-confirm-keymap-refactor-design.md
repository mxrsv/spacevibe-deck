# Stackgrid — Quit confirm + Keymap refactor + gitignore docs

**Date:** 2026-07-02
**Status:** Approved design (pending implementation plan)

## Bối cảnh

Stackgrid là app terminal desktop (Tauri 2 + Preact + signals + xterm.js, backend Rust
với `portable-pty`). Đây là spec gộp cho 3 thay đổi nhỏ, độc lập:

1. Refactor bộ shortcut đang hardcoded thành keymap tập trung (giữ nguyên phím).
2. Thêm popup confirm (dialog native) khi thoát app — cover mọi đường quit.
3. Cho `docs/` vào `.gitignore`.

---

## 1. Refactor shortcut → keymap tập trung

### Vấn đề

`handleShortcut` trong `src/terminal/terminal-manager.ts` là một chuỗi `if-else` trộn
lẫn "phím nào" với "làm gì" — khó đọc, khó mở rộng.

### Thiết kế

Tách thành hai tầng trách nhiệm:

- `keymap.ts` giữ dữ liệu thuần _"tổ hợp phím → tên action"_.
- `terminal-manager.ts` giữ logic _"tên action → hành vi"_.

**File mới `src/terminal/keymap.ts`:**

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

export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = DEFAULT_KEYMAP,
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  for (const b of keymap) {
    if (
      b.key === key &&
      !!b.meta === event.metaKey &&
      !!b.shift === event.shiftKey &&
      !!b.alt === event.altKey &&
      !!b.ctrl === event.ctrlKey
    ) {
      return b.action;
    }
  }
  return null;
}
```

**Sửa `src/terminal/terminal-manager.ts`:** thay thân `handleShortcut` bằng

```ts
function handleShortcut(event: KeyboardEvent): void {
  const action = matchBinding(event);
  if (!action) return;
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

### Tương đương hành vi

`matchBinding` so khớp cả 4 modifier **chính xác** → tái tạo đúng bộ guard cũ
(`!metaKey || ctrlKey || altKey` → bỏ qua). Riêng branch `]` / `[` cũ không kiểm tra
`shift`, nhưng trên bàn phím US giữ Shift đổi ký tự (`]`→`}`) nên thực tế không đổi
hành vi. Phím giữ **y hệt hiện tại**.

### Lợi ích tương lai

`matchBinding` là hàm thuần, không phụ thuộc React/DOM (ngoài kiểu `KeyboardEvent`) →
test được, và sau này muốn cho cấu hình trong Settings chỉ cần thay `DEFAULT_KEYMAP`
bằng data đọc từ store.

---

## 2. Popup confirm khi quit (dialog native, luôn hỏi, cover ⌘Q)

### Mục tiêu

Mọi đường thoát app đều hiện dialog native "Bạn có chắc muốn thoát Stackgrid?" và chỉ
thoát khi user đồng ý. Luôn hỏi (không có tùy chọn tắt).

### Hai đường quit cần cover

- **Nút đóng cửa sổ (red X)** → phát `onCloseRequested` phía frontend.
- **⌘Q / menu Quit (macOS)** → đi qua `RunEvent::ExitRequested` phía Rust, _không_ chui
  qua `onCloseRequested`.

Trên một app **một cửa sổ**, để nút X đóng "tự nhiên" trên macOS chỉ đóng cửa sổ chứ
**không** thoát process. Vì vậy cả hai đường đều quy về **một hành động thật sự thoát**
qua Rust `app.exit(0)`.

### Luồng thống nhất (tránh hỏi 2 lần)

Dùng một cờ `confirmed: AtomicBool` phía Rust làm chốt:

- Frontend `onCloseRequested`: **luôn** `event.preventDefault()` → gọi `promptQuit()`.
- Rust `ExitRequested`: nếu `confirmed == false` → `api.prevent_exit()` + emit
  `"quit-requested"` xuống frontend → frontend `promptQuit()`. Nếu `confirmed == true`
  (do chính ta chủ động exit) → cho thoát, không hỏi lại.
- `promptQuit()` hiện đúng một dialog `ask`; nếu đồng ý → `invoke("confirm_quit")`.
- Command `confirm_quit` set `confirmed = true` rồi `app.exit(0)`.

Nhờ cờ này: nút X (confirm → exit → ExitRequested thấy `confirmed==true` → cho thoát) và
⌘Q (ExitRequested → prevent → hỏi → confirm → exit) đều chỉ hỏi **một lần**. Một guard
`prompting` phía frontend chặn dialog chồng nhau nếu spam ⌘Q.

### File mới `src/lib/quit-guard.ts`

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

let prompting = false;

async function promptQuit(): Promise<void> {
  if (prompting) return;
  prompting = true;
  try {
    const ok = await ask("Bạn có chắc muốn thoát Stackgrid?", {
      title: "Thoát Stackgrid",
      kind: "warning",
      okLabel: "Thoát",
      cancelLabel: "Huỷ",
    });
    if (ok) await invoke("confirm_quit");
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
  const unlistenQuit = await listen("quit-requested", () => void promptQuit());
  return () => {
    unlistenClose();
    unlistenQuit();
  };
}
```

### Wiring `src/ui/app.tsx`

Thêm một `useEffect` riêng (deps rỗng, chạy 1 lần) cài guard và cleanup:

```ts
useEffect(() => {
  let unlisten: UnlistenFn | undefined;
  installQuitGuard()
    .then((fn) => {
      unlisten = fn;
    })
    .catch((err: unknown) =>
      console.error("Failed to install quit guard:", err),
    );
  return () => unlisten?.();
}, []);
```

### Backend `src-tauri/src/lib.rs`

- Thêm state `QuitState { confirmed: AtomicBool }` + `.manage(...)`.
- Command `confirm_quit`:
  ```rust
  #[tauri::command]
  fn confirm_quit(app: tauri::AppHandle, state: tauri::State<QuitState>) {
      state.confirmed.store(true, std::sync::atomic::Ordering::SeqCst);
      app.exit(0);
  }
  ```
- Đăng ký `confirm_quit` vào `invoke_handler` (cạnh các lệnh pty).
- `.plugin(tauri_plugin_dialog::init())`.
- Đổi `.run(generate_context!())` → `.build(generate_context!()).expect(...).run(|app, event| {...})`
  để bắt `RunEvent::ExitRequested`:
  ```rust
  .run(|app_handle, event| {
      if let tauri::RunEvent::ExitRequested { api, .. } = event {
          let state = app_handle.state::<QuitState>();
          if !state.confirmed.load(std::sync::atomic::Ordering::SeqCst) {
              api.prevent_exit();
              let _ = app_handle.emit("quit-requested", ());
          }
      }
  });
  ```
  (cần `use tauri::{Emitter, Manager};`)

### Dependencies & capabilities

- `package.json`: thêm `@tauri-apps/plugin-dialog` (`^2`).
- `src-tauri/Cargo.toml`: thêm `tauri-plugin-dialog = "2"`.
- `src-tauri/capabilities/default.json`: thêm `"dialog:default"` (và xác nhận event
  listen được `core:default` cho phép — nếu không, thêm `"core:event:default"`).
- Command tự viết (`confirm_quit`) **không** cần khai báo capability.
- **Không** cần quyền `destroy` vì thoát bằng `app.exit(0)` phía Rust.

---

## 3. gitignore `docs/`

Thêm một dòng vào `.gitignore`:

```
docs/
```

Spec này vẫn ghi ra `docs/superpowers/specs/` để đọc nhưng **không** được commit — đúng
lựa chọn ignore toàn bộ `docs/`. (Vì vậy file spec này chủ ý **không** commit.)

---

## Files đụng tới

| File                                  | Loại                                      |
| ------------------------------------- | ----------------------------------------- |
| `src/terminal/keymap.ts`              | mới                                       |
| `src/lib/quit-guard.ts`               | mới                                       |
| `src/terminal/terminal-manager.ts`    | sửa (`handleShortcut`)                    |
| `src/ui/app.tsx`                      | sửa (thêm useEffect cài guard)            |
| `package.json`                        | sửa (thêm plugin-dialog)                  |
| `src-tauri/Cargo.toml`                | sửa (thêm tauri-plugin-dialog)            |
| `src-tauri/src/lib.rs`                | sửa (plugin + state + command + RunEvent) |
| `src-tauri/capabilities/default.json` | sửa (dialog:default)                      |
| `.gitignore`                          | sửa (thêm docs/)                          |

## Verification

Repo **chưa có test framework** → verify bằng:

- `npm run build` (tsc + vite) qua sạch.
- `cargo build` (trong `src-tauri`) qua sạch.
- Chạy `npm run tauri dev`, thử tay:
  - Từng shortcut: ⌘D, ⌘⇧D, ⌘⇧W, ⌘], ⌘[ hoạt động y như cũ.
  - Nút đóng cửa sổ → hiện dialog; **Huỷ** → app còn nguyên; **Thoát** → app thoát.
  - ⌘Q → hiện dialog; **Huỷ** → còn nguyên; **Thoát** → app thoát.
  - Không có trường hợp hiện dialog 2 lần.

## Ngoài phạm vi (YAGNI)

- Cho user cấu hình shortcut trong Settings (chỉ dọn đường, chưa làm).
- Tùy chọn "đừng hỏi lại" khi quit.
- Cảnh báo riêng khi còn tiến trình đang chạy (luôn hỏi bất kể trạng thái).
- Thêm test framework (cân nhắc riêng nếu muốn unit-test `matchBinding`).
