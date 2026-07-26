# Findings — Đối chiếu `docs/` với code thật (doc-reality drift)

- **Ngày**: 2026-07-26
- **HEAD khi audit**: `80945a9` (2026-07-25, v0.7.0)
- **Phạm vi**: toàn bộ 27 ADR trong `docs/decisions/`, 6 doc phái sinh, `CONTEXT.md` (root + `docs/`)
- **Loại**: audit tài liệu. Không sửa code sản phẩm, không sửa ADR đang có.
- **Kiểm chứng**: `grep`/`glob` trong `src/` + `src-tauri/src/`, `git log --all -S'<symbol>'`, `npm test` (53 file / 572 test, pass toàn bộ tại HEAD).

---

## 0. Tóm tắt

| Trạng thái     | Số ADR | Ghi chú                                                           |
| -------------- | ------ | ----------------------------------------------------------------- |
| `shipped`      | 11     | Code khớp quyết định                                              |
| `partial`      | 7      | Một phần có, phần còn lại chưa/không còn                          |
| `never-built`  | 3      | Chưa từng tồn tại trong bất kỳ commit nào, trên bất kỳ branch nào |
| `removed`      | 3      | Từng có rồi bị gỡ; ADR vẫn `active`                               |
| `contradicted` | 1      | Code làm ngược quy tắc ADR ghi rõ                                 |
| `unknown`      | 2      | Không kiểm chứng được bằng code (xem §1)                          |

**Tín hiệu hệ thống được xác nhận lại**: `grep -H "supersedes:" docs/decisions/*.md | grep -v "supersedes: \[\]"` → rỗng. 27/27 ADR đều `supersedes: []`, trong khi có 3 ca `removed` và 1 ca `contradicted`. Cơ chế supersede chưa từng được dùng.

**Ba nguồn trôi khác nhau, cần xử lý khác nhau:**

1. **Trôi do chưa build** (0012, 0017, 0022, một phần 0001/0016/0024): ADR đúng, code chưa tới. Đây là backlog, không phải lỗi ADR.
2. **Trôi do đã gỡ** (0002, 0010, 0014): quyết định bị đảo ngược trong code mà không có ADR nào ghi nhận. Đây là chỗ cơ chế supersede lẽ ra phải chạy.
3. **Trôi do render sai/lỗi thời** (`docs/CONTEXT.md`, một số dòng trong `PRD`/`BUSINESS-FLOW`/`REQUIREMENTS`): doc phái sinh không khớp cả ADR lẫn code.

---

## 1. Ledger — 27 ADR

Ký hiệu: `S` shipped · `P` partial · `NB` never-built · `R` removed · `C` contradicted · `?` unknown.

