# Intent — Workspace sidebar

- **Status:** Confirmed (explicit yes from user)
- **Date:** 2026-07-14
- **Method:** `interview-me` (6 rounds)
- **Downstream:** plan → implementation

## Confirmed intent

|                |                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Outcome**    | Tab bar trở thành **workspace bar đổi hướng được** (`left` \| `top`, default `left`). Ở dạng dọc nó là sidebar: mỗi dòng = 1 workspace = 1 tab, hiện tên repo + path, kèm 1 chấm báo "có agent đang chạy trong này". |
| **User**       | Người chạy nhiều agent CLI song song ở nhiều repo cùng lúc trong một cửa sổ stackgrid.                                                                                                                               |
| **Why now**    | Tab hiện chỉ có `name + dotColor`; `session.json` cố ý không lưu CWD/workspace. Hai agent ở hai repo trông y hệt nhau — khi có agent đang chạy, không biết nó chạy ở đâu.                                            |
| **Success**    | Liếc một cái là biết agent đang chạy ở workspace nào, không cần mở pane gõ `git status` / `pwd`.                                                                                                                     |
| **Constraint** | **workspace ≡ tab (1:1)**. Một tab luôn gọn trong một repo. Kéo theo `session.json` phải lưu `workspacePath` per-tab.                                                                                                |

## Quyết định đã chốt

1. **Đơn vị gán workspace = tab**, không phải pane. Một tab không bao giờ trộn hai repo.
2. **Busy indicator ở tầng workspace**, một chấm duy nhất mỗi dòng. KHÔNG xổ ra từng pane.
3. **Sidebar và tab bar ngang là cùng một thứ**, đổi hướng qua settings — không hiện đồng thời. Default `left`.
4. **Mở lại workspace đã có tab → focus tab đang có**, không tạo tab thứ hai cho cùng repo.

## Out of scope

- Cây file / file explorer.
- File preview + git diff (ADR D5 giữ nguyên, chưa implement).
- Xổ tầng pane trong sidebar.
- Thay đổi Open board.
- Multi-window.

## Va chạm đã biết (giải quyết ở khâu plan)

1. **Domain model thay đổi.** `CONTEXT.md` định nghĩa Workspace là "a local folder... **not** `session.json`", và `docs/ARCHITECTURE.md` chốt "session.json = chrome only" (không CWD, không process). Gán `workspacePath` vào tab trong `session.json` phá đúng hai câu đó → cả hai doc phải cập nhật theo, nếu không doc sẽ nói dối.
2. **Layout preset cho phép CWD per-pane** (`Preset.cwds`, `src/lib/preset-schema.ts`) — schema hiện tại _cho phép_ một tab trộn hai repo, mâu thuẫn với ràng buộc 1:1. Cần quyết: siết preset lại, hay chấp nhận pane lệch workspace và sidebar chỉ phản ánh workspace gốc của tab.

## Hình dung (ASCII, đã được user chọn)

```
┌─ WORKSPACES ───────────┐
│ ● spacevibe-deck       │  ← có agent chạy
│   ~/spacevibe-workspace│
│                        │
│ ○ spacevibe-api        │  ← idle
│   ~/spacevibe-workspace│
│                        │
│ ○ landing              │
│   ~/marketing          │
└────────────────────────┘
```
