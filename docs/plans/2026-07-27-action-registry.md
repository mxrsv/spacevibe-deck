# Action Registry

> **For agentic workers:** REQUIRED SUB-SKILL: dùng `superpowers:subagent-driven-development`
> (khuyến nghị) hoặc `superpowers:executing-plans` để chạy plan này theo từng task. Mỗi task có
> checklist Build/Verify riêng, chạy xong task nào verify ngay task đó trước khi sang task sau.

**Spec**: Không có spec riêng — plan này bám theo brief của team lead (xem lịch sử hội thoại) và tự
xác minh lại toàn bộ bằng chứng bằng cách đọc code trực tiếp. **Cảnh báo cho người thực thi**: repo
này đang có nhiều agent sửa đúng vùng `keymap.ts`/`tab-manager.ts`/`menu.rs` song song — plan được
viết lại lần 2 (2026-07-27) sau khi ba commit mới land ngay trong lúc viết (`1645ac7`, `b7e6021`,
`09f5c4d`, `a6ac532`, xem §1). **Trước khi bắt đầu implement, chạy lại `git log --oneline -8` và đọc
diff của mọi commit mới hơn `a6ac532` — nếu có, dừng và đối chiếu lại plan trước khi code, đừng giả
định code khớp plan.**

**Goal**: Gộp ba (thực ra đang thành bốn) nơi khai báo keyboard shortcut / menu macOS rời rạc —
`ShortcutAction` union + `DEFAULT_KEYMAP` trong `keymap.ts`, bảng `commands` dispatch trong
`tab-manager.ts`, danh sách exception của `overlayBlocksAction` cũng trong `tab-manager.ts`, và
từng `action_item(...)` string literal trong `menu.rs` — thành một **Action Registry** duy nhất:
mỗi action khai báo id/label/scope/vị trí-menu một lần, sinh ra keymap matching và (một phần) menu
macOS lúc build, chừa chỗ cho command palette/cheat sheet/rebind ở plan sau.

**Architecture**: `src/terminal/action-registry.ts` là nguồn dữ liệu thuần (không import Preact,
không import Tauri) — một mảng `ACTION_REGISTRY` cộng danh sách binding mặc định `DEFAULT_KEYMAP`.
`keymap.ts` trở thành lớp mỏng "khớp `KeyboardEvent` với action" phái sinh từ registry.
`tab-manager.ts` đọc `scope` của registry thay vì if-chain cứng để quyết định action nào bị chặn
khi có overlay che terminal. Phía Rust: **codegen lúc build** — một script Node/TS
(`scripts/generate-menu.ts`) đọc `ACTION_REGISTRY` và sinh `src-tauri/src/menu_registry.rs` (file
generated, có commit vào git), chạy tự động trước `npm run dev`/`npm run build` (đã được
`tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand` gọi sẵn) qua npm `predev`/`prebuild`
hook — không cần đổi `tauri.conf.json`. Hai submenu thuần-registry (File, View) được sinh toàn bộ
(label + accelerator + thứ tự + separator); ba submenu pha trộn Cocoa builtin (App, Edit, Window)
vẫn viết tay nhưng có Rust test đối chiếu với const sinh từ registry — chi tiết trade-off ở §5.

**Tech Stack**: TypeScript (registry + keymap + tab-manager, không thư viện mới), một script Node
chạy qua `tsx` (devDependency mới, chỉ dùng cho codegen — không đụng runtime bundle của app),
Rust/Tauri 2 (menu, không thêm crate mới).

## Global Constraints

