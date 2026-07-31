# Overnight audit — 2026-08-01

Rà soát toàn bộ codebase `spacevibe-deck` theo 4 trục: bảo mật, tính đúng đắn,
chất lượng (tuân thủ luật đã khai trong `AGENTS.md` / `docs/`), và độ tin cậy.
Mọi finding dưới đây đều được đọc trực tiếp trên mã nguồn tại commit `2ac1371`;
không có finding suy đoán. Không sửa mã sản phẩm trong lần rà soát này.

> **Lưu ý về ngôn ngữ.** `AGENTS.md` R1 quy định "English only for every string,
> comment and doc". Báo cáo này được yêu cầu viết bằng tiếng Việt nên nó vi phạm
> R1 theo đúng nghĩa đen. Cần một quyết định của con người: hoặc dịch báo cáo
> sang tiếng Anh, hoặc bổ sung ngoại lệ cho `docs/review/` vào R1.

> **Không chạy được `npm test` / `npm run build`** trong môi trường rà soát:
> `node_modules` chưa cài (`vitest: not found`). Báo cáo này thuần đọc mã.

---

## High

### H1 — Webview không có CSP, đồng thời `withGlobalTauri` bật, khiến mọi lỗ hổng script trong webview trở thành thực thi lệnh tùy ý

`src-tauri/tauri.conf.json:13` (`"withGlobalTauri": true`) và
`src-tauri/tauri.conf.json:35` (`"csp": null`).

**Kịch bản fail.** Webview chạy không có Content-Security-Policy nào, đồng thời
`window.__TAURI__` được tiêm toàn cục. Chỉ cần một điểm thực thi script bất kỳ
trong webview — một CVE trong `@xterm/xterm` / `three` / `ogl`, một sink
`innerHTML` mới được thêm vào (kiểu đã có sẵn ở `marketing/video/src/overlay.js:67`
và `marketing/video/src/stage-driver.js:183`), hoặc MITM lên `devUrl:
http://localhost:1420` khi chạy dev — là kẻ tấn công gọi được thẳng
`invoke("write_pty", { id, data })`, tức gõ lệnh tùy ý vào shell đăng nhập của
người dùng, cộng thêm `spawn_shell`, `open_editor`, `read_image_as_data_url`.
Toàn bộ 15 command trong `src-tauri/src/lib.rs:53-69` không có lớp phòng thủ thứ
hai nào. Đáng chú ý: `grep` toàn bộ `src/` không tìm thấy chỗ nào dùng
`window.__TAURI__` — mọi module đều import từ `@tauri-apps/api`, nên cờ này
đang mở rộng bề mặt tấn công mà không đổi lại lợi ích gì.

**Hướng sửa.** Đặt `"withGlobalTauri": false` và khai báo CSP chặt
(`default-src 'self'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost`),
điều chỉnh dần theo những gì xterm/ogl thực sự cần.

---

### H2 — `git_branch` chạy `git` chặn (blocking) trên async runtime, không timeout, và bị gọi lại mỗi 2 giây khi lỗi

`src-tauri/src/info.rs:202-216`, cộng với `src/terminal/pane-info-poller.ts:44-64`.

**Kịch bản fail.** `git_branch` là `async fn` nhưng gọi `command.output()` đồng
bộ, không `spawn_blocking`, không deadline. Nếu CWD của pane đang trỏ vào một
network mount treo hoặc một repo rất lớn, lời gọi này giữ chặt một worker của
Tokio runtime. Phía frontend làm cho tình huống tệ hơn: `pane-info-poller.ts:56-62`
chỉ cập nhật `lastBranchCwd` khi thành công, nên khi lỗi/treo, guard "cwd không
đổi thì bỏ qua" ở dòng 47 không bao giờ chặn được, và `setInterval` 2 giây
(`pane-info-poller.ts:95-98`) tiếp tục phát thêm một lời gọi nữa mỗi vòng. Các
worker chồng lên nhau và mọi async command khác (`pty_info`, `resolve_paths`,
`open_editor`, `dirs_exist`) bị đói tài nguyên. Trong cùng file, `pty_info`
(`info.rs:187`) đã dùng `spawn_blocking` đúng cách, và `discover_agents`
(`platform/macos.rs:47-55`) dùng `spawn_blocking` + timeout — `git_branch` là
ngoại lệ duy nhất.

