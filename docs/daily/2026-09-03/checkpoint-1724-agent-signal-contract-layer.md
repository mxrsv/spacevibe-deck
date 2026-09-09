---
tool:        claude
session:     a9eb96ce-19f6-484b-9e15-60b2f4dd0cae
status:      done
head_start:  57d3f3f54a7d0a79fd12b77e052c5196e93d7c9f
head_end:    57d3f3f54a7d0a79fd12b77e052c5196e93d7c9f
commits:     []
files:
  - electron/agent-hooks/claude-hooks-file.ts
  - electron/agent-hooks/claude-hooks-file.test.ts
  - electron/agent-hooks/hook-request.ts
  - electron/agent-hooks/hook-request.test.ts
  - electron/agent-hooks/hook-server.ts
  - electron/agent-hooks/opencode-client.ts
  - electron/agent-hooks/opencode-client.test.ts
  - electron/agent-hooks/opencode-events.ts
  - electron/agent-hooks/opencode-events.test.ts
  - electron/agent-registry/claude-registry.ts
  - electron/agent-registry/claude-registry.test.ts
  - electron/ipc/channels.ts
  - electron/ipc/register-agent-signals.ts
  - electron/ipc/register-services.ts
  - electron/main.ts
  - electron/platform/classify.ts
  - electron/platform/classify.test.ts
  - electron/pty/manager.ts
  - electron/pty/session-store.ts
  - electron/pty/spawn.ts
  - electron/pty/spawn.test.ts
  - electron/resume/resolve.ts
  - electron/resume/resolve.test.ts
  - electron/resume/session-tail.ts
  - electron/resume/session-tail.test.ts
  - electron/wire-contract.test.ts
  - src-tauri/src/info.rs
  - src/host/agent-registry-host.ts
  - src/host/agent-signals-host.ts
  - src/lib/agent-registry.ts
  - src/lib/agent-resume.ts
  - src/lib/agent-signal-map.ts
  - src/lib/agent-signal-map.test.ts
  - src/lib/launch-augment.ts
  - src/lib/launch-augment.test.ts
  - src/lib/session-schema.ts
  - src/lib/session-schema.test.ts
  - src/prompts/inject.test.ts
  - src/settings/settings-schema.ts
  - src/settings/settings-schema.test.ts
  - src/styles/04a-agent-rail.css
  - src/styles/04c-rail-worktree-card.css
  - src/terminal/agent-attention.ts
  - src/terminal/agent-attention.test.ts
  - src/terminal/agent-launch.ts
  - src/terminal/agent-launch.test.ts
  - src/terminal/agent-registry-sync.ts
  - src/terminal/agent-registry-sync.test.ts
  - src/terminal/pty-client.ts
  - src/terminal/pty-client.test.ts
  - src/terminal/session-restore.ts
  - src/terminal/session-restore.test.ts
  - src/terminal/session-tail-store.ts
  - src/terminal/tab-manager-types.ts
  - src/terminal/tab-manager.ts
  - src/terminal/tab-manager.agent-signals.test.ts
  - src/terminal/tab-manager.attention-tracker.test.ts
  - src/terminal/tab-manager.notifier.test.ts
  - src/terminal/tab-manager.tab-lifecycle.test.ts
  - src/terminal/tabs-store.ts
  - src/terminal/task-prompt-send.test.ts
  - src/ui/agent-rail-card-model.ts
  - src/ui/agent-rail-model.ts
  - src/ui/agent-rail-model.test.ts
  - src/ui/agent-rail.tsx
  - src/ui/agent-rail.test.tsx
  - src/ui/sessions/live-session-state.ts
  - src/ui/sessions/recent-session-activity.tsx
  - src/ui/settings/launch-profile-editor.tsx
  - src/ui/worktree-card-row.tsx
  - src/ui/worktree-card-strip.tsx
  - src/gallery/seed-data.ts
  - src/gallery/section-registry.ts
  - src/gallery/sections/signal-mark-variants.tsx
  - src/gallery/sections/signal-mark-variants.css
  - src/gallery/sections/strip-actions-model.ts
  - docs/DESIGN-LANGUAGE.md
  - docs/CONTEXT.md
  - docs/ARCHITECTURE.md
  - docs/specs/2026-09-03-agent-signal-contract-layer-design.md
  - AGENTS.md
  - CHANGELOG.md
uncommitted: true
---

1. **Việc** — Implement trọn spec `2026-09-03-agent-signal-contract-layer-design.md` (owner: "implement this spec, skip plan"): Deck hỏi thẳng CLI về trạng thái/session/câu cuối của agent, giữ `ps` + OSC làm fallback và VẼ rõ đâu là đoán. Cả 4 stage đã xong trong một phiên.

