---
translated-from: b353ffb2
---

# Bắt đầu

SpaceVibe Deck là một terminal trên desktop để chạy nhiều agent CLI cạnh nhau. Mỗi agent chạy
trong một pane terminal riêng; Deck cho bạn biết agent nào đang làm, agent nào đang chờ bạn trả
lời, mỗi agent vừa nói gì, rồi đưa bạn tới đúng pane đang cần bạn.

## Cài Deck

Tải bản mới nhất tại
[github.com/mxrsv/spacevibe-deck/releases/latest](https://github.com/mxrsv/spacevibe-deck/releases/latest).

- **macOS, Apple Silicon (arm64).** File `.dmg` đã được ký và notarize. Deck không có bản cho
  Mac chip Intel.
- **Windows, x64.** Bộ cài `-setup.exe` chưa được ký nên SmartScreen sẽ cảnh báo ở lần cài đầu.
  Deck cài riêng cho từng user, không cần quyền admin. Chưa có bản cho Windows ARM, và bản
  Windows chưa được thử trên máy thật.

Deck tự kiểm tra bản cập nhật, báo khi có bản mới và để bạn chọn lúc nào tải, cài rồi mở lại.
Xem [Settings → About](settings.md#about).

Nếu bạn từng dùng bản Deck cũ chạy trên Tauri: bản đó không kiểm tra cập nhật được nữa, và bản
Tauri cuối cùng cũng không có thông báo chuyển đổi. Bạn tự tải và cài bản Electron hiện tại qua
link ở trên nhé. Settings và workspace không được chuyển sang, đây là một bản cài mới hoàn toàn.
Dữ liệu Tauri cũ vẫn nằm ở `~/Library/Application Support/dev.spacevibe.deck` trên macOS hoặc
`%APPDATA%\dev.spacevibe.deck` trên Windows. Bản Electron dùng một thư mục dữ liệu
`SpaceVibe Deck` riêng; xem [Deck lưu dữ liệu ở đâu](settings.md#where-deck-keeps-its-data).

## Lần mở đầu tiên

Deck mở ra ở **Open board**, màn hình khởi đầu. Ở đây có:

- **Open workspace…** — chọn một thư mục. Workspace là một thư mục trên máy, làm thư mục gốc
  cho một tab.
- **Recent workspaces** — chọn một thư mục là Deck điền sẵn workspace và agent. Xem lại agent
  đã chọn rồi bấm **Open agent** để chạy. Thư mục nào đã bị xoá khỏi ổ đĩa thì không mở được.
- **Create worktree…** — với một git repo, tạo git worktree mới trên một branch mới rồi mở luôn.
  Worktree và branch đi liền với nhau: Deck không bao giờ tạo branch mà thiếu worktree của nó.
- **Resume a previous session…** — lịch sử phiên làm việc, gồm các cuộc trò chuyện Claude Code
  và Codex mà Deck tìm thấy trong log trên máy của chính các tool đó. Bấm một dòng là Deck mở
  tab ở đúng thư mục của phiên đó và gõ sẵn lệnh resume của CLI.

Nếu lần trước bạn thoát Deck khi vẫn còn tab, board sẽ hiện **Last session** ở trên cùng.
**Reopen** mở lại các tab đó và nối tiếp từng cuộc trò chuyện với agent mà Deck tìm lại được;
bỏ qua nó, hoặc mở thứ khác, là Deck bắt đầu lại từ đầu. Scrollback, chỉnh sửa file chưa lưu và
vị trí cửa sổ thì không được khôi phục.

## Chạy một agent

Bấm **⌘T** (Windows: **Ctrl+Shift+T**) để chạy agent cho checkout đang mở, hoặc bấm **Agent**
phía trên Agent Rail (muốn chạy trong một checkout chưa mở gì thì bấm vào tên của nó). Nếu bạn
đang làm việc trong checkout đó, agent mới mở ngay cạnh pane hiện tại; nếu không, nó mở trong
một space mới ở đó, và launcher sẽ báo cho bạn biết trước khi bấm Run. Click chuột phải vào một
checkout để mở menu, trong đó có các [quick agent](agents.md#quick-agents) của bạn; chọn một cái
là Deck chạy nó trong checkout đó bằng lệnh hiện ở
[Settings → Agents](agents.md#settings--agents). **Open shell** mở một shell trống trong tab
mới, còn **New split here** mở shell ngay cạnh tab hiện tại. Menu ⌘T còn có
**Open another project…** để chọn workspace khác.

## Cửa sổ Deck

- **Agent Rail** (cột bên trái). Mỗi project là một cụm, mỗi pane agent là một dòng. Dòng đó hiện
  câu gần nhất agent vừa nói, hoặc tên agent nếu nó chưa nói gì. Chấm nhỏ trên logo agent cho
  biết trạng thái: đỏ là lỗi, vàng là đang hỏi bạn, xám là đã chạy xong; agent đang làm việc thì
  hiện một cụm chấm xoay nhỏ. Chỉ agent nào đang cần bạn mới giữ logo đủ màu, nên lướt qua cột
  là thấy ngay. Bấm vào một dòng để chuyển tới pane đó. Nút ✕ ở mỗi dòng đóng đúng thứ dòng đó
  đại diện: dòng agent thì đóng pane đó, dòng tiêu đề project thì đóng mọi tab của repo đó. Kéo
  tiêu đề project để sắp xếp lại các cụm.
- **Stage** (ở giữa). Các pane terminal của tab đang mở, chia theo ý bạn. Phía trên là một dải
  chip: tab terminal, tài liệu đang mở và tab trình duyệt có chung một kiểu, xếp theo thứ tự mở.
- **Side panel** (bên phải, **⌘⇧J**). Gồm ba tab: **File explorer** (**⌘⇧B**), **Token usage**
  (**⌘⇧U**) và **Session history** (**⌘⇧Y**).
- **Browser tab** (**⌘⇧I**). Một trang web nằm cạnh các terminal, mở ở địa chỉ trang chủ đặt
  trong Settings → Browser.
- **Dev servers** (macOS, ở cuối dải tab). Một chip đếm số server đang chạy trong project bạn
  đang mở; bấm vào để xem danh sách. Deck tìm được cả server khởi động từ Deck lẫn từ terminal
  hay editor khác. Mỗi server có thể mở trong Deck, mở bằng trình duyệt, hoặc sao chép. Chip này
  không hiện ở những nơi Deck không dò được server.

Kéo đường ranh giữa rail và stage để đổi độ rộng. Kéo quá mức nhỏ nhất, bấm **⌘B** hoặc dùng nút
thu gọn cạnh ba nút tròn ở góc cửa sổ để thu rail lại thành một cột avatar project. Huy hiệu trên
avatar đếm số agent đang chờ bạn, và bấm vào avatar sẽ mở các phiên của project đó ngay cạnh
cột. Bấm **⌘B** hoặc nút ở đầu dải tab để mở rộng lại.

## Pane và tab

- Chia pane bằng **⌘D** (cạnh nhau) hoặc **⌘⇧D** (chồng lên nhau). Di chuyển giữa các pane bằng
  **⌘⌥ + mũi tên**; đổi chỗ hai pane bằng **⌘⌥⇧ + mũi tên**.
- Pane shell trống trong một tab đã chia có thanh tiêu đề chứa logo các agent bạn đã ghim. Bấm
  một logo để chạy agent đó trong shell của pane. Thanh tiêu đề cũng có nút chia, mở rộng và
  đóng.
- **⌘E** mở rộng pane đang chọn; **⌘⇧Enter** phóng to nó phủ kín cả tab.
- **⌘W** đóng pane đang chọn; **⌘⇧W** đóng cả tab. Deck sẽ hỏi trước nếu ở đó đang có tiến trình
  nào khác ngoài một shell đang rảnh.
- **⌘⇧T** mở lại tab vừa đóng, với shell mới ở đúng các thư mục cũ.
- **⌘⇧M** tách pane đang chọn ra một cửa sổ riêng.
- **⌘1**–**⌘8** chọn chip theo vị trí; **⌘9** chọn chip cuối; **⌘⇧]** / **⌘⇧[** chuyển vòng qua
  các chip.
- **⌘⇧A** nhảy tới pane đang cần bạn nhất.

## File

Mở file explorer (**⌘⇧B**) để duyệt workspace. Khi bạn mở một file, sidebar tách làm hai: danh
sách nằm sát mép phải, tài liệu hiện bên trái nó, còn terminal vẫn nhìn thấy được. Dùng
**Open files** để quay lại một tài liệu đang giữ; file chưa lưu có dấu chấm. Khi đang ở trong
tài liệu, **⌘S** (Windows: **Ctrl+S**) để lưu và **⌘W** để đóng. File Markdown mở ra ở dạng đã
render; **⌘⇧V** chuyển sang xem mã nguồn.

Nút con mắt trên dòng thư mục dùng để hiện hoặc ẩn các dot-file như `.env` và `.github`. Cây thư
mục cũng ẩn những gì `.gitignore` của repo bỏ qua, như `node_modules` hay output của build, và
nút hình phễu cạnh con mắt sẽ hiện các mục đó ở dạng mờ. Ngoài git repo thì `node_modules`,
`dist` và `target` được coi là bị bỏ qua. `.git` thì luôn ẩn. Dòng của tài liệu đang mở bên cạnh
danh sách được tô sáng, và khi đổi tài liệu, Deck mở các thư mục cha của nó rồi cuộn tới đúng
chỗ.

Trong một git checkout, chuyển explorer từ **Files** sang **Changes** để xem những gì đã đổi kể
từ commit gần nhất: mỗi file kèm trạng thái và số dòng thêm, bớt. Bấm vào một file để mở nó.

Nếu file đã được Git theo dõi cần chạy filter, chẳng hạn Git LFS, Changes sẽ báo không thể
đọc an toàn; hãy dùng Git client quen thuộc để xem các file đó. Thay đổi commit của submodule
vẫn được hiển thị, nhưng thay đổi file bên trong submodule không được quét.
Xem [phần đọc Changes](../../electron/git/changes.ts).

Sơ đồ Markdown không tải ảnh HTTP(S) bên ngoài trong app đã cài.
[Chính sách ảnh](../../electron/app-image-policy.ts) không ảnh hưởng đến browser panel.

**⌘+click** (Windows: **Ctrl+click**) vào đường dẫn mà agent in ra để mở nó. Đường dẫn nằm trong
một workspace mà cửa sổ này đang mở sẽ mở trong editor của Deck, đúng dòng đó; còn lại thì mở
bằng app bạn chọn trong [Settings → Links & editor](settings.md#links--editor). Trên Windows, ở
bản này mới chỉ có phần mở trong Deck là chạy được.

## Mức dùng và quyền riêng tư

Tab Token usage đọc log phiên làm việc trên máy của chính Claude Code và Codex, rồi gom số token
và chi phí ước tính theo agent và theo ngày. Không cần tài khoản.

Từ bản 1.1.0, mỗi ngày Deck gửi đi các bản tổng hợp mức sử dụng cộng dồn. Analytics luôn bật,
không có cách tắt, bắt đầu từ lần mở đầu tiên sau khi nâng cấp; bản 1.0.0 và các bản Tauri cũ
hơn không gửi analytics. Mỗi bản tổng hợp gồm một id ngẫu nhiên mới cho ngày hôm đó, phiên bản
Deck, nền tảng và kiến trúc máy, số lần chạy từng agent có sẵn, số lần mở trình duyệt, explorer
và phần usage, số tab và pane nhiều nhất trong ngày, và việc có khôi phục phiên hay không. Nó
không bao giờ chứa code, đường dẫn, prompt, tên file, tên repo hay một mã định danh cố định nào.
[Settings → Privacy](settings.md#privacy) nói rõ chính xác những gì được gửi và không có công
tắc tắt. Danh sách đầy đủ các trường nằm trong
[`src/telemetry/payload.ts`](../../src/telemetry/payload.ts).