**Hướng sửa.** Bọc `command.output()` trong `spawn_blocking` và thêm deadline
(mẫu `DETECT_TIMEOUT` trong `agents.rs:6` đã có sẵn); ở frontend, ghi nhớ
`lastBranchCwd` cả khi thất bại để không đập lại cùng một CWD hỏng mỗi 2 giây.

---

### H3 — SIGKILL trễ 500 ms bắn vào một process group ID có thể đã được hệ điều hành tái sử dụng

`src-tauri/src/platform/macos.rs:92-98`.

**Kịch bản fail.** Sau khi gửi `SIGHUP` cho foreground process group, hàm spawn
một thread rời, ngủ `KILL_GRACE` (500 ms, `macos.rs:7`) rồi gọi
`killpg(process_group, SIGKILL)` **vô điều kiện** — không kiểm tra group đó còn
tồn tại không, không có đường hủy khi group đã chết sớm. Đóng một pane đang chạy
job foreground nhẹ (ví dụ `npm test` vừa xong, hay một `sleep` ngắn): group thoát
ngay khi nhận SIGHUP, PGID được giải phóng, và trên macOS PID quay vòng ở
99998 nên trên một máy dev bận, PGID đó hoàn toàn có thể được cấp lại cho một
process group khác trong 500 ms. Deck khi đó `SIGKILL` một tiến trình nó không
sở hữu. Bộ test hiện có (`pty.rs:673-757`) chỉ khẳng định "process bị giết", chưa
có case nào khẳng định "process không thuộc về ta thì không bị giết".

**Hướng sửa.** Trước khi leo thang, poll group bằng `killpg(pgid, 0)` /
`waitpid` và bỏ qua SIGKILL khi group đã biến mất; hoặc giữ handle `Child` và
hủy thread escalation khi `try_wait()` báo đã thoát.

---

## Medium

### M1 — `run_editor_program` rò tiến trình zombie mỗi lần editor không thoát trong 10 giây

`src-tauri/src/links.rs:433-445`.

**Kịch bản fail.** Vòng poll thoát bằng `return Ok(())` khi quá `EDITOR_TIMEOUT`
(dòng 438-440), bỏ lại `child` chưa từng được `wait()`. `Drop` của
`std::process::Child` trong std **không** reap tiến trình con. Trên macOS,
`prepare_editor_program` (`links.rs:371-383`) bọc lệnh trong `$SHELL -l -c …`,
nên mỗi lần Cmd+click mở một editor ở chế độ foreground (`vim`, `nvim`, `hx`
qua custom template) để lại một zombie `sh` tồn tại đến hết vòng đời tiến trình
app. Nhánh này cũng không bao giờ đọc `stderr` đã `piped()` (dòng 423), nên chẩn
đoán lỗi mất luôn.

**Hướng sửa.** Ở nhánh timeout, `thread::spawn` một reaper gọi `child.wait()`,
hoặc chuyển sang `tokio::process::Command` để runtime tự reap.

---

### M2 — Sau `kill_pty`, output còn lại của pane bị broadcast sang mọi cửa sổ

`src-tauri/src/pty.rs:498` và `src-tauri/src/coordinator.rs:58-72`.

**Kịch bản fail.** `kill_pty` gọi `coordinator.unregister(id)` đồng bộ, trong khi
thread emitter của chính session đó vẫn đang chạy và có thể còn dữ liệu trong
`pending` (`pty.rs:387-400` và nhánh flush `405-415`). Lời gọi `emit_to_owner`
kế tiếp không tìm thấy owner nên rơi vào nhánh fallback `app.emit(event, payload)`
(`coordinator.rs:70`), phát `pty:output` chứa nội dung terminal của pane đó tới
**mọi** webview window. Comment ở `coordinator.rs:58-59` khẳng định nhánh này
"should not happen after spawn registers" — nhưng đường `kill_pty` làm nó xảy ra
một cách bình thường. Cùng với `move_pane_ownership` (đường đa cửa sổ), nội dung
pane của cửa sổ A lọt vào listener của cửa sổ B.

