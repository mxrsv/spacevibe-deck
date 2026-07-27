# Command Palette + Cheat Sheet

> **For agentic workers:** REQUIRED SUB-SKILL: dùng `superpowers:subagent-driven-development`
> (khuyến nghị) hoặc `superpowers:executing-plans` để chạy plan này theo từng task. Mỗi task có
> checklist Build/Verify riêng, chạy xong task nào verify ngay task đó trước khi sang task sau.

**Spec**: Không có spec riêng — plan này bám theo brief của team lead (xem lịch sử hội thoại,
2026-07-27) và tự xác minh lại toàn bộ bằng chứng bằng cách đọc code trực tiếp tại thời điểm viết
(sau commit `a6ac532` — Lỗi 1/2 keymap vừa fix — và sau `09f5c4d`/`b7e6021`/`1645ac7`).

**Goal**: Giải quyết đúng vấn đề gốc mà audit toàn bộ đường phím đã nêu — không phải "thiếu vài
phím tắt" mà **nhiều action không có đường bàn phím nào cả, và không có chỗ nào trong app để tra
xem có những phím gì**. Thêm (1) **Command palette** (`⌘⇧P`) — gõ để lọc trong toàn bộ
`ACTION_REGISTRY`, Enter để chạy, giải pháp tổng quát cho mọi action kể cả những action không xứng
đáng có chord riêng — và (2) **Cheat sheet trong app** (`⌘/`) — bảng phím tắt render trực tiếp từ
`ACTION_REGISTRY`/`DEFAULT_KEYMAP` đang chạy trong bundle, không phải bảng chép tay có thể lệch.

**Architecture**: Hai overlay Preact mới trong `src/command-palette/` (thư mục ngang hàng
`src/open-board/`, `src/presets/`), phía trên hai module logic thuần không phụ thuộc DOM
(`palette-filter.ts` lọc+xếp hạng, `keybinding-format.ts` in chord ra glyph người đọc được) —
cùng kiểu tách "logic thuần, test nhanh, không cần jsdom" mà `action-registry.ts`/`keymap.ts` đã
theo. Cả hai overlay đọc trực tiếp `ACTION_REGISTRY`/`DEFAULT_KEYMAP` runtime (import tĩnh, cùng
bundle đang chạy) — không có tầng cache/snapshot nào chen giữa, nên **không thể lệch với keymap
thật đang chạy trong app**. Tách biệt với đó: `README.md`'s bảng shortcut (tài liệu cho người chưa
mở app) được **sinh lại lúc build** bằng script Node/TS mới, tái dùng đúng hạ tầng
`predev`/`prebuild` + staleness-check mà `docs/plans/2026-07-27-action-registry.md` (gọi tắt
**plan Registry** từ đây) đã dựng cho `menu_registry.rs`.

**Tech Stack**: TypeScript + Preact + CSS thuần (không thư viện mới — DL-1.1), tái dùng
`@preact/signals` đã có. Không thư viện fuzzy-search — thuật toán xếp hạng tự viết, xem §2.7.

## Global Constraints

- **Phụ thuộc cứng vào plan Registry**: mọi task dưới đây giả định `src/terminal/action-registry.ts`
  (`ACTION_REGISTRY`, `DEFAULT_KEYMAP`, `ActionId`, `isActionId`) đã tồn tại đúng như plan Registry
  Task 1–5 mô tả (registry hoá + hợp nhất `new-preset`/`save-preset`). KHÔNG phụ thuộc Task 6–8 của
  họ (codegen `menu_registry.rs` phía Rust) — palette/cheat sheet thuần TypeScript/Preact, không
  đụng `src-tauri/`.
- Không big-bang: mỗi task tự đứng được, `npm test`/`npx tsc --noEmit` phải xanh ngay sau task đó.
- **Không sửa `overlayBlocksAction`'s if-chain/logic** (`tab-manager.ts`) — plan Registry Task 3 đã
  chuyển nó sang tra `ACTION_SCOPE` từ registry; plan này chỉ cần 2 dòng registry mới có
  `scope: "always"` đúng, không viết thêm code guard nào trong `tab-manager.ts`. Xem §2.2 cho toàn
  bộ lập luận.
- **Không đụng `webkit-ime-fix.ts` hay guard `isComposing`/`keyCode === 229` trong
  `handleShortcut`** (`tab-manager.ts`) — không có lý do phải sửa, xem §2.3 (bằng chứng: guard đó
  chỉ áp cho panes qua `pane.ts`, không panel chrome nào khác dùng nó).
- Không dependency runtime mới, không CSS-in-JS, mọi màu qua token `src/styles.css` (DL-2.1), mọi
  animation trong ngân sách DL-1.2/§7 DESIGN-LANGUAGE.md.
- `npm test`, `npx tsc --noEmit` phải pass ở cuối mỗi task chạm production code (không chỉ task
  cuối).
- Ngôn ngữ: code + comment tiếng Anh (khớp convention repo hiện tại), doc tiếng Việt (D3, khớp toàn
  bộ `docs/` hiện có).

---

## 1. Bối cảnh — bằng chứng đã tự xác minh lại

Đọc trực tiếp `DEFAULT_KEYMAP` (`src/terminal/keymap.ts`, sau `a6ac532`) và `src-tauri/src/menu.rs`
(sau `09f5c4d`) để dựng lại **toàn bộ** chord đã bị chiếm — bảng này là bằng chứng cho §2.4:

**Đã chiếm, `⌘` không Shift**: D(split-row) W(close-pane) E(toggle-expand) T(new-tab)
`]`(focus-next) `[`(focus-prev) `=`(zoom-in) `-`(zoom-out) `0`(zoom-reset) F(find) K(clear-buffer)
`,`(toggle-settings) `1`–`8`(select-tab-N) `9`(select-last-tab) Q(quit, menu.rs riêng) Z(Undo, Cocoa
role) X(Cut) C(Copy) V(Paste) A(Select All) H(Hide) M(Minimize).

**Đã chiếm, `⌘⇧`**: D(split-column) W(close-tab) `]`/`}`(next-tab) `[`/`{`(prev-tab) `+`(zoom-in,
alias) T(reopen-tab) S(save-preset) A(focus-next-attention) N(new-preset, `09f5c4d`) Z(Redo, Cocoa
role) Enter(toggle-zoom-pane).

**Đã chiếm, `⌘⌥`**: ArrowLeft/Right/Up/Down (focus-direction) H(Hide Others, Cocoa role).

**Đã chiếm, `⌃⌘`**: F (Enter Full Screen, Cocoa role mặc định của `.fullscreen()`).

Ba việc audit đã kết luận, tự xác minh lại:

- **Không có UI nào trong app liệt kê được shortcut** — `README.md` là nơi DUY NHẤT, và đã tự lệch
  thực tế nhiều lần trong hôm nay (`b7e6021` thêm `⌘,`, `09f5c4d` thêm `⌘⇧N`, và task Lỗi 1/2 vừa
  đổi ngữ nghĩa `⌘9` — mỗi lần đều phải nhớ tay sửa README theo, không có gì bắt buộc/kiểm tra việc
  đó).
- **Nhiều action không hề có chord** — vd `new-tab`'s "Shell only" (không phải action riêng, không
  tính), hay bất kỳ action tương lai nào không "xứng đáng" một chord riêng (theo đúng khung team
  lead đặt ra) hôm nay hoàn toàn không thể chạy bằng bàn phím, chấm hết — không có cơ chế fallback.
