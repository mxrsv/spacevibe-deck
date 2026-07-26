# Spec — Open board: 3 cột, agent launch, recent combo

- **Date:** 2026-07-15
- **Status:** Approved (design duyệt từng phần trong `/superpowers:brainstorming`)
- **Intent:** [`docs/intent/open-board-agent-launch.md`](../../intent/open-board-agent-launch.md)
- **Downstream:** writing-plans → implementation

## 1. Mục tiêu

Open board trở thành **cửa vào duy nhất** của app: chọn workspace + layout preset + agent CLI trong một màn hình, bấm Open là tab mở đúng layout và **mọi pane** tự chạy agent đã chọn. Overlay "Run an agent" per-pane bị xoá, session restore bị xoá — mở lại app là board, user tự click recent để mở lại.

## 2. Layout

Ba cột (sidebar là app chrome, không thuộc board):

| Cột | Nội dung |
| --- | --- |
| Trái | `WorkspaceSidebar` hiện tại — **không đụng tới** |
| Giữa | **Logo panel**: chỉ một logo canh giữa, nền trơn, không chữ. Cả panel là drop zone; khi kéo ảnh vào thì hiện viền đứt + "Thả ảnh để đổi logo" |
| Phải | Recent workspace (trên) → Layout preset → Agent (dưới), rộng ~520px |

Mật độ cột phải (ép gọn so với board hiện tại):

```
│ WORKSPACE                              recent │
│ ▸ spacevibe-workspace  …/spacevibe-workspace  │
│   layout-test · Claude Code              6m   │   ← 2 dòng, ~44px/row
│   stackgrid            …/spacevibe/stackgrid  │
│   Single pane · Shell                    1h   │
│   + Open Folder…                              │
│ ───────────────────────────────────────────── │
│ LAYOUT                            split + CWD │
│ [▤ Single] [▥ test-1] [▦ test] [＋]           │   ← chip ngang, thumb 44×28
│ ───────────────────────────────────────────── │
│ AGENT                            on all panes │
│ [1 Claude Code] [2 Codex] [3 Gemini] [0 Shell]│   ← segmented chip, 1 hàng
```

- **Workspace row**: tên + path đã `tildify` cắt giữa trên một dòng; dòng phụ hiện combo đã nhớ (`layout · agent`) + thời gian. Path không wrap nữa.
- **Layout preset**: card lớn → chip ngang cuộn được (mini-thumb 44×28 + tên); số pane chuyển thành tooltip. `＋ New preset` là chip cuối.
- **Agent**: một hàng chip, phím tắt `1/2/3/0` giữ nguyên convention của overlay cũ (giờ thuộc về board).
- Footer (summary + Cancel/Open) giữ nguyên, summary thêm agent: `Open spacevibe-workspace as layout-test with Claude Code`.

## 3. Quyết định kỹ thuật

| # | Quyết định | Lý do |
| --- | --- | --- |
| A1 | Chạy agent bằng **`write_pty(id, "claude\r")`**, không spawn agent từ Rust | `$SHELL -lc` là non-interactive → zsh không đọc `.zshrc` → agent thường mất khỏi `$PATH`. Gõ vào shell tương tác thừa hưởng đúng env, và là đúng thứ overlay cũ đang làm |
| B1 | **Xoá hẳn** session restore | Không để code chết; toggle `restoreTabs` cũng biến mất |
| C2 | Logo **nuốt vào app** thành data URL, lưu store riêng `logo.json` | Không cần mở `assetProtocol` scope; file gốc bị xoá/di chuyển vẫn sống; `settings.json` không phình mỗi lần ghi |

## 4. Schema

**`src/lib/workspace-recents.ts` → version 2**

```ts
export type AgentChoice = string | null; // null = Shell only

export interface RecentWorkspace {
  readonly path: string;
  readonly lastOpenedAt: number;
  readonly lastPresetId?: string;
  readonly lastAgent?: AgentChoice;
}
```

- File v1 cũ đọc được: entry thiếu field mới → `undefined`, **không drop entry**.
- `pushRecent(recents, path, now, presetId, agent)` ghi kèm combo; entry cũ cùng path bị thay, vẫn `MAX_RECENTS = 8`.

**`src/settings/settings-schema.ts`**

- Bỏ field `restoreTabs` (và mục tương ứng trong Settings panel).
- Không thêm logo vào đây — logo sống ở store riêng.