- Không big-bang: mỗi task tự đứng được, build/test phải xanh ngay sau task đó, không để đỏ chờ
  task sau (đúng tinh thần Task 25 trong `docs/plans/2026-07-23-agent-attention-rail.md` §"Mỗi task
  đổi contract additive phải chạy `npm run build` ngay trong task").
- Không đổi hành vi shipped trừ khi task nói rõ đó là fix một bug cụ thể, có bằng chứng bên dưới.
- IME guard (`event.isComposing`, `event.keyCode === 229` ở `tab-manager.ts` `handleShortcut`) và
  `webkit-ime-fix.ts` không được đụng tới — các guard này chạy TRƯỚC `matchBinding`.
- **Quy tắc chọn `key` vs `code` cho binding mới (quyết định của team lead, áp dụng cho mọi action
  thêm sau này, không chỉ lift lại tiền lệ)**: một action **CÓ mặt trong menu macOS** (có `menu`
  field và một accelerator thật ở `menu.rs`) LUÔN bind theo `event.key` (`CharKeyBinding`) ở
  webview — vì accelerator native tự thân luôn khớp theo KÝ TỰ, không theo vị trí vật lý; nếu
  webview bind theo `code` trong khi menu bind theo ký tự, trên layout không phải QWERTY (rõ nhất
  Dvorak) hai đường sẽ trỏ tới hai phím vật lý khác nhau cho CÙNG một action — phá đúng bất biến
  "item và shortcut không bao giờ lệch nhau" mà `menu.rs:22-28` đang giữ. Một action **KHÔNG có mặt
  trong menu** thì webview là đường duy nhất, và nếu ký tự nó sinh ra phụ thuộc Shift/layout (điển
  hình: các phím dấu) thì bind theo `event.code` (`PhysicalKeyBinding`) mới đúng, vì không có
  accelerator nào cần giữ nhất quán theo. Bốn binding vật lý hôm nay (`focus-next`/`focus-prev`/
  `next-tab`/`prev-tab`) đúng luật này vì cả bốn không có menu item; `=`/`-`/`0`/`,` giữ `key` đúng
  luật vì cả bốn có accelerator ở `menu.rs`. Đây là **luật**, không phải mô tả lịch sử — Task 1 chỉ
  lift đúng kết quả `a6ac532` đã áp dụng, không tự ý "hoàn thiện thêm", nhưng bất kỳ action mới nào
  thêm sau plan này phải theo đúng luật trên, không suy diễn từ tiền lệ.
- `npm run build`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`,
  `cargo check --manifest-path src-tauri/Cargo.toml` phải pass ở cuối mỗi task chạm production
  code (không chỉ ở task cuối).

---

## 1. Bối cảnh — bằng chứng đã tự xác minh lại (2 lần, sau 2 đợt commit song song)

Team lead brief mô tả 3 nơi khai báo song song. Đọc code tại `main` (`5091580`) xác nhận đúng.
**Trong lúc viết plan, bốn commit mới đã land trên `main`** — không phải một đợt, mà HAI đợt cách
nhau trong cùng phiên viết plan này:

**Đợt 1** (đã tính vào bản plan gốc):

- `1645ac7 fix(shortcuts): block terminal/tab/pane actions while an overlay is open` — thêm
  `overlayBlocksAction()` (`tab-manager.ts`), if-chain chặn mọi action trừ vài ngoại lệ khi
  `boardOpen`/`settingsOpen`/`editorRequest`/`saveDialogOpen` đang mở. Docstring của hàm này **tự
  ghi rõ**: _"This is prep for a future action registry (each entry will carry its own scope), so
  it stays a flat function here rather than growing its own data structure."_ — đúng là lời mời cho
  plan này. `fix-overlay-scope` (agent làm commit này) xác nhận trực tiếp qua tin nhắn: field 4
  overlay dùng đúng tên `board/settings/presetEditor/savePresetDialog` như
  `AttentionOverlaySnapshot` (`src/ui/attention-focus-coordinator.ts:16-25`) cho nhất quán, exception
  hardcode ngay trong `overlayBlocksAction`, KHÔNG có structure/enum riêng — khớp thiết kế Task 3
  dưới đây.
- `b7e6021 feat(settings): add ⌘, shortcut and macOS menu item to toggle Settings` (từng có hash
  `a75a247`, lịch sử bị viết lại — nội dung giữ nguyên) — thêm action `toggle-settings` (Cmd+,),
  menu item "Settings…" trong App menu, ngoại lệ thứ tư trong `overlayBlocksAction`.

**Đợt 2** (land SAU KHI bản plan gốc đã viết xong và gửi báo cáo — buộc viết lại phần Task 1/2/3/4):

- `09f5c4d feat(menu): bind CmdOrCtrl+Shift+N to New Layout Preset` — chỉ sửa `menu.rs` (thêm
  accelerator `Some("CmdOrCtrl+Shift+N")` vào item `NEW_PRESET_MENU_ID`) và `README.md`. **KHÔNG
  đụng `keymap.ts`** — `new-preset` vẫn không phải `ShortcutAction`, `DEFAULT_KEYMAP` không có
  binding nào cho nó. Đây là **bằng chứng sống, mới nhất** cho đúng vấn đề gốc team lead nêu: một
  action giờ có accelerator ở menu.rs mà keymap.ts không biết — hai nguồn lệch nhau ngay lúc vừa
  thêm, không cần chờ lâu mới drift.
- `a6ac532 fix(shortcuts): bind punctuation keys by physical position, fix ⌘9 to select the last
tab` — hai thay đổi lớn, cả hai đã tính vào plan bản này:
  1. `KeyBinding` đổi từ một interface phẳng thành union `CharKeyBinding | PhysicalKeyBinding`.
     Bốn binding `focus-next`/`focus-prev`/`next-tab`/`prev-tab` giờ match theo `event.code`
     (`BracketRight`/`BracketLeft`) — **đây chính là fix layout-non-US mà team lead nêu ở
     `keymap.ts:56-58`, đã xong**, không cần task riêng nữa. `=`/`-`/`0`/`,` (zoom, toggle-settings)
     **cố ý** giữ `event.key` — lý do ghi trong commit message: ba chord zoom đã bị native App menu
     accelerator (`menu.rs`) chặn trước khi webview thấy key nên code-hoá là dead code; comma
     (toggle-settings) không nằm trong nhóm 4 bị đổi, vẫn key-based.
  2. `⌘9` không còn là `select-tab-9` (index cố định 8) — giờ là action riêng `select-last-tab`,
     `TAB_SELECT_BINDINGS` chỉ còn sinh `select-tab-1`..`select-tab-8` (length 8). Index cụ thể của
     `select-last-tab` resolve tại `dispatchAction` (`tabs.length - 1`), không có trong
     `selectTabIndex()`. `tab-manager.ts` có `isTabSelectionAction()` mới (true cho cả
     `select-tab-N` và `select-last-tab`) dùng ở overlay guard + dispatch, giữ đúng exemption của
     `1645ac7`.

Hai commit này KHÔNG do team này chủ động yêu cầu qua kênh nhắn tin — do agent `fix-keymap-layout`
tự chủ động báo lại sau khi land. **Bản plan này đã đọc lại toàn bộ diff của cả bốn commit và viết
theo đúng trạng thái mới nhất** (xác nhận bằng `git log`/`git show` trực tiếp, không suy đoán).

Những gì team lead nêu **vẫn còn nguyên, đã tự kiểm chứng lại lần 2**:

- **Thêm action vẫn phải sửa nhiều nơi**, giờ là 4 chứ không phải 3: `ShortcutAction` union +
  `DEFAULT_KEYMAP` (`keymap.ts`), bảng `commands` (`tab-manager.ts:804-847`), if-chain
  `overlayBlocksAction` + `isTabSelectionAction` (`tab-manager.ts:884-909`), và `action_item(...)`
  string literal (`menu.rs`). `09f5c4d` (đợt 2) là ví dụ **fresh** của đúng vấn đề này: sửa một nơi
  (`menu.rs`), quên nơi kia (`keymap.ts`).
- **`isShortcutAction` vẫn chỉ chấp nhận action có binding** (`keymap.ts:148-150`, `BOUND_ACTIONS`
  build từ `DEFAULT_KEYMAP.map(...)`) — action chỉ-tồn-tại-trong-menu (`new-preset` hiện tại) vẫn
  không đi qua được đường `action:`/`runAction` thống nhất, dù giờ NÓ ĐÃ CÓ một accelerator thật ở
  menu.rs (`Cmd+Shift+N`) mà webview hoàn toàn không biết.
- **Bằng chứng cụ thể về hai bug guard lệch nhau** (đọc `app.tsx` hiện tại dòng 156-165, không đổi
  qua cả 4 commit): `new-preset` và `save-preset` vẫn đi qua hai Tauri event riêng
  (`menu:new-preset`, `menu:save-preset`) thay vì `action:`-prefix + `runAction` như mọi item khác:
  - Phím `Cmd+Shift+S` (save-preset) bị `overlayBlocksAction` chặn đúng khi board/Settings/
    PresetEditor/SavePresetDialog đang mở.
  - Item menu **"Save Layout as Preset…"** thì KHÔNG — listener của nó chỉ còn check
    `!boardOpen.value`, không biết `settingsOpen`/`editorRequest` tồn tại.
  - Item menu **"New Layout Preset…"** không có guard nào cả — và từ `09f5c4d`, giờ còn thêm một
    đường bị lỗi: `Cmd+Shift+N` (menu accelerator, macOS chặn trước khi webview thấy) mở PresetEditor
    vô điều kiện y hệt.
  - Task 4 (hợp nhất hai action này) xoá cả hai bug bằng construction, đồng thời thêm luôn binding
    `Cmd+Shift+N` vào `DEFAULT_KEYMAP` cho nhất quán với `save-preset`/`toggle-settings` (mọi action
    có menu accelerator trong repo này đều có một `DEFAULT_KEYMAP` entry song song — pattern đã có
    sẵn, không phải bịa mới).
- **Không có khái niệm scope là dữ liệu** — vẫn đúng, `overlayBlocksAction`/`isTabSelectionAction`
  là if-chain viết tay.
- **Không phát hiện binding trùng** — `matchBinding` (`keymap.ts:159-178`) vẫn trả match đầu tiên,
  không ai test không-trùng; giờ còn phức tạp hơn vì `KeyBinding` là union hai kiểu.
- **Không có test đồng bộ `menu.rs` ↔ `keymap.ts`** — vẫn đúng, và `09f5c4d` vừa chứng minh sống.

**Không còn đúng nữa (đã fix bởi `a6ac532`, không cần làm lại)**:

- ~~Bind theo ký tự sau layout, không theo phím vật lý~~ — đã fix cho 4 binding có nguy cơ thật
  (không có menu accelerator dự phòng). Ba chord còn key-based (`=`/`-`/`0`) có lý do chính đáng để
  giữ nguyên (menu accelerator chặn trước). Plan này CHỈ lift nguyên trạng, không tự ý code-hoá
  thêm.

## 2. Kiến trúc Action Registry

### 2.1 Registry là gì, nằm ở đâu

`src/terminal/action-registry.ts` (mới) — module thuần dữ liệu, không phụ thuộc DOM/Preact/Tauri.

```ts
export type ActionScope = "terminal" | "always";

export type MenuSubmenu = "App" | "File" | "Edit" | "View" | "Window";

export interface ActionDefinition {
  /** Chuỗi ổn định — cũng là id gửi qua Tauri IPC (`menu:action` payload). */
  readonly id: string;
  /** Tên hiển thị — dùng cho menu macOS hôm nay; để dành cho cheat sheet/command palette sau. */
  readonly label: string;
  /**
   * "terminal": bị `overlayBlocksAction` chặn khi Open board/Settings/PresetEditor/
   * SavePresetDialog đang che lưới terminal (mặc định, đa số action).
   * "always": bỏ qua guard — chỉ dùng cho action có preflight overlay riêng
   * (`focus-next-attention`) hoặc action mà việc mở/tắt CHÍNH overlay đó phụ thuộc nó
   * (`toggle-settings`). Action nhảy tab (`select-tab-N`, `select-last-tab`) được exempt bằng một
   * cơ chế RIÊNG (`isTabSelectionAction` ở `tab-manager.ts`, xem Task 3) — không đặt "always" ở
   * đây, để field này chỉ phản ánh đúng lý do sản phẩm, không lẫn với cơ chế tab-family.
   */
  readonly scope: ActionScope;
  /**
   * Vị trí trong menu macOS. `group` chỉ có ý nghĩa với submenu sinh toàn bộ từ registry
   * (File, View — xem scripts/generate-menu.ts, Task 5): các action cùng group render liền
   * nhau, đổi group so với action trước trong cùng submenu chèn một separator. App/Edit/Window
   * pha Cocoa builtin nên vẫn viết tay trong menu.rs — `group` bị bỏ qua ở đó.
   */
  readonly menu?: {
    readonly submenu: MenuSubmenu;
    readonly group?: string;
  };
}
```

`select-tab-1`..`select-tab-8` **không** là hàng trong `ACTION_REGISTRY` — một họ action tham số
hoá (không menu item, không label cố định, sinh bởi vòng lặp), giữ nguyên cách làm hiện tại
(`TAB_SELECT_BINDINGS`), chỉ hợp nhất vào type `ActionId` qua template literal. `select-last-tab`
(⌘9) **CÓ** là một hàng — nó là action đơn, có label cố định ("Select Last Tab"), khác về bản chất
với họ tham số hoá (xem Task 1).

`KeyBinding` phải phản ánh đúng union thật `a6ac532` đã đưa vào production — KHÔNG phải một
interface phẳng đơn giản:

```ts
interface KeyBindingBase {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ActionId;
}

/** Khớp theo ký tự layout sinh ra (`event.key`, đã lowercase). */
export interface CharKeyBinding extends KeyBindingBase {
  readonly key: string;
}

/** Khớp theo vị trí vật lý (`event.code`) — không phụ thuộc layout/IME. */
export interface PhysicalKeyBinding extends KeyBindingBase {
  readonly code: string;
}

export type KeyBinding = CharKeyBinding | PhysicalKeyBinding;

export type ActionId =
  | (typeof ACTION_REGISTRY)[number]["id"]
  | `select-tab-${number}`;
```

`ACTION_REGISTRY` khai báo bằng `as const satisfies readonly ActionDefinition[]` — giữ literal type
cho `id`, nên `ActionId` là union thật, `Partial<Record<ActionId, () => void>>` trong
`tab-manager.ts` vẫn có exhaustiveness-check như hôm nay.

### 2.2 Trade-off registry (TS) ↔ menu macOS (Rust) — đã chọn phương án

Team lead nêu 3 hướng, đây là quyết định và lý do:

| Phương án                                  | Mô tả                                                                                                                                                                                        | Trade-off                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — push runtime                           | Frontend gọi Tauri command sau khi webview sẵn sàng, Rust dựng menu từ payload                                                                                                               | Đúng nguồn-sự-thật-duy-nhất nhất, nhưng menu xuất hiện **sau** frame đầu (flash menu mặc định/rỗng rồi mới đổi) — vi phạm cảm giác app native mà `menu.rs` hiện tại cố giữ. Thêm một IPC command + capability mới cho thứ vốn là dữ liệu tĩnh — đi ngược tinh thần capability tối thiểu đã thấy ở ADR 0027 (`notification:allow-*` cụ thể, không `notification:default`). |
| B — **codegen lúc build** ✅ (chọn)        | Script Node/TS đọc registry, sinh `.rs` (data + hai hàm dựng submenu thuần-registry), commit file sinh, tự chạy qua npm `predev`/`prebuild` (Tauri đã gọi `npm run dev`/`npm run build` sẵn) | Đồng bộ, không flicker, không capability mới, khớp "Backend: Rust, thin" (ARCHITECTURE.md §1). Cái giá: cần một bước build mới (nhẹ — 1 script, 1 devDependency `tsx`), và `cargo test`/`cargo check` chạy ĐƠN LẺ (không qua npm) cần file sinh đã có sẵn trên đĩa → phải commit file sinh vào git + có bước kiểm tra "không lỗi thời" (Task 6).                          |
| C — test đối chiếu, `menu.rs` vẫn viết tay | Giữ nguyên `menu.rs`, thêm test so registry với string literal trong đó                                                                                                                      | Rủi ro thấp nhất, không cần tooling mới — nhưng KHÔNG xoá được việc sửa 2 chỗ cho một action mới (chính bug `09f5c4d` vừa minh hoạ), chỉ thêm lưới an toàn phát hiện lệch sau khi đã lệch. Không thoả đúng yêu cầu "sinh ra menu macOS" của team lead.                                                                                                                    |

**Chọn B cho File/View** (hai submenu hôm nay **hoàn toàn** là action-registry item, không Cocoa
builtin nào chen vào) → sinh toàn bộ hàm dựng submenu, `menu.rs` chỉ gọi.

**Chọn C (hand-written + Rust test đối chiếu) cho App/Edit/Window** — ba submenu này pha Cocoa
builtin thật (App: `.about()/.services()/.hide()/.hide_others()/.show_all()`; Edit:
`.undo()/.redo()/.cut()/.copy()/.paste()/.select_all()`; Window: `.minimize()/.maximize()/
.fullscreen()`) xen giữa các action-registry item — sinh toàn bộ chuỗi builder cho 3 submenu này
đòi hỏi mã hoá cả các lời gọi builtin (không phải dữ liệu, không thuộc registry) vào generator,
biến generator thành nơi vừa giữ dữ liệu vừa giữ cấu trúc UI Cocoa — trái với chủ đích tách dữ
liệu khỏi chrome. Thay vào đó: `menu.rs` viết tay 3 submenu này y như hôm nay, nhưng
`scripts/generate-menu.ts` cũng xuất một bảng const chỉ-đọc `APP_MENU_ITEMS`/`EDIT_MENU_ITEMS`/
`WINDOW_MENU_ITEMS` (id/label/accelerator) cho 3 submenu đó; một Rust test (`cargo test`) so từng
item viết tay với đúng bộ ba này — lệch là test đỏ ngay (đây chính là cơ chế lẽ ra đã bắt được
`09f5c4d`'s thiếu sót nếu đã tồn tại từ trước).

## 3. Business rules & invariants

- **`ACTION_REGISTRY` là nguồn duy nhất cho: id hợp lệ, label, scope, vị trí menu.**
  `keymap.ts`/`tab-manager.ts`/`menu_registry.rs` (sinh) đều đọc từ đây, không khai báo lại.
- **`DEFAULT_KEYMAP` là nguồn duy nhất cho binding mặc định**, tách khỏi `ACTION_REGISTRY` — một
  action có thể có 0 (chưa dùng trong production hôm nay, nhưng cơ chế phải hỗ trợ), 1, hoặc nhiều
  binding (vd `zoom-in`: `Cmd+=` và `Cmd+Shift+=`), không ép 1:1.
- **`KeyBinding` là union `CharKeyBinding | PhysicalKeyBinding`; luật chọn nhánh nào không phải tuỳ
  ý mà là bind theo CÁI MÀ MENU ACCELERATOR BIND THEO, nếu action đó có mặt trong menu macOS.**
  Accelerator của Tauri/Cocoa khai theo ký tự (`CmdOrCtrl+D`, `CmdOrCtrl+F`…), nên một action vừa
  có menu item vừa có binding webview PHẢI dùng `CharKeyBinding` — nếu dùng `PhysicalKeyBinding`,
  trên layout không phải QWERTY (rõ nhất Dvorak) hai đường sẽ trỏ về **hai phím vật lý khác nhau
  cho cùng một action**, phá đúng bất biến "menu item và shortcut không bao giờ lệch nhau" mà cả
  `menu.rs:22-28` lẫn plan này đang giữ. `PhysicalKeyBinding` chỉ dành cho action **không có** menu
  item, nơi webview là đường duy nhất và ký tự sinh ra phụ thuộc Shift + layout — đúng trường hợp
  4 binding bracket ở `a6ac532`. Task 1 chỉ lift đúng kết quả đã áp dụng luật này (không tự ý
  chuyển thêm binding nào), nhưng luật áp dụng cho MỌI action thêm sau plan này, không chỉ tiền lệ
  hôm nay — xem thêm Global Constraints và đề xuất ADR ở §5.
- **`isShortcutAction`/`isActionId` hợp lệ với MỌI id trong `ACTION_REGISTRY`, có binding hay
  không** — fix cụ thể cho hạn chế "action chỉ-có-trong-menu là bất khả thi" mà team lead nêu.
- **`scope: "always"` chỉ cho hai lý do đã ghi trong `overlayBlocksAction` hiện tại**: preflight
  overlay riêng (`focus-next-attention`), hoặc action mở/đóng chính overlay đang chặn nó
  (`toggle-settings`). Action nhảy tab (`select-tab-N`, `select-last-tab`) exempt qua
  `isTabSelectionAction`, không qua field `scope`. Không thêm ngoại lệ mới trong plan này.
- **Không hai binding cùng loại (cùng `key` hoặc cùng `code`) trùng chord** (field khớp + 4
  modifier) — test bắt buộc; không claim phát hiện collision xuyên-loại (một `code` và một `key`
  cùng khớp một sự kiện thật) vì với bộ binding hôm nay điều đó không thể xảy ra (không phím chữ
  nào có `code` trùng `BracketLeft`/`BracketRight`) — ghi rõ giới hạn này trong test, không phóng
  đại độ bao phủ.
- **File sinh (`menu_registry.rs`) phải commit vào git** và phải khớp với một lần regenerate mới
  nhất — Task 6 thêm bước kiểm tra staleness, thất bại nếu lệch.
- **Không đổi hành vi shipped của `overlayBlocksAction`/`isTabSelectionAction`** — Task 3 chỉ đổi
  NGUỒN dữ liệu (if-chain → tra registry) cho phần scope thường, giữ nguyên logic
  `isTabSelectionAction`; toàn bộ test hiện có (`describe("overlay scope guard...")`,
  `describe("createTabManager toggle-settings routing...")`, `describe("select-last-tab...")`)
  phải xanh nguyên, không sửa assertion.

## 4. Phạm vi / Ngoài phạm vi

**Làm trong plan này**:

- `action-registry.ts` — SSOT id/label/scope/menu-position + `DEFAULT_KEYMAP` (lift đúng union type
  hiện tại, gồm cả fix `event.code` và `select-last-tab` đã land).
- `keymap.ts` thành lớp derive mỏng (matching + validate id), giữ đúng logic union-matching hiện có.
- `tab-manager.ts`'s `overlayBlocksAction` đọc `scope` từ registry thay vì if-chain (giữ
  `isTabSelectionAction` nguyên vẹn).
- Hợp nhất `new-preset`/`save-preset` vào đường `action:`/`runAction` chung — xoá hai bug guard đã
  nêu ở §1, thêm binding `Cmd+Shift+N` cho `new-preset` vào `DEFAULT_KEYMAP` (khớp accelerator đã
  có ở `menu.rs` từ `09f5c4d`).
- Test không-trùng-binding (same-kind).
- Codegen `menu_registry.rs` cho File/View; test đối chiếu cho App/Edit/Window.
- Cập nhật `ARCHITECTURE.md`, `README.md`; đề xuất ADR (không tự tạo file ADR).

**KHÔNG làm** (chừa cho plan sau, hoặc đã xong trước khi plan này bắt đầu):

- **Chuyển thêm binding nào sang `event.code`** — đã xong đủ (4 binding có rủi ro thật) ở `a6ac532`;
  không tự ý "hoàn thiện" ba chord zoom/comma còn key-based, lý do giữ nguyên đã ghi rõ trong commit
  đó và không thuộc phạm vi review lại của plan này.
- Command palette, cheat sheet UI, rebind trong Settings — registry chỉ cần đủ field để những cái
  này build được sau, không tự thêm `keywords`/`category` chưa ai dùng (YAGNI — thêm field không
  tiêu thụ ở đâu chỉ tạo dead metadata).
- **Field `enabled` chung trên `ActionDefinition`** — team lead brief có liệt kê "điều kiện
  enabled" là một field mong muốn của registry. Quyết định: KHÔNG thêm, vì lý do cụ thể hơn YAGNI —
  action duy nhất hôm nay có điều kiện enabled ngoài scope (`save-preset`, cần `tabs.length > 0`)
  là **business logic của riêng action đó**, không phải điều kiện chung nhiều action dùng lại; nó
  đã sống đúng chỗ trong closure của `commands` (`tab-manager.ts`, giữ nguyên ở Task 4) và việc hợp
  nhất menu+phím vào MỘT closure (Task 4) đã tự động xoá bug lệch guard giữa hai đường mà không cần
  cơ chế `enabled` tổng quát nào. Một field `enabled` tổng quát (closure hoặc id điều kiện đặt tên)
  sẽ vừa không dùng tới trong plan này, vừa phá tính chất "registry là dữ liệu thuần, serializable"
  cần cho codegen (Task 5). Khi có action thứ hai thật sự cần điều kiện enabled dùng chung, thêm
  field đó lúc đó — không đoán trước hình dạng.
- Gộp `AttentionOverlaySnapshot` (`src/ui/attention-focus-coordinator.ts`) với 4-signal check trong
  `overlayBlocksAction` thành một type dùng chung. Hai chỗ này đọc cùng 4 signal nhưng phục vụ hai
  mục đích khác nhau (preflight có dismiss-rồi-focus vs. block-toàn-bộ); gộp là dọn dẹp hợp lý
  nhưng KHÔNG phải thứ team lead yêu cầu — nêu ra làm cơ hội cho một plan dọn dẹp riêng.
- Đổi enabled/disabled trực quan (xám menu item) khi action sẽ no-op — hôm nay menu luôn hiện
  "enabled": true bất kể state; giữ nguyên giới hạn này, chỉ đảm bảo _hành vi khi click_ đúng
  (không mở dialog sai lúc), không đảm bảo _hình thức_ item xám đi.
- Cargo dependency mới, đổi capability Tauri, đổi UI/CSS.
- Multi-window action nào chưa tồn tại (`⌘⇧M` Move Pane To… trong REQUIREMENTS.md AC-1 chưa có
  implementation — không thuộc phạm vi refactor này).

## 5. Quyết định đã chốt, rủi ro, đề xuất ADR

### Quyết định đã chốt

- Phương án B (codegen build-time, hybrid với test đối chiếu cho 3 submenu pha builtin) — lý do ở
  §2.2.
- `scope` chỉ 2 giá trị (`"terminal" | "always"`), không mô hình hoá per-overlay chi tiết hơn.
  Action nhảy tab (`select-tab-N`, `select-last-tab`) exempt qua cơ chế riêng
  (`isTabSelectionAction`), KHÔNG ép vào field `scope` — hai lý do exemption khác bản chất
  (product decision vs. "đây là một họ action nhảy tab") không nên chung một field.
- `select-tab-N` (họ tham số hoá) ở ngoài `ACTION_REGISTRY`; `select-last-tab` (action đơn, có
  label cố định) LÀ một hàng bình thường trong `ACTION_REGISTRY`.
- Lift nguyên trạng phần `event.code`/union `KeyBinding` đã có từ `a6ac532`, không mở rộng thêm.

### Rủi ro

- **Repo có nhiều agent sửa song song vùng file này** — đã xảy ra thật (2 đợt commit trong lúc viết
  plan). Người thực thi PHẢI `git log`/`git diff` lại trước khi bắt đầu bất kỳ task nào, không giả
  định trạng thái trong plan còn khớp 100%. Task 1 tự nó có bước "đối chiếu deep-equal với
  `DEFAULT_KEYMAP`/`ACTION_REGISTRY` hiện tại" chính để bắt drift kiểu này sớm.
- **File sinh có thể lỗi thời nếu ai đó chạy `cargo build`/`cargo test` mà chưa từng chạy
  `npm run generate:menu`** — giảm thiểu bằng: (a) commit file sinh vào git nên nó LUÔN tồn tại;
  (b) `predev`/`prebuild` tự chạy lại trước mọi `npm run dev`/`npm run build`; (c) Task 6 thêm bước
  diff-check bắt buộc trong quy trình verify.
- **`tsx` là devDependency mới** — chỉ chạy lúc build/dev, không vào bundle production, rủi ro thấp.
- **Action có menu accelerator (`key`-based) vẫn sai vị trí vật lý trên layout không-QWERTY** (vd
  Dvorak: `Cmd+D` không còn ở phím "D" vật lý) — đây KHÔNG phải lỗi của plan này: `menu.rs`'s
  accelerator tự thân cũng bind theo ký tự, không theo vị trí, nên webview đi theo đúng luật ở
  Global Constraints để hai đường nhất quán VỚI NHAU, dù cả hai cùng "sai" theo nghĩa vị trí vật lý
  trên layout đó. Sửa triệt để đòi hỏi đổi accelerator ở `menu.rs` trước (Tauri/muda's accelerator
  cú pháp không có khái niệm physical-code), việc đó ngoài phạm vi plan này — ghi nhận là giới hạn
  đã biết, không phải bug bỏ sót.

### Đề xuất ADR

Plan này KHÔNG tự tạo file ADR, nhưng đề xuất một ADR mới sau khi implement xong, vì đây là quyết
định kiến trúc cross-cutting thuộc diện `affects: [ARCHITECTURE]` theo pipeline ADR-first của repo:

> **Action Registry là nguồn sự thật duy nhất cho keyboard shortcut + macOS menu.**
> Mọi action khai báo một lần trong `src/terminal/action-registry.ts` (id/label/scope/vị trí
> menu); keymap matching phái sinh runtime, hai submenu thuần-registry (File/View) sinh lúc build
> qua `scripts/generate-menu.ts` → `src-tauri/src/menu_registry.rs` (commit vào git, đối chiếu
> staleness); ba submenu pha Cocoa builtin (App/Edit/Window) viết tay, đối chiếu bằng Rust test.
> `scope` là field first-class quyết định action nào bị chặn khi overlay che terminal.
>
> **Luật chọn `key` vs `code` cho binding của một action**: bind theo CÁI MÀ MENU ACCELERATOR BIND
> THEO, nếu action đó có mặt trong menu macOS. Menu accelerator của Tauri/Cocoa khai theo ký tự
> (`CmdOrCtrl+D`, `CmdOrCtrl+F`…), nên một action vừa có menu item vừa có binding webview phải
> dùng `CharKeyBinding` (`event.key`) — nếu dùng `PhysicalKeyBinding` (`event.code`), trên layout
> không phải QWERTY (rõ nhất Dvorak) hai đường sẽ trỏ về hai phím vật lý khác nhau cho cùng một
> action, phá đúng bất biến "menu item và shortcut không bao giờ lệch nhau" (`menu.rs:22-28`).
> `PhysicalKeyBinding` chỉ dành cho action không có menu item, nơi webview là đường duy nhất và ký
> tự sinh ra phụ thuộc Shift + layout.

Chạy `/adk:adr` với nội dung trên sau khi Task 9 xong, để `git log` của implementation khớp với
ADR record.

---

## 6. Các task

### Task 1: Tạo `action-registry.ts` — lift thuần dữ liệu, không đổi hành vi

**File(s)**:

- [action-registry.ts](../../src/terminal/action-registry.ts) (mới)
- [action-registry.test.ts](../../src/terminal/action-registry.test.ts) (mới)

**Phụ thuộc**: Không — nhưng **bước đầu tiên bắt buộc trước khi viết bất kỳ dòng nào**: `git log
--oneline -5` và đọc lại `src/terminal/keymap.ts` hiện tại. Nếu có commit mới hơn `a6ac532` chạm
`keymap.ts`/`tab-manager.ts`, dừng và đối chiếu diff với nội dung Task này trước khi tiếp tục.

**Decision**: Lift nguyên 25 action hiện có trong `ShortcutAction` union hôm nay (không tính
`select-tab-${number}`) vào `ACTION_REGISTRY`, `scope` gán đúng theo hai ngoại lệ product-decision
thật trong `overlayBlocksAction` hiện tại: `focus-next-attention`, `toggle-settings` → `"always"`;
mọi action còn lại → `"terminal"` (kể cả `select-last-tab` — exemption của nó đến từ
`isTabSelectionAction`, không từ `scope`, xem §3). `KeyBinding`/`DEFAULT_KEYMAP` lift đúng union
`CharKeyBinding | PhysicalKeyBinding` và toàn bộ giá trị hiện tại (bốn binding vật lý, 8 select-tab,
1 select-last-tab) — KHÔNG đổi field nào.

**Build**:

```ts
// src/terminal/action-registry.ts
export type ActionScope = "terminal" | "always";

export type MenuSubmenu = "App" | "File" | "Edit" | "View" | "Window";

export interface ActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly scope: ActionScope;
  readonly menu?: {
    readonly submenu: MenuSubmenu;
    readonly group?: string;
  };
}