**Hướng sửa.** Ghi nhớ nhãn owner ngay lúc spawn trong closure của emitter, hoặc
bỏ hẳn fallback broadcast và im lặng bỏ qua khi owner không còn.

---

### M3 — `move_pane_ownership` chấp nhận nhãn cửa sổ không tồn tại, làm pane mất đường ra vĩnh viễn

`src-tauri/src/coordinator.rs:33-42` và `:74-85`.

**Kịch bản fail.** `move_ownership` chỉ kiểm tra `pane_id` đã đăng ký, không hề
kiểm tra `window_label` có ứng với một webview thật hay không, rồi trả `true`.
Mọi `emit_to_owner` sau đó gọi `app.emit_to(label, …)` và **nuốt lỗi** bằng
`let _ =` (`coordinator.rs:68`). Truyền một nhãn sai hoặc nhãn của cửa sổ vừa
đóng: PTY vẫn chạy, shell/agent vẫn tiêu tài nguyên, nhưng output không đến bất
kỳ cửa sổ nào và không có lỗi nào nổi lên ở đâu — pane "chết lâm sàng" hoàn toàn
im lặng.

**Hướng sửa.** Xác thực bằng `app.get_webview_window(&window_label)` trước khi
gán, trả `Err` khi nhãn không tồn tại.

---

### M4 — Khi `git_branch` lỗi, status bar tiếp tục hiển thị branch của repo khác

`src/terminal/pane-info-poller.ts:55-63`.

**Kịch bản fail.** Trong `catch`, hàm chỉ `console.warn` một lần rồi thoát: cả
`branch` lẫn `lastBranchCwd` đều giữ nguyên. Pane A ở `/repo1` (branch `main`) →
người dùng focus pane B ở `/repo2` → lời gọi `gitBranch("/repo2")` ném lỗi (git
không có trên PATH, thư mục vừa bị xóa, quyền bị từ chối). Kết quả: `branch()`
tiếp tục trả `"main"`, và status bar gán branch của repo1 cho repo2 — fallback
sai theo hướng nguy hiểm nhất, vì thông tin trông hợp lệ chứ không trống.

**Hướng sửa.** Trong `catch`, đặt `branch = null` và `lastBranchCwd = cwd` để UI
hiển thị "không rõ" thay vì giá trị cũ của một CWD khác.

---

### M5 — Poll chồng lấn và `prune` bị đua, làm cache hồi sinh pane đã đóng

`src/terminal/pane-info-poller.ts:66-88` và `:110-117`.

**Kịch bản fail.** `setInterval` ở dòng 95-98 phát vòng poll mới mỗi 2 giây mà
không chờ vòng trước (`poll` là `async`). Đóng một tab trong lúc `ptyInfo` đang
bay: `prune(live)` xóa entry của các pane đã chết, rồi response cũ quay về và
`infoByPane.set(info.id, info)` (dòng 84) ghi lại chính những pane đó. Từ đó
`infoFor(id)` báo một pane đã đóng là còn sống cho đến lần `prune` không liên
quan tiếp theo. Hai vòng poll chậm cũng có thể ghi kết quả ngược thứ tự, làm
header pane nhảy về trạng thái cũ.

**Hướng sửa.** Giữ một cờ `inFlight` để bỏ qua tick khi vòng trước chưa xong, và
lọc kết quả theo `deps.targets()` tại thời điểm ghi.

---

### M6 — `timeout` quanh `spawn_blocking` không hủy được shell probe; comment khẳng định ngược lại

`src-tauri/src/platform/macos.rs:47-55`, tuyên bố sai tại `src-tauri/src/agents.rs:96-104`.

**Kịch bản fail.** `tokio::time::timeout(DETECT_TIMEOUT, task)` chỉ bỏ chờ
`JoinHandle`; closure trong `spawn_blocking` **không** bị hủy, và tiến trình con
`$SHELL -ilc "command -v …"` cũng không bị kill. Với một `.zshrc` treo chờ mạng
(chính kịch bản mà comment ở `agents.rs:96-99` mô tả), mỗi lần mở Open board để
lại thêm một `zsh -ilc` treo và một thread trong blocking pool bị chiếm vĩnh
viễn. Pool này chung với đường `pty_info` trên Windows (`info.rs:187`). Comment ở
`agents.rs:104` viết "instead of blocking a Tokio worker thread forever" — đúng
với worker async, sai với blocking pool, và im lặng về tiến trình con bị bỏ rơi.

