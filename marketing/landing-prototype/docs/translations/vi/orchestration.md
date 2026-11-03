---
translated-from: a467e4d3
---

# Điều phối agent

Điều phối cho phép một agent trong pane của Deck chạy nhiều agent khác. Agent đó, tức coordinator,
chia việc thành các task, mở một worker cho mỗi task trong worktree riêng, chờ các worker làm xong
rồi kiểm tra những gì chúng báo lại. Bạn duyệt kế hoạch trước khi có gì bắt đầu, và bạn là người
merge.

Lệnh `deck` chạy phần này chưa có trong bản release.

## Lệnh deck

`deck` là một lệnh chỉ tồn tại bên trong các pane terminal do Deck mở. Agent dùng nó để mở và điều
khiển các pane khác, bạn cũng tự gõ được. Nó chạy trong zsh, bash và fish trên macOS. Terminal
thường và Windows không có lệnh `deck`. Ngay trong một pane, lệnh vẫn có thể mất dấu pane: một
subcommand của background service của Codex và opencode khi tắt Signals đều khởi động mà không có
danh tính của pane. Khi đó `deck` in ra một dòng báo vậy rồi thoát với mã 3.

Deck đặt thư mục của nó lên đầu `PATH` trong các pane, nên chương trình tên `deck` của bạn bị che
ở đó.

`deck --help` liệt kê mọi lệnh, `deck <command> --help` mô tả từng lệnh. Output là vài dòng chữ.
Thêm `--json` vào bất kỳ lệnh nào để nhận một JSON object.

## Chạy nhiều agent cùng lúc

Trong một pane đang chạy agent, nhờ nó chạy `deck skill orchestrate`, làm theo guide nó in ra, rồi
mô tả công việc. Guide được tích hợp sẵn trong Deck nên luôn khớp với phiên bản bạn đang dùng.
Agent chia việc thành các task, in ra một bảng gồm task và các phụ thuộc của nó, rồi dừng lại. Chưa
có gì được mở cho tới khi bạn nói go, và bạn có thể sửa kế hoạch trước. Sau khi bạn go, nó tạo một
worktree và một branch cho mỗi task, rồi mở một worker ở đó, dưới dạng tab mới chạy agent bạn đã chỉ
định. Mỗi worker hiện trên rail như mọi agent khác, và Deck chuyển focus sang từng tab mới ngay khi
nó mở. Coordinator chờ lượt làm của worker kết thúc, đọc kết quả, tự chạy lại các check, rồi cho
chạy những task đang chờ worker đó. Worker bị kẹt hoặc đặt câu hỏi thì chuyển sang bạn: guide bảo
coordinator chuyển tiếp chứ không tự trả lời. Cuối cùng nó liệt kê các branch và worktree, và bạn
tự merge.

Guide giữ việc điều phối chỉ sâu một tầng: nó bảo worker đừng mở worker của riêng mình.

## Các lệnh