**Logo store (mới) — `src/settings/logo-store.ts` + `logo.json`**

- Key `dataUrl: string` (rỗng = chưa set → fallback logo Stackgrid mặc định).
- Rust command mới `read_image_as_data_url(path: String) -> Result<String, String>`: chỉ nhận `.png .jpg .jpeg .svg .webp`, size ≤ **1 MB**, trả `data:image/<mime>;base64,…`. Lỗi → message người-đọc-được.

## 5. Luồng

**Mở tab**

1. Board mount → `detectAgents()` → render chip agent (allowlist order) + chip `Shell only`.
2. Chọn workspace ở recent → preset + agent **tự điền** từ `lastPresetId` / `lastAgent` (vẫn đổi tay được). Workspace mới (chưa có recent) → preset = `lastUsedId` như hiện tại, agent = `Shell only`.
3. Open → `onOpen(workspace, preset, agent)`.
4. `tab-manager` spawn panes như cũ → mỗi pane **chờ byte output đầu tiên** từ `listenOutput` (prompt đã in) → `write_pty(id, "<agent>\r")`. Agent `null` → không gõ gì.
5. `recordWorkspaceOpen(path, presetId, agent)` ghi combo vào recents.

**Boot**

- `tab-manager.init()` không đọc session nữa → luôn `{ hasTabs: false }` → `App` set `boardOpen = true`.

**Đổi logo**

- Kéo-thả ảnh vào logo panel (dùng `installFileDrop` sẵn có, hit-test vào vùng panel) **hoặc** Settings → Appearance → "App logo" (nút chọn ảnh + Remove).
- Không click panel để mở file picker (quyết định của user).

## 6. Xoá

- `src/agent-picker/agent-picker.ts`, `picker-store.ts`, `skip-all-bar.tsx` + test → **xoá**. Giữ lại `detectAgents` trong `pty-client.ts` và `detect_agents` bên Rust (board dùng).
- `src/lib/session-schema.ts` + test, `src/terminal/session-persistence.ts` → **xoá**. `flushPendingSaves` chỉ còn `flushSettingsSave`.
- `tab-manager.ts`: bỏ `beginAgentPick` (≈ dòng 298, 615) và nhánh restore trong `init()`; `tab-materialize.ts` bỏ cờ `agentPick` / `pollAndAgentPick`.
- `settings.restoreTabs` + UI toggle.
- **Giữ nguyên**: `closed-tabs.ts` (⌘⇧T chỉ sống trong RAM), `workspace-sidebar.tsx`, preset editor.

## 7. Xử lý lỗi

| Tình huống | Hành vi |
| --- | --- |
| `detect_agents` fail | Chỉ còn chip `Shell only` (đúng như FR-025 cũ), log warn |
| Recent nhớ agent không còn trên `$PATH` | Chip không render; selection fallback về `Shell only`; badge ở dòng recent hiện xám + gạch |
| Pane không phát output (shell im) | Timeout **3s** → gõ lệnh luôn, không treo vô hạn |
| `write_pty` fail | `console.error`, pane vẫn là shell trống — không kéo sập tab |
| Logo: file > 1MB / sai định dạng | Không đổi logo; hiện lỗi inline ngay trên panel (và trong Settings) |
| Drop nhiều file cùng lúc | Lấy file **hợp lệ đầu tiên**, bỏ qua phần còn lại |
| Drop ảnh khi board đóng | Rơi về `file-drop` của terminal như hiện tại (không đổi) |

## 8. Test

- `workspace-recents.test.ts`: migrate v1 → v2 (entry thiếu field vẫn sống), `pushRecent` ghi/ghi đè combo, cắt `MAX_RECENTS`.
- `agent-launch.test.ts` (mới): gate first-output → gõ đúng 1 lần/pane; timeout 3s fallback; agent `null` → không `write_pty`; agent không có trên `$PATH` → không `write_pty`.
- `logo-store.test.ts` (mới): validate mime/size, data URL rỗng → fallback.
- Rust: unit test `read_image_as_data_url` (quá size, sai đuôi, file không tồn tại).
- Xoá: `session-schema.test.ts`, `picker-store.test.ts`, phần `agentPick` trong `tab-materialize.test.ts`.

## 9. Out of scope

- Gán agent riêng cho từng pane.
- Logo theo từng workspace.
- Click panel để mở file picker.
- Nhớ nhiều combo cho cùng một workspace.
- Đụng vào `WorkspaceSidebar` hay preset editor.