| ADR      | Title                                    | Kind      | Trạng thái  | Bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                   | Doc phái sinh bị ảnh hưởng                                 |
| -------- | ---------------------------------------- | --------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **0001** | Rust PTY / window coordinator            | arch      | **P**       | Có: `src-tauri/src/coordinator.rs:10-59`, `pty.rs:216` (register), `pty.rs:259-292` (`emit_to_owner` targeted), `coordinator.rs:77-88` + `lib.rs:42` (`move_pane_ownership`). Thiếu: `coordinator.rs:48` `#[allow(dead_code)] // used when multi-window close lands`; `grep -rn "move_pane_ownership" src` → rỗng (frontend chưa gọi)                                                                                        | ARCHITECTURE, REQUIREMENTS                                 |
| **0002** | Multi-window session chrome in one file  | arch      | **R**       | `session-schema.ts` + `session-persistence.ts` bị xoá tại `1b5eff0` (2026-07-15, bump `0.3.0` → `0.5.0`). `grep -rn "session.json" src src-tauri/src` → rỗng. Schema v2 multi-window chưa từng tồn tại                                                                                                                                                                                                                       | ARCHITECTURE, REQUIREMENTS                                 |
| **0003** | Last window close quits the app          | arch      | **C**       | `src/terminal/tab-manager.ts:712-722`: `if (tabs.length === 0) { … await pty.confirmQuit() }` — đúng điều ADR cấm ("must not treat `tabs.length === 0` as app quit"). Comment ở dòng 713 còn cite nhầm "ADR 0002"                                                                                                                                                                                                            | BUSINESS-FLOW, ARCHITECTURE, REQUIREMENTS                  |
| **0004** | Agent-CLI terminal first                 | principle | **S**       | `src-tauri/src/agents.rs:15` `AGENT_ALLOWLIST = ["claude","codex","gemini"]`; `src/lib/process-info.ts:17-19` agent color map; toàn bộ E9 attention rail                                                                                                                                                                                                                                                                     | PRINCIPLES, PRD                                            |
| **0005** | macOS only (v1)                          | principle | **S**       | `src-tauri/tauri.conf.json:40-42` (`macOS.minimumSystemVersion`, `signingIdentity`); `pty.rs:169` `cmd.arg("-l")`; không có lớp portability nào trong `src-tauri/src/`                                                                                                                                                                                                                                                       | PRINCIPLES, PRD, ARCHITECTURE                              |
| **0006** | Mouse and keyboard both first-class      | principle | **P**       | Có cả 2 đường: board `open-board.tsx:261-307` (keyboard) + click handler; `keymap.ts:39-80`. Thiếu: swap chỉ có chuột (`pane-drag.ts:219,269` `metaKey`), `keymap.ts` không có `⌘⌥⇧`+arrow; các surface net-new chưa build nên chưa đánh giá được                                                                                                                                                                            | PRINCIPLES, PRD, UX-DESIGN                                 |
| **0007** | Real PTY + login shell                   | principle | **S**       | `src-tauri/src/pty.rs:43` (`$SHELL`), `pty.rs:169` (`-l`), `portable-pty` trong `Cargo.toml`                                                                                                                                                                                                                                                                                                                                 | PRINCIPLES, BUSINESS-FLOW, ARCHITECTURE                    |
| **0008** | Local by default (no telemetry)          | principle | **S**       | Không có network call nào trong production path: `grep -rn "fetch(\|http://\|https://\|reqwest\|axios" src src-tauri/src` chỉ ra `src/terminal/ime-trace.ts:10,21` (POST tới `127.0.0.1:8792`) — và nó bị chặn sau `import.meta.env.DEV` tại `src/terminal/pane.ts:213-217`, không vào production build. Persist toàn bộ qua `plugin-store` local                                                                            | PRINCIPLES, BUSINESS-FLOW                                  |
| **0009** | MIT / open source                        | principle | **S**       | `LICENSE` dòng 1 = "MIT License"                                                                                                                                                                                                                                                                                                                                                                                             | PRINCIPLES                                                 |
| **0010** | Session restore = layout chrome, not CWD | principle | **R**       | Cùng bằng chứng 0002. `CONTEXT.md:67-69` (root) thừa nhận "Session restore (removed in 0.4.0)" nhưng ADR vẫn `active` và vẫn nằm trong `derived_from` của PRD/BF/ARCH/REQ                                                                                                                                                                                                                                                    | PRINCIPLES, PRD, BUSINESS-FLOW, ARCHITECTURE, REQUIREMENTS |
| **0011** | Product intent: parallel multi-agent     | product   | **?**       | Là product stance, không có claim kiểm chứng được bằng code. Các hệ quả cụ thể của nó nằm ở 0012–0019                                                                                                                                                                                                                                                                                                                        | PRD                                                        |
| **0012** | Multi-window workspace model             | product   | **NB**      | `grep -rn "WebviewWindow" src` → rỗng (chỉ có trong `pty.rs:13,147` như tham số Rust). `src-tauri/tauri.conf.json:14` khai báo đúng 1 window. `menu.rs` chỉ có `quit` / `new_preset` / `save_preset` — không có "New Window"                                                                                                                                                                                                 | PRD, BUSINESS-FLOW, ARCHITECTURE, REQUIREMENTS             |
| **0013** | Open board (workspace ∥ preset) + CWD    | product   | **P**       | Có: `src/open-board/open-board.tsx`, built-in preset `presets-store.ts:82`, CWD origin `src/ui/app.tsx:241` (`resolveInheritedCwds(preset.layout, preset.cwds, inherit)`). Lệch: board là **3 phần** (`open-board.tsx:41` `BoardSection = "workspace" \| "layout" \| "agent"`), không phải 2 field song song; trigger "New Window" không tồn tại, board mở cho New Tab (`tab-manager.ts:535-537`) và là entry point duy nhất | PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS                |
| **0014** | Agent picker + agent-state recognition   | product   | **R** (nửa) | Nửa picker **removed**: `src/agent-picker/{agent-picker.ts,picker-store.ts,skip-all-bar.tsx}` bị xoá tại `1b5eff0`. `grep -rni "skip all\|skipAll" src` → không còn. Thay bằng chọn agent trên board + gõ `<agent>\r` (`src/terminal/agent-launch.ts`). Nửa recognition **shipped**: `agents.rs:15`, `process-info.ts:17-19`, `pty_info`                                                                                     | PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS                |
| **0015** | Layout presets: artifact, mock, CRUD     | product   | **S**       | `presets-store.ts:53` (save), `:60` (rename), `:67` (delete); `save-preset-dialog.tsx:7,30-31,74-78` (overwrite); `preset-editor.tsx:91,113-116` (mock → `onCreate`); `app.tsx:382` mở tab mới                                                                                                                                                                                                                               | PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS                |
| **0016** | Pane swap + cross-window move            | product   | **P**       | Swap **có**: `split-tree.ts:148` `swapLeaves`, `terminal-manager.ts:451-455`, `pane-drag.ts:93,163-164,237` (center drop zone qua `metaKey`). Cross-window move **không có**: không UI, không call site. Busy-guard đúng phạm vi: `close-coordinator.ts:39,62` chỉ ở close                                                                                                                                                   | PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS                |
| **0017** | File sidebar: Cmd+click preview + diff   | product   | **NB**      | `git log --all -S'FileSidebar'` → 0 commit; `-S'file-sidebar'` → 0 commit; `grep -rn "FileSidebar" src` → rỗng. ⌘+click hiện đi thẳng ra editor: `link-provider.ts:49` → `link-client.ts:31-32` → `open_editor`                                                                                                                                                                                                              | PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS                |
| **0018** | v1 distribution: unsigned                | product   | **S**       | `tauri.conf.json:42` `"signingIdentity": "-"`; `README.md:106-107` tài liệu hoá bước Gatekeeper (`xattr -cr`)                                                                                                                                                                                                                                                                                                                | PRD, BUSINESS-FLOW, REQUIREMENTS                           |
| **0019** | v1 scope boundaries                      | product   | **P**       | Các mục "out" đều đúng (không SSH, không embed agent UI, không sidebar editing, không ship-gate ký). Nhưng mục "Persisting CWDs or running processes inside `session.json`" đã mất đối tượng — `session.json` không còn tồn tại                                                                                                                                                                                              | PRD                                                        |
| **0020** | Pane-id ≡ PTY id                         | arch      | **S**       | `pty.rs:146-154` `spawn_shell → Result<u32>`; `split-tree.ts:262` `serializeTree` (strip id), `:285` `treeFromLayout`, `:126` `replaceLeaf`, `:148` `swapLeaves`                                                                                                                                                                                                                                                             | ARCHITECTURE, REQUIREMENTS                                 |
| **0021** | Preset persistence: `presets.json`       | arch      | **S**       | `src/presets/presets-store.ts:15` `const STORE_FILE = "presets.json"`; built-in code-defined `presets-store.ts:4,82`                                                                                                                                                                                                                                                                                                         | ARCHITECTURE, REQUIREMENTS                                 |
| **0022** | Sidebar data plane: Rust reads + git     | arch      | **NB**      | `grep -rn "read_file_preview\|git_diff" src src-tauri/src` → rỗng. `git log --all -S'read_file_preview'` → 3 commit, **tất cả chỉ chạm `docs/`** (`a0929b5`, `b23f83d`, `05ec84f`); `git_diff` giống hệt. Chưa từng có trong code                                                                                                                                                                                            | ARCHITECTURE, REQUIREMENTS                                 |
| **0023** | Agent PATH detect: allowlist + spawn     | arch      | **P**       | Có: `agents.rs:15` allowlist, `agents.rs:106` `detect_agents`, dùng ở `open-board.tsx:106` và `pty-client.ts:80`. Lệch: "Picker options = detected + Shell only + Skip all" và "one-shot per materialization" không còn (xem 0014); "spawn immediately" thực tế là **gõ vào shell tương tác** sau khi shell sẵn sàng (`agent-launch.ts`), không phải spawn từ Rust                                                           | ARCHITECTURE, REQUIREMENTS                                 |
| **0024** | Signals / module-store multi-window      | arch      | **P**       | Có: per-webview signals, `plugin-store`, PTY không đi qua signals (`pty.rs:259-285` → `TerminalManager`). Không có: `grep -rn "settings-changed\|presets-changed" src src-tauri/src` → **rỗng**; `session.json` aggregation đã removed                                                                                                                                                                                       | ARCHITECTURE                                               |
| **0025** | v1 stack: Tauri 2 + Preact + xterm.js    | arch      | **S**       | `package.json:15-26`: `@preact/signals ^2.9.2`, `preact ^10.29.3`, `@xterm/xterm ^6.0.0` + fit/search/unicode, `@tauri-apps/plugin-{store,dialog,notification,opener}`. Lưu ý: bảng ADR không liệt kê `plugin-notification` và `plugin-opener` (thêm sau, đúng tinh thần "revisable")                                                                                                                                        | ARCHITECTURE                                               |
| **0026** | Flat visual identity                     | arch      | **P**       | `src/styles.css` dùng đúng token; nhưng `docs/DESIGN-LANGUAGE.md:173-183` tự khai 3 chỗ chưa tuân thủ (`.tab-popover__label`, `.search-bar` box-shadow, các `.is-selected`)                                                                                                                                                                                                                                                  | UX-DESIGN                                                  |
| **0027** | Agent attention signals + per-pane ack   | product   | **S**       | `src/terminal/agent-attention.ts:258` tracker, `:469` `acknowledge`; `keymap.ts:75` `focus-next-attention` (`⌘⇧A`); `ui/agent-attention-mark.tsx` dùng ở `tab-bar.tsx:97` + `workspace-logo.tsx:72`; `agent-notifier.ts`; `settings-schema.ts:20,55` `agentNotifications` mặc định `false`; `attention-focus-coordinator.ts` preflight                                                                                       | PRD, BUSINESS-FLOW, ARCHITECTURE, UX-DESIGN, REQUIREMENTS  |

