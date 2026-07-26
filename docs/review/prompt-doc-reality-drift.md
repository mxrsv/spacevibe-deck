# Prompt — Đối chiếu docs với code thật (doc-reality drift)

> Dùng prompt dưới đây (nguyên văn) cho một phiên riêng. Mục tiêu là tách bạch phần "docs do pipeline ADR-first sinh ra" khỏi phần "hành vi thật của code", vì hiện tại docs mô tả ở thì hiện tại nhiều thứ chưa build hoặc đã bị gỡ.

---

Bạn là auditor tài liệu kỹ thuật. Nhiệm vụ: đối chiếu **toàn bộ `docs/` của Stackgrid với code thật**, tìm mọi chỗ tài liệu mô tả hành vi mà code không có, rồi lập một sổ đối chiếu (ledger) trung thực. Đây là audit tài liệu — **không sửa code sản phẩm**.

## Vì sao cần làm

Stackgrid dùng pipeline ADR-first: `docs/decisions/*.md` (27 ADR, append-only bất biến) là nguồn sự thật, các doc phái sinh (`PRD.md`, `BUSINESS-FLOW.md`, `ARCHITECTURE.md`, `UX-DESIGN.md`, `REQUIREMENTS.md`, `PRINCIPLES.md`) được render ra từ tập ADR đang active, và `CONTEXT.md` giữ ngôn ngữ miền. ADR viết quyết định ở **thì hiện tại**, nên khi đọc lại rất dễ tưởng tính năng đã tồn tại.

Đã xác minh được hai lỗ hổng, dùng làm mẫu để tìm phần còn lại:

**1. Mô tả tính năng chưa từng được build.**
`docs/decisions/0017-file-sidebar-preview-diff-readonly.md` + `0022-sidebar-data-plane.md` mô tả: ⌘+click filepath mở một sidebar bên phải xem nội dung + git diff. `CONTEXT.md:95-97` render nó vào ngôn ngữ miền ở thì hiện tại ("Right-hand read-only viewer opened by Cmd+click…"). Thực tế:

```
git log --all -S'FileSidebar'   → rỗng
git log --all -S'file-sidebar'  → rỗng
grep -rl "FileSidebar" src/     → rỗng
```

Không tồn tại trong bất kỳ commit nào, trên bất kỳ branch nào. ⌘+click hiện tại đi thẳng ra `open_editor` (`src/terminal/link-provider.ts:36-51`).

**2. Mô tả tính năng đã bị gỡ nhưng ADR chưa bị supersede.**
`docs/decisions/0010-session-restore-layout-chrome-not-cwd.md` vẫn active. `CONTEXT.md` thì ghi rõ "Session restore (removed in 0.4.0)" và nói `session.json`, `session-schema`, `session-persistence` đã bị xoá. Nhưng `PRD.md` (dòng 51, 76, 90, 105) và `BUSINESS-FLOW.md` (dòng 19, 36, 104, 118, 164, 174) vẫn mô tả session restore và `session.json` như đang chạy — vì cả hai đều `derived_from` có 0010.

**3. Tín hiệu hệ thống.** Chạy:

```
grep -H "supersedes:" docs/decisions/*.md | grep -v "supersedes: \[\]"
```

→ **rỗng**. Toàn bộ 27 ADR đều `supersedes: []`. Một pipeline mà mô hình đúng đắn của nó dựa hoàn toàn vào "đổi ý = ADR mới supersede ADR cũ", nhưng chưa từng ghi nhận một lần supersede nào, trong khi codebase đã gỡ hẳn session restore. Nghĩa là cơ chế supersede chưa bao giờ được dùng, và độ trôi có thể lớn hơn hai ca trên nhiều.

## Đọc trước

- `CONTEXT.md` — ngôn ngữ miền, có ghi chú "removed in x.y.z" ở vài mục
- `docs/decisions/` — 27 ADR (10 product, 10 architecture, 7 principle), frontmatter `id / title / date / kind / affects / supersedes`
- `docs/PRD.md`, `BUSINESS-FLOW.md`, `ARCHITECTURE.md`, `UX-DESIGN.md`, `REQUIREMENTS.md`, `PRINCIPLES.md` — doc phái sinh, frontmatter `derived: true` + `derived_from: [ids]`
- `docs/DESIGN-LANGUAGE.md` §10 — **đây là hình mẫu đúng**: một bảng "Migration status (what does NOT comply yet)" liệt kê thẳng những chỗ chưa tuân thủ, kèm ghi chú "do not fix opportunistically". Cần tổng quát hoá đúng kiểu trung thực này cho các doc còn lại.
- `src/`, `src-tauri/src/` — code thật

## Phương pháp

Đi từng ADR một, không lấy mẫu. Với mỗi ADR:

1. Trích ra các **claim kiểm chứng được** — hành vi cụ thể mà code phải có (lệnh, file, component, IPC command, phím tắt, trạng thái UI).
2. Xác minh bằng code, không bằng doc khác. Ưu tiên theo thứ tự: `grep`/`glob` trong `src/` và `src-tauri/src/` → chạy test liên quan → `git log --all -S'<symbol>'` khi cần biết nó từng tồn tại chưa.
3. Phân loại: `shipped` / `partial` / `never-built` / `removed` / `contradicted` (code làm khác hẳn ADR).
4. Với `partial` phải nói rõ phần nào có phần nào không — đừng gộp thành "có".

Sau đó với từng doc phái sinh: đối chiếu `derived_from` với các ADR đã phân loại, và chỉ ra những đoạn văn cụ thể (kèm số dòng) đang mô tả trạng thái không đúng thực tế.

## Ràng buộc cứng

- **Không sửa nội dung ADR đang có.** ADR là append-only bất biến; đổi ý phải là ADR mới có `supersedes`. Nếu phát hiện ADR cần bị supersede thì **đề xuất** nội dung ADR mới, đừng tự ghi đè.
- Không sửa code sản phẩm trong phiên này.
- Không suy đoán từ doc sang doc. Mọi kết luận "có/không có" phải trỏ được về `file:line` trong code hoặc một lệnh git cụ thể có output.
- Nếu không xác minh được, ghi `unknown` kèm lý do — đừng đoán.

## Đầu ra

Ghi ra `docs/review/findings-doc-reality-drift-2026-07-26.md`:

1. **Bảng ledger** — mỗi dòng: ADR id, title, kind, trạng thái, bằng chứng (`file:line` hoặc lệnh git), doc phái sinh nào bị ảnh hưởng.
2. **Danh sách đoạn doc sai thực tế** — theo từng file, kèm số dòng và câu trích.
3. **Đề xuất ADR supersede** — với các ca `removed` / `contradicted`, phác nội dung ADR mới (title, kind, affects, supersedes, decision).
4. **Đề xuất cơ chế chống trôi** — tổng quát hoá kiểu bảng của `DESIGN-LANGUAGE.md` §10: ví dụ thêm trường `status` vào frontmatter ADR, hoặc một mục "chưa build" cố định ở mỗi doc phái sinh. Nêu đánh đổi, đừng chỉ chọn một phương án.

Kết bài bằng danh sách việc cần người quyết, xếp theo mức rủi ro nếu để nguyên.

## Ngoài phạm vi

- Các finding UI/UX và finding về ⌘+click → editor: đang xử lý ở luồng khác, đừng đụng.
- Không refactor `docs/`, không đổi cấu trúc thư mục.