// Thứ tự khai báo = thứ tự item trong menu macOS cho submenu sinh toàn bộ từ
// registry (File, View — xem scripts/generate-menu.ts, Task 5). App/Edit/
// Window pha Cocoa builtin nên vẫn viết tay trong menu.rs; `group` bị bỏ qua
// ở đó.
export const ACTION_REGISTRY = [
  {
    id: "toggle-settings",
    label: "Settings…",
    // Bỏ qua overlay guard: gate nó sẽ tự nhốt Settings không cách nào đóng
    // lại, vì settingsOpen=true chặn mọi action khác kể cả toggle-settings.
    scope: "always",
    menu: { submenu: "App" },
  },
  {
    id: "new-tab",
    label: "New Tab",
    // Chỉ set boardOpen.value = true — vô hại nếu board đã mở, không có gì
    // để gate.
    scope: "always",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "reopen-tab",
    label: "Reopen Closed Tab",
    scope: "terminal",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "close-pane",
    label: "Close Pane",
    scope: "terminal",
    menu: { submenu: "File", group: "close" },
  },
  {
    id: "close-tab",
    label: "Close Tab",
    scope: "terminal",
    menu: { submenu: "File", group: "close" },
  },
  { id: "find", label: "Find…", scope: "terminal", menu: { submenu: "Edit" } },
  {
    id: "clear-buffer",
    label: "Clear Buffer",
    scope: "terminal",
    menu: { submenu: "Edit" },
  },
  {
    id: "split-row",
    label: "Split Vertically",
    scope: "terminal",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "split-column",
    label: "Split Horizontally",
    scope: "terminal",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "toggle-zoom-pane",
    label: "Zoom Pane",
    scope: "terminal",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "toggle-expand",
    label: "Focus Expand",
    scope: "terminal",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "zoom-in",
    label: "Increase Font Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-out",
    label: "Decrease Font Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-reset",
    label: "Actual Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "focus-next-attention",
    label: "Next Agent Needing Attention",
    // Có preflight overlay riêng (runAttentionFocus / attention-focus-
    // coordinator.ts) — dismiss board/settings rồi focus, tự block khi
    // PresetEditor/SavePresetDialog có draft. Gate ở đây nữa sẽ double-guard.
    scope: "always",
    menu: { submenu: "View", group: "attention" },
  },
  {
    id: "save-preset",
    label: "Save Layout as Preset…",
    scope: "terminal",
    menu: { submenu: "Window" },
  },
  { id: "focus-next", label: "Focus Next Pane", scope: "terminal" },
  { id: "focus-prev", label: "Focus Previous Pane", scope: "terminal" },
  { id: "focus-left", label: "Focus Pane Left", scope: "terminal" },
  { id: "focus-right", label: "Focus Pane Right", scope: "terminal" },
  { id: "focus-up", label: "Focus Pane Up", scope: "terminal" },
  { id: "focus-down", label: "Focus Pane Down", scope: "terminal" },
  { id: "next-tab", label: "Next Tab", scope: "terminal" },
  { id: "prev-tab", label: "Previous Tab", scope: "terminal" },
  {
    id: "select-last-tab",
    label: "Select Last Tab",
    // Exempt khỏi overlay guard qua isTabSelectionAction (tab-manager.ts,
    // Task 3) — cùng cơ chế với select-tab-N, KHÔNG qua scope "always".
    scope: "terminal",
  },
] as const satisfies readonly ActionDefinition[];

