---
translated-from: d2278942
---

# Agent

Agent là một tool AI chạy trên dòng lệnh mà Deck mở trong một pane terminal. Deck không thay
cách làm việc riêng của tool đó: nó chạy lệnh trong một shell thật, theo dõi pane, và đọc log
phiên làm việc của chính tool đó nếu biết định dạng.

## Agent có sẵn

Deck nhận ra sẵn mười hai agent. Mỗi agent đi kèm một lệnh khởi chạy, và lệnh đó hiện rõ trên
màn hình trong Settings → Agents chứ không giấu sau một cái tên.

| Agent          | Lệnh khởi chạy                                                              |
| -------------- | --------------------------------------------------------------------------- |
| Claude Code    | `claude --dangerously-skip-permissions`                                     |
| Codex          | `codex --dangerously-bypass-approvals-and-sandbox -c tui.animations=false` |
| OpenCode       | `opencode`                                                                  |
| Antigravity    | `agy --dangerously-skip-permissions`                                        |
| Gemini CLI     | `gemini --yolo`                                                             |
| GitHub Copilot | `copilot`                                                                   |
| Amp            | `amp`                                                                       |
| Kimi Code      | `kimi`                                                                      |
| Kiro           | `kiro-cli`                                                                  |
| Grok Build     | `grok`                                                                      |
| Mistral Vibe   | `vibe`                                                                      |
| Droid          | `droid`                                                                     |

`-c tui.animations=false` của Codex tắt hiệu ứng động lúc rảnh. Khi chờ, Codex cứ vẽ lại ô nhập
prompt liên tục, Deck sẽ hiểu nhầm là agent vẫn đang làm, nên dòng của nó hiện vòng xoay "đang
làm" cả trước khi bạn gõ gì lẫn sau khi câu trả lời đã xong. Nếu bạn tự viết lệnh Codex, nhớ giữ
flag đó, hoặc đặt `animations = false` dưới `[tui]` trong `~/.codex/config.toml` để tắt hiệu ứng
ở mọi terminal.

Một số lệnh ở đây bỏ qua bước hỏi xác nhận của chính tool. Đó là chủ đích của Deck, vốn sinh ra
để chạy những agent làm việc liên tục, và cũng là lý do mọi lệnh đều được ghi rõ ra và agent nào
cũng tắt được. OpenCode để trần vì chế độ `--auto` của nó phải bật theo từng phiên. Bảy agent
được thêm sau Gemini CLI cũng để trần: Deck chưa đọc danh sách flag của chúng, nên không có nút
chỉnh flag, model hay effort cho chúng (trừ mức tự chủ và spec mode của Droid), và khi resume thì
chạy lại lệnh trần.