**Hướng sửa.** Spawn `Child` thủ công, giữ handle, và `kill()` nó khi hết
deadline; đồng thời sửa comment cho khớp với thứ code thật sự bảo đảm.

---

### M7 — Doc comment của `remove_session` mô tả một lỗi đã được sửa, như thể nó vẫn còn

`src-tauri/src/pty.rs:139-176`.

**Kịch bản fail.** Comment (dòng 139-155) khẳng định dứt khoát rằng đường thoát
shell bình thường vẫn drop `Session` bên trong scope của guard, và kết luận
"`kill_pty` was fixed for the same hazard; this sibling was missed". Nhưng thân
hàm (dòng 162-175) đã hoist giá trị ra ngoài scope của guard đúng theo mẫu của
`kill_pty` (`pty.rs:483-497`): `let removed = { match … }; drop(removed);`. Guard
được nhả ở cuối `match`, `Session` chỉ drop ở dòng 175. Hệ quả: người bảo trì
tiếp theo đọc comment sẽ hoặc "sửa" lại đoạn code vốn đã đúng, hoặc coi đây là
lỗi đã biết và bỏ qua vấn đề còn thật sự tồn tại — thứ tự field của `Session`
(`pty.rs:37-44`) vẫn đặt `master` trước `platform`, nên Job Object với
`KILL_ON_JOB_CLOSE` vẫn drop sau pseudoconsole.

**Hướng sửa.** Viết lại comment thành mô tả bất biến đang được giữ ("giá trị
phải rời scope guard trước khi drop, vì …") và tách phần thứ tự field thành một
ghi chú riêng ở chỗ khai báo `struct Session`.

---

### M8 — Số lượng comment trích `FR-`/`ADR` lớn hơn con số `AGENTS.md` khai

`AGENTS.md:17-19` khai "Four code comments still cite `FR-`/`ADR` … (`agents.rs`,
`open-board.tsx`, `migrate.rs`)".

**Kịch bản fail.** Thực tế có 9 comment trên 6 file:
`src-tauri/src/coordinator.rs:4` (`ADR docs/decisions/0001`),
`src-tauri/src/migrate.rs:6` (`ADR 0028`),
`src-tauri/src/agents.rs:104` (`FR-025`), `src-tauri/src/agents.rs:110` (`FR-003 AC-2`),
`src/open-board/open-board.tsx:179` (`FR-025`),
`src/terminal/action-registry.ts:357` (`FR-032`),
`src/terminal/terminal-manager.ts:87` (`FR-032`), `:383` (`FR-032 AC-3`), `:392` (`FR-032 AC-2`).
Ba file — `coordinator.rs`, `action-registry.ts`, `terminal-manager.ts` — hoàn
toàn vắng mặt trong danh sách. Người đưa ra quyết định "strip the comments or
soften the claim" sẽ quyết định trên một phạm vi sai.

**Hướng sửa.** Cập nhật mục "In flight" trong `AGENTS.md` với danh sách đầy đủ ở
trên trước khi đưa fork này cho con người quyết.

---

### M9 — R1 ("English only") đang bị vi phạm, trong khi cả hai drift ledger đều tuyên bố "Empty — verified"

`AGENTS.md:72` đặt luật; `AGENTS.md:94` và `docs/ARCHITECTURE.md:88` tuyên bố
ledger rỗng và đã được kiểm chứng.