/**
 * `select-tab-1`..`select-tab-8` KHÔNG là hàng trong ACTION_REGISTRY — một
 * họ action tham số hoá (không menu item, không label cố định), sinh bằng
 * vòng lặp như trước. `select-last-tab` (⌘9) LÀ một hàng bình thường ở trên
 * — action đơn, label cố định, khác bản chất với họ tham số hoá.
 */
export type ActionId =
  | (typeof ACTION_REGISTRY)[number]["id"]
  | `select-tab-${number}`;

const ACTION_IDS: ReadonlySet<string> = new Set(
  ACTION_REGISTRY.map((a) => a.id),
);

/**
 * Whether `value` names a real action — có binding hay không không liên
 * quan (fix cho hạn chế cũ: action chỉ-tồn-tại-trong-menu vẫn hợp lệ dù
 * không có binding nào trong DEFAULT_KEYMAP).
 */
export function isActionId(
  value: unknown,
  registry: ReadonlySet<string> = ACTION_IDS,
): value is ActionId {
  if (typeof value !== "string") {
    return false;
  }
  if (registry.has(value)) {
    return true;
  }
  const match = /^select-tab-([1-8])$/.exec(value);
  return match !== null;
}

interface KeyBindingBase {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ActionId;
}

/**
 * LUẬT khi thêm một binding mới, đọc trước khi chọn nhánh:
 *
 * Bind theo CÁI MÀ MENU ACCELERATOR BIND THEO, nếu action đó có mặt trong
 * menu macOS (có `menu` field ở ACTION_REGISTRY và một accelerator thật ở
 * menu.rs/menu_registry.rs). Menu accelerator của Tauri/Cocoa khai theo ký
 * tự (vd "CmdOrCtrl+D"), không theo vị trí vật lý — nên một action vừa có
 * menu item vừa có binding webview PHẢI dùng CharKeyBinding. Nếu dùng
 * PhysicalKeyBinding ở đây, trên layout không phải QWERTY (rõ nhất Dvorak)
 * hai đường sẽ trỏ về HAI PHÍM VẬT LÝ KHÁC NHAU cho cùng một action, phá
 * đúng bất biến "menu item và shortcut không bao giờ lệch nhau"
 * (src-tauri/src/menu.rs, comment đầu file).
 *
 * PhysicalKeyBinding chỉ dành cho action KHÔNG có menu item — nơi webview
 * là đường duy nhất và ký tự sinh ra phụ thuộc Shift + layout (vd các phím
 * dấu: focus-next/prev, next-tab/prev-tab).
 */
