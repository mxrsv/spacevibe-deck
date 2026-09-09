# Settings UI cho Stackgrid — Design

**Ngày:** 2026-07-02
**Trạng thái:** Đã duyệt

## Mục tiêu

Thêm giao diện settings cho Stackgrid (terminal app Tauri + xterm.js):

- Đổi font terminal (family + size)
- Đổi màu (theme preset + override các màu chính: background, foreground, cursor, selection)
- Sidebar chung của app, dock được ở `left` hoặc `top` (vị trí là một setting)

## Quyết định đã chốt

| Chủ đề          | Quyết định                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Vai trò sidebar | Sidebar riêng (thanh công cụ chung, sau này chứa tab/session), Settings là một mục trong đó                          |
| Lưu trữ         | File JSON qua `tauri-plugin-store` (`settings.json`)                                                                 |
| Màu sắc         | 4 màu chính + theme preset (Tokyo Night, Dracula, One Dark, Catppuccin Mocha); 16 màu ANSI đi theo preset            |
| Font            | Dropdown font monospace phổ biến (lọc bằng `document.fonts.check()`) + mục "Custom…" nhập tự do + chỉnh size (10–24) |
| UI lib          | Preact (+ `@preact/signals`, `@preact/preset-vite`)                                                                  |

## Layout

- App chia 2 vùng: **sidebar** (thanh icon ~44px) và **vùng terminal**.
- `sidebarPosition: "left"` → flex row, sidebar dọc bên trái; `"top"` → flex column, sidebar ngang trên cùng.
- Sidebar có nút ⚙️ mở **settings panel** trượt ra cạnh sidebar; terminal tự fit lại nhờ `ResizeObserver` sẵn có.

## Cấu trúc code

```
src/
├── main.ts                  # bootstrap: init settings → render Preact app → attach terminal
├── terminal/
│   └── terminal.ts          # tách xterm + PTY từ main.ts cũ, expose applySettings()
├── settings/
│   ├── settings-schema.ts   # type Settings + defaults + validate dữ liệu đọc từ store
│   ├── settings-store.ts    # signal state + load/save tauri-plugin-store
│   └── themes.ts            # theme presets + resolveTheme(themeId, overrides)
└── ui/
    ├── app.tsx              # layout: sidebar + terminal + panel
    ├── sidebar.tsx
    ├── settings-panel.tsx
    └── controls/            # font-select, color-field
```

## Schema settings

```ts
interface Settings {
  fontFamily: string; // default: "SF Mono"
  fontSize: number; // default: 13, clamp 10–24
  themeId: string; // default: "tokyo-night"
  colorOverrides: Partial<TerminalColors>; // background/foreground/cursor/selectionBackground
  sidebarPosition: "left" | "top"; // default: "left"
}
```

## Data flow

- Thay đổi áp dụng **ngay** (live preview): update signal → `applySettings()` set `term.options` (tạo object theme mới, không mutate) → `fit()` khi font đổi.
- Ghi `settings.json` qua plugin store với autoSave debounce.
- Khởi động: đọc store → validate/merge defaults → init terminal.
- Nút "Khôi phục mặc định".

## Rust side

- Thêm `tauri-plugin-store = "2"` vào `Cargo.toml`, đăng ký `tauri_plugin_store::Builder::default().build()`, thêm permission `store:default`. Không có command mới.

## Error handling

- Store đọc lỗi/file hỏng → dùng defaults, log warning, app vẫn chạy.
- Font custom không tồn tại → fallback theo chuỗi `Menlo, Monaco, monospace`.
- Giá trị màu không hợp lệ trong store → bỏ qua override đó, dùng màu preset.

## Testing

- `npm run build` (tsc strict + vite) và `cargo check` phải pass.
- Kiểm tra bằng mắt qua `tauri dev`: đổi font/size/theme/màu thấy hiệu lực ngay, đổi vị trí sidebar, restart app giữ nguyên settings.