- **`⌘K` không trống** (đã là `clear-buffer`) — xác nhận đúng cảnh báo của team lead, quan trọng
  cho §2.4 (không đi theo quán tính VS Code's "⌘K" cho việc khác).

`docs/plans/2026-07-27-keyboard-parity.md` **chưa tồn tại trên đĩa** tại thời điểm viết plan này
(`ls docs/plans/` không thấy file) — ranh giới với plan đó nêu bằng lời ở §4.

---

## 2. Kiến trúc

### 2.1 File mới, field mới trên registry

```
src/command-palette/
  keybinding-format.ts       (thuần, không DOM)      + keybinding-format.test.ts
  palette-filter.ts          (thuần, không DOM)      + palette-filter.test.ts
  recent-commands.ts         (thuần + 1 signal)      + recent-commands.test.ts
  command-palette.tsx        (Preact overlay)        + command-palette.test.tsx
  shortcuts-cheat-sheet.tsx  (Preact overlay)         + shortcuts-cheat-sheet.test.tsx
scripts/
  generate-shortcuts-readme.ts (mới — codegen README, KHÔNG đụng menu_registry.rs)
```

`ActionDefinition` (plan Registry, `src/terminal/action-registry.ts`) có thêm đúng MỘT field mới —
xem §2.7-registry (dưới) cho lý do cụ thể tại sao field này KHÔNG rơi vào cùng nhóm YAGNI mà
`keywords`/`enabled` đã bị plan Registry từ chối:

```ts
export type ActionCategory = "pane" | "tab" | "terminal" | "app";

export interface ActionDefinition {
  readonly id: string;
  readonly label: string;
  /** NEW — nhóm hiển thị cho cheat sheet + palette, KHÔNG liên quan macOS menu (đó là `menu`). */
  readonly category: ActionCategory;
  readonly scope: ActionScope;
  readonly menu?: { readonly submenu: MenuSubmenu; readonly group?: string };
}
```

### 2.2 Giải mâu thuẫn palette ↔ `overlayBlocksAction` (điểm a + b)

**Nguyên tắc gốc, chốt trước khi đọc phần còn lại**: _Palette không cấp thêm quyền, chỉ cấp thêm
đường tới bàn phím._ Chạy một action qua palette phải cho kết quả **giống hệt bit-for-bit** so với
gõ đúng chord của action đó trực tiếp, kể cả khi bị `overlayBlocksAction` chặn. Palette không bao
giờ "mở khoá" một action mà bấm chord thẳng cũng bị chặn.

Từ nguyên tắc đó, ba quyết định cụ thể:

**(1) Bản thân action mở palette là `scope: "always"`** — giống hệt lý do `toggle-settings` đã có
từ `b7e6021`: nếu action mở palette bị `overlayBlocksAction` chặn theo mặc định, thì khi Settings
đang mở, người dùng **không có cách nào mở palette để gõ "Toggle Settings" và đóng nó lại** — đúng
cái bẫy `toggle-settings` đã tự cắn một lần. `toggle-command-palette`/`toggle-shortcuts` cả hai đều
`scope: "always"`.

Nhưng KHÔNG đơn giản chỉ copy `toggle-settings` — nó còn phải tôn trọng đúng luật `dismissBoard`/
`dismissSettings` KHÔNG áp dụng cho `PresetEditor`/`SavePresetDialog` mà `attention-focus-
coordinator.ts` (`runAttentionFocus`, dùng chung cho `⌘⇧A` và status-dot click) đã lập ra:
**draft đang mở → block hoàn toàn, không dismiss, không mở gì đè lên**. Palette áp đúng luật đó,
nhưng ở App (không phải `tab-manager.ts`) — xem code cụ thể ở Task 5:

```ts
// app.tsx — mirror của runAttentionFocus's rule 2 ("presetEditor/savePresetDialog → block")
const toggleCommandPalette = (): void => {
  if (paletteOpen.value) {
    paletteOpen.value = false;
    tabsRef.current?.focusActive();
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return; // draft in flight — same rule as attention-focus-coordinator.ts, no exceptions
  }
  paletteOpen.value = true;
};
```

`boardOpen`/`settingsOpen` KHÔNG bị dismiss khi mở palette (khác `runAttentionFocus`, vốn dismiss
cả hai) — palette **layer lên trên** thay vì thay thế, vì đóng góp của nó không phải "focus đúng
pane" (nơi dismiss-trước-rồi-mới-focus là bắt buộc để tránh ack nhầm pane) mà là "cho gõ tên một
lệnh" — không có gì để mất nếu Settings/board vẫn ở nguyên phía dưới trong lúc gõ.

**(2) Chọn một dòng trong palette: đóng palette TRƯỚC, dispatch action SAU, cùng một tick đồng
bộ** — tái dùng chính xác pattern `app.tsx`'s `selectTab` đã dùng cho tab-bar click
(`boardOpen.value = false; tabsRef.current?.selectTab(index);`) và
`attention-focus-coordinator.ts`'s docstring ("no `await` anywhere... back-to-back in the same
tick"):

```ts
function confirm(index: number): void {
  const entry = entries[index];
  if (!entry) return;
  recordCommandRun(entry.id);
  paletteOpen.value = false; // đóng TRƯỚC
  tabsRef.current?.focusActive();
  tabsRef.current?.runAction(entry.id as ActionId); // dispatch SAU, cùng tick
}
```

Vì sao thứ tự này đúng, không phải may rủi: sau khi đóng, `overlayBlocksAction` (đọc `boardOpen`/
`settingsOpen`/`editorRequest`/`saveDialogOpen` — **KHÔNG đọc `paletteOpen`**, xem điểm 3 dưới) chỉ
còn thấy đúng những overlay THẬT SỰ vẫn đang che lưới. Nếu user mở palette đè lên Settings rồi chọn
"Split Vertically" (`scope: "terminal"`): đóng palette xong, `settingsOpen` **vẫn còn `true`**
(palette không đụng nó) → `overlayBlocksAction` chặn action → no-op — **giống hệt** kết quả nếu
user gõ thẳng `⌘D` trong lúc Settings đang mở (đã đúng từ `1645ac7`, không đổi). Nếu palette được
mở đè lên terminal trơn (không overlay nào khác) thì sau khi đóng, không gì chặn cả — action chạy
bình thường. Không có case nào palette "linh hoạt hơn" bấm chord thật — đúng nguyên tắc gốc.

**(3) KHÔNG thêm `paletteOpen` vào bốn tín hiệu `overlayBlocksAction` đọc** — đây là phát hiện quan
trọng nhất giải quyết điểm (a)+(b) mà KHÔNG cần sửa `tab-manager.ts` một dòng nào: lo ngại "phím
tắt/menu bị bấm lọt qua trong lúc palette đang mở" **đã được một guard có sẵn xử lý xong**, không
liên quan `overlayBlocksAction` chút nào —

```ts
// tab-manager.ts:904-910 (không đổi)
function isChromeTextField(node: unknown): boolean {
  return (
    (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
    !node.closest(".pane__term")
  );
}
```

`handleShortcut` (window-capture keydown) và `runAction` (macOS menu bridge — `document.
activeElement`) cả hai đều gọi `isChromeTextField` **trước khi** đụng tới `matchBinding`/
`dispatchAction`. Palette's ô lọc là một `<input>` thật, luôn giữ DOM focus trong lúc palette mở
(mount effect `inputRef.current?.focus()`, giống hệt `SavePresetDialog`'s
`containerRef.current?.querySelector("input")?.focus()`). Chừng nào input đó còn focus:

- Một chord gõ trực tiếp (không qua click chuột trong palette) **không bao giờ chạm tới
  `matchBinding`** — `handleShortcut` bail ngay ở `isChromeTextField`, y hệt cách ô đổi tên tab đã
  chặn shortcut hôm nay.
- Một click menu macOS (`runAction`) cũng bail y hệt, vì `document.activeElement` vẫn là ô input
  đó.

Nói cách khác: **guard chống-rò-rỉ đã tồn tại sẵn, miễn phí, không cần một dòng code mới trong
`overlayBlocksAction`.** Đường DUY NHẤT một action thật sự chạy trong lúc palette mở là qua
`confirm()` ở mục (2) — route có kiểm soát, đóng-trước-dispatch-sau như đã chứng minh đúng.

### 2.3 IME tiếng Việt (điểm c)

`applyWebkitImeFix` (`webkit-ime-fix.ts`) chỉ được gọi ở **đúng một chỗ**:
`src/terminal/pane.ts:214`, bên trong `term.open()` của mỗi pane xterm — xác nhận bằng
`rg -n "applyWebkitImeFix" src/` chỉ ra một match. Docstring của chính file đó cũng nói rõ đây là
workaround cho **hai bug cụ thể của xterm.js's internal composition handling trong WKWebView**
(`_keyDownSeen`, `_inputEvent`, dead-key double-commit) — không phải bug của `<input>` HTML chuẩn.

Bằng chứng gián tiếp: `save-preset-dialog.tsx`'s ô tên preset, `open-board.tsx`'s ô rename preset,
và `settings-panel.tsx`'s các field text — không cái nào import `webkit-ime-fix.ts`, không cái nào
có vấn đề gõ tiếng Việt được ghi nhận. Một `<input>` HTML trong WKWebView xử lý composition/Telex
đúng chuẩn, không cần patch gì.

Kết luận: ô lọc của palette là một `<input>` HTML bình thường (`command-palette.tsx`, Task 6) —
**không cần đụng `webkit-ime-fix.ts`, không cần patch gì cho gõ Telex**. Việc DUY NHẤT cần tự bảo vệ
là handler `Enter`-để-chạy CỦA RIÊNG PALETTE (không phải guard toàn cục) — một vài bộ gõ tiếng Việt
dùng Enter để commit một candidate composition; nếu handler không kiểm tra, Enter-commit-composition
có thể VỪA commit ký tự VỪA chạy luôn dòng đang highlight. Guard này KHÔNG tồn tại sẵn ở đâu khác
cho pattern "gõ-để-lọc + Enter-để-chạy" (chưa có precedent trong repo — `open-board.tsx` không có ô
lọc text nào, chỉ list+chip điều hướng bằng phím không cần composition), nên palette tự thêm, mirror
đúng guard `tab-manager.ts`'s `handleShortcut` đã dùng:

```ts
if (event.isComposing || event.keyCode === 229) {
  return; // Vietnamese Telex / CJK candidate commit — never treat as nav/confirm
}
```

đặt ở đầu `command-palette.tsx`'s `handleKeyDown`, xem Task 6.

### 2.4 Chord đề xuất (điểm d)

Từ bảng đã chiếm ở §1: **cả `⌘⇧P` và `⌘/` đều còn trống 100%** — không xuất hiện trong
`DEFAULT_KEYMAP`, không trong `menu.rs`, không trùng role Cocoa builtin nào (`undo/redo/cut/copy/
paste/select_all/minimize/maximize/fullscreen/hide/hide_others/show_all/about/services` — không có
role nào tên P hay `/`).

- **`toggle-command-palette` → `⌘⇧P`**. Lý do: đây là convention thống trị nhất giữa các công cụ
  dev hiện đại — VS Code, Cursor, Sublime Text, Figma, Linear, JetBrains (Shift+Cmd+A nhưng P cũng
  quen) — đúng nhóm app mà người dùng SpaceVibe Deck (chạy CLI agent) gần như chắc chắn dùng hàng
  ngày, nên cơ bắp tay đã có sẵn. **Runner-up đã cân nhắc**: `⌘⇧O` — chính iTerm2 dùng chord này cho
  "Open Quickly" (tính năng gần giống command palette nhất trong hệ sinh thái terminal macOS, và
  file này đã có tiền lệ theo "iTerm2 convention" cho `⌘W`). Cả hai đều trống, đều hợp lý — chọn
  `⌘⇧P` vì đối tượng người dùng chính (dev quen VS Code-family) áp đảo hơn nhóm quen riêng iTerm2's
  Open Quickly, nhưng nêu rõ để `docs/plans/2026-07-27-keyboard-parity.md` (nếu/khi được viết) có
  quyền quyết định khác nếu có lý do sản phẩm mạnh hơn.
- **`toggle-shortcuts` → `⌘/`**. Lý do: "?" (Shift+/) không giữ meta là convention phổ biến
  (Slack/Linear/Notion/GitHub) cho "show shortcuts", nhưng **không dùng được trực tiếp ở đây** — mọi
  binding trong `DEFAULT_KEYMAP` đều bắt buộc giữ `meta: true` (không ngoại lệ, xác nhận đọc lại
  toàn bộ file), vì một phím KHÔNG giữ modifier luôn luôn phải rơi thẳng vào pane đang gõ lệnh shell
  — `⌘/` giữ đúng tinh thần "/" = tra cứu/trợ giúp mà không đụng quy tắc đó.
  Cheat sheet **không bắt buộc phải có chord riêng để dùng được** — nó luôn tới được qua (a) palette
  (gõ "shortcut" hoặc "help"), (b) nút biểu tượng trong `ChromeActions` (mouse-first-class, xem Task 8) — `⌘/` chỉ là đường tắt thứ ba, không phải đường DUY NHẤT, nên rủi ro nếu keyboard-parity.md
  sau này muốn đổi/bỏ chord này là thấp.

Cả hai action **không có menu item macOS** trong plan này — xem quyết định + lý do ở §4 "KHÔNG làm".

### 2.5 Cheat sheet ↔ `README.md` không thể lệch (điểm e)

Hai bề mặt khác mục đích, không gộp làm một:

- **In-app cheat sheet** (`shortcuts-cheat-sheet.tsx`) — import trực tiếp `ACTION_REGISTRY`/
  `DEFAULT_KEYMAP` **runtime**, cùng bundle đang chạy. Không thể lệch, vì không có bước "snapshot"
  nào ở giữa — nó LÀ nguồn thật, hiển thị lại.
- **`README.md`** — tài liệu cho người chưa mở app (duyệt GitHub). Team lead nêu rõ nó đã lệch thật
  hôm nay nhiều lần vì chép tay. Quyết định: **sinh lại lúc build**, tái dùng đúng hạ tầng
  `predev`/`prebuild` + `--check` staleness mà plan Registry Task 6/8 đã dựng cho
  `menu_registry.rs` — không phát minh cơ chế mới, không thêm bước CI mới ngoài cái đã được chấp
  nhận. Trade-off: thêm một script nhỏ + một bước predev nữa (chi phí biên gần 0, hạ tầng đã trả
  tiền); đổi lại README's bảng shortcut **không thể lệch** nữa — khớp đúng nỗi đau team lead nêu là
  động lực, không phải nỗi đau giả định.

  README's bảng bọc trong marker comment để phần văn xuôi tay (câu về Shift+Enter, mục Settings…)
  sống sót qua mỗi lần sinh lại:

  ```markdown
  <!-- SHORTCUTS:START (generated by `npm run generate:shortcuts-readme` — do not hand-edit) -->

  ...bảng...

  <!-- SHORTCUTS:END -->
  ```

  Script MỚI (`generate-shortcuts-readme.ts`), KHÔNG sửa `generate-menu.ts` (single responsibility,
  F9) — cả hai đọc chung `ACTION_REGISTRY`/`DEFAULT_KEYMAP` nhưng sinh hai file khác nhau, không
  phụ thuộc lẫn nhau.

Cheat sheet **mechanically render một dòng một action** (không gộp khéo nhiều action vào một dòng
như README hôm nay đang làm tay, vd `"⌘+ / ⌘- / ⌘0"` gộp 3 action) — đánh đổi một chút mật độ để đổi
lấy zero rủi ro lệch; nếu sau này cần gộp lại cho gọn, đó là field `mergeWith` speculative — không
thêm bây giờ (cùng lý lẽ YAGNI plan Registry đã dùng cho `keywords`).

**Cập nhật sau khi viết plan này**: plan Registry đã sửa lại theo bằng chứng `select-last-tab` là
MỘT action cố định (không tham số hoá) và giờ là một hàng thật trong `ACTION_REGISTRY` (khác
`select-tab-1`..`select-tab-8`, vẫn là họ tham số hoá, vẫn KHÔNG có trong registry). Hệ quả: chỉ còn
`select-tab-N` (họ 1-8) và `Quit` (route qua `quit-requested` event riêng, chưa từng và không thuộc
phạm vi hợp nhất vào `ACTION_REGISTRY`) cần dòng tĩnh viết tay trong `shortcuts-cheat-sheet.tsx`
(KHÔNG đi qua registry) — `select-last-tab` giờ tự động xuất hiện trong cả cheat sheet lẫn palette
qua đúng vòng lặp registry-driven bình thường (category `"tab"`, xem Task 1), không cần dòng tĩnh
riêng nữa. Xem Task 7/9 cho code đã cập nhật theo đúng thay đổi này.

### 2.6 UI/CSS (điểm f)

Tuân `docs/DESIGN-LANGUAGE.md` — không phải "config row" (§5, dành riêng cho settings-shaped value
editing) mà là **list + filter**, cùng họ với `open-board.tsx`'s danh sách workspace/preset/agent
(button rows, `kbd` hint số, arrow-key điều hướng có wrap, không thư viện ngoài). Cụ thể:

- Overlay dùng `.modal-scrim` sẵn có (đúng pattern `preset-editor`/`save-preset`), z-index riêng
  cao hơn MỌI overlay khác hiện có (`tab-popover` 100 là cao nhất hôm nay) — chọn **200**, đủ margin,
  lý do: palette là meta-overlay, theo đúng §2.2 phải render/dùng được bất kể overlay nào khác đang
  mở phía dưới.
- Không `box-shadow` mờ/lệch, không `backdrop-filter` (DL-1.3) — dùng background step + hairline
  (`--hair-strong`) như `preset-editor` đã làm.
- Animation: `rise-in` 0.2s đã có sẵn trong `styles.css` (dùng bởi `.preset-editor`) — tái dùng
  nguyên, không class animation mới. Tôn trọng `prefers-reduced-motion` qua đúng cách `styles.css`
  đã làm (`.panel *` scope, không allowlist tên class — DL §9.3).
- Text field: `<input>` gắn thẳng `value={query.value}`/`onInput` (KHÔNG qua `CommitInput`) — lý do
  rõ: `CommitInput` (DL-6.3) giải quyết vấn đề _store bên ngoài ghi đè `value=` trong lúc đang gõ_
  (đặc thù panel Settings, nơi state re-render từ nhiều nguồn ngoài). Ô lọc của palette chỉ có
  đúng MỘT nguồn ghi (chính người gõ) — không ai khác ghi vào `query.value` — nên không có nguy cơ
  đó xảy ra; `save-preset-dialog.tsx`'s ô tên preset đã dùng đúng pattern signal-bound trực tiếp này
  và không bị liệt vào "Migration status" (§10 DESIGN-LANGUAGE.md) như một vi phạm — tiền lệ rõ
  ràng.
- Copy: tiếng Anh, sentence-case, không viết hoa toàn bộ (DL-4.3) — "Type a command…", "No matching
  command", "Keyboard Shortcuts".
- `--mono` cho mọi giá trị/chord hiển thị (`<kbd>`), `--ui-font` cho label — đúng DL-4.1/4.2.

### 2.7 Xếp hạng kết quả (điểm g)

**Không fuzzy-with-gaps, không thư viện.** Với ~26 action, nhãn (`label`) là cụm nhiều từ mô tả rõ
("Split Vertically", "Clear Buffer", "Increase Font Size") — substring/prefix match trên `label`
(và fallback `id`) đã đủ tốt: gõ 2-3 ký tự bất kỳ trong bất kỳ từ nào của nhãn đã thu hẹp danh sách
hiệu quả. Bốn tầng, đơn giản, dễ test:

1. `label` bắt đầu bằng query (khớp tiền tố toàn nhãn) — điểm cao nhất.
2. Một TỪ trong `label` bắt đầu bằng query (khớp tiền tố một từ, vd "vert" khớp "Split **Vert**ically").
3. `label` chứa query ở bất kỳ đâu (substring).
4. `id` chứa query (fallback cuối, vd user gõ đúng `"zoom-in"`).

Trong CÙNG một tầng, ưu tiên **gần đây dùng** (MRU, tối đa 5 mục, in-memory — không persist, không
đụng `settings-store`/migration, cùng policy "in-memory only" mà `closedTabs`/`unread` trong
`tab-manager.ts` đã dùng) làm tie-break phụ (bonus nhỏ, không đủ nhảy tầng). Query rỗng: hiện MRU
trước, phần còn lại theo đúng thứ tự khai báo trong `ACTION_REGISTRY` (ổn định, không xáo trộn khó
đoán). Xem code chính xác + test cases ở Task 3.

**Registry KHÔNG cần thêm `keywords`** — giữ đúng quyết định YAGNI của plan Registry, mở rộng thêm
một lý do kỹ thuật cụ thể: với nhãn đa từ + khớp tiền tố-theo-từ ở tầng 2, phần lớn từ đồng nghĩa
hợp lý ("zoom" cho cả hai zoom action, "buf" cho buffer, "spl" cho split) đã được `label` chính nó
phủ, không cần một field riêng chưa ai đo lường nhu cầu thật. Nếu sau này có bằng chứng cụ thể
(người dùng gõ mà không tìm ra), thêm `keywords` lúc đó — không đoán trước hình dạng, đúng tinh
thần plan Registry đã đặt ra cho chính nó.

**Registry CẦN thêm `category`** (§2.1) — khác `keywords`, đây có NGƯỜI TIÊU THỤ cụ thể ngay trong
plan này: cheat sheet phải nhóm theo mục đích UX ("Pane"/"Tab"/"Terminal"/"App"), không phải theo
`menu.submenu` (đích macOS Cocoa) — hai trục khác nhau thật sự, không phải cùng một thứ đặt tên
khác. Bằng chứng cụ thể `menu.submenu` không dùng được cho việc này: (1) nhiều action cố ý KHÔNG có
`menu` (`focus-left/right/up/down`, `next-tab`, `prev-tab`, `focus-next`, `focus-prev` — không rác
menu Cocoa vì không cần) nhưng vẫn cần một chỗ trong cheat sheet; (2) registry's `View` submenu hôm
nay trộn lẫn cả pane-action (`split-row`, `toggle-zoom-pane`) lẫn app-action (`zoom-in/out/reset`)
vào một nhóm Cocoa — đúng cho menu macOS, sai cho cheat sheet (team lead's README hôm nay tách chúng
ra hai mục "Panes" và "Terminal & view" khác nhau). Ép cheat sheet nhóm theo `menu.submenu` sẽ vừa
để trống action không-menu, vừa nhóm sai mục đích UX cho action có menu — `category` là field nhỏ
nhất giải quyết cả hai, dữ liệu thuần (string enum), không phá tính serializable mà codegen phía
Rust cần (nó không được Rust side đọc tới — không ảnh hưởng `scripts/generate-menu.ts`/
`menu_registry.rs` của plan Registry chút nào).

---

## 3. Business rules & invariants

- **Palette không bao giờ cấp quyền vượt quá bấm chord trực tiếp** (nguyên tắc gốc §2.2) — mọi test
  của Task 5/6 phải chứng minh đúng bất biến này, không chỉ chứng minh "chạy được".
- **`toggle-command-palette`/`toggle-shortcuts` là `scope: "always"`** — lý do y hệt `toggle-
settings` (không thì tự nhốt), nhưng CÒN kiểm tra riêng `editorRequest`/`saveDialogOpen` trong
  closure của App (không phải trong `overlayBlocksAction`) trước khi mở — draft không bao giờ bị
  che.
- **Đóng palette luôn xảy ra TRƯỚC khi dispatch action đã chọn, cùng tick đồng bộ, không `await`
  chen giữa** — mirror `attention-focus-coordinator.ts`'s invariant.
- **`overlayBlocksAction` (`tab-manager.ts`) không đọc `paletteOpen`** — quyết định có chủ đích
  (§2.2 mục 3), không phải thiếu sót. Test phải xác nhận: mở palette đè lên terminal trơn (không
  overlay khác), gõ thẳng `⌘D` trong lúc palette đang mở (giả lập, không qua click) — action đó
  KHÔNG chạy, vì `isChromeTextField` chặn ở tầng `handleShortcut`/`runAction`, không phải vì
  `overlayBlocksAction` biết về palette.
- **`select-tab-N` (họ tham số hoá 1-8)/`Quit` không xuất hiện trong danh sách CÓ THỂ CHẠY của
  palette** — vì chúng không phải hàng trong `ACTION_REGISTRY` (quyết định của plan Registry,
  palette chỉ render đúng registry). Cheat sheet VẪN hiển thị cả hai (dòng tĩnh, §2.5) để không
  thụt lùi so với README. `select-last-tab` KHÔNG nằm trong nhóm này nữa — nó là một hàng thật
  trong `ACTION_REGISTRY` (cập nhật của plan Registry sau khi viết plan này), nên palette chạy được
  nó bình thường, đúng nguyên tắc gốc "mọi hàng trong registry đều tới được qua palette".
- **MRU (recent commands) in-memory only** — reset khi tắt app, không ghi `settings-store`/
  `localStorage`, không migration nào cần viết.
- **`README.md`'s bảng shortcut là generated content giữa hai marker** — mọi PR sửa tay bảng đó
  ngoài script là bug (staleness-check Task 9 phải bắt được).

## 4. Phạm vi / Ngoài phạm vi

**Làm trong plan này**:

- `palette-filter.ts`, `keybinding-format.ts`, `recent-commands.ts` — logic thuần + test.
- `command-palette.tsx`, `shortcuts-cheat-sheet.tsx` — hai overlay Preact.
- `ActionCategory` field mới trên `ActionDefinition` (delta trên plan Registry's output), backfill
  toàn bộ action hiện có + 2 action mới.
- Wiring `tab-manager.ts` (2 seam mới kiểu `onTogglePalette`/`onToggleShortcuts`, mirror
  `onToggleSettings` — KHÔNG sửa `overlayBlocksAction`), `app.tsx`, `chrome-actions.tsx` (2 nút
  icon mới), `styles.css`.
- `scripts/generate-shortcuts-readme.ts` + `package.json`'s `predev`/`prebuild` + `README.md` marker
  comment hoá.
- `CONTEXT.md` — thêm mục **Command palette** + **Cheat sheet** (khái niệm sản phẩm user-facing
  thật, KHÁC quyết định của plan Registry về việc không đụng CONTEXT.md — họ đúng vì Action Registry
  là chi tiết triển khai nội bộ; ở đây user thực sự nhìn thấy và tương tác trực tiếp với hai khái
  niệm này, nên chúng thuộc glossary).
- `docs/ARCHITECTURE.md` — thêm `command-palette/` vào module map §3 + một quyết định mới (D11-style,
  mirror D10 của plan Registry) + đề xuất ADR (không tự tạo file).

**KHÔNG làm** (ranh giới với `docs/plans/2026-07-27-keyboard-parity.md` — chưa tồn tại trên đĩa,
nêu bằng lời):

- **Quyết định action nào "xứng đáng" một chord riêng vs. để palette lo** — đó đúng là câu hỏi
  keyboard-parity.md phải trả lời (theo mô tả của team lead). Plan này chỉ dựng CÔNG CỤ (palette +
  cheat sheet); nó không tự ý gán/bỏ chord cho bất kỳ action hiện có nào ngoài hai chord của chính
  nó (`⌘⇧P`, `⌘/`) và không giả định trước danh sách "action không xứng đáng chord" nào — palette
  liệt kê TOÀN BỘ `ACTION_REGISTRY` vô điều kiện, không lọc theo "có chord hay không". Nếu
  keyboard-parity.md sau này quyết định gỡ chord của action X, palette vẫn hoạt động đúng (X chỉ
  không còn cột shortcut trong cheat sheet) — không có coupling ngược.
- **Menu item macOS cho `toggle-command-palette`/`toggle-shortcuts`** — về logic có hợp lý (đặt dưới
  Window submenu, cạnh New/Save Preset), nhưng đụng vào `menu.rs`'s Window submenu **viết tay** +
  Rust cross-check test hand-written (`window_menu_matches_registry`, plan Registry Task 7) — một
  phụ thuộc chéo sâu vào chi tiết triển khai Rust của một plan khác chưa chạy. Chrome button (mouse)
  - chord (keyboard) + tự-liệt-kê-trong-palette đã thoả "mouse and keyboard both first-class" (ADR
  6.  đúng mức `focus-next-attention`/`toggle-expand` đã có (hai action đó cũng không có mặt
      trong App menu, chỉ tình cờ có trong View menu). Để dành cho một task/plan riêng sau khi plan
      Registry ổn định.
- **Rebind trong Settings** (đổi chord tuỳ ý) — team lead's brief gốc liệt kê nhưng loại nó ra khỏi
  "hai thứ cần plan" của message giao việc này; palette/cheat sheet chỉ CHẠY/HIỂN THỊ binding hiện
  có, không sửa được.
- **Trường `keywords` trên `ActionDefinition`** — giữ nguyên quyết định YAGNI của plan Registry,
  lập luận mở rộng ở §2.7.
- **Field `enabled`** — giữ nguyên quyết định của plan Registry (business logic riêng từng action,
  không phải điều kiện chung); palette hiển thị mọi action vô điều kiện giống hệt menu hôm nay
  không xám action nào, đã được plan Registry ghi nhận là giới hạn chấp nhận được.
- **Multi-window** — không có action multi-window nào tồn tại để liệt kê (REQUIREMENTS.md AC-1
  "Move Pane To…" chưa implement), không thuộc phạm vi.

---

## 5. Quyết định đã chốt, rủi ro, đề xuất ADR

### Quyết định đã chốt

- Palette là meta-overlay `scope: "always"`, không dismiss board/settings khi mở, đóng-trước-dispatch
  -sau khi chọn — §2.2.
- Không thêm `paletteOpen` vào `overlayBlocksAction` — tái dùng `isChromeTextField` sẵn có — §2.2
  mục 3.
- `category` là field mới hợp lệ (có consumer cụ thể); `keywords`/`enabled` vẫn KHÔNG thêm — §2.7.
- Chord: `⌘⇧P` (palette), `⌘/` (cheat sheet) — cả hai xác minh trống, không menu item macOS — §2.4,
  §4.
- README's bảng shortcut sinh lúc build, tái dùng hạ tầng predev/staleness của plan Registry — §2.5.
- Xếp hạng: 4 tầng substring/prefix trên `label`→`id`, MRU tie-break trong tầng, không thư viện —
  §2.7.

### Rủi ro

- **Phụ thuộc cứng vào plan Registry chưa chạy** — nếu họ đổi shape `ActionDefinition`/
  `DEFAULT_KEYMAP` khác với những gì plan này giả định (vd `KeyBinding.key` → `KeyBinding.code`
  toàn bộ ở Task 4 của họ, khác cách `a6ac532` đã làm — union `CharKeyBinding | PhysicalKeyBinding`,
  giữ `key` cho chữ cái/zoom), `keybinding-format.ts` (Task 2) phải xử lý ĐÚNG shape thật tại thời
  điểm implement, không phải shape giả định trong plan này. Giảm thiểu: `keybinding-format.ts`
  thiết kế nhận cả hai dạng field (`"code" in binding ? ... : ...`, xem Task 2) — không giả định
  cứng một trong hai.
- **Danh sách chord "đã chiếm" ở §1 có thể lệch nếu có commit mới vào `keymap.ts`/`menu.rs` giữa lúc
  viết plan này và lúc implement** — giảm thiểu: Task 4 (chord) phải tự `grep`/đọc lại
  `DEFAULT_KEYMAP` + `menu.rs` NGAY TRƯỚC khi thêm hai binding mới, không tin mù bảng ở §1.
- **z-index 200 có thể xung đột nếu một overlay khác trong tương lai cũng muốn "luôn ở trên cùng"**
  — chấp nhận được cho v1 (chỉ một meta-overlay tồn tại); nếu có overlay thứ hai kiểu này sau này,
  cần một hệ thống z-index có thứ bậc rõ ràng hơn — không thuộc phạm vi plan này.

### Đề xuất ADR

Không tự tạo file, đề xuất chạy `/adk:adr` sau khi Task 10 xong:

> **Command palette là đường bàn phím tổng quát cho mọi action, cheat sheet trong app render trực
> tiếp từ `ACTION_REGISTRY`/`DEFAULT_KEYMAP` runtime.** Palette không cấp quyền vượt quá bấm chord
> trực tiếp — mọi action chọn qua palette chạy qua đúng `overlayBlocksAction` mà action đó đã có,
> palette chỉ đóng chính nó trước khi dispatch. `README.md`'s bảng shortcut sinh lúc build từ cùng
> nguồn, không còn chép tay.

---

## 6. Các task

### Task 1: `ActionCategory` — mở rộng registry, backfill toàn bộ action

**File(s)**:

- [action-registry.ts](../../src/terminal/action-registry.ts) (đã tồn tại — từ plan Registry)
- [action-registry.test.ts](../../src/terminal/action-registry.test.ts)

**Phụ thuộc**: plan Registry Task 1–5 đã implement xong (registry có đúng 25 action: 24 gốc +
`new-preset`).

**Decision**: Thêm `ActionCategory` + field `category` bắt buộc trên `ActionDefinition`, backfill
toàn bộ 25 hàng hiện có, KHÔNG đổi `id`/`label`/`scope`/`menu` của bất kỳ hàng nào (chỉ thêm field).

**Build**:

```ts
export type ActionCategory = "pane" | "tab" | "terminal" | "app";
```

Thêm `category:` vào interface `ActionDefinition` (giữa `label` và `scope`, xem §2.1), rồi backfill
theo bảng. **Lưu ý**: plan Registry đã cập nhật (sau khi plan này được viết) để `select-last-tab`
là MỘT HÀNG THẬT trong `ACTION_REGISTRY` (không còn nằm ngoài như bản đầu — chỉ họ tham số hoá
`select-tab-1`..`select-tab-8` mới còn nằm ngoài registry) — backfill bảng dưới phải gồm cả
`select-last-tab`, xác nhận lại tên/id chính xác của hàng đó trong `action-registry.ts` thật tại
thời điểm implement trước khi gõ theo bảng này (tên id có thể khác nếu họ đổi lần nữa):

| category     | action ids                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"pane"`     | `close-pane`, `split-row`, `split-column`, `toggle-zoom-pane`, `toggle-expand`, `focus-next-attention`, `focus-next`, `focus-prev`, `focus-left`, `focus-right`, `focus-up`, `focus-down` |
| `"tab"`      | `new-tab`, `reopen-tab`, `close-tab`, `save-preset`, `new-preset`, `next-tab`, `prev-tab`, `select-last-tab`                                                                              |
| `"terminal"` | `find`, `clear-buffer`                                                                                                                                                                    |
| `"app"`      | `toggle-settings`, `zoom-in`, `zoom-out`, `zoom-reset`                                                                                                                                    |

**Verify**:

- `npm test -- action-registry` — sửa test snapshot "tập id" hiện có (KHÔNG đổi tập id, chỉ đảm bảo
  vẫn pass — field mới không ảnh hưởng tập id) + thêm test mới:

  ```ts
  it("assigns a category to every action, no gaps", () => {
    for (const action of ACTION_REGISTRY) {
      expect(["pane", "tab", "terminal", "app"]).toContain(action.category);
    }
  });

  it("every action id from §-table Task 1 has the expected category", () => {
    const byId = new Map(ACTION_REGISTRY.map((a) => [a.id, a.category]));
    expect(byId.get("close-pane")).toBe("pane");
    expect(byId.get("new-tab")).toBe("tab");
    expect(byId.get("find")).toBe("terminal");
    expect(byId.get("toggle-settings")).toBe("app");
  });
  ```

- `npm run build` pass — không consumer nào khác của `ActionDefinition` bị vỡ (field mới là bắt
  buộc, TypeScript sẽ tự báo nếu quên backfill một hàng, nhờ `as const satisfies readonly
ActionDefinition[]`).

---

### Task 2: `keybinding-format.ts` — in chord ra glyph người đọc được

**File(s)**:

- [keybinding-format.ts](../../src/command-palette/keybinding-format.ts) (mới)
- [keybinding-format.test.ts](../../src/command-palette/keybinding-format.test.ts) (mới)

**Phụ thuộc**: Task 1 (dùng type `KeyBinding` từ `action-registry.ts`/`keymap.ts`).

**Decision**: Hàm thuần, không DOM. Nhận diện CẢ HAI dạng `KeyBinding` có thể có tại thời điểm
implement (`{ key: string }` hoặc `{ code: string }` — xem rủi ro ở §5, KHÔNG giả định cứng một
trong hai) bằng `"code" in binding`.

**Build**:

```ts
// src/command-palette/keybinding-format.ts
import type { KeyBinding } from "../terminal/keymap";

/** event.code (physical) -> display glyph, for codes with no obvious 1:1 letter. */
const CODE_LABELS: Readonly<Record<string, string>> = {
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Enter: "⏎",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** event.key (lowercased, as DEFAULT_KEYMAP stores it) -> display glyph. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "⏎",
};

function keyOrCodeLabel(binding: KeyBinding): string {
  if ("code" in binding) {
    const code = binding.code;
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }
  const key = binding.key;
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** "⌘⇧D" style, Apple HIG modifier order (⌃⌥⇧⌘) + key/code glyph last. */
export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("⌃");
  if (binding.alt) parts.push("⌥");
  if (binding.shift) parts.push("⇧");
  if (binding.meta) parts.push("⌘");
  parts.push(keyOrCodeLabel(binding));
  return parts.join("");
}

/** Every binding in `keymap` whose `action` matches `id`, in declaration order. */
export function bindingsForAction(
  id: string,
  keymap: readonly KeyBinding[],
): readonly KeyBinding[] {
  return keymap.filter((b) => b.action === id);
}

/** All bindings for `id`, formatted and joined " / "; null if none exist (menu-only action). */
export function formatBindingsForAction(
  id: string,
  keymap: readonly KeyBinding[],
): string | null {
  const bindings = bindingsForAction(id, keymap);
  return bindings.length === 0
    ? null
    : bindings.map(formatKeyBinding).join(" / ");
}
```

- [ ] **Step 1 — test trước (đỏ)**:

```ts
// keybinding-format.test.ts
import { describe, expect, it } from "vitest";
import {
  formatKeyBinding,
  formatBindingsForAction,
  bindingsForAction,
} from "./keybinding-format";
import type { KeyBinding } from "../terminal/keymap";

describe("formatKeyBinding", () => {
  it("formats a plain meta+letter binding", () => {
    expect(
      formatKeyBinding({ key: "d", meta: true, action: "split-row" }),
    ).toBe("⌘D");
  });

  it("formats meta+shift in HIG order (⇧ before ⌘... no, ⌘ last)", () => {
    expect(
      formatKeyBinding({
        key: "d",
        meta: true,
        shift: true,
        action: "split-column",
      }),
    ).toBe("⌘⇧D");
  });

  it("formats a physical-code binding using the glyph table", () => {
    expect(
      formatKeyBinding({
        code: "BracketRight",
        meta: true,
        action: "focus-next",
      }),
    ).toBe("⌘]");
  });

  it("formats meta+alt+arrow (key-based, lowercased as DEFAULT_KEYMAP stores it)", () => {
    expect(
      formatKeyBinding({
        key: "arrowleft",
        meta: true,
        alt: true,
        action: "focus-left",
      }),
    ).toBe("⌘⌥←");
  });

  it("formats comma", () => {
    expect(
      formatKeyBinding({ key: ",", meta: true, action: "toggle-settings" }),
    ).toBe("⌘,");
  });
});

describe("bindingsForAction / formatBindingsForAction", () => {
  const keymap: readonly KeyBinding[] = [
    { key: "=", meta: true, action: "zoom-in" },
    { key: "+", meta: true, shift: true, action: "zoom-in" },
    { key: "-", meta: true, action: "zoom-out" },
  ];

  it("joins multiple bindings for the same action with ' / '", () => {
    expect(formatBindingsForAction("zoom-in", keymap)).toBe("⌘= / ⌘⇧+");
  });

  it("returns null for an action with zero bindings (menu-only)", () => {
    expect(formatBindingsForAction("new-preset", keymap)).toBeNull();
  });

  it("bindingsForAction returns the raw matches in declaration order", () => {
    expect(bindingsForAction("zoom-in", keymap)).toHaveLength(2);
  });
});
```

- [ ] **Step 2 — chạy, xác nhận FAIL**: `npm test -- keybinding-format` — lỗi "Cannot find module
      './keybinding-format'".
- [ ] **Step 3 — implement** đúng code ở block Build trên.
- [ ] **Step 4 — chạy lại, xác nhận PASS**: `npm test -- keybinding-format`.
- [ ] **Step 5 — commit**: `feat(command-palette): add keybinding-format for chord display strings`.

---

### Task 3: `palette-filter.ts` — lọc + xếp hạng thuần

**File(s)**:

- [palette-filter.ts](../../src/command-palette/palette-filter.ts) (mới)
- [palette-filter.test.ts](../../src/command-palette/palette-filter.test.ts) (mới)

**Phụ thuộc**: Task 1, Task 2.

**Decision**: Hàm thuần nhận `registry`/`keymap` làm tham số (KHÔNG default vào `ACTION_REGISTRY`
thật — cùng pattern `matchBinding(event, keymap = DEFAULT_KEYMAP)`/`isActionId(value, registry)` đã
dùng, để test dùng fixture nhỏ, ổn định, không phụ thuộc nội dung registry thật thay đổi theo thời
gian).

**Build**:

```ts
// src/command-palette/palette-filter.ts
import type { ActionDefinition } from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";
import { formatBindingsForAction } from "./keybinding-format";

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly category: ActionDefinition["category"];
  /** Formatted chord(s), or null for a menu-only action with no default binding. */
  readonly shortcut: string | null;
}

export interface PaletteFilterInput {
  readonly registry: readonly ActionDefinition[];
  readonly keymap: readonly KeyBinding[];
  readonly query: string;
  /** Most-recently-run action ids, newest first. */
  readonly recentIds: readonly string[];
}

function toEntry(
  action: ActionDefinition,
  keymap: readonly KeyBinding[],
): PaletteEntry {
  return {
    id: action.id,
    label: action.label,
    category: action.category,
    shortcut: formatBindingsForAction(action.id, keymap),
  };
}

/** null = no match; higher = better. See docs/plans/2026-07-27-command-palette.md §2.7. */
function scoreMatch(entry: PaletteEntry, query: string): number | null {
  const label = entry.label.toLowerCase();
  const id = entry.id.toLowerCase();
  if (label.startsWith(query)) return 3;
  const words = label.split(/[^a-z0-9]+/).filter((w) => w !== "");
  if (words.some((w) => w.startsWith(query))) return 2;
  if (label.includes(query)) return 1;
  if (id.includes(query)) return 0;
  return null;
}

function recencyBonus(id: string, recentIds: readonly string[]): number {
  const index = recentIds.indexOf(id);
  // Small enough to never cross a whole score tier (tiers are 1.0 apart) —
  // only breaks ties within the same tier, never outranks a better match.
  return index === -1 ? 0 : (1 - index / recentIds.length) * 0.5;
}

function orderByRecency(
  entries: readonly PaletteEntry[],
  recentIds: readonly string[],
): PaletteEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const recent = recentIds
    .map((id) => byId.get(id))
    .filter((e): e is PaletteEntry => e !== undefined);
  const recentSet = new Set(recent.map((e) => e.id));
  const rest = entries.filter((e) => !recentSet.has(e.id));
  return [...recent, ...rest];
}

export function filterPaletteEntries(
  input: PaletteFilterInput,
): PaletteEntry[] {
  const { registry, keymap, query, recentIds } = input;
  const entries = registry.map((a) => toEntry(a, keymap));
  const q = query.trim().toLowerCase();
  if (q === "") {
    return orderByRecency(entries, recentIds);
  }
  return entries
    .map((entry) => ({
      entry,
      score: scoreMatch(entry, q),
    }))
    .filter(
      (scored): scored is { entry: PaletteEntry; score: number } =>
        scored.score !== null,
    )
    .map((scored) => ({
      ...scored,
      score: scored.score + recencyBonus(scored.entry.id, recentIds),
    }))
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.entry);
}
```

- [ ] **Step 1 — test trước (đỏ)**:

```ts
// palette-filter.test.ts
import { describe, expect, it } from "vitest";
import { filterPaletteEntries } from "./palette-filter";
import type { ActionDefinition } from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";