/** Khớp theo ký tự layout sinh ra (`event.key`, đã lowercase). */
export interface CharKeyBinding extends KeyBindingBase {
  readonly key: string;
}

/** Khớp theo vị trí vật lý (`event.code`) — không phụ thuộc layout/IME. */
export interface PhysicalKeyBinding extends KeyBindingBase {
  readonly code: string;
}

export type KeyBinding = CharKeyBinding | PhysicalKeyBinding;

const TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 8 },
  (_, index): KeyBinding => ({
    key: String(index + 1),
    meta: true,
    action: `select-tab-${index + 1}`,
  }),
);

const SELECT_LAST_TAB_BINDING: KeyBinding = {
  key: "9",
  meta: true,
  action: "select-last-tab",
};

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  { key: "w", meta: true, action: "close-pane" },
  { key: "w", meta: true, shift: true, action: "close-tab" },
  // Vật lý (event.code) — fix layout non-US, xong ở a6ac532, lift nguyên.
  { code: "BracketRight", meta: true, action: "focus-next" },
  { code: "BracketLeft", meta: true, action: "focus-prev" },
  { key: "e", meta: true, action: "toggle-expand" },
  { key: "t", meta: true, action: "new-tab" },
  { code: "BracketRight", meta: true, shift: true, action: "next-tab" },
  { code: "BracketLeft", meta: true, shift: true, action: "prev-tab" },
  // Cố ý vẫn key-based — đã bị native App menu accelerator chặn trước khi
  // webview thấy key, code-hoá là dead code (lý do trong a6ac532).
  { key: "=", meta: true, action: "zoom-in" },
  { key: "+", meta: true, shift: true, action: "zoom-in" },
  { key: "-", meta: true, action: "zoom-out" },
  { key: "0", meta: true, action: "zoom-reset" },
  { key: "enter", meta: true, shift: true, action: "toggle-zoom-pane" },
  { key: "f", meta: true, action: "find" },
  { key: "k", meta: true, action: "clear-buffer" },
  { key: "t", meta: true, shift: true, action: "reopen-tab" },
  { key: "s", meta: true, shift: true, action: "save-preset" },
  { key: "a", meta: true, shift: true, action: "focus-next-attention" },
  { key: ",", meta: true, action: "toggle-settings" },
  { key: "arrowleft", meta: true, alt: true, action: "focus-left" },
  { key: "arrowright", meta: true, alt: true, action: "focus-right" },
  { key: "arrowup", meta: true, alt: true, action: "focus-up" },
  { key: "arrowdown", meta: true, alt: true, action: "focus-down" },
  ...TAB_SELECT_BINDINGS,
  SELECT_LAST_TAB_BINDING,
];
```

**Verify**:

- `action-registry.test.ts` — viết mới, chạy `npm test -- action-registry`:
  - Không hai hàng nào trong `ACTION_REGISTRY` trùng `id`.
  - Mọi `DEFAULT_KEYMAP[i].action` phải là `isActionId(...) === true`.
  - **Không hai binding cùng loại trùng chord** — so sánh same-kind (mọi cặp `CharKeyBinding` theo
    `key`, mọi cặp `PhysicalKeyBinding` theo `code`, cộng 4 modifier); không claim bắt collision
    xuyên-loại (ghi rõ trong comment test, xem §3):

    ```ts
    function chordKey(b: KeyBinding): string {
      const base = "code" in b ? `code:${b.code}` : `key:${b.key}`;
      return `${base}|${!!b.meta}|${!!b.shift}|${!!b.alt}|${!!b.ctrl}`;
    }

    it("has no two same-kind bindings matching the same chord", () => {
      const seen = new Set<string>();
      for (const binding of DEFAULT_KEYMAP) {
        const k = chordKey(binding);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    });
    ```

  - Mọi action có `menu` phải có `label` khác rỗng.
  - Snapshot tập id: `new Set(ACTION_REGISTRY.map((a) => a.id))` phải bằng đúng tập 25 id liệt kê ở
    trên (Set so sánh qua `toEqual`, không phụ thuộc thứ tự) — chứng minh lift không rơi/thêm nhầm
    action nào so với `ShortcutAction` union hiện tại của `keymap.ts`.
  - `isActionId("select-tab-5")` → true, `isActionId("select-tab-8")` → true,
    `isActionId("select-tab-9")` → **false** (⌘9 giờ là `select-last-tab`, không phải index 8),
    `isActionId("select-last-tab")` → true, `isActionId("select-tab-0")` → false.
  - **Decouple khỏi binding** — dùng tham số `registry` override mà `isActionId` đã có sẵn (cùng
    pattern với `matchBinding`'s tham số `keymap` override):

    ```ts
    it("accepts any id present in the registry set, whether or not it has a binding", () => {
      const registryIds = new Set(["menu-only-action"]);
      expect(isActionId("menu-only-action", registryIds)).toBe(true);
      expect(isActionId("not-in-registry", registryIds)).toBe(false);
    });
    ```

- `git diff --stat src/terminal/action-registry.ts` là file mới, không file nào khác đổi ở task
  này — chưa ai import nó, nên `npm run build`/`npm test` (toàn repo) phải xanh y hệt trước task.

---

### Task 2: `keymap.ts` trở thành lớp phái sinh mỏng

**File(s)**:

- [keymap.ts](../../src/terminal/keymap.ts)
- [keymap.test.ts](../../src/terminal/keymap.test.ts)

**Phụ thuộc**: Task 1

**Decision**: `keymap.ts` không còn giữ dữ liệu — chỉ còn "khớp `KeyboardEvent` với action" +
re-export, giữ **nguyên logic union-matching hiện tại** (`"code" in binding` discriminant) —
KHÔNG rút gọn về một nhánh. `ShortcutAction` (tên cũ) trở thành alias của `ActionId`.
`isShortcutAction` (tên cũ) gọi thẳng `isActionId`. `CharKeyBinding`/`PhysicalKeyBinding` cũng
re-export để không phải sửa import ở nơi khác nếu có.

**Build**:

```ts
// src/terminal/keymap.ts
import {
  DEFAULT_KEYMAP,
  isActionId,
  type ActionId,
  type CharKeyBinding,
  type PhysicalKeyBinding,
  type KeyBinding,
} from "./action-registry";

export {
  DEFAULT_KEYMAP,
  type CharKeyBinding,
  type PhysicalKeyBinding,
  type KeyBinding,
};
export type ShortcutAction = ActionId;

/**
 * Whether `value` names a real action — có binding hay không không liên
 * quan. Guards đường action đến như untrusted string: macOS menu gửi item id
 * qua Tauri IPC.
 */
export function isShortcutAction(value: unknown): value is ShortcutAction {
  return isActionId(value);
}

/**
 * Exact match on the key/code and all four modifiers; null when nothing
 * matches. A `PhysicalKeyBinding` (has `code`) matches on `event.code`; a
 * `CharKeyBinding` (has `key`) matches on `event.key`, lowercased.
 */
export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = DEFAULT_KEYMAP,
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  for (const binding of keymap) {
    const keyMatches =
      "code" in binding ? binding.code === event.code : binding.key === key;
    if (
      keyMatches &&
      !!binding.meta === event.metaKey &&
      !!binding.shift === event.shiftKey &&
      !!binding.alt === event.altKey &&
      !!binding.ctrl === event.ctrlKey
    ) {
      return binding.action;
    }
  }
  return null;
}

