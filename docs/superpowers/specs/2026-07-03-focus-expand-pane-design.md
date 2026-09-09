# Focus expand pane — Design

**Ngày:** 2026-07-03
**Trạng thái:** Đã duyệt (chờ implementation plan)

## Mục tiêu

Khi có nhiều pane trong một tab, các pane chèn ép nhau nên khó đọc. Thêm chế độ
**Focus expand** (opt-in, mặc định tắt): khi bật, pane đang active tự giãn ra
chiếm phần lớn hơn; chuyển focus sang pane khác thì pane cũ tự thu về đúng tỷ lệ
gốc và pane mới giãn ra.

## Hành vi (UX)

- **Kích hoạt**: phím **⌘E** (đang trống trong keymap) + nút icon trong tab bar,
  nút sáng lên khi mode đang bật (style `iconbtn.is-active` sẵn có). Trạng thái
  lưu `focusExpand: boolean` trong `settings.json`, mặc định `false`, áp dụng
  cho mọi tab.
- **Mức giãn**: pane active nhận tối thiểu **65%** (`EXPAND_RATIO = 0.65`) trên
  **mỗi split dọc path** từ root tới nó — tức giãn cả hai trục. Nếu tỷ lệ gốc của
  nhánh chứa pane đã ≥ 65% thì giữ nguyên (không bao giờ thu nhỏ pane active).
- **Chuyển focus** (click, focusin, ⌘] / ⌘[): pane cũ thu về tỷ lệ gốc, pane mới
  giãn. Transition `flex-grow` **150ms ease**.
- **Chỉ 1 pane**: không thay đổi gì. **Tắt mode**: trả về layout gốc ngay.
- **Kéo divider khi mode bật**: drag vẫn commit vào **tỷ lệ gốc** như hiện tại;
  thả tay xong expand áp lại trên tỷ lệ mới. Trong lúc drag tắt transition
  (dựa vào class `is-resizing` sẵn có) để không lag tay kéo.
- **Settings panel mở** (focus rời terminal): pane active giữ nguyên trạng thái
  giãn — chấp nhận, không coi là mất active.

## Kiến trúc

Nguyên tắc: **tree gốc là SSOT, expand chỉ là override lúc hiển thị** — không
mutate tree, không đụng persistence.

### `src/lib/split-tree.ts` — pure function mới

```ts
expandForPane(node: TreeNode, paneId: number, minRatio: number): TreeNode
```

- Trả về bản sao tree với ratio override dọc path tới leaf `paneId`:
  nhánh chứa pane là `a` → `ratio = max(ratio, minRatio)`;
  là `b` → `ratio = min(ratio, 1 - minRatio)`.
- `paneId` không tồn tại trong tree → trả về node gốc nguyên vẹn (không throw).
- Immutable như mọi hàm khác trong file. Khi không có gì đổi (ratio giữ nguyên,
  hai nhánh giữ nguyên) → trả về **cùng reference** node cũ, theo pattern
  `removeLeaf` (`if (a === node.a && b === node.b && ratio === node.ratio)
return node`).

### `src/terminal/layout.ts` — apply ratio tại chỗ

```ts
applyRatios(container: HTMLElement, root: TreeNode): void
```

- Walk DOM song song với tree, chỉ cập nhật `style.flexGrow` trên
  `.split__child` — **không rebuild DOM** → CSS transition chạy được.
- ⚠️ Cấu trúc `.split` có 3 con `[child a, divider, child b]`
  (`layout.ts` append `first, divider, second`) — walk phải lấy đúng
  `:scope > .split__child` (con thứ 0 và 2), **né divider**, rồi đệ quy qua
  `firstElementChild` của mỗi child.
- Tách phần thuần để test được trong node env: pure helper
  `ratioEntries(root): { path: Path; ratio: number }[]` (unit test vitest);
  `applyRatios` chỉ còn map path → DOM.
- Invariant: DOM phải khớp tree lúc gọi. Giữ nguyên kỷ luật hiện tại — mọi
  structural change gọi `render()` đồng bộ ngay sau khi mutate tree; **không**
  gọi `applyRatios` bắc qua `await` sau structural change.

### `src/terminal/terminal-manager.ts` — wiring

- `displayTree()`: mode bật **và** >1 pane **và** có `activeId`
  → `expandForPane(tree, activeId, 0.65)`; ngược lại → `tree` gốc.
- 🔴 **`render()` build DOM từ `tree` GỐC** (KHÔNG phải displayTree), rồi gọi
  `applyRatios(container, displayTree())` ngay sau `renderTree` để overlay
  expand. Lý do: `buildDivider` capture `node.ratio` của tree đã build làm
  baseline commit, và `onUp` luôn fire kể cả click-không-kéo — nếu build từ
  displayTree thì chỉ cần click divider trên path pane active là ratio đã giãn
  (0.65) bị commit ngược vào tree gốc, làm bẩn SSOT + persist sai vào session.
  Build từ gốc → baseline divider = ratio gốc, commit luôn đúng, và chỉ có
  MỘT đường code (renderTree gốc + overlay applyRatios) thay vì hai path phải
  tự đồng bộ.
- `setActive(id)` gọi thêm `applyRatios(container, displayTree())`.
- `splitActive`: **gán `activeId = pane.id` trực tiếp** (KHÔNG gọi
  `setActive` — bản mới kèm `applyRatios` sẽ chạy trên DOM cũ chưa khớp tree
  vừa `splitLeaf`, vi phạm invariant ở trên) rồi mới `render()`. `render()`
  tự overlay expand với activeId mới → pane mới giãn thẳng trong một nhịp.
  Đây cũng là pattern các path structural sẵn có: `closePane` gán
  `activeId = leafIds(tree)[0]`, `respawn` gán `activeId = fresh.id` trực
  tiếp rồi render. Nhớ gọi `updateActiveClasses()` (render đã set class theo
  `isActive` nên thực tế đã cover).