const REGISTRY: readonly ActionDefinition[] = [
  {
    id: "split-row",
    label: "Split Vertically",
    category: "pane",
    scope: "terminal",
  },
  {
    id: "split-column",
    label: "Split Horizontally",
    category: "pane",
    scope: "terminal",
  },
  {
    id: "clear-buffer",
    label: "Clear Buffer",
    category: "terminal",
    scope: "terminal",
  },
  {
    id: "toggle-settings",
    label: "Settings…",
    category: "app",
    scope: "always",
  },
];

const KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  { key: "k", meta: true, action: "clear-buffer" },
  { key: ",", meta: true, action: "toggle-settings" },
];

describe("filterPaletteEntries", () => {
  it("empty query, no recents: returns registry declaration order", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "",
      recentIds: [],
    });
    expect(result.map((e) => e.id)).toEqual([
      "split-row",
      "split-column",
      "clear-buffer",
      "toggle-settings",
    ]);
  });

  it("empty query, with recents: recents float to the top in MRU order", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "",
      recentIds: ["clear-buffer", "toggle-settings"],
    });
    expect(result.map((e) => e.id)).toEqual([
      "clear-buffer",
      "toggle-settings",
      "split-row",
      "split-column",
    ]);
  });

  it("prefix match on the whole label ranks above a mid-word substring match", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "s",
      recentIds: [],
    });
    // "Split Vertically"/"Split Horizontally" start with "s"; "Settings…" also
    // starts with "s" — all tier 3, tie-broken by declaration order.
    expect(result.map((e) => e.id)).toEqual([
      "split-row",
      "split-column",
      "toggle-settings",
    ]);
  });

  it("word-prefix match (tier 2) ranks above substring-only match (tier 1)", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "vert",
      recentIds: [],
    });
    expect(result.map((e) => e.id)).toEqual(["split-row"]);
  });

  it("recency breaks ties within the same tier, never crosses tiers", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "s",
      recentIds: ["toggle-settings"],
    });
    // toggle-settings is recent, but split-row/split-column still both prefix-
    // match "s" — recency only re-orders WITHIN the tier, so toggle-settings
    // (tier 3, recent) outranks the other two tier-3 entries.
    expect(result[0].id).toBe("toggle-settings");
  });

  it("returns [] when nothing matches", () => {
    const result = filterPaletteEntries({
      registry: REGISTRY,
      keymap: KEYMAP,
      query: "xyz-no-match",
      recentIds: [],
    });
    expect(result).toEqual([]);
  });

  it("includes shortcut string per entry, null for a menu-only action", () => {
    const registryWithMenuOnly: readonly ActionDefinition[] = [
      ...REGISTRY,
      {
        id: "new-preset",
        label: "New Layout Preset…",
        category: "tab",
        scope: "terminal",
      },
    ];
    const result = filterPaletteEntries({
      registry: registryWithMenuOnly,
      keymap: KEYMAP,
      query: "",
      recentIds: [],
    });
    expect(result.find((e) => e.id === "split-row")?.shortcut).toBe("⌘D");
    expect(result.find((e) => e.id === "new-preset")?.shortcut).toBeNull();
  });
});
```

- [ ] **Step 2 — chạy, xác nhận FAIL**: `npm test -- palette-filter`.
- [ ] **Step 3 — implement** đúng code ở block Build trên.
- [ ] **Step 4 — chạy lại, xác nhận PASS**.
- [ ] **Step 5 — commit**: `feat(command-palette): add palette-filter with tiered label match + MRU tie-break`.

---

### Task 4: `chrome/events.ts` signals + `recent-commands.ts` MRU

**File(s)**:

- [events.ts](../../src/chrome/events.ts)
- [recent-commands.ts](../../src/command-palette/recent-commands.ts) (mới)
- [recent-commands.test.ts](../../src/command-palette/recent-commands.test.ts) (mới)

**Phụ thuộc**: không (độc lập, có thể chạy song song Task 2/3).

**Decision**: `paletteOpen`/`shortcutsOpen` là module signal trong `chrome/events.ts`, đúng chỗ
`settingsOpen` đã được promote tới (`1645ac7`) vì cùng lý do — `tab-manager.ts` (ngoài closure
component `App`) cần đọc được. MRU sống ở module riêng (`recent-commands.ts`), không phải
`chrome/events.ts`, vì nó không phải overlay-open state — tách theo trách nhiệm (F9).

**Build**:

`chrome/events.ts` — thêm 2 dòng, cạnh `settingsOpen`:

```ts
/**
 * Command palette open state — sits alongside `settingsOpen` for the same
 * reason (1645ac7): `tab-manager.ts`'s overlay scope guard reads
 * `boardOpen`/`settingsOpen`/`editorRequest`/`saveDialogOpen`, but
 * deliberately NOT this one — see docs/plans/2026-07-27-command-palette.md
 * §2.2 for why the palette does not need to be in that block-list.
 */