/**
 * 0-based tab index for a `select-tab-N` action, null for any other action —
 * including `select-last-tab` (⌘9), which has no fixed index of its own.
 */
export function selectTabIndex(action: ShortcutAction): number | null {
  const match = /^select-tab-(\d+)$/.exec(action);
  return match ? Number(match[1]) - 1 : null;
}
```

**Verify**:

- `npm test -- keymap` — file test hiện tại (đã có `codeEvent` helper + test layout-độc-lập +
  test `select-last-tab` từ `a6ac532`) **không sửa gì**, phải pass 100% nguyên trạng.
- Cơ chế decouple-khỏi-binding của `isActionId`/`isShortcutAction` đã có test thật ở Task 1 (dùng
  tham số `registry` override) — task này không cần thêm test riêng cho việc đó.
- `npm run build` pass — `tab-manager.ts`, `app.tsx` import `ShortcutAction`/`isShortcutAction`/
  `matchBinding`/`DEFAULT_KEYMAP`/`selectTabIndex` từ `./keymap` không đổi tên, không cần sửa các
  file đó ở task này.

---

### Task 3: `overlayBlocksAction` tra `scope` từ registry thay vì if-chain

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)

**Phụ thuộc**: Task 1, Task 2

**Decision**: Thay đúng phần thân hàm `overlayBlocksAction` (`tab-manager.ts:884-899`), giữ nguyên
chữ ký. Giữ **nguyên vẹn `isTabSelectionAction`** (`tab-manager.ts:901-909`) — không đụng, vì
exemption của `select-tab-N`/`select-last-tab` là cơ chế riêng, không thuộc registry `scope` (§3).
Không đổi hành vi.

**Build**:

```ts
// import thêm ACTION_REGISTRY, cạnh import DEFAULT_KEYMAP hiện có từ ./keymap
import { ACTION_REGISTRY } from "./action-registry";

const ACTION_SCOPE = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.scope] as const),
);

/**
 * Single choke point deciding whether `action` may run while an overlay
 * (Open board, Settings, PresetEditor, SavePresetDialog) is covering the
 * terminal grid. `focus-next-attention`/`toggle-settings`/`new-tab` scope
 * now lives on `ActionDefinition.scope` (src/terminal/action-registry.ts —
 * see each entry's comment for why it is "always"). `select-tab-N` and
 * `select-last-tab` are exempt through `isTabSelectionAction` below, not
 * through `scope` — they are a distinct action family, not a product-level
 * "always" decision.
 */
function overlayBlocksAction(action: ShortcutAction): boolean {
  if (ACTION_SCOPE.get(action) === "always" || isTabSelectionAction(action)) {
    return false;
  }
  return (
    boardOpen.value ||
    settingsOpen.value ||
    editorRequest.value !== null ||
    saveDialogOpen.value
  );
}
```

**Verify**:

- `npm test -- tab-manager` — toàn bộ `describe("overlay scope guard...")`,
  `describe("createTabManager toggle-settings routing...")`, và
  `describe("select-last-tab (⌘9) — always the last tab, never a fixed index 8", ...)` (từ
  `1645ac7`/`b7e6021`/`a6ac532`) phải pass **không sửa một dòng assertion nào**.
- Thêm một test mới xác nhận nguồn dữ liệu thật sự đổi:

  ```ts
  it("reads scope from ACTION_REGISTRY, not a hardcoded list", () => {
    const alwaysActions = ACTION_REGISTRY.filter(
      (a) => a.scope === "always",
    ).map((a) => a.id);
    expect(new Set(alwaysActions)).toEqual(
      new Set(["focus-next-attention", "new-tab", "toggle-settings"]),
    );
  });
  ```

- `npm run build` pass.

---

### Task 4: Hợp nhất `new-preset` + `save-preset` vào đường `action:`/`runAction` chung

**File(s)**:

- [action-registry.ts](../../src/terminal/action-registry.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)
- [keymap.test.ts](../../src/terminal/keymap.test.ts)
- [app.tsx](../../src/ui/app.tsx)
- [menu.rs](../../src-tauri/src/menu.rs)

**Phụ thuộc**: Task 2, Task 3

**Decision**: Xoá `NEW_PRESET_MENU_ID`/`SAVE_PRESET_MENU_ID` và hai branch riêng trong
`on_menu_event` (`menu.rs`); xoá hai listener `menu:new-preset`/`menu:save-preset` (`app.tsx`).
Route cả hai qua `action_item()`/`ACTION_PREFIX` như mọi item khác. Thêm binding
`Cmd+Shift+N` cho `new-preset` vào `DEFAULT_KEYMAP` — khớp accelerator `menu.rs` đã có sẵn từ
`09f5c4d` (`Some("CmdOrCtrl+Shift+N")`), và khớp pattern mọi action-có-menu-accelerator khác trong
registry (`save-preset`, `toggle-settings` đều có binding song song).

Đây là fix trực tiếp ba bug đã xác minh ở §1: menu "New Layout Preset…" không guard gì (mở đè lên
overlay khác vô điều kiện, cả từ click lẫn từ `Cmd+Shift+N`); menu "Save Layout as Preset…" guard
yếu hơn phím tương ứng; `menu.rs` có accelerator mà `keymap.ts` không biết (`09f5c4d`). Sau task
này cả hai action đi qua đúng MỘT closure trong `commands`, cùng `overlayBlocksAction`.

**Build**:

`action-registry.ts` — thêm hàng `new-preset`, thêm binding vào `DEFAULT_KEYMAP`:

```ts
// Thêm vào ACTION_REGISTRY, cạnh hàng "save-preset" (cùng submenu Window):
{
  id: "new-preset",
  label: "New Layout Preset…",
  scope: "terminal",
  menu: { submenu: "Window" },
},
```

```ts
// Thêm vào DEFAULT_KEYMAP, cạnh binding "save-preset":
{ key: "n", meta: true, shift: true, action: "new-preset" },
```

`tab-manager.ts` — thêm closure vào `commands` (import `editorRequest` đã sẵn có ở đầu file):

```ts
"new-preset": () => {
  editorRequest.value = { source: "live" };
},
```

`app.tsx` — xoá hai listener `menu:new-preset`/`menu:save-preset`, giữ nguyên listener `menu:action`
chung:

```ts
useEffect(() => {
  const unsubs: UnlistenFn[] = [];
  // Every File/Edit/View/Window item whose accelerator the macOS menu now
  // owns, including New/Save Preset (unified — no more menu:new-preset/
  // menu:save-preset special cases; see docs/plans/2026-07-27-action-
  // registry.md Task 4).
  void listen<string>("menu:action", (event) => {
    if (isShortcutAction(event.payload)) {
      tabsRef.current?.runAction(event.payload);
    }
  }).then((fn) => unsubs.push(fn));
  return () => unsubs.forEach((fn) => fn());
}, []);
```

`menu.rs` — `action_item` nhận `Option<&str>` (cần cho `new-preset` nếu về sau lại có action
menu-only thật không binding; hôm nay `new-preset` đã có binding nên `None` không thực sự dùng ở
đây, nhưng đổi signature vẫn cần để giữ registry tổng quát cho Task 5's codegen):

```rust
#[cfg(target_os = "macos")]
fn action_item<R: Runtime>(
    handle: &tauri::AppHandle<R>,
    action: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(
        handle,
        format!("{ACTION_PREFIX}{action}"),
        label,
        true,
        accelerator,
    )
}
```

Mọi lời gọi `action_item(handle, "...", "...", "CmdOrCtrl+...")` hiện có bọc lại thành
`Some("CmdOrCtrl+...")` (cơ giới, ~11 lời gọi). `new_preset`/`save_preset`:

```rust
let new_preset = action_item(
    handle,
    "new-preset",
    "New Layout Preset…",
    Some("CmdOrCtrl+Shift+N"),
)?;
let save_preset = action_item(
    handle,
    "save-preset",
    "Save Layout as Preset…",
    Some("CmdOrCtrl+Shift+S"),
)?;
let window_menu = SubmenuBuilder::new(handle, "Window")
    .minimize()
    .maximize()
    .separator()
    .fullscreen()
    .separator()
    .item(&new_preset)
    .item(&save_preset)
    .build()?;