- `applySettings(next)`: **luôn** gọi `applyRatios(container, displayTree())`
  — idempotent, không cần diff hay lưu prev settings (manager hiện không giữ
  settings cũ): mode tắt → displayTree == tree gốc nên tự về gốc; mode bật →
  giãn; settings khác đổi (font/theme) → apply lại ratio hiện hành, vô hại.
- Guard null: `applySettings` có thể chạy khi manager chưa init (`tree ===
null`, ví dụ settings đổi qua `useSignalEffect` trước `initFresh`) —
  `displayTree()` trả `null` khi tree null, và `applyRatios` với root null
  phải **no-op** (giống guard `if (!tree) return` sẵn có trong `render()`).
- `serializeLayout()` **không đổi** — vẫn đọc tree gốc, session không bao giờ
  lưu nhầm tỷ lệ đã giãn.
- `onRatioCommit`: vẫn commit vào tree gốc như hiện tại, sau đó gọi
  `applyRatios(container, displayTree())` để expand áp lại trên tỷ lệ mới
  (khớp hành vi "thả tay xong expand áp lại" ở phần UX).

### Keymap + Settings + UI

- `keymap.ts`: action mới `toggle-expand`, binding `{ key: "e", meta: true }`.
  Handler nằm trong `handleShortcut` của `tab-manager.ts` → gọi
  `updateSettings({ focusExpand: !settings.value.focusExpand })` — thay đổi tự
  lan tới các manager qua đường `applySettings` sẵn có.
- `settings-schema.ts`: thêm `focusExpand: boolean` vào `Settings`,
  `DEFAULT_SETTINGS` (`false`) và `validateSettings` (kiểu boolean, fallback
  default — giống `restoreTabs`).
- `tab-bar.tsx`: thêm nút icon toggle (expand icon). TabBar hiện không import
  `settings` — nối theo pattern sẵn có: App truyền prop `expandActive` +
  `onToggleExpand` (như `onSplitRow`), nút set class `is-active` theo prop.
- `styles.css`: `.split__child { transition: flex-grow 150ms ease; }` và
  `.split.is-resizing > .split__child { transition: none; }`.

### Chống spam resize trong lúc animation

ResizeObserver của pane fire liên tục trong 150ms transition → xterm `fit()` +
`resize_pty` mỗi frame (SIGWINCH spam cho TUI app đang chạy). Fix trong
`pane.ts`: debounce đặt **ở callback ResizeObserver** (~90ms trailing) — KHÔNG
đặt bên trong `fit()`, vì các call trực tiếp (mount, show → `pane.fit()`,
applySettings) phải chạy ngay như hiện tại. Hệ quả chấp nhận: refit khi kéo
divider / resize window tới trễ ~90ms sau khi lắng (SIGWINCH tới TUI trễ
tương ứng); đổi lại hết spam resize mỗi frame.

## Edge cases

- **Pane đóng / shell exit khi đang giãn**: `closePane`/`respawn` render lại từ
  tree gốc mới + expand theo `activeId` mới — tự đúng, không cần code riêng.
- **Structural change khi mode bật** (split/close): đi qua `render()` đầy đủ,
  `applyRatios` không dùng cho case này.
- **Session restore**: layout đọc/ghi từ tree gốc — không ảnh hưởng.

## Testing

Unit (vitest sẵn có):

- `split-tree.test.ts`: `expandForPane` — leaf đơn (trả nguyên), nhánh `a`/`b`,
  nested nhiều tầng (override dọc path, nhánh ngoài path giữ nguyên), ratio gốc
  đã ≥ minRatio (giữ nguyên), `paneId` không tồn tại (trả node gốc, cùng
  reference), immutability (tree gốc không đổi sau khi gọi).
- `split-tree.test.ts` (hoặc file riêng): `ratioEntries` — path + ratio đúng
  thứ tự cho tree nested (phần thuần của applyRatios, test được node env).
- `settings-schema.test.ts`: validate `focusExpand` (boolean hợp lệ, thiếu,
  sai kiểu → fallback `false`).
- `keymap.test.ts`: ⌘E → `toggle-expand`, không nhầm với binding khác.

Manual:

- ⚠️ **Smoke test ĐẦU TIÊN trong plan**: verify `transition: flex-grow` thật sự
  animate trong WKWebView macOS (đổi flexGrow inline trên `.split__child`) —
  đây là giả định hình ảnh cốt lõi, không unit-test được; fail thì đổi hướng
  (vd transition trên flex-basis %) trước khi build phần wiring còn lại.
- 3+ panes (cả row lẫn column), bật ⌘E, click / ⌘] đổi focus → giãn/thu mượt.
- Click divider (không kéo) khi mode bật → tỷ lệ gốc KHÔNG đổi (blocker #1
  của review: baseline divider phải là ratio gốc).
- Kéo divider lúc mode bật → không lag, thả tay expand áp lại đúng.
- Tắt mode → về layout gốc. Restart app → mode giữ nguyên trạng thái.
- Restore session sau quit lúc đang giãn → layout đúng tỷ lệ gốc.

## Ngoài phạm vi

- Zoom toàn phần (kiểu tmux) — có thể thêm sau như tầng 2.
- Tùy chỉnh mức giãn (65% là hằng số, chưa cần setting riêng).