**Kịch bản fail.** Có chuỗi/comment tiếng Việt tại:
`src/terminal/webkit-ime-fix.ts:22-23` (`vâ`, `trâ`, `ấn`),
`src/lib/terminal-links.ts:62` (`docs/ghi-chú.md`),
`src-tauri/src/pty.rs:525-527` (`ố`), `:560-561` (`chào ─── bạn`), `:580-585` (`sống`),
`src-tauri/src/agents.rs:203` (`/Users/bình/.local/bin/claude`).
Phần lớn là fixture hợp lý cho test UTF-8/IME, nhưng R1 không hề ghi ngoại lệ
nào, nên trạng thái hiện tại là "luật nói một đằng, code làm một nẻo" mà ledger
lại khẳng định đã kiểm chứng — đúng loại drift mà mục "Chưa khớp thực tế" sinh
ra để bắt.

**Hướng sửa.** Hoặc thêm một mệnh đề ngoại lệ vào R1 cho fixture test đa ngôn
ngữ, hoặc thay các fixture bằng ký tự non-ASCII không mang ngữ nghĩa tiếng Việt
— rồi ghi kết quả vào ledger thay vì để nó rỗng.

---

### M10 — Bảng module trong `ARCHITECTURE.md` bỏ sót thư mục UI lớn nhất và mô tả sai `src/chrome/`

`docs/ARCHITECTURE.md:23-26` và `AGENTS.md:57-68`.

**Kịch bản fail.** Cả hai tài liệu liệt kê `src/terminal/`, `src/chrome/`,
`src/open-board/`, `src/settings/`, `src/presets/`, `src/lib/` — nhưng `src/ui/`
không xuất hiện ở đâu cả, dù đây là thư mục chứa 24 file gồm `app.tsx`,
`tab-bar.tsx`, `settings-panel.tsx`, `workspace-sidebar.tsx`, `status-bar.tsx`.
Ngược lại, `src/chrome/` được mô tả là "window chrome, tabs" nhưng thực tế chỉ
chứa đúng một file `events.ts`. Một agent hay người mới đọc doc để định vị code
UI sẽ tìm ở `src/chrome/` và không thấy gì. Ledger của cả hai file đều tự nhận
đã verified (`ARCHITECTURE.md:88`, `AGENTS.md:94`).

**Hướng sửa.** Thêm dòng `src/ui/` vào cả bảng module và cây layout, sửa mô tả
`src/chrome/` thành "cross-module event bus".

---

### M11 — `harden_webview` chỉ chạy cho cửa sổ tồn tại lúc `setup()`

`src-tauri/src/lib.rs:44-50`.

**Kịch bản fail.** Vòng lặp chạy một lần trên `app.webview_windows()` trong
`setup()`. Comment ngay phía trên (dòng 46-47) tự thừa nhận "a future second
window needs the same call", nhưng không có hook `on_window_event` /
`on_page_load` nào được đăng ký. Hạ tầng đa cửa sổ đã có sẵn:
`coordinator::move_pane_ownership` (`coordinator.rs:74-85`) và
`WindowCoordinator::panes_for_window` (`coordinator.rs:45-55`). Cửa sổ thứ hai
đầu tiên được tạo sau `setup()` sẽ giữ nguyên phím tắt trình duyệt mặc định của
wry — đúng hậu quả mà comment mô tả: một phím F5 hủy toàn bộ tab và bỏ rơi mọi
PTY (kèm agent CLI đang chạy trong đó).

**Hướng sửa.** Chuyển lời gọi `harden_webview` vào hook tạo cửa sổ để mọi webview
đều được xử lý, không chỉ những cái có mặt lúc khởi động.

---

## Low

### L1 — `killPane` / `killAll` chỉ giết PTY, không dọn đối tượng pane

`src/terminal/pane-lifecycle.ts:113-117` và `:119-125`.

**Kịch bản fail.** Khác với `discardPane` (`:104-111`) vốn dọn đủ ba việc
(`panes.delete`, `clearPaneCwd`, `pane.dispose`), `killPane` chỉ gọi `killPty`.
Hiện tại chưa rò rỉ vì call site duy nhất (`terminal-manager.ts:284-289`) tự làm
nốt phần còn lại, và `killAll` được `dispose()` (`terminal-manager.ts:675-681`)
theo sau. Nhưng tên hàm và sự tồn tại của `discardPane` ngay bên cạnh gợi ý điều
ngược lại: call site thứ hai bất kỳ sẽ rò một instance xterm cùng entry
`pane-cwd` mà không có gì báo lỗi.