| Lệnh | Tác dụng | Ghi chú |
| --- | --- | --- |
| `deck status` | Cho xem phiên bản Deck, pane này, cửa sổ của nó, và pane này có mở được pane khác không. | |
| `deck worktree create --repo <path> --branch <name>` | Tạo một git worktree trên branch mới và in đường dẫn của nó. | `--dest <path>` chọn thư mục. Không có thì thư mục đặt tên theo branch, `/` đổi thành `-`, nằm cạnh repository. Lệnh không bao giờ ghi đè branch hay thư mục có sẵn. |
| `deck pane list` | Liệt kê các pane trong cửa sổ này kèm agent, phase, attention và confidence. | Pane do pane này mở được đánh dấu. Pane `working` có confidence `inferred` nghĩa là hai phút rồi nó chưa báo gì: đọc nó trước khi chờ thêm. |
| `deck pane open --cwd <path> --agent <id>` | Mở tab mới với một agent trong thư mục đó và in id của pane mới. | `--agent` là chữ đầu tiên trong lệnh khởi chạy của agent ở [Agent có sẵn](agents.md#built-in-agents), ví dụ `claude`, `codex` hoặc `opencode`; agent phải được cài và đang bật. `--name <label>` đặt tên cho tab. Focus chuyển sang tab mới. `--prompt <text>` gửi thêm tin nhắn đầu tiên: xem [Câu hỏi lần chạy đầu](#first-run-questions). |
| `deck pane send <id> <text>` | Gõ text vào một pane và nhấn Enter khi agent của nó ở trạng thái `idle`. | `--stdin` đọc text từ standard input. `--no-submit` chỉ gõ, không nhấn Enter. Đặt `--` trước text bắt đầu bằng dấu gạch. |
| `deck pane read <id>` | In phần cuối scrollback của pane dưới dạng text thuần. | `--lines <n>` chọn số dòng: mặc định 200, tối đa 2000. `--envelope` in [envelope](#envelopes) hoàn chỉnh cuối cùng dưới dạng JSON, hoặc `none`. |
| `deck pane wait <id> --for <state>` | Chờ tới khi pane đạt một trạng thái, rồi in trạng thái đó. | `idle`, `needs-you`, `exited` hoặc `turn`: xem [Chờ](#waiting). `--timeout <s>` mặc định 600, tối đa 3600. |
| `deck pane close <id>` | Đóng một pane do pane này mở. | `--force` đóng luôn không hỏi: xem [Đóng](#closing). |
| `deck skill orchestrate` | In guide điều phối cho coordinator. | |

Một pane chỉ `send` và `close` được các pane nó đã mở. Nó cũng `read` và `wait` được chính mình, còn
`pane list` cho thấy mọi pane trong cửa sổ. Pane nào khác thì được trả lời như thể nó không tồn
tại. Mã thoát: 0 xong, 1 bị từ chối hoặc lỗi, 2 sai cú pháp, 3 ngoài pane của Deck, 124 hết thời
gian.

### Chờ

- **`idle`** — agent làm xong lượt và không có gì cần bạn, hoặc nó đã rời pane.
- **`needs-you`** — agent hỏi một câu hoặc báo warning hay lỗi, hoặc nó đã rời pane.
- **`exited`** — agent đã rời pane.
- **`turn`** — một trong ba trường hợp trên: lượt làm đã kết thúc, bằng cách này hay cách khác.

Sau một lệnh `send`, lệnh `wait` với `idle` hoặc `turn` bỏ qua trạng thái `idle` có từ trước và chỉ
xong khi agent đã bắt đầu một lượt làm. Nếu không có lượt nào bắt đầu trong năm giây kể từ lúc
`send`, `wait` báo `no turn started after the send` và thoát với mã 0. Năm giây này tính từ lúc
`send`, kể cả khi `wait` được gọi muộn hơn, và chỉ việc agent đang làm mới tính là một lượt: focus
vào pane hay xoá attention thì không. `send` không ảnh hưởng tới `needs-you` và `exited`. Hết thời
gian thì thoát với mã 124.

### Gửi

`send` kết thúc theo một trong bốn cách:

- **`sent`** — text đã được gõ và Enter đã được nhấn.
- **`pasted`** — text nằm trong pane nhưng Enter bị giữ lại, vì agent đang bận hoặc đang hỏi gì đó.
- **`stale`** — tiến trình agent đã đổi trước khi text kịp được gõ hoặc gửi đi, nên chưa có gì được
  gửi và có thể chưa có gì được gõ. Trường hợp này thoát với mã 1.
- **`expired`** — lệnh gửi phải chờ sau một lệnh gửi khác cho tới khi quá hạn, nên bị bỏ. Chưa có gì
  được gõ. Trường hợp này thoát với mã 1.

Sau `pasted` hoặc `stale`, hãy đọc pane trước khi làm bất cứ việc gì khác. Nếu text đang nằm trong
ô nhập, đừng gửi lại: bản đầu vẫn còn ở đó. Ký tự điều khiển và escape sequence trong text bị loại
bỏ. Các lệnh gửi vào cùng một pane chạy lần lượt từng cái.

### Đóng

Pane đang làm việc, hoặc đang chờ bạn, bị từ chối nếu không có `--force`. Pane nào khác, kể cả
agent đang `idle`, sẽ hiện cho bạn hộp thoại đóng thông thường và lệnh chờ câu trả lời của bạn.
Nếu bạn huỷ, lệnh báo lỗi và pane vẫn còn. `--force` đóng mà không hỏi. Pane không tự đóng chính
nó được.

## Envelope

Worker kết thúc output cuối của nó bằng đúng một trong các block sau. Coordinator đọc block hoàn
chỉnh cuối cùng bằng `deck pane read <id> --envelope`.

```text
DECK_WORKER_DONE
task: <task id>
summary: <one line>
files: <comma-separated paths or none>
checks: <commands and outcomes>
handoff: <next-step context or none>
```

```text
DECK_WORKER_BLOCKED
task: <task id>
reason: <one line>
needs: <decision, access or dependency>
```

Block thiếu một field được đọc là `none`, còn template của brief mà bị in lại trên màn hình thì bị
bỏ qua. Block `DONE` là lời khẳng định của worker, không phải bằng chứng: guide yêu cầu coordinator chạy lại các check và
báo riêng những gì worker khẳng định với kết quả tự chạy của mình.

## Câu hỏi lần chạy đầu

Lần đầu một agent mở trong một thư mục mới, nó có thể hỏi một câu trước khi nhận bất kỳ input nào.
Claude Code hỏi có tin thư mục này không. Khi câu hỏi đó còn trên màn hình, agent vẫn đọc ra là
`idle`. `deck pane open --prompt` gửi tin nhắn ngay khi agent lần đầu đọc ra `idle`, nên trong một
worktree mới, tin nhắn có thể trả lời câu hỏi đó thay vì chuyển brief đi. Lệnh in ra hai dòng, id
của pane và `prompt:` kèm kết quả (`sent`, `pasted`, `not-idle` hoặc một lời từ chối), và thoát với
mã 0 dù kết quả thế nào.

Thứ tự an toàn, cũng là thứ tự guide làm theo:

1. `deck pane open` không có `--prompt`.
2. `deck pane wait <id> --for idle`.
3. `deck pane read <id>`. Nếu thấy một câu hỏi, coordinator nhờ bạn tự trả lời ngay trong pane của
   worker đó, rồi chờ và đọc lại.
4. `deck pane send <id> --stdin` kèm brief.

Chỉ dùng `--prompt` cho agent mà bạn biết là không hỏi gì ở lần chạy đầu.

## Deck không làm gì

- **Merge.** Deck không có lệnh nào để merge, push hay mở pull request, và guide bảo coordinator
  đừng merge, rebase, push, mở pull request hay xoá worktree. Lệnh git duy nhất Deck chạy cho việc
  điều phối là `git worktree add`.
- **Tự điều phối.** Coordinator là một agent bình thường làm theo guide. Deck không có scheduler
  riêng.
- **Ép guide.** Việc chờ bạn go, chỉ sâu một tầng và chuyển câu hỏi của worker cho bạn đều nằm trong
  guide mà coordinator làm theo. Deck không kiểm tra những điều đó, và coordinator gõ được vào bất
  kỳ worker nào nó đã mở.
- **Nhận pane của bạn.** Coordinator chỉ điều khiển các pane do chính nó mở, không bao giờ pane bạn
  tự mở.
- **Chạy ngoài pane của Deck**, hoặc trên Windows.