export const paletteOpen = signal(false);
/** Keyboard-shortcuts cheat sheet open state — same shape as `paletteOpen`. */
export const shortcutsOpen = signal(false);
```

`recent-commands.ts` — mới:

```ts
// src/command-palette/recent-commands.ts
import { signal } from "@preact/signals";

const MAX_RECENT = 5;

/**
 * Most-recently-run command palette action ids, newest first. In-memory
 * only — resets on relaunch, same policy as `closedTabs`/`unread` in
 * tab-manager.ts. Not persisted: no settings-store field, no migration.
 */
export const recentCommandIds = signal<readonly string[]>([]);

/** Record `id` as just-run: moves it to the front, dedupes, caps at MAX_RECENT. */
export function recordCommandRun(id: string): void {
  const withoutId = recentCommandIds.value.filter(
    (existing) => existing !== id,
  );
  recentCommandIds.value = [id, ...withoutId].slice(0, MAX_RECENT);
}
```

- [ ] **Step 1 — test trước (đỏ)** cho `recent-commands.ts`:

```ts
// recent-commands.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { recentCommandIds, recordCommandRun } from "./recent-commands";

describe("recordCommandRun", () => {
  afterEach(() => {
    recentCommandIds.value = [];
  });

  it("adds the id to the front", () => {
    recordCommandRun("split-row");
    expect(recentCommandIds.value).toEqual(["split-row"]);
  });

  it("moves an existing id to the front instead of duplicating it", () => {
    recordCommandRun("split-row");
    recordCommandRun("clear-buffer");
    recordCommandRun("split-row");
    expect(recentCommandIds.value).toEqual(["split-row", "clear-buffer"]);
  });

  it("caps at 5 entries, dropping the oldest", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      recordCommandRun(id);
    }
    expect(recentCommandIds.value).toEqual(["f", "e", "d", "c", "b"]);
  });
});
```

- [ ] **Step 2 — chạy, xác nhận FAIL**: `npm test -- recent-commands`.
- [ ] **Step 3 — implement** cả hai file đúng block Build trên.
- [ ] **Step 4 — chạy lại, xác nhận PASS**.
- [ ] **Step 5 — commit**: `feat(command-palette): add paletteOpen/shortcutsOpen signals + in-memory recent-commands MRU`.

---

### Task 5: `tab-manager.ts` wiring — 2 seam mới, KHÔNG sửa `overlayBlocksAction`

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: Task 1 (registry có 2 action mới với `scope: "always"` — xem Interfaces bên dưới).

**Interfaces**:

- Consumes: `ACTION_REGISTRY` từ `action-registry.ts` phải đã có 2 hàng
  `{ id: "toggle-command-palette", scope: "always", category: "app" }` và
  `{ id: "toggle-shortcuts", scope: "always", category: "app" }` — task này KHÔNG thêm chúng (đó
  là Task 1, coi như đã xong); task này chỉ wiring dispatch.
- Produces: `TabManagerDeps.onTogglePalette?: () => void`, `TabManagerDeps.onToggleShortcuts?: () =>
void` — App (Task 8) implement hai deps này.

**Decision**: Mirror chính xác pattern `onToggleSettings` (`b7e6021`) — action chỉ gọi seam, không
bao giờ ghi trực tiếp vào `paletteOpen`/`shortcutsOpen`. `overlayBlocksAction` KHÔNG đổi một dòng —
vì `scope: "always"` đã đọc từ registry (plan Registry Task 3), hai action mới tự động lọt qua đúng
nhánh exemption có sẵn, không cần thêm `action === "toggle-command-palette"` vào if-chain nào (nếu
plan Registry Task 3 CHƯA implement lúc chạy task này — tức `overlayBlocksAction` vẫn còn if-chain
viết tay của `1645ac7`/`a75a247` — thì mới cần thêm 2 dòng `action === "toggle-command-palette" ||
action === "toggle-shortcuts"` vào if-chain đó tạm thời; xoá lại khi plan Registry Task 3 chạy sau).

**Build**:

```ts
// Thêm vào TabManagerDeps, cạnh onToggleSettings:
/**
 * ⌘⇧P (`toggle-command-palette`) routes here instead of writing `paletteOpen`
 * directly — same shape as `onToggleSettings`. App owns the open/close+
 * focus-return flow (see app.tsx's `toggleCommandPalette`, which also checks
 * `editorRequest`/`saveDialogOpen` before opening — see docs/plans/
 * 2026-07-27-command-palette.md §2.2). Missing = safe no-op.
 */