**Hai ca `unknown`:**

- **0011** (product intent) — thuần stance, không sinh claim kiểm chứng được. Không phải lỗ hổng.
- **0006** phần "các surface net-new cần cả pointer lẫn keyboard" — không thể xác minh phần nói về sidebar / move popover vì chúng chưa tồn tại. Phần verify được đã ghi ở bảng.

---

## 2. Đoạn doc mô tả sai thực tế

Chỉ liệt kê những đoạn nói **ở thì hiện tại** về thứ không có trong code tại `80945a9`. Không liệt kê những đoạn tự đánh dấu "net-new / v1 gap" — chúng đã trung thực sẵn.

### 2.1 `CONTEXT.md` (root — ngôn ngữ miền)

| Dòng  | Trích                                                                                                                    | Thực tế                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 8     | "Multi-window là v1 scope: panes can move between windows; each window's layout chrome participates in session restore." | Không có multi-window (ADR 0012 `NB`); session restore đã gỡ (0010 `R`). Cả hai vế đều sai ở thì hiện tại.                                     |
| 67-69 | "**Session restore** (removed in **0.4.0**)"                                                                             | Đúng là đã gỡ, nhưng **sai version**: commit gỡ là `1b5eff0`, bump `0.3.0` → **`0.5.0`**. Không có bản 0.4.0 nào trong lịch sử `package.json`. |
| 91-93 | "**Move to window**: Detach a pane into another OS window … Bidirectional. Does not prompt when busy."                   | Không tồn tại (0016 phần move = `NB`). Mục từ mô tả một hành vi không có.                                                                      |
| 95-97 | "**File sidebar**: Right-hand read-only viewer opened by Cmd+click…"                                                     | Chưa từng tồn tại (0017 `NB`). ⌘+click → `open_editor`.                                                                                        |
| 104   | "Closing the last tab of a window closes that window; closing the last tab of the last window quits the app"             | Code: `tab-manager.ts:712-722` — đóng tab cuối là **quit ngay**, không có tầng window.                                                         |

### 2.2 `docs/CONTEXT.md` (working context)

| Dòng | Trích                                        | Thực tế                                                                                                      |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 12   | "Currently `0001–0026` are all active"       | Có 27 ADR — thiếu 0027 (thêm 2026-07-24).                                                                    |
| 31   | "all **45 FR + 9 NFR** IDs carried over 1:1" | `REQUIREMENTS.md` hiện có **50 FR** + 9 NFR (E9 thêm FR-080…FR-084).                                         |
| 43   | "## Code state (`60ebe99`)"                  | `60ebe99` là 2026-07-10; HEAD là `80945a9` (2026-07-25). Mô tả "seams actively landing" đã lỗi thời 15 ngày. |
| 61   | "`docs/REQUIREMENTS.md` (45 FR + 9 NFR …)"   | Như dòng 31.                                                                                                 |

### 2.3 `docs/PRD.md`