Cho tới khi bạn chọn [quick agent](#quick-agents), quick launch và menu của checkout sẽ đưa ra các
agent đã cài: các agent trên theo đúng thứ tự này, rồi tới agent bạn tự thêm.

## Settings → Agents

Danh sách được chia theo những gì Deck tìm thấy trong `PATH` của login shell:

- **Installed** — các agent đã tìm thấy file chạy. **Refresh** tìm lại ngay, kể cả agent bạn tự
  thêm.
- **Available to install** — phần còn lại.

Mỗi agent là một dòng, hiện tên và lệnh dùng để chạy nó:

- **on / off.** Tắt một agent là nó biến khỏi các lựa chọn khởi chạy; agent có sẵn thì không xoá
  được, vì lần dò tiếp theo Deck lại tìm thấy nó.
- **Configure** (mũi tên) mở phần cài đặt của agent ngay dưới dòng đó:
  - **Command** — lệnh khởi chạy đầy đủ hiện ở đầu tiên. Sửa thẳng vào đó hoặc chỉnh các nút
    trong **Launch**; cả hai cùng sửa một lệnh. Rời khỏi ô hoặc bấm Enter là lưu nếu lệnh hợp
    lệ; lệnh không hợp lệ vẫn nằm trong ô kèm thông báo lỗi. Mũi tên reset cạnh một lệnh tự
    viết sẽ xoá preset đó và quay về lệnh đã lưu tiếp theo, hoặc lệnh có sẵn của Deck.
  - **Launch** — các công tắc và lựa chọn mà từng CLI hỗ trợ. Có hai, ba lựa chọn thì chúng nằm
    cạnh nhau, kể cả **CLI default**; danh sách dài hơn thì dùng menu.
  - **Model** — **Default model**, **Default effort** và **Additional models** xuất hiện ở các
    agent đã cài mà CLI của chúng nhận các flag đó.
  - **Integrations → Signals** — với Claude Code, Codex và opencode: dùng trạng thái do chính
    agent báo thay cho ước đoán của Deck, áp dụng cho phiên mới. Mặc định bật cho cả ba. Với
    Claude Code và Codex, Signals cài hook của Deck vào settings của chúng; còn opencode thì nạp
    một plugin nhỏ của Deck và không ghi gì vào config của nó. Tính năng này cũng áp dụng cho
    lệnh bạn tự gõ trong Deck. Với Codex, Deck mở các phiên terminal mà không dùng background
    service dùng chung của Codex để trạng thái về đúng pane, nên các phiên đó không hiện trong
    `codex agents`. Với opencode, `OPENCODE_CONFIG_DIR` mà bạn tự đặt sẽ không được dùng bên
    trong terminal của Deck. Tắt tính năng này là gỡ hook của bản cài này. Terminal mở từ trước
    khi cài tích hợp thì cần mở lại.
- Với agent nằm trong **Available to install**, chọn **Configure launch** để chuẩn bị lệnh trước
  khi cài. Phần chỉnh model chỉ hiện sau khi Deck phát hiện ra CLI.
- **Add command.** Lưu thêm một dòng lệnh cho agent. Lệnh đầu tiên lưu cho một agent cũng thành
  lệnh chính của nó; các lệnh sau đứng sau làm phương án cho mũi tên reset ở trên. Deck nhận ra
  agent từ chữ đầu tiên của lệnh.

Lệnh bạn viết được gõ y nguyên vào một shell tương tác đang chạy, nên chỉ được dùng chữ cái, chữ
số, dấu cách và `. , : @ + = _ - /`. Pipe, `&&`, `;`, dấu nháy, redirect, biến và xuống dòng đều
bị từ chối, kèm lời giải thích. Muốn dùng pipeline thì đặt nó trong một wrapper script và khai
báo script đó như một agent tự thêm. Các lệnh cài đặt Deck đưa sẵn là lệnh chính chủ của nhà cung
cấp nên không bị giới hạn này.

### Cài agent còn thiếu

Agent có sẵn mà Deck không tìm thấy sẽ có nút **Install** trên dòng của nó trong
Settings → Quick agents, và hiện thành một ô mờ trong launcher, xếp sau các agent chạy được. Rê
chuột lên để xem chính xác lệnh sẽ chạy. Nút này mở một terminal tên `Install <Agent>` trong một
space mới (ở thư mục home nếu chưa mở thư mục nào), gõ lệnh cài của nhà cung cấp và chạy luôn ở
đó, nên bạn thấy mọi câu hỏi và trả lời ngay trong terminal đó. Bấm **Install** lần nữa khi
terminal đó còn mở sẽ đưa bạn quay lại nó.

Deck không ngồi chờ bộ cài chạy xong. Nó tìm lại khi bạn quay về cửa sổ Deck, mở một danh sách
agent, hoặc bấm **Refresh**, và lúc đó dòng của agent chuyển sang **Installed** mà không cần khởi
động lại. Agent cài theo cách này cũng được thêm vào quick agent của bạn. Terminal đã mở từ trước
vẫn giữ `PATH` lúc nó khởi động, nên hãy chạy agent vừa cài từ một terminal mới. Agent nào có lệnh
cài mà Deck chưa kiểm chứng thì hiện nút **Get**, bấm vào sẽ mở website của nó. Install và Get chỉ
xuất hiện với agent có sẵn đang bật, không bao giờ với agent tự thêm, và chỉ có trong app
Electron.

## Quick agent

Quick agent là các ô trong quick launcher và các dòng trong menu của checkout. Bạn chọn chúng ở
Settings → Agents → Quick agents; launcher không có danh sách riêng để sửa. Lựa chọn của bạn được
lưu lại; agent nào bạn tắt hoặc gỡ cài sẽ không hiện trong menu nữa và cũng không bị thay bằng
agent khác.

Rê chuột hoặc focus vào một ô để xem chính xác lệnh nó sẽ gõ, thư mục, và nó sẽ mở ở đâu. Chip
**Default profile** dưới các ô cho bạn chọn một lệnh khởi chạy khác của agent cho lần này; rời
launcher là lựa chọn đó bị bỏ, còn **Edit profiles in Settings…** mở chỗ viết các lệnh. Nếu một
agent không chạy được, launcher sẽ nói lý do và cho bạn **Retry**.

**Open shell** trong menu của checkout mở một tab terminal mới trong Deck ngay tại checkout đó.
Dùng **New split here** nếu muốn một pane nằm cạnh tab hiện có.

## Agent tự thêm

Trong **Agent identities**, bạn thêm được bất kỳ CLI nào bằng một cái tên và lệnh sẽ gõ vào mỗi pane. Bấm
vào tên hoặc lệnh để sửa; ✕ để xoá. Agent đã khai báo vẫn nằm trong danh sách khi file chạy của
nó không có trong `PATH`, để một tool chưa cài hiện là "thiếu" chứ không phải là mất dữ liệu.

Agent tự thêm hiện tên và trạng thái trên rail nhưng không có "câu gần nhất": Deck chỉ đọc log
phiên làm việc của những agent có sẵn mà nó biết.

## Deck biết gì về từng agent

| Agent               | Câu gần nhất trên rail | Resume khi mở lại                           |
| ------------------- | ---------------------- | ------------------------------------------- |
| Claude Code         | có                     | đúng session id                             |
| Codex               | có                     | đúng session id                             |
| OpenCode            | có                     | đúng session id                             |
| Gemini CLI          | không                  | `--resume latest`                           |
| Antigravity         | không                  | cố tìm session id, không được thì `--continue` |
| Droid               | không                  | `--resume --last` cho thư mục đó            |
| Các agent có sẵn khác | không                | chạy lại lệnh trần                          |
| Tự thêm             | không                  | chạy lại nguyên lệnh đã khai báo            |

Trạng thái đang làm, cần bạn và lỗi lấy từ chính terminal (tiếng bell, thông báo và tín hiệu tiến
độ mà tool phát ra, cộng với việc output chạy liên tục), nên dùng được với mọi agent. Khi Deck
đoán trạng thái cần bạn hoặc đã xong dựa vào nhịp output thay vì do agent báo, tooltip của dòng
đó ghi **(inferred)**. Khi bật **Signals** (mặc định là bật), trạng thái của phiên mới là do chính
agent báo, và trạng thái cần bạn còn nói được nó đang chờ gì, ví dụ một câu hỏi xin quyền. Agent
có tiến trình đã rời khỏi pane sẽ hiện là **ended**.

## Mức dùng token

Tab Token usage (**⌘⇧U**) đọc log phiên làm việc trên máy của Claude Code và Codex, kể cả log của
sub-agent trong Claude Code, rồi gom số token và chi phí ước tính theo agent và theo ngày. Các mốc
thời gian tính theo ngày lịch ở máy bạn: Today, 7 days, 30 days, All. Chi phí dùng bảng giá chụp
sẵn đi kèm Deck.

**Details** ở đầu tab mở một trang Usage lớn hơn phủ lên vùng chính, rail vẫn nhìn thấy được
(**⌘⇧R**, hoặc View → Usage Details). **Back** hoặc Escape đưa bạn về chỗ cũ; chọn một tab hay
một agent trên rail sẽ đóng trang này và chuyển tới đó.