onTogglePalette?: () => void;
/** ⌘/ (`toggle-shortcuts`) — same shape as onTogglePalette above. */
onToggleShortcuts?: () => void;
```

```ts
// Thêm vào `commands`, cạnh "toggle-settings":
"toggle-command-palette": () => deps.onTogglePalette?.(),
"toggle-shortcuts": () => deps.onToggleShortcuts?.(),
```

**Verify**:

- `npm test -- tab-manager` — thêm test mới, mirror đúng bộ test `toggle-settings routing` đã có
  (`describe("createTabManager toggle-settings routing...")`):

  ```ts
  describe("createTabManager toggle-command-palette / toggle-shortcuts routing", () => {
    it("⌘⇧P routes through onTogglePalette exactly once", async () => {
      const onTogglePalette = vi.fn();
      const { tm } = setup({ deps: { onTogglePalette } });
      await tm.init();
      await flush();
      tm.runAction("toggle-command-palette");
      expect(onTogglePalette).toHaveBeenCalledTimes(1);
      tm.dispose();
    });

    it("is NOT blocked by the overlay scope guard while Settings is open", async () => {
      const onTogglePalette = vi.fn();
      const { tm } = setup({ deps: { onTogglePalette } });
      await tm.init();
      await flush();
      settingsOpen.value = true;
      tm.runAction("toggle-command-palette");
      expect(onTogglePalette).toHaveBeenCalledTimes(1);
      settingsOpen.value = false;
      tm.dispose();
    });

    it("⌘/ routes through onToggleShortcuts exactly once", async () => {
      const onToggleShortcuts = vi.fn();
      const { tm } = setup({ deps: { onToggleShortcuts } });
      await tm.init();
      await flush();
      tm.runAction("toggle-shortcuts");
      expect(onToggleShortcuts).toHaveBeenCalledTimes(1);
      tm.dispose();
    });

    it("without the dep: both are a safe no-op", async () => {
      const { tm } = setup({});
      await tm.init();
      await flush();
      expect(() => tm.runAction("toggle-command-palette")).not.toThrow();
      expect(() => tm.runAction("toggle-shortcuts")).not.toThrow();
      tm.dispose();
    });
  });
  ```

- Thêm MỘT test chứng minh bất biến cốt lõi §2.2/§3 — dispatch một `scope: "terminal"` action
  trong khi `settingsOpen` vẫn `true` (mô phỏng "palette đã đóng nhưng Settings vẫn mở phía dưới")
  KHÔNG chạy, đúng như bấm chord trực tiếp:

  ```ts
  it("a scope:terminal action dispatched right after the palette 'closes' is still blocked if Settings is still open underneath — palette grants no extra access", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row");
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(2);

    settingsOpen.value = true; // Settings still open — palette already "closed" itself
    tm.runAction("close-pane"); // exact call shape confirm() in command-palette.tsx makes
    await flush();

    expect(statusInfo.value.paneCount).toBe(2); // blocked, same as pressing ⌘W directly
    settingsOpen.value = false;
    tm.dispose();
  });
  ```

- `npm run build` pass.

---

### Task 6: `command-palette.tsx` — overlay Preact

**File(s)**:

- [command-palette.tsx](../../src/command-palette/command-palette.tsx) (mới)
- [command-palette.test.tsx](../../src/command-palette/command-palette.test.tsx) (mới)

**Phụ thuộc**: Task 3 (`filterPaletteEntries`), Task 4 (`recentCommandIds`/`recordCommandRun`).

**Interfaces**:

- Consumes: `filterPaletteEntries` (Task 3), `recentCommandIds`/`recordCommandRun` (Task 4).
- Produces: `CommandPaletteProps { onRun(id: string): void; onClose(): void; }` — Task 8 (`app.tsx`)
  render component này với `registry`/`keymap` truyền vào từ import tĩnh
  `ACTION_REGISTRY`/`DEFAULT_KEYMAP`.

**Decision**: Component nhận `registry`/`keymap` qua props (không import trực tiếp bên trong) — giữ
component test được với fixture nhỏ, đúng pattern Task 3. `onRun`/`onClose` là callback thuần do App
truyền vào (App sở hữu thứ tự đóng-trước-dispatch-sau, KHÔNG phải component này — xem §2.2, việc
component này làm chỉ là gọi `onClose()` rồi `onRun(id)` theo đúng thứ tự, App quyết định
`onClose`/`onRun` LÀ GÌ).

**Build**:

```tsx
// src/command-palette/command-palette.tsx
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ActionDefinition } from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";
import { filterPaletteEntries } from "./palette-filter";
import { recentCommandIds, recordCommandRun } from "./recent-commands";