2. **Đã làm**
   - **Stage 0:** `cursor-agent` classify là agent trên cả hai host; tracker có `SignalConfidence`/`phaseConfidence`/`exitCode`, seed gate từ snapshot OSC (đóng blind window §4.5), launcher `onFire` poll ngay + 1 s; agent → shell là `ended` (từ thứ 6 của rail, ô vuông 7px; xoá `requested`/`completed`, giữ `error`/`warning`; xoá khi focus hoặc output lúc visible, kèm tên agent để shell chết sau không in lại); `paneSignal()` trả `{ state, confidence }`, inferred `asked`/`done` vẽ rỗng, accessible name `needs you (inferred)`; Recent activity dùng cùng `paneSignal`; gallery `signal mark direction` (3 candidate × 2, A ship); DL-27.3 amended.
   - **Stage 1:** main poll `claude agents --json` theo demand (5 s, dừng sau 15 s không ai hỏi), channel `agent_registry`; renderer join theo pid của `pty_info`, vắng 2 poll mới coi là mất, stale không tính; `noteRegistry` latch `requested` explicit + `detail` (`waitingFor`); `PaneView.sessionId` là fact → tail store gửi `preferredId` + `exact` (không rank); journal lưu `sessionId`, restore ưu tiên id trên đĩa.
   - **Stage 2:** env `DECK_PANE_ID`/`DECK_HOOK_TOKEN`/`DECK_HOOK_PORT` (cấp id trước spawn); loopback hook endpoint với validator thuần + test riêng (POST `/hook`, token so sánh constant-time, cap 64 KiB cả header lẫn stream, generation check theo `session_id`); `userData/agent-hooks/claude.json` + `deck-hook.sh` (POSIX, exit 0, fallback `terminalSequence` OSC 777); push `hook:event`; arm-time augmentation (`--settings '<file>'`, `--session-id` mint, `-c tui.notification_condition=always`, `--port` + SSE opencode), journal giữ nguyên lệnh của user, host không có `agent_signal_config` thì arm y như cũ; event map một module (`Stop` → completed + câu vào tail store, `StopFailure` → `failed`, `Notification` chỉ 2 matcher, `PermissionRequest` → requested + tool); settings `agentSignalAdapters` + switch "Signals" ở Settings → Agents.
   - **Stage 3:** `tracker.tick` hạ contract state quá 120 s xuống inferred; generation check ở cả main lẫn tracker; opencode được xoay session theo port.
   - Docs: CONTEXT.md entry mới, AGENTS.md (direction + fork queue + 2 drift row + Updated), ARCHITECTURE.md (3 dòng module + quyết định "inbound surface đầu tiên của main"), CHANGELOG 1.1.0, spec status → `decided` + link CONTEXT.
   - Sau advisor cuối: opencode client chỉ bỏ cuộc ở lần connect ĐẦU (90 s), stream rớt sau đó vẫn reconnect — có test với server giả (`opencode-client.test.ts`).
   - Tác dụng phụ của kiểm tra tay: probe `--settings` đã tốn một lượt API Claude thật và để lại session `11111111-2222-4333-8444-555555555555` trong `~/.claude/projects/-private-tmp-deck-hook-probe/` (sẽ hiện trong Recent activity) — KHÔNG tự xoá, chờ owner; `/tmp/deck-*` đã dọn; không còn `opencode serve` chạy sót.

3. **Bằng chứng** — `npx tsc --noEmit` + `tsc -p tsconfig.electron.json` sạch; `npm run electron:build` OK; `npm run build` OK (17 s); `generate:menu:check` OK; **`npm test` full: 331 file pass + 1 skipped, 4465 test pass + 5 skipped, 0 fail**; DL gate 18/18 + gallery-entry; `cargo test --lib info::tests` 9/9; prettier clean trên mọi file đã sửa (code + docs); `docs-anchors.sh`: 6 lỗi đều pre-existing (README/ARCHITECTURE/CONTEXT dòng cũ), không thuộc phần vừa viết. Kiểm tra tay ngoài host: pid registry = tpgid leader của tty (join chính xác); `claude --settings` CỘNG hook bên cạnh 13 hook user, `Stop` mang `last_assistant_message`, `--session-id` chạy; opencode 1.18.25 SSE frame + `/session/status` + `/doc` event shapes; latency registry 0.14–0.22 s. **Chưa có host pass `electron:dev`, chưa owner eye review, Windows chưa có script hook.**

4. **Quyết định / bỏ hướng**
   - Không commit: tree mang batch 09-02 rail-create-consolidation chưa commit của session khác, file chồng nhau → `git commit -- <paths>` sẽ quét hunk của họ; docs chờ owner đọc (D14). Owner commit chung hoặc tự tách hunk.
   - `ended` sinh từ agent → shell (`noteProcess`), không từ `noteExit` (pane PTY chết bị auto-close trong tab multi-pane); tên agent bị xoá khi end được "check" để shell chết sau không in lại.
   - Chỉ seed gate từ snapshot OSC (heuristic lúc mở gate = màn hình khởi động).
   - Registry poll theo demand; `status` ≠ `waiting` không hành động; `exact` chỉ kèm pin.
   - Endpoint: một câu trả lời 403 cho cả "pane lạ" lẫn "sai token"; drop generation cũ ở cả main lẫn tracker; server event của opencode được xoay session (một TUI nhiều session).
   - Augmentation chỉ khi host trả `agent_signal_config` (Electron); Tauri/test harness arm đồng bộ y như cũ.
   - Chọn ô vuông cho `ended` (ring xám rỗng trùng `done` inferred); B/C vẽ trong gallery.

5. **Còn treo → mai bắt đầu từ**
   - Owner đọc docs + quyết định commit (chung với batch 09-02 hay tách).
   - Live check §8 của audit trong `electron:dev` (dùng wrapper set `userData` tạm): #0, #1, #4, #5, #11 (ghi latency), #2, #6, #7, #8, #12, kill endpoint giữa chừng, freeze-and-degrade.
   - Owner chọn candidate mark trong gallery `signal mark direction` → park section (precedent `unread-mark-variants`).
   - Windows: script hook PowerShell (Gate C); Gemini/agy/cursor snippet opt-in (spec §10.5) là change sau.

Liên quan: [spec contract layer](../../specs/2026-09-03-agent-signal-contract-layer-design.md) · [trust audit](../../review/2026-09-03-agent-signal-trust-audit.md) · [CONTEXT entry](../../CONTEXT.md#the-rail-says-how-much-it-knows--2026-09-03) · [checkpoint audit sáng](checkpoint-1108-agent-signal-trust-audit.md)
