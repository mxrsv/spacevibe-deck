---
translated-from: fb727656
---

# Điện thoại

Ứng dụng SpaceVibe Deck cho iPhone ghép đôi với Deck trên máy Mac hoặc máy Windows của bạn. Từ
điện thoại, bạn thấy mọi pane và việc chúng đang làm, trả lời agent đang cần bạn, gõ vào bất kỳ
pane nào, mở agent mới kèm prompt, và đọc file, thay đổi cùng lượng token của một checkout. Deck
trên máy tính vẫn là nơi điều khiển: không có gì chạy trên điện thoại, và Deck phải đang mở thì
điện thoại mới với tới được.

Tính năng đồng hành trên điện thoại chưa có trong bản release. Ứng dụng chạy trên iPhone; iPad
dùng giao diện của iPhone.

## Ghép đôi điện thoại

1. Trong Deck, mở **Settings** (**⌘,**, Windows: **Ctrl+,**) và vào **Mobile**.
2. Chọn **Pair a phone**. Deck hiện một mã QR dùng được trong năm phút và chỉ một lần.
3. Trên iPhone, mở SpaceVibe Deck, chọn **Pair a desktop** rồi đưa camera vào mã.

Điện thoại và máy tính tự thống nhất khoá với nhau; không có tài khoản, không cần đăng nhập. Không dùng
camera thì chọn **Copy code** trong Deck, dán vào ô nhập mã trên điện thoại rồi chọn **Use code**;
với Universal Clipboard, mã đã chép tự sang iPhone. Khi mã hết hạn, chọn **Show a new code**. Một điện thoại ghép được với nhiều máy tính, và một máy tính
ghép được với nhiều điện thoại.