| Dòng  | Trích                                                                                                                                             | Thực tế                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 42    | "If there is no restorable session (or restore is off / this is a new window)…"                                                                   | Không có session restore, không có New Window. Điều kiện mô tả không tồn tại. |
| 45    | "Each pane shows an **agent picker** … **Skip all** leaves unpicked panes as idle shells"                                                         | Picker đã bị gỡ (`1b5eff0`). Agent chọn trên board trước khi materialize.     |
| 48-51 | Toàn bộ mục "Resume — open the app again" (restore layout chrome + one-shot picker)                                                               | Cả hai đều không còn.                                                         |
| 56    | "User **moves a pane to a new window** or **joins it back**"                                                                                      | `NB`.                                                                         |
| 57    | "Closing the last tab of one window closes that window"                                                                                           | Code quit ngay.                                                               |
| 67-71 | Mục "Inspect — file from the CLI" (sidebar preview + diff)                                                                                        | `NB`.                                                                         |
| 76    | "(separate artifact from `session.json`)"                                                                                                         | `session.json` không tồn tại.                                                 |
| 85-86 | Scope In: "**Multi-window** … persist and restore chrome for **all** windows"; "**Open board** … always on New Window / no session / restore off" | `NB` / không còn.                                                             |
| 88-90 | Scope In: "**Post-layout / post-restore agent picker**"; "**File sidebar**"; "Session restore remains layout chrome only"                         | Lần lượt `R`, `NB`, `R`.                                                      |
| 105   | Scope Out: "Persisting CWDs or running processes inside `session.json`"                                                                           | Mất đối tượng.                                                                |
| 117   | Brownfield note: "Shipped today: … **session chrome restore** …"                                                                                  | Sai — đã gỡ. (Phần "Not shipped" của dòng này thì đúng.)                      |

### 2.4 `docs/BUSINESS-FLOW.md`

| Dòng    | Trích                                                                                  | Thực tế                                                                 |
| ------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 18      | Cold launch "may load persisted multi-window session chrome"                           | Không có.                                                               |
| 19      | Open board "Entered on New Window, missing/disabled session restore, or empty session" | Không có New Window / restore; board là entry point duy nhất + New Tab. |
| 21      | Quitting "after last window is gone"                                                   | Quit khi đóng tab cuối.                                                 |
| 25-29   | Toàn bộ bảng **Window** states (Open-board window / Active window / Closing)           | Không có tầng window.                                                   |
| 36      | Tab state "**Agent-pick pending**"                                                     | Trạng thái không còn tồn tại.                                           |
| 37      | Live state "… swap, drag-dock, **move across windows**"                                | move across windows `NB`.                                               |
| 47      | Pane state "**Picker**"                                                                | Không còn.                                                              |
| 75-82   | Toàn bộ bảng **Sidebar** states                                                        | `NB`.                                                                   |
| 96-97   | Rule 2, 3 (relaunch + restore)                                                         | Không còn.                                                              |
| 104     | Rule 7 "Session restore spawn CWD = `$HOME` … presets do not rewrite `session.json`"   | Mất đối tượng.                                                          |
| 108-114 | Rules 10-14 (agent picker, Skip all, one-shot)                                         | `R`.                                                                    |
| 118     | Rule 15 "separate persisted artifact from `session.json`"                              | Mất đối tượng (bản thân `presets.json` thì đúng).                       |
| 127-128 | Rule 21, 22 (move to new window / join)                                                | `NB`.                                                                   |
| 131-132 | Rule 25, 26 (close last tab → close window)                                            | Code quit ngay.                                                         |
| 136-140 | Rules 27-31 (sidebar)                                                                  | `NB`.                                                                   |
| 164     | Inv 2 "`session.json` … never persists pane CWDs"                                      | Mất đối tượng.                                                          |
| 168     | Inv 6 "restore path never skips the one-shot agent picker"                             | Cả hai vế không còn.                                                    |
| 169     | Inv 7 "App quit ⟺ no windows left"                                                     | Code: quit ⟺ no tabs left.                                              |

### 2.5 `docs/ARCHITECTURE.md`

Doc này đã có **note "0.4.0 supersede"** ở dòng 27-37 — đây là nỗ lực trung thực duy nhất trong nhóm doc phái sinh. Nhưng note đó **không nhất quán với chính thân doc**:

| Dòng    | Trích                                                                                                                                                                                                             | Vấn đề                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| 27-37   | Note "0.4.0 supersede"                                                                                                                                                                                            | Nhắc version **0.4.0** trong khi commit gỡ bump lên **0.5.0** (`1b5eff0`). Note này cũng không phải ADR — nó là một supersede ghi ngoài log quyết định, đúng thứ mà `CONTEXT.md:50-55` cấm. |
| 48      | Persist row: "`settings.json`, `presets.json`, `workspaces.json`, `logo.json` (no `session.json` — 0.4.0)"                                                                                                        | Đúng thực tế, nhưng mâu thuẫn trực tiếp với §4 seam 5 và §7/§8 bên dưới.                                                                                                                    |
| 82      | `info.rs` — "(v1) `read_file_preview`, `git_diff`, `detect_agents`"                                                                                                                                               | `detect_agents` thực tế nằm ở `src-tauri/src/agents.rs:106`, không phải `info.rs`. Hai cái còn lại `NB`.                                                                                    |
| 84      | "(v1) `window.rs` optional: WebviewWindow lifecycle"                                                                                                                                                              | Coordinator thực tế nằm ở `coordinator.rs`, không phải `window.rs`. Tên file trong doc không tồn tại.                                                                                       |
| 94      | Module map liệt kê `open-board/, presets/, **sidebar/**`                                                                                                                                                          | `src/sidebar/` không tồn tại. (`src/ui/workspace-sidebar.tsx:36` là "vertical workspace list", một thứ khác hoàn toàn.)                                                                     |
| 109     | §4 seam 5: "**`session.json` = chrome + `workspacePath`** … Restore spawns every pane…"                                                                                                                           | Mô tả ở thì hiện tại một artifact đã bị xoá. Mâu thuẫn với note đầu doc.                                                                                                                    |
| 150-172 | D3 toàn bộ (SessionData v2, migration v1→v2)                                                                                                                                                                      | Chưa từng tồn tại; v1 flat thì đã bị xoá.                                                                                                                                                   |
| 217-232 | D6 "Picker options = detected agents + Shell only + Skip all"                                                                                                                                                     | `R`.                                                                                                                                                                                        |
| 239     | D7 "writer emits app-wide events (`settings-changed`, `presets-changed`)"                                                                                                                                         | `grep` → rỗng. Chưa build.                                                                                                                                                                  |
| 284-305 | Data flow "Open → materialize → picker" và "Session restore-all"                                                                                                                                                  | Cả hai flow không còn.                                                                                                                                                                      |
| 327-337 | Data flow "Cmd+click → sidebar"                                                                                                                                                                                   | `NB`. Flow thật: `link-provider.ts:49` → `open_editor`.                                                                                                                                     |
| 371     | §7 State ownership: "Session chrome                                                                                                                                                                               | `session.json` v2                                                                                                                                                                           | Disk" | Mâu thuẫn với §8 dòng 386 (`~~Session~~ … removed in 0.4.0`) trong cùng một doc. |
| 373     | §7: "Agent picker pending                                                                                                                                                                                         | Per-pane ephemeral UI flag"                                                                                                                                                                 | `R`.  |
| 386     | §8: "removed in 0.4.0"                                                                                                                                                                                            | Sai version (xem trên).                                                                                                                                                                     |
| 397     | §9 Shipped commands — bảng thiếu `detect_agents`, `dirs_exist`, `read_image_as_data_url`, `scan_workspace_favicon`, `resolve_paths`, `open_editor`, `move_pane_ownership` (tất cả đều đã có trong `lib.rs:37-52`) | Bảng "shipped" lỗi thời; `detect_agents` và `move_pane_ownership` bị xếp nhầm vào "net-new" ở dòng 412, 415.                                                                                |

### 2.6 `docs/UX-DESIGN.md`

| Dòng    | Trích                                                              | Thực tế                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 49-127  | §2 Open board — "Two parallel columns"                             | Board thật có **3 phần** (`open-board.tsx:41`): workspace sidebar / logo panel / cột phải xếp chồng recents → preset → agent. ASCII mockup ở dòng 59-75 không khớp UI hiện tại. |
| 53      | "Shown on New Window, on launch with restore off / no session"     | Không tồn tại.                                                                                                                                                                  |
| 119     | "Immediately after, each pane enters the **agent picker** (§4)"    | `R`.                                                                                                                                                                            |
| 207-263 | §4 Agent picker — toàn bộ section (overlay, Skip all bar, số hint) | `R`. Đây là section dài nhất mô tả một surface đã bị xoá khỏi code.                                                                                                             |
| 266-321 | §5 File sidebar — toàn bộ section                                  | `NB`.                                                                                                                                                                           |
| 341-344 | §6 "Keyboard — swap with neighbor. `⌘⌥⇧` + arrows"                 | `keymap.ts:77-80` chỉ có `⌘⌥`+arrow (focus). Không có biến thể shift. Chưa build.                                                                                               |
| 346-382 | §6 "Move a pane to another window" + popover mockup                | `NB`.                                                                                                                                                                           |
| 388     | §7 "the agent picker is the only surface that auto-appears"        | `R`.                                                                                                                                                                            |
| 393     | §7 "separate from `session.json` (chrome only — BF-Inv 2)"         | Mất đối tượng.                                                                                                                                                                  |
| 416-525 | §9 Agent attention rail                                            | **Chính xác** — khớp code (`agent-attention-mark.tsx`, `tab-bar.tsx:97`, `workspace-logo.tsx:72`, `keymap.ts:75`). Section này là mẫu đối chiếu tốt.                            |

### 2.7 `docs/REQUIREMENTS.md`

Đây là doc rủi ro cao nhất: nó tự tuyên bố ở dòng 800 rằng "the handoff to `superpowers:writing-plans` carries **no staleness warnings**" — trong khi 3 trong 9 epic mô tả thứ không tồn tại.

| Dòng    | Đơn vị                         | Trạng thái                                                                                                                                              |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 54      | Epic index E6 `session`        | Toàn epic mất đối tượng.                                                                                                                                |
| 63-73   | FR-001 AC-2, AC-3, AC-4        | Nhắc "session restore disabled/enabled" và "restore path". Không tồn tại.                                                                               |
| 75-87   | FR-002                         | "two parallel columns" — board thật 3 phần.                                                                                                             |
| 111-121 | FR-005 AC-3                    | "every pane enters agent-pick pending (FR-021)" — `R`.                                                                                                  |
| 219-287 | **Toàn bộ E3** (FR-020…FR-026) | FR-020 (`detect_agents`) `S`; FR-021…FR-026 (picker, Skip all, number hints) `R`.                                                                       |
| 315-323 | FR-032                         | `⌘⌥⇧`+arrow swap — chưa build.                                                                                                                          |
| 325-366 | FR-033…FR-036                  | Move popover — `NB`.                                                                                                                                    |
| 382-390 | FR-041                         | Window close kills only owned PTYs — `NB` (`coordinator.rs:48` còn `dead_code`).                                                                        |
| 392-400 | FR-042 AC-1                    | "Closing the last tab of a window closes that window; the app keeps running if other windows remain" — code làm ngược (`tab-manager.ts:712`).           |
| 402-409 | FR-043                         | `settings-changed` / `presets-changed` — chưa build.                                                                                                    |
| 413-462 | **Toàn bộ E6** (FR-050…FR-053) | `R`. FR-054 (closed-tab in-memory) thì vẫn `S`.                                                                                                         |
| 466-536 | **Toàn bộ E7** (FR-060…FR-066) | `NB`.                                                                                                                                                   |
| 640     | NFR-002 AC-2                   | "All v1 persistence targets local files (`settings.json`, `session.json`, `presets.json`)" — thiếu `workspaces.json`, `logo.json`; thừa `session.json`. |
| 648     | NFR-003 AC-1                   | Viện dẫn FR-026/FR-033/FR-066 — các FR của surface không tồn tại.                                                                                       |
| 695     | NFR-008 AC-2                   | "Session chrome restore semantics remain layout-chrome-only (ADR 0010 stays in force)" — không còn session chrome nào để giữ.                           |
| 713-758 | Bảng coverage BF-Rule → FR     | Ánh xạ tới các FR đã chết; bảng cho cảm giác phủ 100%.                                                                                                  |
| 800     | Handoff note                   | "carries no staleness warnings" — đây là câu nguy hiểm nhất trong toàn bộ `docs/`.                                                                      |