**Hướng sửa.** Đổi tên thành `killPtyOnly` / `terminatePtyOnly`, hoặc gộp phần
dọn dẹp vào trong hàm.

---

### L2 — Hover trên OSC link có thể rò listener modifier vĩnh viễn

`src/terminal/osc-link-handler.ts:63-75` và `:77-80`, cùng
`src/terminal/primary-modifier.ts:6`.

**Kịch bản fail.** `hover()` đăng ký `onPrimaryModifierChange` bên trong một
`queueMicrotask`; `leave()` chỉ hủy đăng ký đã tồn tại. Khi con trỏ lướt nhanh
qua nhiều link và cặp hover→leave rơi vào cùng một task, `leave` chạy trước với
`unsubscribe === null` (không làm gì), rồi microtask mới đăng ký listener — và
không còn ai gỡ nó khỏi `Set` cấp module trong `primary-modifier.ts`. Mỗi lần
như vậy cộng thêm một listener sống mãi, mỗi listener ghi vào một
`ILinkDecorations` của link đã biến mất.

**Hướng sửa.** Đặt cờ `left = true` trong `leave()` và thoát sớm khỏi microtask
khi cờ được bật.

---

### L3 — `resolve_paths` và `dirs_exist` làm I/O chặn trong async command, `dirs_exist` không giới hạn đầu vào

`src-tauri/src/links.rs:118-137` và `src-tauri/src/agents.rs:111-117`.

**Kịch bản fail.** `resolve_paths` giới hạn ứng viên ở `MAX_PATHS = 64`
(`links.rs:19`) nhưng vẫn chạy tới 64 lời gọi `std::fs::canonicalize` đồng bộ
ngay trên async runtime cho mỗi lần hover. `dirs_exist` thì không có giới hạn nào
trên `paths.len()`: frontend gửi mảng bao nhiêu phần tử cũng được, mỗi phần tử là
một `is_dir()` chặn. Trên một mount chậm, một lần hover hoặc một lần khôi phục
recents đủ giữ worker trong hàng trăm mili-giây. Guard UNC (`has_rejected_root`,
`shell_integration.rs:96-122`) đã chặn được trường hợp tệ nhất trên Windows,
nhưng không chặn NFS/SMBFS đã mount trên macOS.

**Hướng sửa.** Bọc cả hai trong `spawn_blocking` và áp một trần cứng cho
`dirs_exist` giống `MAX_PATHS`.

---

### L4 — `terminate_session` trên macOS luôn báo thành công, làm vô hiệu hóa cơ chế retry mà `kill_pty` mô tả

`src-tauri/src/platform/macos.rs:71-83`.

**Kịch bản fail.** Hàm bỏ lỗi bằng `let _ = killer.kill();` (dòng 81) rồi trả
`Ok(())` vô điều kiện. Comment tại `pty.rs:477-478` giải thích rằng
`terminate_session` được giữ trong lock cố ý để "a failure leaves the session in
the map, retryable" — nhưng trên macOS không lỗi nào có thể tới được nhánh đó,
nên session luôn bị xóa khỏi map kể cả khi việc giết tiến trình thất bại, và
người dùng mất luôn khả năng thử lại.

**Hướng sửa.** Truyền lỗi từ `killer.kill()` ra ngoài, hoặc sửa comment ở
`pty.rs` để không hứa một hành vi mà adapter macOS không cung cấp.

---

### L5 — Escape đường dẫn POSIX làm hỏng tên file chứa xuống dòng thay vì trích dẫn nó

`src/lib/shell-escape.ts:14-25`.