Mọi thứ giữa điện thoại và Deck đều được mã hoá đầu-cuối. Dữ liệu đi qua relay của SpaceVibe, nơi
chỉ chuyển tiếp những gói đã niêm phong mà nó không đọc được: relay biết thiết bị nào đã ghép đôi,
khi nào chúng kết nối và mỗi gói lớn bao nhiêu, nhưng không bao giờ thấy chữ trong terminal, file
hay nội dung thông báo của bạn. [Thông báo quyền riêng tư](https://deck.spacevibe.dev/privacy) liệt
kê chính xác những gì relay nhận được.

## Dùng ứng dụng

**Desktops** liệt kê mọi máy tính đã ghép đôi, cùng project, checkout và pane của từng máy, đúng
thứ tự và đúng ký hiệu như thanh rail của Deck. Mỗi pane hiện dòng cuối cùng và cách đây bao lâu nó
in ra, nên một pane bị kẹt vẫn trông như đang kẹt, kể cả khi Deck chưa đánh dấu nó.

Những pane cần bạn nằm trên cùng, dưới **Needs you**, mới nhất trước, hiện tối đa ba pane và có
**See all** để xem phần còn lại:

- Khi agent đưa ra danh sách lựa chọn có đánh số, mỗi lựa chọn là một nút. Bấm nút sẽ gõ số đó vào
  pane; bạn không cần mở pane.
- Khi agent hỏi một câu, **Reply** gửi câu trả lời của bạn như khi bạn tự gõ.
- Khi agent bị lỗi, **Open** mở pane của nó.

Mở một pane để xem terminal theo đúng kích thước trên máy tính, co cho vừa chiều ngang điện thoại.
Chụm hai ngón hoặc chạm vào nhãn kích thước để đổi cỡ chữ từ 50 đến 200%; điện thoại nhớ cỡ chữ cho
từng máy. Xem một pane từ điện thoại không bao giờ đổi kích thước của nó trên máy tính. Trong pane
mở từ Needs you, vuốt hoặc dùng các chấm để sang pane đang chờ tiếp theo.

- **Reply** ở dưới cùng dán chữ của bạn rồi nhấn Enter, giống gõ trên máy tính.
- **Live** gửi từng phím ngay khi bạn bấm, dùng cho shell và cho các câu hỏi riêng của agent. Hàng
  phím phía trên bàn phím có thêm Esc, Tab, Shift+Tab, Ctrl+C, các phím mũi tên và Return.

Duyệt hay trả lời agent bằng cách gõ, như khi ngồi ở máy tính; các nút đánh số là lối tắt duy nhất,
và chúng hoạt động giống nhau với mọi agent.

## Mở agent mới

Chọn **+** ở Desktops, rồi chọn máy tính, project và checkout, một agent trong danh sách của máy đó,
và nếu muốn thì thêm prompt đầu tiên. Tab mở ngay trên máy tính mà không giành focus. Điện thoại gửi
prompt khi agent đã sẵn sàng. Nếu agent hỏi gì đó trước, chẳng hạn có tin tưởng một thư mục mới hay
không, điện thoại giữ prompt lại và nhờ bạn trả lời câu hỏi đó trong pane trước.

## File, thay đổi và lượng dùng

Từ một checkout, **Files** duyệt thư mục và mở file văn bản, **Changes** liệt kê những gì đã đổi
kèm số dòng thêm và bớt và hiện diff của từng file, còn **Usage** hiện đúng các con số token và chi
phí như trang usage của Deck. Cả ba chỉ để đọc: điện thoại không bao giờ sửa file hay chạy git.

## Thông báo

Điện thoại nhận thông báo khi một agent cần bạn hoặc làm xong, trừ khi bạn đang dùng một cửa sổ
Deck trên máy tính. Bật hoặc tắt trong **Settings** → **Notifications** của ứng dụng trên điện
thoại; cài đặt thông báo của Deck trên máy tính không ảnh hưởng tới điện thoại. Thông báo cũng được
mã hoá như mọi thứ khác. Nếu một thông báo không mở được, nó hiện "An agent needs you". Chạm vào để
mở pane đó.

Thông báo mã hoá cần bản ứng dụng đã cài. Khi bạn dùng thử qua Expo Go, thông báo chỉ hiện "An agent
needs you" cho đến khi bạn mở ứng dụng.

## Offline, khoá và thu hồi

- **Offline.** Khi Deck đóng hoặc không với tới được máy tính, điện thoại hiện máy đó là offline
  kèm lần cuối thấy nó, và tự kết nối lại khi Deck mở lại.
- **Giữ máy tính thức.** Trong lúc có agent đang chạy và có điện thoại đã ghép đôi, Deck giữ cho
  máy tính không ngủ. Gập nắp laptop khi đang chạy pin thì máy vẫn ngủ.
- **Cùng mạng.** Khi điện thoại và máy tính dùng chung Wi-Fi, điện thoại kết nối thẳng, và phần
  thông tin máy tính trên điện thoại ghi rõ điều đó. Ở lần kết nối thẳng đầu tiên, tường lửa của máy
  tính có thể hỏi Deck có được nhận kết nối đến không; từ chối thì điện thoại chỉ tiếp tục dùng
  relay. Rời khỏi mạng đó, điện thoại tự quay về relay.
- **Face ID.** Ứng dụng hỏi Face ID hoặc mật mã khi mở và sau năm phút ở chế độ nền. Tắt nó trong
  **Settings** → **Unlock with Face ID** của ứng dụng trên điện thoại.
- **Thu hồi.** Trong **Settings** → **Mobile** của Deck, **Revoke** gỡ một điện thoại. Chỉ trong
  vài giây, điện thoại đó hiện máy tính là đã thu hồi và không còn với tới được. Trên điện thoại,
  **Forget this desktop** làm điều tương tự từ phía bên kia.
- **Cập nhật.** Khi phiên bản ứng dụng và Deck lệch nhau quá xa, điện thoại nói rõ bên nào cần cập
  nhật: Deck qua trình cập nhật của nó, ứng dụng qua TestFlight hoặc App Store.

## Trên Windows

Mọi điều ở trên đều dùng được với Deck trên Windows. Deck trên Windows không có hook của agent, nên
nó chỉ biết agent cần bạn qua những gì agent in ra. Nó có thể bỏ lỡ lúc đó: khi ấy pane không được
ghim dưới Needs you và không có thông báo, nhưng pane vẫn hiện dòng cuối và thời gian trong cây.