```

Xoá `NEW_PRESET_MENU_ID`/`SAVE_PRESET_MENU_ID` (const) và hai nhánh `else if id ==
NEW_PRESET_MENU_ID`/`SAVE_PRESET_MENU_ID` trong `on_menu_event`.

**Verify**:

- `npm test -- keymap` — thêm test bằng dữ liệu production thật:

  ```ts
  it("matches Cmd+Shift+N as new-preset — menu.rs's accelerator (09f5c4d) now has a webview match", () => {
    expect(matchBinding(keyEvent("n", { metaKey: true, shiftKey: true }))).toBe(
      "new-preset",
    );
  });
  ```

- `npm test -- tab-manager` — thêm test mới:

  ```ts
  it("new-preset now honors the overlay scope guard (menu click and Cmd+Shift+N both)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    settingsOpen.value = true;
    tm.runAction("new-preset");
    expect(editorRequest.value).toBeNull(); // trước fix: mở vô điều kiện
    settingsOpen.value = false;
  });

  it("save-preset menu path and keyboard path now share one guard", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    editorRequest.value = { source: "live" }; // PresetEditor draft mở
    tm.runAction("save-preset"); // trước fix: chỉ check boardOpen, sẽ lọt qua
    expect(saveDialogOpen.value).toBe(false);
    editorRequest.value = null;
  });
  ```

- `npm run build` pass.
- `cargo check --manifest-path src-tauri/Cargo.toml` pass — xác nhận `Option<&str>` không vỡ lời
  gọi nào khác của `action_item`.
- Chạy `npm run tauri dev`: `Cmd+Shift+N` mở PresetEditor khi không có overlay; mở Settings rồi thử
  lại (cả `Cmd+Shift+N` lẫn click menu) → no-op. Tương tự cho `Cmd+Shift+S`/"Save Layout as
  Preset…".

---

### Task 5: Codegen `menu_registry.rs` cho File/View + const đối chiếu cho App/Edit/Window

**File(s)**:

- [generate-menu.ts](../../scripts/generate-menu.ts) (mới)
- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)
- [menu_registry.rs](../../src-tauri/src/menu_registry.rs) (mới, generated — commit vào git)

**Phụ thuộc**: Task 4 (registry phải có nội dung cuối cùng, gồm `new-preset`, trước khi generate)

**Decision**: Thêm `tsx` làm devDependency (chỉ chạy lúc build/dev qua Node, không vào bundle
production — `vite build` không đụng thư mục `scripts/`). Script đọc `ACTION_REGISTRY` +
`DEFAULT_KEYMAP`, sinh MỘT file Rust:

- Hai hàm `build_file_menu`/`build_view_menu` — dựng đầy đủ submenu (item + separator theo `group`)
  cho hai submenu thuần-registry, viết dưới dạng chuỗi `.item(&x)` y hệt idiom đang chạy trong
  `menu.rs` hôm nay.
- Ba const `APP_MENU_ITEMS`/`EDIT_MENU_ITEMS`/`WINDOW_MENU_ITEMS: &[(&str, &str, Option<&str>)]`
  (action id, label, accelerator) cho ba submenu pha builtin — dùng ở Task 6 để đối chiếu, KHÔNG
  dùng để dựng UI.

Accelerator suy ra từ `DEFAULT_KEYMAP` phải xử lý ĐÚNG union `CharKeyBinding | PhysicalKeyBinding`
— không giả định mọi binding có field `code`.

**Build**:

```ts
// scripts/generate-menu.ts — chạy bằng `tsx`, KHÔNG vào bundle production.
import { writeFileSync } from "node:fs";
import {
  ACTION_REGISTRY,
  DEFAULT_KEYMAP,
  type ActionDefinition,
  type KeyBinding,
  type MenuSubmenu,
} from "../src/terminal/action-registry";

const HEADER = `// AUTO-GENERATED by \`npm run generate:menu\` (scripts/generate-menu.ts)
// from src/terminal/action-registry.ts — do not hand-edit.
// Regenerate: npm run generate:menu
`;

// event.code -> ký tự accelerator muda/Tauri hiểu.
const CODE_TO_ACCEL: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
};

