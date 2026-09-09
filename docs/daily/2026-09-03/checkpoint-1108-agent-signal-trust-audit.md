---
tool:        claude
session:     8c552f03-5ba6-47b7-b7b7-69c92bf0fffc
status:      paused
head_start:  57d3f3f54a7d0a79fd12b77e052c5196e93d7c9f
head_end:    57d3f3f54a7d0a79fd12b77e052c5196e93d7c9f
commits:     []
files:       [docs/review/2026-09-03-agent-signal-trust-audit.md, docs/specs/2026-09-03-agent-signal-contract-layer-design.md]
uncommitted: true
---

1. **Việc** — Audit độ tin cậy của mọi tín hiệu Deck đọc từ agent CLI, rồi — sau khi owner chốt hướng "staged A → B" — viết design spec cho lớp contract đọc tín hiệu agent (giữ TUI thật, hỏi thẳng CLI theo từng pane, `ps` + OSC làm fallback).

2. **Đã làm**
   - Đọc trọn pipeline: `agent-activity` → `agent-attention` → `agent-rail-model`, `pane-info-poller` + `classify`, `electron/resume/*`, `session-tail-store`, `recent-activity-sync`, `agents.ts`, gate readiness của `launchTask`, `commandProblem` trong `launch-profile.ts`.
   - Lập ma trận 13 tín hiệu × 7 agent, gắn tier C / R / H; xác nhận bằng `tsx` rằng `cursor-agent` classify ra `busy`.
   - Fetch docs chính thức 6 agent; phát hiện lớn nhất: `claude agents --json` là registry chính thức pid → sessionId → status/waitingFor, chạy thử trên máy này ra đúng các session đang sống.
   - Merge report của 2 research subagent (contracts + 13 peer app), tự re-fetch 7 claim trọng yếu, phần còn lại đánh dấu "reported".
   - Gọi `codex exec` (0.153.0, read-only) làm second opinion; memo nguyên văn ở §9 của report; hai phản biện (tier C chưa đủ điều kiện, exit code ≠ `failed`) đã sửa vào §0/§7.3.
   - Viết report `docs/review/2026-09-03-agent-signal-trust-audit.md` (9 finding, 12 đề xuất, 13 live-check, §9 Codex).
   - Viết spec `docs/specs/2026-09-03-agent-signal-contract-layer-design.md` (`proposed`): 4 stage (UI trung thực + fix → Claude registry → adapter theo pane: Claude `--settings`/`--session-id`, Codex `-c tui.notification_condition=always`, opencode `--port` + `/event` → freshness/generation), bảng fork §1, 7 câu hỏi veto §10 kèm default.
   - Xác minh cục bộ trước khi viết spec: `codex -c key=value` tồn tại; `opencode --port` default 0; `commandProblem` chỉ cho chữ số, khoảng trắng và `. , : @ + = _ - /` → path có khoảng trắng phải đi qua arm-time augmentation, không qua preset.

3. **Bằng chứng** — `npx prettier --check` trên report, spec và checkpoint → clean; `npx tsx` classify → chỉ `cursor-agent` ra `busy`; `claude agents --json` trả `pid`/`status`/`waitingFor`. Không sửa code, không chạy test/build. Chưa có host pass.

4. **Quyết định / bỏ hướng**
   - Owner chốt hướng staged A → B; bác C (inject config toàn cục), D (chỉ opt-in), E (headless).
   - Spec cấp chương trình để ở `docs/specs` (precedent inbox 2026-09-02); mỗi stage sẽ là một openspec change riêng khi bắt đầu.
   - Process chết là `ended` (từ thứ 6 của rail), không phải `failed`; `failed` chỉ từ event lỗi của CLI.
   - Codex v1 không cài hook (không có override theo launch), chỉ bật BEL `always`; Gemini/Antigravity/Cursor ở fallback v1.
   - Không sửa code, không đổi `AGENTS.md`/`CONTEXT.md`/DL cho tới khi §1 spec được duyệt (D10, D14).

5. **Còn treo → mai bắt đầu từ**
   - Owner duyệt bảng fork §1 và trả lời 7 câu §10 của spec (im lặng = giữ default); chưa commit cả report lẫn spec.
   - Sau duyệt: mở openspec change cho Stage 0 (classify `cursor-agent`, confidence mark + `ended` trong DL-27.3, blind window), rồi live-check #0/#1/#4/#5.
   - Stage 1 chỉ bắt đầu khi live-check #11 (pid của `claude agents --json` khớp `pty_info`, ổn định qua 10 lần poll) đạt.

Liên quan: [review](../../review/2026-09-03-agent-signal-trust-audit.md) · [spec contract layer](../../specs/2026-09-03-agent-signal-contract-layer-design.md) · [spec Agent Inbox](../../specs/2026-09-02-agent-inbox-redesign-design.md) · [spec rail 2026-08-16](../../specs/2026-08-16-agent-status-rail-design.md) · [plan pairing 2026-08-22](../../plans/2026-08-22-rail-tail-pane-pairing.md)