### 2.8 `docs/PRINCIPLES.md`

`derived_from: [0004, 0005, 0006, 0007, 0008, 0009, 0010]` — chứa 0010 (`R`). File chỉ 17 dòng nên chưa thấy câu nào sai ở thì hiện tại, nhưng nguyên tắc "session restore = layout chrome" vẫn được liệt kê như một non-negotiable đang có hiệu lực.

---

## 3. Đề xuất ADR supersede

Không ghi đè ADR nào. Dưới đây là **phác thảo nội dung** cho các ADR mới; số hiệu là gợi ý theo thứ tự append.

### 3.1 ADR 0028 — Session restore removed; Open board is the sole entry point

```yaml
id: 0028
title: "Session restore removed; Open board is the sole entry point"
date: <ngày ghi>
kind: principle
affects: [PRINCIPLES, PRD, BUSINESS-FLOW, ARCHITECTURE, REQUIREMENTS]
supersedes: [0002, 0010]
```

**Context.** ADR 0010 giữ session restore ở mức layout chrome; ADR 0002 định hình `session.json` v2 đa cửa sổ. Trên thực tế commit `1b5eff0` (v0.5.0, 2026-07-15) đã xoá `session-schema.ts`, `session-persistence.ts` và `settings.restoreTabs`; `session.json` không còn được ghi hay đọc. Việc này chưa từng được ghi nhận bằng ADR, nên PRD/BUSINESS-FLOW/ARCHITECTURE/REQUIREMENTS vẫn render session restore ở thì hiện tại.

**Decision.** Stackgrid không persist hay restore tab/pane qua các lần khởi động. Open board là entry point duy nhất (và là màn hình của New Tab). Người dùng mở lại folder bằng tay từ Recents (`workspaces.json`). Chỉ settings, layout presets, workspace recents và app logo persist. Closed-tab stack (`⌘⇧T`) sống trong bộ nhớ theo phiên.

**Consequences.** ADR 0002 và 0010 rời khỏi tập active. `derived_from` của PRD/BF/ARCH/REQ phải bỏ 0002/0010 và thêm 0028, rồi re-render. Note "0.4.0 supersede" ở `ARCHITECTURE.md:27-37` được thay bằng tham chiếu tới ADR này (và sửa version thành 0.5.0). Epic E6 trong REQUIREMENTS bị rút; FR-050…FR-053 retire, FR-054 giữ nguyên.

**Options rejected.** Giữ 0002/0010 active và chỉ ghi chú trong doc phái sinh — đúng thứ đang gây ra drift này.

### 3.2 ADR 0029 — Agent chosen on the board and typed into the shell; per-pane picker removed

```yaml
id: 0029
title: "Agent chosen on the Open board and typed into the shell; per-pane picker removed"
date: <ngày ghi>
kind: product
affects: [PRD, BUSINESS-FLOW, UX-DESIGN, REQUIREMENTS, ARCHITECTURE]
supersedes: [0014, 0023]
```

**Context.** ADR 0014 quy định picker một lần cho mỗi pane sau materialize/restore, kèm "Skip all"; ADR 0023 cố định cơ chế detect + "spawn immediately". Commit `1b5eff0` xoá cả `src/agent-picker/`. Agent giờ được chọn **trước** khi materialize, ngay trên board, và được **gõ** (`<agent>\r`) vào shell tương tác khi shell in byte đầu tiên (`src/terminal/agent-launch.ts`) — không spawn từ Rust, vì `$SHELL -lc` làm mất `$PATH` đúng.

**Decision.** Một lựa chọn agent cho cả board, áp cho mọi pane của tab được materialize. `Shell only` không gõ gì. Mỗi pane chỉ được gõ đúng một lần; ghi thất bại để nguyên pane thành shell thường. Closed-tab reopen không launch lại agent. Allowlist `claude`/`codex`/`gemini` + `detect_agents` (`src-tauri/src/agents.rs`) được giữ nguyên từ 0023 và mang sang ADR này.

**Consequences.** Bỏ trạng thái "Agent-pick pending", "Picker", rule BF 10-14, invariant BF-Inv 6, UX §4, epic E3 (trừ FR-020). Phần agent-state recognition của 0014 (Busy / Agent-styled) được giữ lại nguyên văn trong ADR mới để không mất quyết định đó khi 0014 rời tập active.

**Options rejected.** Chỉ supersede 0014 mà giữ 0023 — 0023 mô tả picker options và "spawn immediately", cả hai đều sai; phải đi cùng nhau.

### 3.3 ADR 0030 — Single-window v1; multi-window deferred

```yaml
id: 0030
title: "Single-window v1; multi-window and cross-window move deferred"
date: <ngày ghi>
kind: product
affects: [PRD, BUSINESS-FLOW, ARCHITECTURE, UX-DESIGN, REQUIREMENTS]
supersedes: [0012]
```

**Context.** ADR 0012 tuyên bố v1 là multi-window. Sau 17 ngày kể từ ADR, `tauri.conf.json` vẫn khai báo đúng một window, không có "New Window" trong menu, không có `WebviewWindow` nào được tạo từ frontend, và `WindowCoordinator::panes_for_window` vẫn mang `#[allow(dead_code)] // used when multi-window close lands`. Trong khi đó `tab-manager.ts:712` quit app khi đóng tab cuối — semantics single-window mà ADR 0003 cấm.