export interface CommandPaletteProps {
  registry: readonly ActionDefinition[];
  keymap: readonly KeyBinding[];
  onRun(id: string): void;
  onClose(): void;
}

export function CommandPalette({
  registry,
  keymap,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const query = useSignal("");
  const highlighted = useSignal(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = filterPaletteEntries({
    registry,
    keymap,
    query: query.value,
    recentIds: recentCommandIds.value,
  });

  function confirm(index: number): void {
    const entry = entries[index];
    if (!entry) {
      return;
    }
    recordCommandRun(entry.id);
    // Close BEFORE dispatch, same tick — see docs/plans/2026-07-27-command-
    // palette.md §2.2. `onClose`/`onRun` are supplied by App; this component
    // only fixes the ORDER, not what each callback does.
    onClose();
    onRun(entry.id);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Vietnamese Telex / CJK candidate commit — never treat as nav/confirm.
    // See docs/plans/2026-07-27-command-palette.md §2.3.
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        highlighted.value = Math.min(highlighted.value + 1, entries.length - 1);
        break;
      case "ArrowUp":
        highlighted.value = Math.max(highlighted.value - 1, 0);
        break;
      case "Enter":
        confirm(highlighted.value);
        break;
      case "Escape":
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim command-palette-scrim" onMouseDown={onClose}>
      <div
        class="command-palette"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          class="command-palette__input"
          type="text"
          placeholder="Type a command…"
          spellcheck={false}
          value={query.value}
          onInput={(event) => {
            query.value = (event.target as HTMLInputElement).value;
            highlighted.value = 0; // fresh filter → snap highlight back to top
          }}
        />
        <ul class="command-palette__list" role="listbox">
          {entries.length === 0 ? (
            <li class="command-palette__empty">No matching command</li>
          ) : (
            entries.map((entry, index) => (
              <li
                key={entry.id}
                role="option"
                aria-selected={index === highlighted.value}
                class={`command-palette__row ${
                  index === highlighted.value ? "is-highlighted" : ""
                }`}
                onMouseEnter={() => {
                  highlighted.value = index;
                }}
                onClick={() => confirm(index)}
              >
                <span class="command-palette__label">{entry.label}</span>
                {entry.shortcut !== null ? (
                  <kbd class="command-palette__shortcut">{entry.shortcut}</kbd>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 1 — test trước (đỏ)**:

```tsx
// command-palette.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/preact";
```

**Lưu ý**: repo chưa có `@testing-library/preact` — kiểm tra `package.json` trước khi viết test
này (grep `"@testing-library"` — không có tại thời điểm viết plan). Task này KHÔNG được thêm
dependency mới ngoài kế hoạch (Global Constraints) — dùng thẳng Preact's `render` từ
`preact-render-to-string`? Không — cách repo hiện có: `settings-panel.test.tsx` render bằng
`preact`'s `render` trực tiếp vào một DOM node thật (jsdom), rồi query bằng
`container.querySelector`/dispatch native `KeyboardEvent`/`InputEvent` — đọc file đó để lấy đúng
pattern trước khi viết test này (không dùng testing-library, dùng `preact`'s `render`/`h` trực
tiếp + `document.createElement`). Test cụ thể:

```tsx
// command-palette.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render } from "preact";
import { CommandPalette } from "./command-palette";
import { recentCommandIds } from "./recent-commands";
import type { ActionDefinition } from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";

const REGISTRY: readonly ActionDefinition[] = [
  {
    id: "split-row",
    label: "Split Vertically",
    category: "pane",
    scope: "terminal",
  },
  {
    id: "clear-buffer",
    label: "Clear Buffer",
    category: "terminal",
    scope: "terminal",
  },
];
const KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "k", meta: true, action: "clear-buffer" },
];

function mount(onRun: (id: string) => void, onClose: () => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(
    <CommandPalette
      registry={REGISTRY}
      keymap={KEYMAP}
      onRun={onRun}
      onClose={onClose}
    />,
    container,
  );
  return container;
}

describe("CommandPalette", () => {
  afterEach(() => {
    recentCommandIds.value = [];
    document.body.innerHTML = "";
  });

  it("filters rows as the input changes", () => {
    const container = mount(vi.fn(), vi.fn());
    const input = container.querySelector<HTMLInputElement>(
      ".command-palette__input",
    )!;
    input.value = "clear";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const labels = [
      ...container.querySelectorAll(".command-palette__label"),
    ].map((el) => el.textContent);
    expect(labels).toEqual(["Clear Buffer"]);
  });

  it("Enter on the highlighted row calls onClose() THEN onRun(id), in that order", () => {
    const calls: string[] = [];
    const onRun = vi.fn((id: string) => calls.push(`run:${id}`));
    const onClose = vi.fn(() => calls.push("close"));
    const container = mount(onRun, onClose);
    const list = container.querySelector(".command-palette")!;
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(calls).toEqual(["close", "run:split-row"]); // first row, order matters — §2.2
  });

  it("ArrowDown moves the highlight, Enter then runs the newly-highlighted row", () => {
    const onRun = vi.fn();
    const container = mount(onRun, vi.fn());
    const list = container.querySelector(".command-palette")!;
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onRun).toHaveBeenCalledWith("clear-buffer");
  });

  it("Escape calls onClose without calling onRun", () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    const container = mount(onRun, onClose);
    const list = container.querySelector(".command-palette")!;
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("a composing keydown (IME) is ignored — never confirms or navigates", () => {
    const onRun = vi.fn();
    const container = mount(onRun, vi.fn());
    const list = container.querySelector(".command-palette")!;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(event, "isComposing", { value: true });
    list.dispatchEvent(event);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("shows the chord next to each row that has one, nothing for one that doesn't", () => {
    const container = mount(vi.fn(), vi.fn());
    const kbds = [
      ...container.querySelectorAll(".command-palette__shortcut"),
    ].map((el) => el.textContent);
    expect(kbds).toEqual(["⌘D", "⌘K"]);
  });
});
```

- [ ] **Step 2 — chạy, xác nhận FAIL**: `npm test -- command-palette`.
- [ ] **Step 3 — implement** đúng code ở block Build trên.
- [ ] **Step 4 — chạy lại, xác nhận PASS**.
- [ ] **Step 5 — commit**: `feat(command-palette): add CommandPalette overlay component`.

---

### Task 7: `shortcuts-cheat-sheet.tsx` — bảng tham chiếu chỉ đọc

**File(s)**:

- [shortcuts-cheat-sheet.tsx](../../src/command-palette/shortcuts-cheat-sheet.tsx) (mới)
- [shortcuts-cheat-sheet.test.tsx](../../src/command-palette/shortcuts-cheat-sheet.test.tsx) (mới)

**Phụ thuộc**: Task 2 (`formatBindingsForAction`).

**Decision**: Nhóm theo `category`, thứ tự nhóm cố định `["pane", "tab", "terminal", "app"]`
(khớp thứ tự README hôm nay: Panes → Tabs → Terminal & view). Hai dòng tĩnh KHÔNG từ registry
(`select-tab-N` family, `Quit`) — xem §2.5. Component chỉ đọc, không có action nào chạy được từ đây
(khác palette) — click ra ngoài hoặc Escape đóng.

**Build**:

```tsx
// src/command-palette/shortcuts-cheat-sheet.tsx
import { useEffect } from "preact/hooks";
import type {
  ActionDefinition,
  ActionCategory,
} from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";
import { formatBindingsForAction } from "./keybinding-format";

export interface ShortcutsCheatSheetProps {
  registry: readonly ActionDefinition[];
  keymap: readonly KeyBinding[];
  /** Count of select-tab-N bindings in `keymap` — drives the "⌘1 … ⌘N" label. */
  tabSelectCount: number;
  onClose(): void;
}

const CATEGORY_ORDER: readonly ActionCategory[] = [
  "pane",
  "tab",
  "terminal",
  "app",
];
const CATEGORY_TITLE: Readonly<Record<ActionCategory, string>> = {
  pane: "Pane",
  tab: "Tab",
  terminal: "Terminal",
  app: "App",
};

interface Row {
  readonly label: string;
  readonly shortcut: string;
}

function rowsForCategory(
  category: ActionCategory,
  registry: readonly ActionDefinition[],
  keymap: readonly KeyBinding[],
): Row[] {
  const rows: Row[] = registry
    .filter((a) => a.category === category)
    .map((a) => ({
      label: a.label,
      shortcut: formatBindingsForAction(a.id, keymap) ?? "—",
    }));
  return rows;
}

export function ShortcutsCheatSheet({
  registry,
  keymap,
  tabSelectCount,
  onClose,
}: ShortcutsCheatSheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Two rows the registry deliberately does not model — see docs/plans/
  // 2026-07-27-command-palette.md §2.5. select-tab-1..select-tab-8 is a
  // parameterized family (no stable per-tab label to put in a registry row),
  // Quit is a raw Cocoa/quit-guard flow, neither is an ACTION_REGISTRY row.
  // select-last-tab is NOT here — it is a real ACTION_REGISTRY row (category
  // "tab"), so it already comes through `rowsForCategory` above like any
  // other action; adding it here too would duplicate it.
  const tabExtraRows: Row[] = [
    { label: "Select tab N", shortcut: `⌘1 … ⌘${tabSelectCount}` },
  ];
  const appExtraRows: Row[] = [{ label: "Quit", shortcut: "⌘Q" }];

  return (
    <div class="modal-scrim shortcuts-cheat-sheet-scrim" onMouseDown={onClose}>
      <div
        class="shortcuts-cheat-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h1>Keyboard Shortcuts</h1>
        {CATEGORY_ORDER.map((category) => {
          const rows = rowsForCategory(category, registry, keymap);
          const extra =
            category === "tab"
              ? tabExtraRows
              : category === "app"
                ? appExtraRows
                : [];
          const all = [...rows, ...extra];
          return (
            <section key={category} class="shortcuts-cheat-sheet__group">
              <h2>{CATEGORY_TITLE[category]}</h2>
              <table>
                <tbody>
                  {all.map((row) => (
                    <tr key={row.label}>
                      <td class="shortcuts-cheat-sheet__keys">
                        <kbd>{row.shortcut}</kbd>
                      </td>
                      <td class="shortcuts-cheat-sheet__label">{row.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 1 — test trước (đỏ)**:

```tsx
// shortcuts-cheat-sheet.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render } from "preact";
import { ShortcutsCheatSheet } from "./shortcuts-cheat-sheet";
import type { ActionDefinition } from "../terminal/action-registry";
import type { KeyBinding } from "../terminal/keymap";

const REGISTRY: readonly ActionDefinition[] = [
  {
    id: "split-row",
    label: "Split Vertically",
    category: "pane",
    scope: "terminal",
  },
  { id: "new-tab", label: "New Tab", category: "tab", scope: "always" },
  { id: "find", label: "Find…", category: "terminal", scope: "terminal" },
  {
    id: "toggle-settings",
    label: "Settings…",
    category: "app",
    scope: "always",
  },
];
const KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "t", meta: true, action: "new-tab" },
  { key: "f", meta: true, action: "find" },
  { key: ",", meta: true, action: "toggle-settings" },
];

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onClose = vi.fn();
  render(
    <ShortcutsCheatSheet
      registry={REGISTRY}
      keymap={KEYMAP}
      tabSelectCount={8}
      onClose={onClose}
    />,
    container,
  );
  return { container, onClose };
}

describe("ShortcutsCheatSheet", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("groups rows under category headings in pane/tab/terminal/app order", () => {
    const { container } = mount();
    const headings = [...container.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(["Pane", "Tab", "Terminal", "App"]);
  });

  it("adds the synthetic select-tab-N row under Tab, using tabSelectCount", () => {
    const { container } = mount();
    const labels = [...container.querySelectorAll("td:nth-child(2)")].map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Select tab N");
    const row = [...container.querySelectorAll("tr")].find((tr) =>
      tr.textContent?.includes("Select tab N"),
    );
    expect(row?.querySelector("kbd")?.textContent).toBe("⌘1 … ⌘8");
  });

  it("adds the synthetic Quit row under App, not sourced from the registry", () => {
    const { container } = mount();
    const row = [...container.querySelectorAll("tr")].find((tr) =>
      tr.textContent?.includes("Quit"),
    );
    expect(row?.querySelector("kbd")?.textContent).toBe("⌘Q");
  });

  it("Escape calls onClose", () => {
    const { onClose } = mount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 — chạy, xác nhận FAIL**: `npm test -- shortcuts-cheat-sheet`.
- [ ] **Step 3 — implement** đúng code ở block Build trên.
- [ ] **Step 4 — chạy lại, xác nhận PASS**.
- [ ] **Step 5 — commit**: `feat(command-palette): add read-only ShortcutsCheatSheet grouped by category`.

---

### Task 8: Wire vào `app.tsx` + `chrome-actions.tsx` + `styles.css`

**File(s)**:

- [app.tsx](../../src/ui/app.tsx)
- [chrome-actions.tsx](../../src/ui/chrome-actions.tsx)
- [tab-bar.tsx](../../src/ui/tab-bar.tsx) — nếu `ChromeActionsProps` đổi shape, mọi call site phải
  cập nhật; kiểm tra bằng `rg -n "ChromeActions" src/ui` trước khi coi task xong.
- [styles.css](../../src/styles.css)

**Phụ thuộc**: Task 5 (seam `onTogglePalette`/`onToggleShortcuts`), Task 6, Task 7.

**Decision**: `app.tsx` sở hữu `toggleCommandPalette`/`toggleShortcuts` (đúng §2.2's code mẫu +
mirror `toggleSettings`), truyền vào `createTabManager` như hai dep mới, render hai overlay có điều
kiện y hệt cách `SavePresetDialog`/`SettingsPanel` đang render. `ChromeActions` thêm MỘT nút mới
("Command Palette" — mở palette; cheat sheet chỉ tới qua palette + `⌘/`, không thêm nút thứ hai để
tránh dày hàng icon quá mức, đúng tinh thần "quiet chrome" DL §0).

**Build**:

`app.tsx` — thêm cạnh `toggleSettings`:

```tsx
import { paletteOpen, shortcutsOpen } from "../chrome/events";
import { CommandPalette } from "../command-palette/command-palette";
import { ShortcutsCheatSheet } from "../command-palette/shortcuts-cheat-sheet";
import { ACTION_REGISTRY } from "../terminal/action-registry";
import { DEFAULT_KEYMAP, selectTabIndex } from "../terminal/keymap";

// ...trong App():

const toggleCommandPalette = (): void => {
  if (paletteOpen.value) {
    paletteOpen.value = false;
    tabsRef.current?.focusActive();
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return; // draft in flight — same rule as attention-focus-coordinator.ts
  }
  paletteOpen.value = true;
};

const toggleShortcuts = (): void => {
  if (shortcutsOpen.value) {
    shortcutsOpen.value = false;
    tabsRef.current?.focusActive();
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  shortcutsOpen.value = true;
};
```

Trong `useEffect` dựng `createTabManager`, thêm 2 dep:

```tsx
const manager = createTabManager(host, undefined, {
  onRequestAttentionFocus: (tabIndex) => requestAttentionFocus(tabIndex),
  onToggleSettings: () => toggleSettings(),
  onTogglePalette: () => toggleCommandPalette(),
  onToggleShortcuts: () => toggleShortcuts(),
});
```

Trong JSX (`<main class="stage">`), thêm cạnh `SavePresetDialog`:

```tsx
{
  paletteOpen.value ? (
    <CommandPalette
      registry={ACTION_REGISTRY}
      keymap={DEFAULT_KEYMAP}
      onClose={toggleCommandPalette}
      onRun={(id) => {
        if (isShortcutAction(id)) {
          tabsRef.current?.runAction(id);
        }
      }}
    />
  ) : null;
}
{
  shortcutsOpen.value ? (
    <ShortcutsCheatSheet
      registry={ACTION_REGISTRY}
      keymap={DEFAULT_KEYMAP}
      tabSelectCount={
        DEFAULT_KEYMAP.filter((b) => selectTabIndex(b.action) !== null).length
      }
      onClose={toggleShortcuts}
    />
  ) : null;
}
```

**Lưu ý quan trọng**: `onRun` gọi `toggleCommandPalette` (đóng) rồi mới `tabsRef.current?.
runAction(id)` — nhưng theo Task 6, `CommandPalette.confirm()` ĐÃ gọi `onClose()` trước `onRun(id)`
rồi. `onClose` ở đây CHÍNH LÀ `toggleCommandPalette`, nên thứ tự thật sự khi chạy là:
`toggleCommandPalette()` (đóng) → `onRun(id)` → `runAction(id)` — đúng bất biến §2.2, không lặp lại
việc đóng hai lần (component không tự đóng lần nữa, nó chỉ gọi callback App truyền vào đúng một
lần).

`chrome-actions.tsx` — thêm icon + prop:

```tsx
interface ChromeActionsProps {
  settingsOpen: boolean;
  expandActive: boolean;
  onSplitRow(): void;
  onSplitColumn(): void;
  onClosePane(): void;
  onToggleExpand(): void;
  onToggleSettings(): void;
  onTogglePalette(): void; // NEW
}

function PaletteIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 10.5l2.5 2-2.5 2" />
      <line x1="12" y1="14.5" x2="15.5" y2="14.5" />
    </svg>
  );
}
```

Thêm nút, cạnh nút Settings:

```tsx
<button
  type="button"
  class="iconbtn"
  title="Command Palette (⌘⇧P)"
  aria-label="Open command palette"
  onClick={props.onTogglePalette}
>
  <PaletteIcon />
</button>
```

Truyền `onTogglePalette={toggleCommandPalette}` ở cả hai call site `<ChromeActions>` trong
`app.tsx` (sidebar titlebar + `TabBar`'s internal `ChromeActions`, kiểm tra `tab-bar.tsx` có
prop-drill `ChromeActionsProps` tương tự `settingsOpen`/`onToggleSettings` hay không — nếu có, thêm
`onTogglePalette` song song).

`styles.css` — thêm cạnh `.preset-editor`:

```css
/* ---------- Command palette (⌘⇧P) ---------- */
.command-palette-scrim {
  z-index: 200;
}
.command-palette {
  display: flex;
  flex-direction: column;
  width: min(560px, 86vw);
  max-height: min(420px, 70vh);
  background: var(--chrome-1);
  border: 1px solid var(--hair-strong);
  border-radius: 12px;
  outline: none;
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}
.command-palette__input {
  font: inherit;
  font-family: var(--ui-font);
  font-size: 13px;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid var(--hair);
  background: transparent;
  color: var(--text-primary);
  outline: none;
}
.command-palette__list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
}
.command-palette__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.command-palette__row.is-highlighted {
  background: color-mix(in srgb, var(--fg) 6%, transparent);
  box-shadow: inset 2px 0 0 var(--accent);
}
.command-palette__label {
  font-family: var(--ui-font);
  font-size: 12.5px;
  color: var(--text-primary);
}
.command-palette__shortcut {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.command-palette__empty {
  padding: 14px;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}

/* ---------- Shortcuts cheat sheet (⌘/) ---------- */
.shortcuts-cheat-sheet-scrim {
  z-index: 200;
}
.shortcuts-cheat-sheet {
  width: min(640px, 90vw);
  max-height: min(560px, 82vh);
  overflow-y: auto;
  padding: 18px 22px;
  background: var(--chrome-1);
  border: 1px solid var(--hair-strong);
  border-radius: 12px;
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.shortcuts-cheat-sheet h1 {
  font-size: 13px;
  margin: 0 0 12px;
  color: var(--text-primary);
}
.shortcuts-cheat-sheet__group h2 {
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin: 14px 0 4px;
}
.shortcuts-cheat-sheet table {
  width: 100%;
  border-collapse: collapse;
}
.shortcuts-cheat-sheet__keys {
  width: 120px;
  padding: 3px 0;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.shortcuts-cheat-sheet__label {
  padding: 3px 0;
  font-family: var(--ui-font);
  font-size: 12.5px;
  color: var(--text-primary);
}
```

`@media (prefers-reduced-motion: reduce)` block đã có sẵn trong `styles.css` theo scope `.panel *`
— kiểm tra scope đó có phủ `.command-palette`/`.shortcuts-cheat-sheet` không; nếu block hiện tại chỉ
scope `.panel *` (Settings panel), thêm `.command-palette *, .shortcuts-cheat-sheet *` vào cùng
selector list đó (KHÔNG tạo block reduced-motion mới — DL §9.3 cấm allowlist rời rạc).

**Verify**:

- `npx tsc --noEmit` pass.
- `npm test` (toàn bộ suite) pass — xác nhận không phá test nào import `ChromeActionsProps`/`app.tsx`.
- Screenshot review (frontend-design-bar / eye-review DL §9.6) — dựng app thật (`npm run tauri dev`
  hoặc `npm run dev` xem trong browser với mock nếu Tauri không sẵn), mở `⌘⇧P`, gõ vài ký tự, xác
  nhận: không `box-shadow` mờ, không viết hoa toàn bộ, chord hiện đúng `--mono`, z-index nổi trên
  Settings khi mở đè lên Settings.

---

### Task 9: `generate-shortcuts-readme.ts` — sinh bảng README lúc build

**File(s)**:

- [generate-shortcuts-readme.ts](../../scripts/generate-shortcuts-readme.ts) (mới)
- [package.json](../../package.json)
- [README.md](../../README.md)

**Phụ thuộc**: Task 1 (`category`), plan Registry Task 6/8 đã implement (tái dùng `predev`/
`prebuild` + pattern `--check`).

**Decision**: Script Node/TS riêng (KHÔNG sửa `scripts/generate-menu.ts` — single responsibility,
hai file sinh hai đích khác nhau từ cùng nguồn dữ liệu). Đọc `ACTION_REGISTRY`/`DEFAULT_KEYMAP`,
sinh 3 bảng markdown (Pane/Tab/Terminal+App gộp — khớp 3 mục README hôm nay: "Panes"/"Tabs"/
"Terminal & view"; `category: "app"`'s hàng zoom-in/out/reset + `toggle-settings` xếp chung mục
"Terminal & view" cho khớp layout README hiện tại — cheat sheet trong app dùng 4 nhóm tách biệt
§2.1, README giữ 3 mục cũ để diff tối thiểu), ghi đè phần giữa hai marker.

**Build**:

```ts
// scripts/generate-shortcuts-readme.ts
import { readFileSync, writeFileSync } from "node:fs";
import {
  ACTION_REGISTRY,
  type ActionDefinition,
} from "../src/terminal/action-registry";
import { DEFAULT_KEYMAP, selectTabIndex } from "../src/terminal/keymap";
import { formatBindingsForAction } from "../src/command-palette/keybinding-format";

const START =
  "<!-- SHORTCUTS:START (generated by `npm run generate:shortcuts-readme` — do not hand-edit) -->";
const END = "<!-- SHORTCUTS:END -->";

function row(action: ActionDefinition): string {
  const shortcut = formatBindingsForAction(action.id, DEFAULT_KEYMAP) ?? "—";
  return `| ${shortcut.padEnd(9)} | ${action.label.replace(/…$/, "")} |`;
}

function table(
  title: string,
  ids: readonly string[],
  extraRows: readonly string[] = [],
): string {
  const byId = new Map(ACTION_REGISTRY.map((a) => [a.id, a]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((a): a is ActionDefinition => a !== undefined)
    .map(row);
  return [
    `**${title}**`,
    "",
    "| Shortcut  | Action |",
    "| --------- | ------ |",
    ...rows,
    ...extraRows,
    "",
  ].join("\n");
}

const tabSelectCount = DEFAULT_KEYMAP.filter(
  (b) => selectTabIndex(b.action) !== null,
).length;

const paneIds = ACTION_REGISTRY.filter((a) => a.category === "pane").map(
  (a) => a.id,
);
const tabIds = ACTION_REGISTRY.filter((a) => a.category === "tab").map(
  (a) => a.id,
);
const terminalAppIds = ACTION_REGISTRY.filter(
  (a) => a.category === "terminal" || a.category === "app",
).map((a) => a.id);

const generated = [
  table("Panes", paneIds),
  // `select-last-tab` is a real ACTION_REGISTRY row (category "tab") — it
  // already comes through `tabIds` above via the normal `row()` path, so the
  // only extra row needed here is the parameterized select-tab-1..8 family,
  // which the registry deliberately does not model (no stable per-tab label).
  table("Tabs", tabIds, [`| ⌘1 … ⌘${tabSelectCount}   | Select tab _N_ |`]),
  table("Terminal & view", terminalAppIds, [`| ⌘Q        | Quit |`]),
].join("\n");

const checkOnly = process.argv.includes("--check");
const readmePath = new URL("../README.md", import.meta.url);
const current = readFileSync(readmePath, "utf-8");
const startIdx = current.indexOf(START);
const endIdx = current.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  console.error("README.md is missing the SHORTCUTS marker comments");
  process.exit(1);
}
const next =
  current.slice(0, startIdx + START.length) +
  "\n\n" +
  generated +
  "\n" +
  current.slice(endIdx);

if (checkOnly) {
  if (next !== current) {
    console.error(
      "README.md's shortcuts table is stale — run `npm run generate:shortcuts-readme`",
    );
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(readmePath, next);
```

`package.json`:

```json
{
  "scripts": {
    "generate:shortcuts-readme": "tsx scripts/generate-shortcuts-readme.ts",
    "generate:shortcuts-readme:check": "tsx scripts/generate-shortcuts-readme.ts --check",
    "predev": "npm run generate:menu && npm run generate:shortcuts-readme",
    "prebuild": "npm run generate:menu && npm run generate:shortcuts-readme"
  }
}
```

(giả định plan Registry Task 6 đã thêm `tsx` vào `devDependencies` và `predev`/`prebuild` gọi
`generate:menu` — task này CHỈ nối thêm `&& npm run generate:shortcuts-readme`, không tạo lại
`predev`/`prebuild` từ đầu.)

`README.md` — bọc 3 bảng hiện có (dòng ~117-149) trong marker `START`/`END`, xoá nội dung bảng tay
hiện tại (script sẽ điền lại), giữ nguyên câu văn xuôi trước/sau ("Shift+Enter is not
distinguishable...").

**Verify**:

- `npm run generate:shortcuts-readme` chạy không lỗi, README's 3 bảng khớp đúng dữ liệu registry
  hiện tại (đọc lại bằng mắt, đối chiếu với bảng cũ — không hàng nào bị rơi).
- `npm run generate:shortcuts-readme:check` ngay sau đó → exit 0.
- Sửa tay một `label` trong `action-registry.ts` (vd đổi "Find…" thành "Find"), chạy lại
  `:check` → exit khác 0, báo rõ lệch — rồi revert.
- `npm test` pass (không file test nào phụ thuộc nội dung README).

---

### Task 10: `CONTEXT.md`, `docs/ARCHITECTURE.md`, xác minh toàn bộ

**File(s)**:

- [CONTEXT.md](../../CONTEXT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

**Phụ thuộc**: Task 1 – Task 9.

**Decision**: Thêm 2 mục glossary mới vào `CONTEXT.md` (khác quyết định "không đụng CONTEXT.md" của
plan Registry — action-registry là chi tiết triển khai nội bộ, còn hai khái niệm này là UI/khái
niệm sản phẩm user nhìn thấy trực tiếp, thuộc đúng phạm vi glossary theo cách mọi mục khác trong
`CONTEXT.md` đã làm, vd **Open board**, **Layout preset**).

**Build**:

`CONTEXT.md`, thêm cạnh mục **Open board** (theo đúng thứ tự alphabet lỏng file đang dùng, hoặc
cuối file — kiểm tra convention thứ tự hiện có trước khi chèn):

```markdown
**Command palette**:
The universal keyboard entry point (⌘⇧P) for every action in the app — type to filter, Enter to
run. Solves reachability for actions that don't have (or don't deserve) their own dedicated chord;
never grants an action more access than pressing its own chord directly would (a `scope: "terminal"`
action chosen from the palette is still blocked by the same overlay guard it would hit directly).
_Avoid_: Quick open, Spotlight, fuzzy finder

**Cheat sheet**:
The read-only in-app reference (⌘/) listing every action and its bound chord, grouped by category
(Pane/Tab/Terminal/App). Rendered directly from the running `ACTION_REGISTRY`/`DEFAULT_KEYMAP` —
cannot drift from the real keymap the way a hand-written doc can.
_Avoid_: Help, shortcuts list, keyboard reference
```

`ARCHITECTURE.md` §3 (module map), thêm dòng cạnh `terminal/`:

```
  command-palette/ command palette + cheat sheet chrome: palette-filter (pure
                   rank/filter), keybinding-format (pure chord→glyph), both
                   consumed by two Preact overlays reading action-registry
                   directly (no snapshot layer — cannot drift from the live keymap)
```

`ARCHITECTURE.md` §5, thêm sau D10 (của plan Registry, giả định đã tồn tại):

```markdown
### D11 — Command palette grants no access beyond its target action's own chord

**Chosen: palette closes itself synchronously, then dispatches through the exact same
`TabManager.runAction`/`overlayBlocksAction` path a direct keypress would use.**

- Opening the palette (`⌘⇧P`) is `scope: "always"` (same reason as `toggle-settings`) but does NOT
  dismiss `boardOpen`/`settingsOpen` — it layers on top instead.
- Confirming a row closes the palette, then dispatches — same tick, no `await` — so
  `overlayBlocksAction` always sees the real overlay state underneath, never a stale "palette still
  open" flag. `paletteOpen` is deliberately NOT one of the four signals `overlayBlocksAction` reads;
  the existing `isChromeTextField` guard (already used by the tab-rename input) prevents any
  shortcut/menu leak-through while the palette's filter input holds focus.

**Rejected:**

- _Add `paletteOpen` to `overlayBlocksAction`'s block-list_ — redundant with the existing
  `isChromeTextField` guard for the leak-prevention case, and would require extra plumbing to avoid
  blocking the palette's OWN confirm path (which must be allowed to dispatch anything the same
  action's direct chord could).

**ADR:** proposed, not yet recorded — see `docs/plans/2026-07-27-command-palette.md` §5.
```

**Verify**:

- `rg -n "Command palette|Cheat sheet" CONTEXT.md` → 2 mục mới xuất hiện.
- `rg -n "command-palette" docs/ARCHITECTURE.md` → ít nhất 2 dòng.
- Chạy TOÀN BỘ verify của mọi task trước, liền một lượt, không chỉ từng task riêng lẻ:
  - `npm test` (toàn bộ suite).
  - `npx tsc --noEmit`.
  - `npm run generate:shortcuts-readme:check`.
  - `git status --porcelain=v1` — đối chiếu danh sách file đổi khớp đúng "File(s)" của 10 task trên,
    không file nào ngoài dự kiến bị chạm.
- Xác minh thủ công (`npm run tauri dev` hoặc `npm run dev`):
  - `⌘⇧P` mở palette bất kể overlay nào khác đang mở (trừ PresetEditor/SavePresetDialog có draft —
    xác nhận bị chặn đúng, không mở đè).
  - Gõ tiếng Việt Telex vào ô lọc (vd gõ "ddoongs" → "đóng" hoặc tương tự) — gõ đúng, không ký tự
    nào bị nuốt/nhân đôi.
  - Chọn một action `scope: "terminal"` trong khi Settings đang mở phía dưới palette → không chạy
    (blocked), đóng Settings, mở lại palette, chọn lại → chạy đúng.
  - `⌘/` mở cheat sheet, hiện đủ 4 nhóm + 2 dòng tĩnh (Select tab N, Quit) + `select-last-tab`
    (registry-driven, KHÔNG phải dòng tĩnh — xác nhận nó không bị lặp hai lần).
  - Nút "Command Palette" mới trong `ChromeActions` mở đúng palette bằng chuột.

Sau khi task này xanh, đề xuất chạy `/adk:adr` với nội dung D11 ở trên.