**Kịch bản fail.** Vòng lặp escape mọi ký tự ASCII ngoài `SAFE_CHAR` bằng dấu
`\` phía trước. Với `\n` (hợp lệ trong tên file trên macOS), kết quả là dấu
backslash đứng ngay trước một newline thật — shell đọc đó là line continuation
và nuốt cả hai, nên file `a<LF>b` được gõ vào PTY thành đối số `ab`. Đây **không**
phải injection (newline bị tiêu thụ chứ không được thực thi), nhưng thao tác kéo
thả file lặng lẽ trỏ vào một đường dẫn khác. Nhánh Windows ngay trên đó
(dòng 11-13) đã dùng cách trích dẫn đúng.

**Hướng sửa.** Bọc toàn bộ đường dẫn trong dấu nháy đơn và nhân đôi/thoát dấu
nháy bên trong, giống nhánh Windows.

---

### L6 — Fake `PtyClient` trong test không khớp hợp đồng của backend

`src/terminal/pty-client.ts:149-154` so với `src-tauri/src/info.rs:180-197`.

**Kịch bản fail.** `createMemoryPtyClient().ptyInfo` dùng `flatMap` và **bỏ hẳn**
các id không có trong map, trong khi `pty_info` thật luôn trả đúng một entry cho
mỗi id được hỏi, với `kind: "unknown"` khi không tra được (`info.rs:81-89`,
`:136-141`). Mọi test đi qua fake này không bao giờ thấy hình dạng dữ liệu mà app
thật nhận được, nên nhánh xử lý pane "unknown" ở
`terminal-manager.ts:650-663` và `pane-info-poller.ts:83-85` không được bao phủ
đúng.

**Hướng sửa.** Cho fake trả về một entry `unknown` cho mỗi id thiếu, khớp với
hợp đồng của Rust.

---

### L7 — `close-coordinator.ts` thụt lề 4 space, lệch với toàn bộ phần còn lại của repo

`src/terminal/close-coordinator.ts` (toàn file).

**Kịch bản fail.** Mọi file khác trong `src/terminal/` dùng 2 space; file này
dùng 4. `package.json` không có script `format` hay `lint` nào (điều `AGENTS.md:41-42`
đã xác nhận: "No separate `lint` script in this repo"), nên CI không bắt được và
sai lệch sẽ lan sang mọi chỉnh sửa tiếp theo trong file này.

**Hướng sửa.** Chuẩn hóa về 2 space; cân nhắc thêm `prettier --check` vào CI để
chốt vấn đề một lần.

---

## Tổng kết

| Mức      | Số lượng |
| -------- | -------- |
| Critical | 0        |
| High     | 3        |
| Medium   | 11       |
| Low      | 7        |
| **Tổng** | **21**   |

**Ba việc nên làm trước.**

1. **H1** — bật CSP và tắt `withGlobalTauri`: đây là thay đổi cấu hình rẻ nhất,
   nhưng là thứ duy nhất đứng giữa một lỗ hổng script trong webview và việc thực
   thi lệnh tùy ý qua `write_pty`.
2. **H2** — đưa `git_branch` vào `spawn_blocking` kèm timeout, và ghi nhớ CWD
   ngay cả khi lỗi ở phía poller: hiện tại một CWD hỏng duy nhất đủ làm đói toàn
   bộ IPC async mỗi 2 giây.
3. **H3** — thêm kiểm tra sống/chết trước khi leo thang SIGKILL: đây là finding
   duy nhất có thể gây thiệt hại ra ngoài phạm vi ứng dụng.

**Ghi chú về các mục thuộc `src-tauri` load-bearing seams (R4).** H3, M1, M2, M3,
M6, M7 và M11 đều nằm trong PTY / window coordinator / close coordinator — theo
`AGENTS.md:26-27` đây là fork, cần con người quyết trước khi viết code. Báo cáo
này dừng ở mức mô tả và đề xuất, không chạm vào mã sản phẩm.

**Điểm mạnh đáng ghi nhận.** Bề mặt injection cổ điển đã được xử lý kỹ:
`open_editor` xác thực canonical path và từ chối UNC/verbatim trước khi chạm
filesystem (`links.rs:203-256`), template custom trên Windows được parse thành
argv và từ chối cú pháp shell (`links.rs:286-336`), đường dẫn POSIX được trích
dẫn trước khi vào `sh -c` (`links.rs:338-363`), `detect_agents` chạy trên
allowlist hằng số (`agents.rs:15`, `platform/macos.rs:42-46`), và giá trị
`lastAgent` lấy từ store trên đĩa luôn phải đi qua `resolveAgentChoice`
(`workspace-recents.ts:138-149`) đối chiếu với danh sách CLI thật sự có trên
PATH trước khi được gõ vào shell.