**Decision.** v1 là single-window. Đóng tab cuối = quit app (busy guard vẫn chạy trước). Cross-window move và "Move pane to…" popover chuyển sang "Later". Seam coordinator trong Rust (`coordinator.rs`) **được giữ** như hạ tầng cho tương lai và vì nó đã cải thiện việc route event; nó không phải là cam kết multi-window của v1.

**Consequences.** ADR 0003 (quit routing) trở nên vô đối tượng ở tầng window — cần quyết định: hoặc ADR này supersede luôn 0003, hoặc 0003 được giữ như quyết định cho tương lai. **Đây là điểm cần người quyết** (xem §5). Epic E5 rút còn FR-040; E4 rút còn FR-030…FR-032. UX §6 rút phần popover.

**Options rejected.** Giữ 0012 active và đánh dấu "chưa build" trong doc — không phản ánh việc code đã đi theo hướng ngược lại (quit-on-last-tab).

### 3.4 Không đề xuất supersede cho 0017 / 0022 (file sidebar)

Đây là ca **`never-built`, không phải `contradicted`**: chưa có gì trong code đi ngược lại quyết định. Đúng cách xử lý là gắn trạng thái "chưa build" (xem §4), không phải supersede. Supersede ở đây sẽ đồng nghĩa với "quyết định bỏ tính năng" — một quyết định sản phẩm mà audit này không có thẩm quyền đưa ra.

Cùng lý do cho các phần `partial` của 0001, 0016, 0024, 0026, và cho 0006.

---

## 4. Đề xuất cơ chế chống trôi

Vấn đề gốc: ADR viết ở thì hiện tại, doc phái sinh render lại cũng ở thì hiện tại, và **không có trường nào phân biệt "đã quyết" với "đã build"**. `DESIGN-LANGUAGE.md:173-183` là chỗ duy nhất trong repo giải được bài này — bằng một bảng liệt kê thẳng cái chưa tuân thủ, kèm câu "do not fix opportunistically". Bốn cách tổng quát hoá nó, kèm đánh đổi:

### Phương án A — Thêm trường `status` vào frontmatter ADR

```yaml
status: decided | building | shipped | superseded
status_evidence: "src-tauri/src/agents.rs:15"
status_checked: 2026-07-26
```

- **Được**: một nguồn duy nhất; renderer có thể tự chèn nhãn "(chưa build)" vào mọi câu render từ ADR chưa shipped; `docs-check` có thể so `status` với `grep` thật.
- **Mất**: **phá tính bất biến của ADR** — `CONTEXT.md:50-55` quy định ADR append-only, mà `status` thì buộc phải sửa tại chỗ. Đây là mâu thuẫn kiến trúc, không phải chi tiết kỹ thuật.
- **Biến thể giảm đau**: để `status` ra một file riêng `docs/decisions/STATUS.yml` (map `id → status/evidence/checked`), ADR vẫn bất biến. Đổi lại mất tính "một file một quyết định".

### Phương án B — Mục "Reality gap" cố định ở mỗi doc phái sinh

Mỗi doc render thêm một section bắt buộc ở cuối, đúng kiểu `DESIGN-LANGUAGE.md` §10:

```markdown
## N. Reality gap (what this document describes but the code does not do)

| Section         | ADR  | Trạng thái  | Bằng chứng                          |
| --------------- | ---- | ----------- | ----------------------------------- |
| §4 Agent picker | 0014 | removed     | `1b5eff0` xoá `src/agent-picker/`   |
| §5 File sidebar | 0017 | never-built | `git log --all -S'FileSidebar'` → 0 |
```

- **Được**: không đụng ADR; đã có tiền lệ trong repo và tiền lệ đó chứng minh là đọc được; người đọc thấy cảnh báo ở cùng file với nội dung sai.
- **Mất**: bảng phải cập nhật thủ công mỗi lần render; dễ chính nó bị trôi (`ARCHITECTURE.md:27-37` là ví dụ sống — note supersede đó đã sai version và mâu thuẫn với thân doc).

### Phương án C — Đổi thì của văn bản render

Renderer sinh câu theo `status`: shipped → thì hiện tại ("Cmd+click opens a sidebar"); chưa build → thể tương lai/điều kiện ("v1 will open a sidebar" / "Decision: … — not yet implemented").

- **Được**: sửa đúng nguyên nhân gốc (thì hiện tại gây ngộ nhận), không cần bảng phụ, không đụng ADR.
- **Mất**: phải sửa toàn bộ prose 6 doc; và vẫn cần một nguồn `status` — tức là phải đi kèm A hoặc B, không đứng một mình.

### Phương án D — `docs-check` có kiểm chứng bằng code

Mở rộng skill `docs-check` hiện tại (nay chỉ so tập `derived_from` với tập active) thành: mỗi ADR khai một **probe** kiểm chứng được (`grep` pattern, tên file, hoặc lệnh git), CI chạy probe và fail khi `status` khai không khớp thực tế.

- **Được**: là cơ chế duy nhất **không thể tự trôi** — nó đo code chứ không đo doc. Sẽ bắt được cả 4 ca `R`/`C` ở audit này ngay ngày chúng xảy ra.
- **Mất**: chi phí xây cao nhất; probe cũng cần bảo trì (đổi tên symbol → probe gãy giả); và `CONTEXT.md:28-30` ghi rõ hook đã **bị bỏ có chủ ý** ("no `on-render` / freeze hook was wired for v2 — user choice"), nên phương án này đi ngược một lựa chọn đã có.

### Gợi ý phối hợp

