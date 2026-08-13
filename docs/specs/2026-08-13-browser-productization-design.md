# Browser productization — Design

Date: 2026-08-13 · Status: **decided** under the program's standing authority
([phases 2–5 plan](../plans/2026-08-13-redesign-phases-2-5.md) `current`, D12
approved 2026-08-14; run-to-completion instruction §0.6). Owner review of this
document is owed and recorded in the plan's §0.3 — authored, not skipped.

## 1. Context

**Origin:**

- Phase 3 ships the feature toolbar, whose `tools` group exposes a Browser
  action. The [toolbar spec](2026-08-12-feature-toolbar-design.md) `decided`
  wrote Browser's activation contract as "a main tab/pane surface, not a dock",
  while the built, smoke-verified implementation is a docked `WebContentsView`
  column ([browser panel](../../src/browser/browser-panel.tsx) `current`,
  [view host](../../electron/browser/view.ts) `current`). D12 exists because a
  toolbar may not open a surface whose own contract it contradicts.
- Phase 5's §6.2 implements whatever this document freezes.

**Decision (D12, approved as recommended):**

- **Browser stays docked for this program.** The toolbar's Browser action
  toggles the docked column — pressed while it is open, closing it; opening it
  otherwise. It does not create tabs, does not multiply surfaces, and does not
  pretend the panel is a main surface.
- The toolbar spec's Browser activation contract is **amended by this
  document** (see §5): a main-surface conversion changes native-view ownership
  (one `WebContentsView` per window, positioned over a measured hole, hidden
  under overlays — DL-19.6) and is a separate spec/plan if it is ever wanted.
  "Productization" does not imply it.

## 2. Canonical data

- [`ACTION_REGISTRY`](../../src/terminal/action-registry.ts) `current` owns
  `toggle-browser` (scope `pane`, View menu, `⌘⇧I` / `Ctrl+Shift+I`).
- [`settings-schema.ts`](../../src/settings/settings-schema.ts) `current` owns
  `browserWidth` and `browserHomeUrl`, and gains `browserLastUrl` (§3).
- [`browser-store.ts`](../../src/browser/browser-store.ts) `current` stays the
  window-scoped chrome state (R5); the page itself lives in the host's native
  view and is never renderer state.
- The host's persistent partition (`view.ts`) already keeps cookies and storage
  across relaunch, isolated from the app's own session. Not canonical here:
  page content, history stacks, anything inside the web page.

## 3. Solution architecture

**Restore the loaded page across relaunch.** Today the panel opens
`browserHomeUrl`; whatever the user navigated to is lost with the window. The
contract becomes:

- `browserLastUrl: string` (default `""`) is written on every **committed**
  main-frame navigation the host publishes (`did-navigate`, not in-page hash
  changes), through the existing settings write path — one write per committed
  navigation, none during load.
- Opening the panel loads `browserLastUrl` when it is non-empty, else
  `browserHomeUrl`. A failed restore falls back to `browserHomeUrl` and reports
  through the panel's existing status line (DL-19.5); it never dialogs.
- One value app-wide, last writer wins across windows — the panel is one
  session (the host already shares one partition), and per-window URL memory is
  a multi-surface feature this program does not add.
- Clearing the address bar and navigating home does what it says; there is no
  separate "reset" affordance.

**Toolbar projection (phase 3).** `toggle-browser` joins the toolbar's `tools`
group as its only member until phases 4–5 add theirs (D7). Tooltip copy is
sentence case at the toolbar layer (D6); the registry keeps its Title Case menu
label. No new action id is introduced.

**Electron-only labelling.** The panel is hosted by `electron/browser/`; no
Tauri implementation exists. The View menu already carries the item on both
hosts — under Tauri the action must fail soft exactly as it does today (IPC
facade rejects, nothing renders). Every claim, doc and commit about this
surface names it Electron-only; shipping Tauri simply does not have it.

**Manual passes phase 5 owes (unchanged from the plan's §6.2):** the
real-compositor pass CONTEXT.md lists as never done (resize, drag-to-width,
hide-under-overlay), and an Inspect payload checked against a real React dev
server. Neither is dischargeable by unit tests or by a headless run alone.

## 4. Failure modes

- `browserLastUrl` names a server that is down after relaunch: the view shows
  its normal load failure, the status line reports it, the URL stays editable —
  identical to typing a dead address today.
- A malformed persisted value (hand-edited settings file): the same
  `url.ts` rules that gate typed input gate the restore; an unopenable value
  falls back to `browserHomeUrl` silently and is overwritten by the next
  committed navigation.
- Settings write fails mid-session: the panel keeps working; restore quality
  degrades to the last successful write — the existing persist-error surface
  already reports store failures.

## 5. Amendment to the toolbar spec

The toolbar spec's §3 "Tool activation contracts — Browser" bullet and its §4
"When Browser has no existing surface…" bullet are superseded by this document:
activation **toggles the docked browser column** (open ↔ closed); there is no
surface creation semantics, no most-recently-active selection, and no
tab-inside-Browser concept. The spec file itself is not rewritten — it is a
frozen decision record predating D12 — and carries a pointer to this section.

## 6. Done and excluded

**Done when (phase 5 §6.2):** `browserLastUrl` merges with schema coverage;
relaunch restores the page against a live dev server; the two manual passes
above are run and pasted; the toolbar item ships in phase 3 wired to the dock.

**Excluded:** tabs, history UI, bookmarks, downloads UI, multi-window
independent URLs, main-surface conversion, any Tauri browser implementation,
any change to the injection/grab security posture (frozen by the 2026-08-12
review).

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                    | Intent     | Status  | Evidence                                     |
| ---------------------------------------- | ---------- | ------- | -------------------------------------------- |
| Relaunch restores the loaded page        | `decided`  | backlog | implementation scheduled phase 5 §6.2        |
| The toolbar's Browser action is the dock | `decided`  | backlog | toolbar ships in phase 3 with this contract  |
