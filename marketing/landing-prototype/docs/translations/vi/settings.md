---
translated-from: 63ba2cfc
---

# Cài đặt

Mở Settings bằng **⌘,** (Windows: **Ctrl+,**). Settings phủ kín cả cửa sổ; thoát ra bằng **Back**
hoặc Escape. Cài đặt được lưu theo từng máy, trong thư mục dữ liệu của Deck, ở file
`settings.json`, và áp dụng cho mọi cửa sổ Deck.

## Appearance

Appearance gom chế độ màu, chữ trong terminal, khung giao diện của workspace và phần nhận diện. Bản
xem trước (chỉ để xem) cập nhật ngay khi bạn chọn; nó không mở phiên terminal nào cả.

- **Theme** — Light hoặc Dark. Mặc định là Dark. Ở Dark, terminal là lớp nền sâu nhất trong cửa
  sổ, còn khung giao diện nổi lên phía trên.
- **Font and size** — dùng chung cho terminal và editor có sẵn (cỡ chữ mặc định là 13).
- **Tab bar position** — dải chip nằm trong sidebar (mặc định) hoặc chạy dọc phía trên.
- **Show pane bar** — thanh tên bên trong mỗi pane đã chia (mặc định tắt).
- **Show status bar** — thanh dưới cùng hiện branch, đường dẫn và thông tin cửa sổ (mặc định tắt).

## Browser

- **Home address** — trang mà tab trình duyệt mở ra khi không có trang cũ nào để khôi phục (mặc
  định `http://localhost:3000`).

## Terminal

- **Scrollback** — số dòng giữ lại cho mỗi pane: 1,000 / 5,000 / 10,000 (mặc định) / 50,000 /
  100,000.

## Agents

Danh sách agent: các agent có sẵn đã cài và chưa cài, lệnh khởi chạy của từng agent, công tắc bật
tắt, lựa chọn cho quick launch, và các agent bạn tự khai báo. Xem [Agent](agents.md).

## Links & editor

- **Open with** — app dùng để mở một đường dẫn khi bạn ⌘+click vào nó mà đường dẫn đó không thuộc
  workspace nào đang mở. Danh sách gồm những app Deck tìm thấy đã cài trong số VS Code, Cursor,
  Zed, GitHub Desktop, GitKraken, Finder, Terminal, iTerm2, Ghostty và Hyper. Đường dẫn nằm trong
  một workspace đang mở thì luôn mở trong editor của Deck. Deck dò app theo kiểu app bundle của
  macOS, nên trên Windows bản này chưa gợi ý được app ngoài nào.

## Shortcuts

Mọi thao tác kèm phím hiện tại của nó. Bấm vào một dòng để ghi tổ hợp phím mới; nếu trùng với thao
tác khác thì dòng đó sẽ báo ra, còn nút reset đưa về phím mặc định. Trong lúc ghi phím, các phím
tắt của menu tạm ngưng để phím bạn bấm tới được ô ghi.

## Notifications

- **Agent notifications** — mặc định bật. Khi cửa sổ nằm ở nền, Deck thông báo khi agent làm
  xong, hỏi bạn hoặc chờ duyệt, hay gặp lỗi. Bấm thông báo để quay về đúng pane đó.
  Nếu pane đã đóng hoặc chuyển sang cửa sổ khác, thông báo mở lại cửa sổ ban đầu.
  Bản cập nhật này bật lại một lần nếu trước đó bạn đã tắt; nếu bạn tắt sau đó, Deck sẽ nhớ.
  Xem [thông báo của agent](../../src/terminal/agent-notifier.ts).
- **Open System Settings** mở phần thông báo của macOS hoặc Windows, nơi hệ điều hành kiểm soát
  việc hiện thông báo. Trên macOS, cho phép thông báo khi lời nhắc đầu tiên xuất hiện; dùng công
  tắc **Badges** của hệ thống để kiểm soát số trên Dock.
  Xem [cài đặt thông báo](../../src/ui/settings/sections/notifications-section.tsx).
- **Dock badge (macOS)** — tổng số **N need you** của mọi cửa sổ đang mở, gồm cả pane đã xong
  mà bạn chưa xem. Số này biến mất khi về 0 và không phụ thuộc công tắc thông báo trong Deck.
  Windows có thông báo nhưng không có Dock badge.
  Xem [số pane cần bạn](../../src/ui/attention/attention-badge-sync.ts).