**B + C** là tổ hợp rẻ nhất mà đủ: bảng "Reality gap" cho cảnh báo tại chỗ, đổi thì cho phần chưa build để câu văn tự nó không nói dối. **A (biến thể `STATUS.yml`)** nếu muốn một nguồn máy đọc được mà vẫn giữ ADR bất biến. **D** chỉ đáng làm nếu chấp nhận đảo lại quyết định "không hook" — và nếu làm, nó thay thế được phần lớn công sức bảo trì của B.

Một việc rẻ và độc lập với cả 4: sửa `REQUIREMENTS.md:800` — bỏ câu "carries no staleness warnings". Câu đó biến một doc đã trôi thành một doc **tự chứng nhận là không trôi**, và nó là input contract cho planning.

---

## 5. Việc cần người quyết — xếp theo rủi ro nếu để nguyên

### R1 — `REQUIREMENTS.md` tự tuyên bố không có staleness, trong khi 3/9 epic mô tả thứ không tồn tại

**Rủi ro cao nhất.** Đây là input contract cho `superpowers:writing-plans`. Một phiên planning đọc file này sẽ sinh task cho FR-021…FR-026 (picker đã xoá), FR-050…FR-053 (session đã xoá), FR-060…FR-066 (sidebar chưa từng có) — và tin rằng chúng chưa làm chứ không phải đã bị bỏ.
**Quyết định cần**: sửa dòng 800 ngay (rẻ, không cần ADR), hay chờ re-render sau khi các ADR ở §3 landed?

### R2 — ADR 0003 vs `tab-manager.ts:712` — quy tắc quit đang bị code làm ngược

Hiện vô hại vì chỉ có một window, nhưng ADR nói rõ "implementers must not treat `tabs.length === 0` as app quit". Nếu multi-window được làm sau mà không ai đọc lại, đây là bug nuốt agent đang chạy ở window khác.
**Quyết định cần**: ADR 0030 (§3.3) có supersede luôn 0003 không, hay 0003 giữ nguyên như quyết định cho lúc multi-window landed? Nếu giữ, cần một dòng trong bảng Reality gap của BUSINESS-FLOW nói rõ code hiện chưa tuân thủ.

### R3 — Ba ADR `removed` vẫn nằm trong tập active và trong `derived_from` của 5 doc

0002, 0010, 0014 vẫn là "nguồn sự thật" cho PRD/BF/ARCH/REQ/UX. Mọi lần re-render từ nay sẽ **tái tạo lại chính những đoạn sai** đã liệt kê ở §2 — drift tự phục hồi.
**Quyết định cần**: duyệt nội dung 3 ADR supersede ở §3, và thứ tự re-render (phase order: PRINCIPLES → PRD/BF → ARCH/UX → REQ).

### R4 — `ARCHITECTURE.md` tự mâu thuẫn trong cùng một file

Dòng 48 và 386 nói `session.json` đã bị gỡ; dòng 109, 150-172, 371 mô tả nó ở thì hiện tại. Một người đọc lấy đoạn nào tuỳ chỗ họ mở file.
**Quyết định cần**: xoá note 0.4.0 (dòng 27-37) và thay bằng tham chiếu ADR 0028, hay giữ note và sửa cho nhất quán trước khi có ADR?

### R5 — Sai version "0.4.0" lan ra 3 file

`CONTEXT.md:67`, `ARCHITECTURE.md:27,386`. Commit gỡ session là `1b5eff0`, bump `0.3.0` → `0.5.0`. Không có bản 0.4.0 trong lịch sử `package.json`.
**Quyết định cần**: sửa thành 0.5.0 ở cả 3 chỗ (thuần sự kiện, chắc là không cần bàn — nhưng nó nằm trong doc phái sinh nên đụng vào là đụng quy trình render).

### R6 — `docs/CONTEXT.md` lỗi thời ở 4 điểm

ADR active `0001–0026` (thiếu 0027), "45 FR" (thực tế 50), code state trỏ `60ebe99` (2026-07-10, cách HEAD 15 ngày). File này là thứ agent đọc đầu tiên khi vào repo.
**Quyết định cần**: cập nhật ngay hay gộp vào lần re-render sau ADR?

### R7 — Chọn cơ chế chống trôi

Không cấp bách như R1-R3, nhưng nếu không chọn thì audit này sẽ phải lặp lại sau vài tháng.
**Quyết định cần**: B+C, A-biến-thể, hay D (kèm đảo lại quyết định "không hook" ở `CONTEXT.md:28-30`)?

### R8 — Tên module trong `ARCHITECTURE.md` §3 không khớp cây thật

`info.rs` được gán `detect_agents` (thật ra ở `agents.rs`), `window.rs` không tồn tại (thật ra `coordinator.rs`), `src/sidebar/` không tồn tại. Bảng "Shipped commands" §9 thiếu 7 command đã có trong `lib.rs:37-52`.
**Quyết định cần**: đây là drift thuần mô tả (không phải quyết định sai) — sửa trong lần re-render ARCHITECTURE hay tách một pass riêng?

---

## Phụ lục — các lệnh đã chạy

```bash
grep -H "supersedes:" docs/decisions/*.md | grep -v "supersedes: \[\]"          # → rỗng
git log --all -S'FileSidebar'   --oneline                                       # → 0 commit
git log --all -S'file-sidebar'  --oneline                                       # → 0 commit
git log --all -S'read_file_preview' --oneline                                   # → 3 commit, chỉ chạm docs/
git log --all -S'git_diff'      --oneline                                       # → 3 commit, chỉ chạm docs/
git log --all -S'session-persistence' --oneline                                 # → 4 commit, xoá tại 1b5eff0
git show --stat 1b5eff0 | grep -E "agent-picker|session-"                       # → 8 file bị xoá
grep -rn "settings-changed\|presets-changed" src src-tauri/src                   # → rỗng
grep -rn "WebviewWindow" src                                                    # → rỗng
grep -rn "move_pane_ownership" src                                              # → rỗng (chỉ có phía Rust)
grep -rn "read_file_preview\|git_diff" src src-tauri/src                        # → rỗng
npm test                                                                        # → 53 file / 572 test, pass
```
