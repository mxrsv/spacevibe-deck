---
tool: claude
session: null
status: paused
head_start: null
head_end: 57d3f3f
commits: []
files:
  - openspec/changes/rail-create-consolidation/proposal.md
  - openspec/changes/rail-create-consolidation/specs/rail-create-controls/spec.md
  - openspec/changes/rail-create-consolidation/design.md
  - openspec/changes/rail-create-consolidation/tasks.md
  - src/ui/agent-rail-card-model.ts
  - src/ui/agent-rail-model.ts
  - src/ui/worktree-card-row.tsx
  - src/ui/worktree-card-menus.tsx
  - src/ui/worktree-card.tsx
  - src/ui/agent-rail.tsx
  - src/ui/tab-strip.tsx
  - src/ui/tab-bar.tsx
  - src/ui/app.tsx
  - src/chrome/events.ts
  - src/terminal/action-registry.ts
  - src/terminal/tab-manager.ts
  - src/terminal/tab-manager-types.ts
  - src-tauri/src/menu_registry.rs
  - src/styles/04a-agent-rail.css
  - src/styles/04c-rail-worktree-card.css
  - src/styles/04d-rail-card-menus.css
  - src/styles/05-tab-bar-toolbar.css
  - src/styles/11-settings-screen.css
  - src/gallery/chrome-fixtures.tsx
  - src/gallery/rail-worktree-cards.tsx
  - src/gallery/sections/popovers-section.tsx
  - src/ui/menu-subject.test.ts
  - src/ui/card-actions-menu.test.tsx
  - src/ui/worktree-card-menus.test.ts
  - src/ui/worktree-card.test.tsx
  - src/ui/agent-rail.test.tsx
  - src/ui/agent-rail-model.test.ts
  - src/ui/tab-strip.test.tsx
  - src/ui/tab-bar.test.tsx
  - src/ui/rail-cluster-drag.test.ts
  - src/ui/repository-rail.test.tsx
  - src/ui/app.test.tsx
  - docs/DESIGN-LANGUAGE.md
  - docs/CONTEXT.md
  - AGENTS.md
  - CHANGELOG.md
uncommitted: true
---

## Việc

Gộp các nút `+` trong rail Deck về đúng một nút tạo agent trên mỗi checkout, bỏ `+` ở header project và trên tab strip, cho `⌘T` mở cùng danh sách agent và nêu rõ destination — vì trước đó 5 nút `+` làm 3 việc khác nhau và 4 nút sinh shell không nói ở đâu.

## Đã làm

- Interview chốt intent với owner, viết 4 artifact `openspec/changes/rail-create-consolidation` (validate --strict ok).
- `MenuSubject` + `subjectOf` / `subjectWhere` / `subjectForWorkspace`; `whereOf` uỷ quyền cho `subjectWhere`.
- `CardActionsMenu` có 2 placement: anchored (như cũ) và free-standing (heading destination + hàng `Open another project…`); sửa lỗi có sẵn: focus hàng đầu chờ đến khi surface đã đặt xong.
- Hàng `New agent`, bare row, flat entries đều mở menu qua hook `useActionsMenu`; header `+` và `.tab-add` bị xoá cùng CSS; header grid còn 2 track.
- Cluster remembered giờ in các checkout dạng rowless group (`rememberedWorktrees`) để còn đường quay lại; rail đọc `live` từ `tabIndexes`.
- `⌘T`: `openTaskLauncher` → `railKeyboardMenuFor` (signal mới), gọi `ensureRepositoriesScanned` trước, bấm lần hai thì đóng; không còn recursion; `new-tab` relabel `New Agent…`, menu regenerate.
- Gallery: specimen menu free-standing trong popovers (portal ra body vì `.gx-section` có transform); rail specimen nhận `GALLERY_CARD_ACTIONS`.
- Docs: DL-27.18 retired, DL-27.25 + DL-13.7 amended; AGENTS.md (fork queue, direction, drift row); CONTEXT.md section mới; CHANGELOG 1.1.0 bullet.

## Bằng chứng

- `npx vitest run` 13 file đã đụng + `scripts/design-language.test.ts`: 439/439 pass.
- `npx tsc --noEmit` và `npx tsc -p tsconfig.electron.json --noEmit`: sạch. `npm run generate:menu:check`: pass. Prettier: sạch trên mọi file đã đụng.
- Playwright trên gallery `127.0.0.1:5175` (popovers, cả deck-dark và deck-light): heading đúng, hàng board cuối, mép trái trùng pad, focus vào `Run Claude`.
- Chưa chạy: `npm test` full, `npm run build`, `electron:build`, `electron:dev`, owner eye review. Section `navigation` của gallery crash headless renderer — tái hiện y hệt trên worktree HEAD `57d3f3f` sạch → lỗi có sẵn, không phải của thay đổi này.

## Quyết định / bỏ hướng

- `⌘T` mở menu free-standing dưới tab strip, bỏ hướng "mở sidebar rồi pin menu card" (đổi layout, top-tab không có sidebar) và bỏ hồi sinh `AgentQuickPicker` (thêm vocabulary thứ hai).
- Shell chỉ còn qua `New split here`; tab shell thứ hai trong checkout đã có tab không còn đường từ rail — ghi cho owner veto.
- Top-tab mode mất hết nút tạo bằng chuột, bù bằng hàng `Open another project…` trong menu `⌘T`; alternative giữ `.tab-add` chỉ trong `TabBar` — ghi cho owner veto.
- Tauri cũng nhận thay đổi (tab strip và `⌘T` là renderer-wide) — ghi cho owner veto.
- `rememberedClusters` in checkout thay vì giữ header rowless — phát sinh khi bỏ header `+`, không có trong plan, ghi thành task 4.6.

## Còn treo → mai bắt đầu từ

- Owner duyệt 4 hệ quả ở trên (top-tab mode, tab shell thứ hai, Tauri, guard `taskOperationPending` không áp cho hàng menu) rồi mới chạy gate 10.x.
- 10.1–10.2: `npm test` full, `npm run build`, `npm run electron:build`.
- 10.3: `npm run electron:dev` — bấm mọi nút tạo trong rail và `⌘T` ở 3 layout, chụp cho eye review.
- 9.4: khi `rail-card-menu-agents-and-naming` archive, scope lại scenario "No heading block" thành "raised from a card".
- Toàn bộ thay đổi chưa commit, nằm chồng lên diff Quick Launch deferral chưa commit của `app.tsx`.

Liên quan: [proposal](../../../openspec/changes/rail-create-consolidation/proposal.md), [spec](../../../openspec/changes/rail-create-consolidation/specs/rail-create-controls/spec.md), [design](../../../openspec/changes/rail-create-consolidation/design.md), [tasks](../../../openspec/changes/rail-create-consolidation/tasks.md), [CONTEXT § 2026-09-02](../../CONTEXT.md#one-create-control-per-checkout--2026-09-02).