function normalizeCode(code: string): string {
  if (CODE_TO_ACCEL[code]) return CODE_TO_ACCEL[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** event.key -> ký tự/token accelerator muda/Tauri hiểu. */
function normalizeKey(key: string): string {
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (key.length > 1) return key[0].toUpperCase() + key.slice(1); // "enter" -> "Enter"
  return key; // punctuation/digit as-is: "=", "-", "0", ","
}

function tokenFor(binding: KeyBinding): string {
  return "code" in binding
    ? normalizeCode(binding.code)
    : normalizeKey(binding.key);
}

/** Accelerator string cho macOS menu, hoặc None nếu action không có binding. */
function acceleratorFor(actionId: string): string {
  const binding = DEFAULT_KEYMAP.find((b) => b.action === actionId);
  if (!binding) {
    return "None";
  }
  const parts = ["CmdOrCtrl"];
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  if (binding.ctrl) parts.push("Ctrl");
  parts.push(tokenFor(binding));
  return `Some("${parts.join("+")}")`;
}

function itemsFor(submenu: MenuSubmenu) {
  return ACTION_REGISTRY.filter((a) => a.menu?.submenu === submenu);
}

function buildGeneratedSubmenuFn(
  fnName: string,
  submenuLabel: string,
  submenu: MenuSubmenu,
): string {
  const items = itemsFor(submenu);
  let lastGroup: string | undefined;
  const lines: string[] = [];
  const vars: string[] = [];
  for (const item of items) {
    if (lastGroup !== undefined && item.menu?.group !== lastGroup) {
      lines.push("        .separator()");
    }
    lastGroup = item.menu?.group;
    const varName = item.id.replace(/-/g, "_");
    vars.push(
      `    let ${varName} = action_item(handle, "${item.id}", "${item.label}", ${acceleratorFor(
        item.id,
      )})?;`,
    );
    lines.push(`        .item(&${varName})`);
  }
  return `#[cfg(target_os = "macos")]
pub fn ${fnName}<R: Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use super::menu::action_item;
${vars.join("\n")}
    tauri::menu::SubmenuBuilder::new(handle, "${submenuLabel}")
${lines.join("\n")}
        .build()
}
`;
}

function buildConstTable(constName: string, submenu: MenuSubmenu): string {
  const rows = itemsFor(submenu)
    .map(
      (item) =>
        `    ("${item.id}", "${item.label}", ${acceleratorFor(item.id)}),`,
    )
    .join("\n");
  return `pub const ${constName}: &[(&str, &str, Option<&str>)] = &[\n${rows}\n];\n`;
}

const output = [
  HEADER,
  buildGeneratedSubmenuFn("build_file_menu", "File", "File"),
  buildGeneratedSubmenuFn("build_view_menu", "View", "View"),
  buildConstTable("APP_MENU_ITEMS", "App"),
  buildConstTable("EDIT_MENU_ITEMS", "Edit"),
  buildConstTable("WINDOW_MENU_ITEMS", "Window"),
].join("\n");

writeFileSync(
  new URL("../src-tauri/src/menu_registry.rs", import.meta.url),
  output,
);
```

`package.json`:

```json
{
  "scripts": {
    "generate:menu": "tsx scripts/generate-menu.ts",
    "predev": "npm run generate:menu",
    "prebuild": "npm run generate:menu",
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "devDependencies": {
    "tsx": "^4"
  }
}
```

`npm install` cập nhật `package-lock.json`.

Chạy `npm run generate:menu` một lần để tạo `src-tauri/src/menu_registry.rs`, review output bằng
mắt (đối chiếu với `menu.rs` hôm nay — File/View phải sinh đúng thứ tự/separator như bản viết tay
hiện tại), rồi **commit file này vào git** — không phải build artifact bị ignore.

**Verify**:

- `npm run generate:menu` chạy không lỗi, tạo `src-tauri/src/menu_registry.rs`.
- Đọc lại file sinh: `build_file_menu` phải theo đúng thứ tự `new_tab, reopen_tab, [separator],
close_pane, close_tab` (group `primary` → `close`); `build_view_menu` phải theo đúng thứ tự
  `split_row, split_column, [sep], toggle_zoom_pane, toggle_expand, [sep], zoom_in, zoom_out,
zoom_reset, [sep], focus_next_attention` (group `split` → `zoom-pane` → `font` → `attention`) —
  khớp 1:1 với `menu.rs` hôm nay. Accelerator sinh ra cho `zoom-in`/`zoom-out`/`zoom-reset` phải là
  `"CmdOrCtrl+="`/`"CmdOrCtrl+-"`/`"CmdOrCtrl+0"` (đi qua nhánh `normalizeKey`, không phải
  `normalizeCode`) — xác nhận union được xử lý đúng, không lệch vì giả định sai field.
- `cargo check --manifest-path src-tauri/Cargo.toml` — **sẽ báo lỗi ở bước này** vì `menu.rs` chưa
  gọi `menu_registry::` gì cả. Đây là kỳ vọng — Task 6 mới wire vào; task này chỉ xác nhận cú pháp
  Rust của file sinh tự nó hợp lệ bằng cách thêm tạm `mod menu_registry;` không dùng vào
  `lib.rs`/`main.rs` và đổi `fn action_item` trong `menu.rs` thành `pub(crate) fn action_item` —
  chạy `cargo check`, xác nhận không lỗi cú pháp/type, rồi ĐỂ NGUYÊN cho Task 6 dùng tiếp (không
  revert).

---

### Task 6: Wire `menu.rs` gọi hàm sinh + Rust test đối chiếu App/Edit/Window

**File(s)**:

- [menu.rs](../../src-tauri/src/menu.rs)

**Phụ thuộc**: Task 5

**Decision**: `install()` gọi `menu_registry::build_file_menu`/`build_view_menu` thay vì dựng
inline. Ba submenu App/Edit/Window **giữ nguyên viết tay** (đúng quyết định §2.2) — thêm một
`#[cfg(test)] mod tests` so từng item viết tay với
`menu_registry::{APP_MENU_ITEMS, EDIT_MENU_ITEMS, WINDOW_MENU_ITEMS}`.

**Build**:

```rust
// Trong install(), thay đoạn dựng File/View inline:
let file_menu = menu_registry::build_file_menu(handle)?;
let view_menu = menu_registry::build_view_menu(handle)?;
```

```rust
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::menu_registry::{APP_MENU_ITEMS, EDIT_MENU_ITEMS, WINDOW_MENU_ITEMS};

    // Bộ ba (action id, label, accelerator) viết tay trong install() cho App/
    // Edit/Window — phải khớp CHÍNH XÁC với registry sinh ra. Đây là lưới an
    // toàn cho ba submenu không thể generate toàn bộ (pha Cocoa builtin) —
    // xem docs/plans/2026-07-27-action-registry.md §2.2. Chính cơ chế này
    // lẽ ra đã bắt được thiếu sót của 09f5c4d (accelerator thêm ở menu.rs mà
    // keymap.ts không biết) nếu đã tồn tại từ trước.
    const HAND_WRITTEN_APP: &[(&str, &str, Option<&str>)] =
        &[("toggle-settings", "Settings…", Some("CmdOrCtrl+,"))];
    const HAND_WRITTEN_EDIT: &[(&str, &str, Option<&str>)] = &[
        ("find", "Find…", Some("CmdOrCtrl+F")),
        ("clear-buffer", "Clear Buffer", Some("CmdOrCtrl+K")),
    ];
    const HAND_WRITTEN_WINDOW: &[(&str, &str, Option<&str>)] = &[
        (
            "new-preset",
            "New Layout Preset…",
            Some("CmdOrCtrl+Shift+N"),
        ),
        (
            "save-preset",
            "Save Layout as Preset…",
            Some("CmdOrCtrl+Shift+S"),
        ),
    ];

    #[test]
    fn app_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_APP, APP_MENU_ITEMS);
    }

    #[test]
    fn edit_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_EDIT, EDIT_MENU_ITEMS);
    }

    #[test]
    fn window_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_WINDOW, WINDOW_MENU_ITEMS);
    }
}
```

Ghi chú comment ngay phía trên `app_menu`/`edit_menu`/`window_menu` trong `install()`: "Nếu sửa
item nào ở đây, cập nhật `HAND_WRITTEN_*` trong `mod tests` bên dưới VÀ `action-registry.ts` —
`cargo test` sẽ đỏ nếu quên."

**Verify**:

- `cargo check --manifest-path src-tauri/Cargo.toml` pass — không còn cảnh báo unused từ Task 5.
- `cargo test --manifest-path src-tauri/Cargo.toml` pass, gồm 3 test mới.
- Cố tình sửa sai một label trong `HAND_WRITTEN_EDIT` (vd "Find" thay vì "Find…"), chạy `cargo
test`, xác nhận `edit_menu_matches_registry` đỏ với thông báo rõ ràng — rồi revert lại đúng.
- `npm run tauri dev`: menu macOS hiện đúng như trước toàn bộ (File/View giờ generated, App/Edit/
  Window vẫn viết tay) — click từng item, xác nhận accelerator + hành vi không đổi so với trước
  Task 5.

---

### Task 7: Staleness guard cho file sinh

**File(s)**:

- [package.json](../../package.json)

**Phụ thuộc**: Task 5, Task 6

**Decision**: Thêm script `generate:menu:check` — regenerate vào một file tạm, diff với file đã
commit, fail nếu khác. Không tự động sửa.

**Build**:

```json
{
  "scripts": {
    "generate:menu:check": "tsx scripts/generate-menu.ts --check"
  }
}
```

Sửa `scripts/generate-menu.ts` nhận flag `--check`: khi có, ghi ra file tạm
(`node:os` `tmpdir()` + tên cố định), so nội dung với `src-tauri/src/menu_registry.rs` hiện có
bằng `readFileSync` + so chuỗi, `process.exit(1)` kèm thông báo nếu khác, không ghi đè file thật.

**Verify**:

- `npm run generate:menu:check` ngay sau khi file sinh đã commit → exit 0.
- Sửa tay một dòng trong `action-registry.ts` (vd đổi label `"Find…"` thành `"Find"`), chạy lại
  `npm run generate:menu:check` → exit khác 0, báo rõ file lỗi thời — rồi revert.
- Ghi lại vào Task 9 (verify cuối): `npm run generate:menu:check` là một bước bắt buộc, chạy trước
  `cargo test`.

---

### Task 8: Cập nhật `ARCHITECTURE.md`, `README.md`

**File(s)**:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [README.md](../../README.md)

**Phụ thuộc**: Task 1 – Task 7

**Decision**: `ARCHITECTURE.md` — thêm `action-registry.ts` vào module map §3 (`terminal/`), thêm
một quyết định mới trong §5 (D10-style) ghi lại phương án codegen + trade-off đã chọn, note trong
§9 (IPC catalog) rằng menu macOS không thêm IPC command mới. `README.md` — bảng shortcut cập nhật
đúng entry `⌘⇧N` (New Layout Preset — đã có từ `09f5c4d`, giữ nguyên), thêm một câu ở đầu mục
"Keyboard shortcuts" ghi rằng bảng này khớp `src/terminal/action-registry.ts`. **Không đụng
CONTEXT.md** — Action Registry là chi tiết triển khai nội bộ, không phải khái niệm domain sản phẩm.
**Không đụng UX-DESIGN.md** — không có bảng shortcut tổng hợp để đồng bộ.

**Build**:

ARCHITECTURE.md §3, thêm vào khối `src/` liệt kê module:

```
  terminal/       imperative domain: TabManager, TerminalManager, Pane, layout,
                   action-registry (keyboard + menu SSOT), keymap (event matching,
                   derived from action-registry), AgentAttentionTracker, agent-notifier
```

ARCHITECTURE.md §5, thêm sau D9:

```markdown
### D10 — Action registry: keyboard shortcut + macOS menu single source of truth

**Chosen: TS registry (`src/terminal/action-registry.ts`) + build-time codegen for
Cocoa-builtin-free submenus, hand-written + Rust test cross-check for the rest.**

- `ACTION_REGISTRY` holds id/label/scope/menu-position once; `keymap.ts` derives event
  matching, `tab-manager.ts`'s `overlayBlocksAction` reads `scope`.
- `scripts/generate-menu.ts` → `src-tauri/src/menu_registry.rs` (committed, npm
  `predev`/`prebuild`-triggered): File/View submenus (100% registry items) generated in
  full; App/Edit/Window (interleave native Cocoa items) stay hand-written in `menu.rs`,
  checked against generated const tables by a `cargo test`.

**Rejected:**

- _Frontend pushes the registry to Rust at runtime after the webview is ready_ — menu
  would flash/reflow after first frame; adds an IPC command + capability for static data.
- _Keep `menu.rs` fully hand-written, test-only cross-check for every submenu_ — doesn't
  eliminate the "edit two places" tax for File/View, only detects drift after the fact.

**ADR:** proposed, not yet recorded — see `docs/plans/2026-07-27-action-registry.md` §5.
```

README.md, đầu mục "## Keyboard shortcuts":

```markdown
## Keyboard shortcuts

Every shortcut below, and its macOS menu counterpart, comes from one source:
`src/terminal/action-registry.ts`.
```

**Verify**:

- `rg -n "action-registry" docs/ARCHITECTURE.md README.md` trả về ít nhất 2 dòng.
- Đọc lại toàn bộ `ARCHITECTURE.md` §3, §5, §9 — không có câu nào nói sai.

---

### Task 9: Xác minh toàn bộ

**File(s)**: Không sửa file trong task này.

**Phụ thuộc**: Task 1 – Task 8

**Decision**: Không chấp nhận "unit test xanh" nếu build TS hoặc Rust còn đỏ, hoặc file sinh lỗi
thời. Trước khi bắt đầu, `git log --oneline -5` lại một lần nữa — nếu có commit mới chạm vùng file
này kể từ khi task 1 bắt đầu, đối chiếu lại trước khi báo hoàn thành.

**Verify**:

- `npm run generate:menu:check` — exit 0.
- `npm run build` pass.
- `npm test` pass (toàn bộ suite).
- `cargo check --manifest-path src-tauri/Cargo.toml` pass.
- `cargo test --manifest-path src-tauri/Cargo.toml` pass.
- `git status --porcelain=v1` — review danh sách file đổi khớp đúng danh sách `File(s)` của 8 task
  trên.
- Chạy `npm run tauri dev`, xác minh thủ công:
  - Toàn bộ 25 action + họ `select-tab-N`/`select-last-tab` hoạt động y hệt trước plan (phím lẫn
    menu).
  - `Cmd+D` khi Open board đang mở (có tab ẩn phía sau) → không split gì.
  - "New Layout Preset…" (`Cmd+Shift+N` và click menu) và "Save Layout as Preset…" (`Cmd+Shift+S`
    và click menu): no-op khi Settings/PresetEditor/SavePresetDialog đang mở; hoạt động bình
    thường khi không có overlay.
  - `Cmd+,` mở/đóng Settings bất kể overlay nào khác đang mở.
  - `Cmd+9` luôn nhảy tới tab cuối cùng, bất kể số lượng tab.
  - Đổi macOS input source sang một layout không phải US (hoặc dùng System Settings đổi phím
    `]`/`[` qua một layout có ký tự khác ở vị trí đó) → `Cmd+]`/`Cmd+[` và `Cmd+Shift+]`/
    `Cmd+Shift+[` vẫn đúng focus-next/prev và next-tab/prev-tab (fix từ `a6ac532`, xác nhận vẫn
    đúng sau khi registry hoá).

Sau khi task này xanh, đề xuất chạy `/adk:adr` với nội dung ở §5 để ghi lại quyết định.
