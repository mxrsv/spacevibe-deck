# Feature Toolbar — Design

Date: 2026-08-12 · Status: pending user approval

> **Amended 2026-08-14 (D12):** the Browser activation contract in §3 and §4 is
> superseded — Browser stays a docked column and the toolbar action toggles it.
> See [browser productization §5](2026-08-13-browser-productization-design.md)
> `decided`. The text below is kept as written.

## 1. Context

**Origin:**

- The owner wants compact clickable icons for Deck features, organized into
  understandable groups, with hover tooltips that show the feature name and
  its platform shortcut when one exists.
- The owner selected a horizontal toolbar and requires a preview in
  [`gallery.html`](../../gallery.html) before any shipping UI is changed.

**Problem:**

[`ChromeActions`](../../src/ui/chrome-actions.tsx) `current` mixes pane actions,
product tools, update state, and Settings in one undifferentiated cluster. That
works for the current small set, but it does not give Explorer, an embedded
Browser, Usage, or later tools a stable place, and native `title` tooltips do
not provide a consistent name/shortcut layout.

**Decisions:**

- Keep one horizontal toolbar in both Deck chrome layouts.
- Organize actions into Tools, Pane, and Global groups separated by hairlines.
- Use compact icon-only controls for familiar actions; their accessible names
  and visible tooltips carry the text.
- Move lower-priority actions into a `More` menu when width is insufficient.
- Treat the gallery as the required demo surface. Gallery code remains outside
  the shipping bundle under R7.
- This design defines entry-point behavior only. Explorer implementation keeps
  its own approved design, and Browser navigation, security, persistence, and
  process lifecycle require a separate design before implementation.

## 2. Canonical data

**Canonical:**

- [`ACTION_REGISTRY`](../../src/terminal/action-registry.ts) `current` owns each
  action's id, English label, platform bindings, scope, and destructive flag.
- [`shortcutLabel`](../../src/lib/shortcut-label.ts) `current` formats the
  active platform binding for display.
- A toolbar registry owns only presentation metadata: icon, group, order,
  overflow priority, and whether the action is temporarily unavailable.
- Existing feature state remains canonical for pressed, expanded, disabled,
  and update states. The toolbar does not duplicate product state.

**Not canonical:**

- JSX-local labels or shortcut strings.
- Tooltip copy that repeats an action label already present in
  `ACTION_REGISTRY`.
- Gallery fixtures. They demonstrate states but never drive the shipping app.

## 3. Solution architecture

**Components:**

- **Toolbar registry:** A presentation projection over registered actions. It
  defines grouping and responsive priority without owning command behavior.
- **Feature toolbar:** Renders the three groups and routes activation to the
  same command path used by keyboard and native menu actions.
- **Action tooltip:** A shared lightweight tooltip rendered for hover and
  keyboard focus. It shows the action label on the left and a `kbd` shortcut
  on the right when one exists. An unavailable action shows its reason instead
  of pretending the click can run.
- **Overflow menu:** The final stable toolbar control. It lists actions that do
  not fit, preserving group order, action state, label, icon, and shortcut.
- **Gallery specimens:** Real toolbar components mounted through `src/gallery/`
  on `gallery.html`, showing normal, compact, hover/focus, active, disabled,
  and overflow states.

**Group order:**

1. **Tools:** Explorer, Browser, Usage, then future product tools.
2. **Pane:** Split vertically, Split horizontally, Focus expand, Close pane.
3. **Global:** Prompts, actionable Updates state, Settings.

Settings remains the rightmost visible action. `More` sits immediately before
Settings when overflow exists. Separators render only between non-empty visible
groups, never as stranded lines.

**Responsive priority:**

- Explorer, Browser, Prompts, Settings, and `More` are persistent.
- Usage overflows first, followed by Focus expand, Close pane, then the split
  actions. An actionable update remains visible ahead of non-critical actions.
- At the minimum supported window width, no action overlaps native window
  controls, tabs, or workspace navigation.
- v1 does not support user reordering, pinning, or drag-and-drop customization.

**Tool activation contracts:**

- **Explorer:** Toggles or focuses the right dock for the active workspace. It
  uses `Cmd+Shift+E` on macOS and `Ctrl+Shift+E` on Windows, matching VS Code.
  The existing Windows `toggle-expand` binding at `Ctrl+Shift+E` is removed;
  Focus expand remains clickable there.
- **Browser:** Focuses the most recently active Browser surface, creating one
  when none exists. Creating additional browser tabs is an action inside the
  Browser surface, not repeated toolbar activation. Browser renders as a main
  tab/pane surface, not a dock.
- **Usage:** Opens its existing full-window Usage surface contract.
- **Settings:** Opens its existing full-window Settings surface contract.
- **Pane and Global actions:** Preserve their current command behavior and
  overlay guards.

**Tooltip behavior:**

- Visible on pointer hover and keyboard focus, and dismissed when neither
  remains.
- Uses theme tokens, `--ui-font`, one hairline, and the 130 ms chrome state
  transition. It uses no visual timer, shadow, blur, or new dependency.
- A shortcut appears only when the active platform has a binding. No empty
  parentheses or placeholder chord is rendered.
- Tooltip content is also available to assistive technology through the
  trigger's accessible description. The icon remains `aria-hidden` through
  [`DeckIcon`](../../src/ui/controls/deck-icon.tsx) `current`.
- Unavailable actions remain focusable through a semantic unavailable state so
  mouse and keyboard users can discover the reason; they do not execute.

## 4. Failure modes

- When an action has no platform binding, its tooltip shows only the name.
- When the toolbar loses width, actions move to `More` without changing their
  order, state, or command path.
- When an action is unavailable, activation is blocked and the tooltip states
  why; the control does not fail silently.
- When the active platform changes the displayed chord, the tooltip reads the
  binding from the registry rather than retaining a hardcoded macOS label.
- When no workspace is active, Explorer still opens its specified empty state
  and offers folder selection; it never silently roots at the home directory.
- When Browser has no existing surface, activation creates exactly one. When
  one or more exist, activation focuses the most recently active one and does
  not create another.
- When every action in a group has overflowed or is absent, the group separator
  disappears.
- When reduced motion is requested, tooltip and menu transitions are disabled.

## 5. Done and excluded

**Done:**

- `gallery.html` shows the real feature toolbar at normal and minimum-width
  layouts across the existing gallery themes.
- The gallery demonstrates every group, responsive overflow, an active tool,
  an action without a shortcut, and an unavailable action with its reason.
- Pointer hover and keyboard focus show the same custom tooltip; shortcut text
  matches the selected macOS or Windows gallery platform.
- Explorer displays `Cmd+Shift+E` on macOS and `Ctrl+Shift+E` on Windows.
- No gallery module enters the shipping renderer bundle.
- Shipping implementation is not complete until the repository's minimum
  automated gate and native screenshot approval pass on both supported
  platforms.

**Not done:**

- Browser engine, URL bar, navigation policy, permission model, downloads,
  persistence, crash recovery, or web-content security.
- Explorer tree/editor implementation, which remains governed by
  [`2026-08-12-file-explorer-design.md`](2026-08-12-file-explorer-design.md)
  `decided` and remains queued after Electron MVP.
- Toolbar customization, extensions, command palette changes, or new native
  menu structure beyond registering the approved actions.
- Shipping these Electron-only tools in the feature-frozen Tauri app.

## 6. Open questions

- None. Browser internals are deliberately deferred to their own design rather
  than left ambiguous in this toolbar design.
