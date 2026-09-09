---
tool:        claude
session:     f3790cc3-59f1-4cd7-b126-194514dcf111
status:      done
head_start:  53e64126166f8202940acba1221688189c692cc2
head_end:    aec4b8a
commits:     []
files:       []
uncommitted: true
---

# MXR-7 — Open Board chạy agent khác với agent nó ghi

## 1. Việc

Người dùng nhờ check issue MXR-7, rồi nhờ check lại trong bối cảnh họ đang tạm dừng release cho
Open Board / Quick Launch — cần xác định việc dừng đó có làm issue mất hiệu lực hay không.

## 2. Đã làm

- Đọc MXR-7 qua Linear MCP (sau khi người dùng authorize): Urgent, `In Progress`, project
  `Deck · Quality`, có PR đính kèm là #25.
- Đọc 2 comment trên issue và 4 commit của PR #25 (`claude/linear-mxr-7-ky8ybt`): cách sửa là
  `resolveAgent` trả ba nhánh `chosen` / `substituted` / `shell-fallback`, kết quả không phải
  `chosen` bị giữ thành `PendingOpen` với `Open anyway` / `Manage agents…`.
- Kiểm CI: `windows-check` đỏ trên PR, **nhưng `origin/main` đỏ đúng job đó** (lỗi ở
  `electron/pty/info.test.ts` + `manager.test.ts`, không dính Open Board) → nợ có sẵn, không phải
  regression của branch.
- **Phát hiện chính:** có hai bản Open Board song song. `v1.0.0` và `origin/main` vẫn là board
  one-click `onOpen`; bản composer (`onStartTask` / `seedAgentFor`) nằm trong **59 commit local
  chưa push** (`e221b49`, `57d3f3f`). Đó đúng là phần người dùng đang dừng.
- Xác minh composer **không** sửa MXR-7: `seedAgentFor` truyền `runnable` vào `agentForWorkspace`,
  nên `resolveAgentChoice` vẫn rơi về `runnable[0]` và `runs(remembered)` luôn true khi máy có
  agent — agent thay thế được điền sẵn vào field, vẫn không nêu lý do.
- Đối chiếu `mxrsv/add-board-agent`: **không** đụng `src/open-board` hay `src/launcher` → không
  xung đột với PR #25. Xung đột thật là giữa PR #25 và `e221b49` (hai lần viết lại cùng file).
- Sửa lại lời khuyên sai ở lượt trước: chạy `electron:dev` từ checkout này sẽ build local main +
  dirty tree = board composer, không phải board của PR #25.

## 3. Bằng chứng

Chỉ đọc, **không sửa file nào của repo** trong phiên này. Các file `M` trong `git status` là
checkpoint uncommitted của phiên khác, không phải của phiên này; `aec4b8a` là merge do phiên khác
tạo. Không chạy test/build vì không có thay đổi code nào để verify.

Dữ liệu đã đối chiếu: `gh pr view 25`, `gh run view --job 101413476948 --log-failed`,
`gh run list --workflow=CI --branch=main`, `git log origin/main..main` (59 commit),
`git show v1.0.0:src/open-board/open-board.tsx | grep -c "onOpen("` → 2.

## 4. Quyết định / bỏ hướng

- **Kết luận: việc dừng release KHÔNG làm MXR-7 mất hiệu lực.** Ngược lại, nó khiến PR #25 thành
  bản vá duy nhất mà board đang ship nhận được. Bỏ hướng "chờ composer land rồi tính", vì composer
  không sửa lỗi này.
- Đề xuất merge PR #25 vào `origin/main` ngay; khi composer quay lại thì port ba nhánh của
  `resolveAgent` vào `seedAgentFor` và cho substitution hiện trên notice line của composer.
- **Không** ghi gì vào Linear — người dùng chỉ nhờ check, không nhờ cập nhật.

## 5. Còn treo → mai bắt đầu từ

- Dựng worktree cho `origin/claude/linear-mxr-7-ky8ybt` rồi chạy `electron:dev` trong đó để eye-test
  khối decision — **không** `git stash` để đổi branch tại chỗ, cây này mang checkpoint uncommitted lớn.
- Sau eye-test: quyết merge PR #25 hay chờ, và trả lời câu hỏi port sang composer.
- 59 commit local chưa push (composer + task launcher + explorer + rail) vẫn treo, chưa có quyết
  định đẩy hay giữ.

---

PR: `mxrsv/spacevibe-deck#25` · commit trên branch: `1c528c6`, `e821d0b`, `bb90b39`, `eb5b3e7`
Issue liên quan: MXR-5 (nguồn finding), MXR-6 (wire task launcher, Backlog), MXR-34 (CI đỏ, Done)