## About

Phiên bản Deck, **Check for updates** và **Release notes**. Bản cập nhật không bao giờ tự tải hay
tự cài khi bạn chưa chọn; Deck sẽ hỏi trước khi đóng pane để cài.
Lần xác nhận đó tính cả công việc đang chạy và file chưa lưu trong mọi cửa sổ đang mở,
theo [kiểm tra trước khi cập nhật](../../electron/ipc/register-updater.ts).

## Privacy

Từ bản 1.1.0, analytics về mức sử dụng luôn bật, không có cách tắt. Trang này nói rõ chính xác
những gì được gửi và có link tới thông báo về quyền riêng tư; trang không có công tắc nào. Các bản
tổng hợp chỉ chứa số liệu sử dụng theo ngày, không bao giờ có code, đường dẫn, prompt hay output
của agent. Bản 1.0.0 và các bản Tauri cũ hơn không gửi analytics.

Trạng thái analytics và các bộ đếm trong ngày chưa gửi nằm ở `telemetry.json` trong thư mục dữ
liệu của Deck, tách riêng khỏi `settings.json`. Nếu một bản build dành cho phát triển từng lưu lựa
chọn tắt thì khi mở lại, analytics sẽ được bật. Nếu không đọc được `telemetry.json`, Deck đếm tạm
trong bộ nhớ cho lần chạy đó và để nguyên file; số liệu của ngày hôm đó sẽ mất khi bạn thoát.

## Tìm kiếm và dấu đã đổi

Ô ở đầu danh sách Settings tìm một mục cài đặt theo đúng tên in trên dòng của nó. Mỗi trang hiện
số kết quả khớp trong trang đó, và các dòng khớp được tô sáng. **Esc** xoá ô tìm kiếm trước, rồi
mới đóng Settings.

Dấu chấm sau tên một mục cài đặt nghĩa là nó đang khác giá trị mặc định. Dấu chấm đánh dấu đúng
những gì nút **reset page** của trang đó sẽ khôi phục: các tuỳ chọn. Agent đã khai báo, cấu hình
khởi chạy và layout có dòng riêng trong [Reset](#reset), nên chúng không có dấu chấm.

## Reset

Trang Reset có ba dòng: tuỳ chọn, layout, và agent tự thêm kèm cấu hình khởi chạy cùng mẫu prompt.
Dòng nào cũng hỏi trước, liệt kê những cài đặt sẽ bị đổi và những gì được giữ lại. Một dòng sẽ bị
mờ đi khi trong nhóm của nó không có gì khác mặc định. Các trang có chứa tuỳ chọn cũng hiện số mục
đang khác mặc định, kèm nút **reset page** chỉ tác động lên đúng trang đó. Reset agent và mẫu
prompt cũng bỏ ghim các agent đã xoá khỏi quick launch. Logo tự đặt, workspace và log phiên làm
việc của chính các agent vẫn được giữ nguyên.

## Deck lưu dữ liệu ở đâu

| File hoặc thư mục     | Nội dung                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `settings.json`       | Tuỳ chọn của app; trạng thái analytics được lưu riêng                      |
| `workspaces.json`     | Các workspace gần đây, cùng layout và agent lúc mở mỗi workspace lần cuối  |
| `presets.json`        | Layout preset                                                              |
| `repositories.json`   | Kết quả dò git repo và worktree đã lưu tạm cho rail                        |
| `session.json`        | Nhật ký tab đang mở, dùng để khôi phục phiên                               |
| `update-attempt.json` | Lần cài cập nhật gần nhất, để báo lại nếu mở lại sau cập nhật bị lỗi       |
| `telemetry.json`      | Trạng thái analytics và các bộ đếm trong ngày chưa gửi                     |
| `usage-cache.json`    | Kết quả đã phân tích về token usage và các thư mục project nơi chúng chạy  |
| `themes/`             | File theme từ các bản trước; Settings không có chỗ nhập theme              |

Trên macOS, thư mục đó là `~/Library/Application Support/SpaceVibe Deck`; trên Windows là
`%APPDATA%\SpaceVibe Deck`.
