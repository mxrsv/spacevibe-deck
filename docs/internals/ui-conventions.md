# UI conventions: Tailwind classes and HTML elements

> For maintainers. Using Deck? See [docs/user/](../user/).

How Deck writes Tailwind classes and which HTML element each job uses, read off the code that
already exists. A rule the code meets is stated flatly; a rule it does not meet yet is marked
**target** with the number of violations. Counts were taken on 2026-10-23 over
[`src/gallery/layout-mocks/`](../../src/gallery/layout-mocks/) (the gallery mocks of the shell
layout the [layout spec](../specs/2026-10-22-agent-first-shell-layout.md) evaluates) unless a line says otherwise; re-run them before quoting one. Visual rules stay in
[`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md); this page does not restate them.

## Where Tailwind applies

Tailwind exists only inside the preset fence (DL-1.6), and each stylesheet that imports it
generates only the classes its own `@source` lines scan. The app's stylesheet,
[`src/ui/preset-entry.css`](../../src/ui/preset-entry.css), scans only the shared controls named
in [`src/ui/preset.css:22`](../../src/ui/preset.css). Each gallery page adds its own sources:
[`layout-mocks/mocks.css:5`](../../src/gallery/layout-mocks/mocks.css),
[`sections/preset-controls-section.css:4`](../../src/gallery/sections/preset-controls-section.css)
and [`shadcn-preview/preset.css:4`](../../src/gallery/shadcn-preview/preset.css). So a class that
renders in a gallery page can compile to nothing in the app, and nothing fails: a class that
appears only in a shipping file outside those controls leaves its element unstyled. Chrome outside the fence is plain CSS under
`src/styles/`.

## Tailwind

### Text sizes

- **Five named steps, nothing else.** `text-sm` (14px) and `text-xs` (12px) come from the
  preset; `text-2xs` (11px), `text-3xs` (10px) and `text-code` (12px, with `font-mono`) are
  declared once in [`src/ui/type-scale.css:10`](../../src/ui/type-scale.css). Examples:
  `text-2xs` at
  [`option-inbox-switcher.tsx:73`](../../src/gallery/layout-mocks/option-inbox-switcher.tsx),
  `text-3xs` at
  [`rail-option-c-views.tsx:66`](../../src/gallery/layout-mocks/surfaces/rail/rail-option-c-views.tsx),
  `text-code` at [`agent-dock.tsx:28`](../../src/gallery/layout-mocks/agent-dock.tsx). In the
  mocks: `text-xs` 48, `text-2xs` 25, `text-code` 13, `text-sm` 8, `text-3xs` 2.
- **Never `text-[..px]` or `text-[..rem]`.** The type-scale file calls a size written at a use
  site a defect ([`type-scale.css:3`](../../src/ui/type-scale.css)), and LAY-13 in
  [the shell layout spec](../specs/2026-10-22-agent-first-shell-layout.md) decides it. **Target**,
  with 5 violations outside the mocks' fake web page:
  - 5 × `text-[0.625rem]` (10px, the same size as `text-3xs`) in the generated preset controls,
    for example [`src/ui/controls/button.tsx:25`](../../src/ui/controls/button.tsx) and
    [`badge.tsx:8`](../../src/ui/controls/badge.tsx).
  - The 4 `text-[10px]`/`text-[11px]`/`text-[13px]` in
    [`browser-page.tsx:60`](../../src/gallery/layout-mocks/surfaces/browser/browser-page.tsx)
    are page content of a fake website, which LAY-13 exempts, not Deck chrome.

### Colour

- **Colour comes from theme tokens.** The preset's roles (`text-foreground`,
  `text-muted-foreground`, `bg-muted`, `bg-accent`, `border`, `ring-ring`, `bg-sidebar`…)
  appear 283 times in the mocks, for example `hover:bg-muted` at
  [`agent-dock.tsx:28`](../../src/gallery/layout-mocks/agent-dock.tsx). Terminal and diff colours
  are custom properties declared for light and dark in
  [`mocks.css:24`](../../src/gallery/layout-mocks/mocks.css) and read with the
  `text-(--term-ok)` form, 39 times, for example
  [`mock-terminal.tsx:32`](../../src/gallery/layout-mocks/mock-terminal.tsx).
- **No palette or hex colours.** **Target**, with 28 violations outside the fake web page:
  25 palette classes for agent states and scrims (`bg-red-600`, `bg-amber-500`, `bg-sky-600`,
  `bg-black/55`), for example
  [`agent-parts.tsx:42`](../../src/gallery/layout-mocks/agent-parts.tsx) and
  [`settings-option-a-rows.tsx:54`](../../src/gallery/layout-mocks/surfaces/settings/settings-option-a-rows.tsx),
  and 3 hex window-button dots at
  [`agent-parts.tsx:76`](../../src/gallery/layout-mocks/agent-parts.tsx). The state colours
  have no preset token yet; adding one is the fix, not another palette class.

### `className` on a shared control

- **A shared control takes `className` for layout only**: width, height, margin, padding,
  gap, alignment. Its look comes from its `variant` and `size`, so a colour or font class at
  the call site forks the control's look per surface. Layout-only examples: `w-full` on the
  `SelectTrigger` at
  [`rail-option-c-create.tsx:60`](../../src/gallery/layout-mocks/surfaces/rail/rail-option-c-create.tsx),
  `min-w-44` on a `DropdownMenuContent` at
  [`rail-option-c-row.tsx:269`](../../src/gallery/layout-mocks/surfaces/rail/rail-option-c-row.tsx).
  **Target**: 16 of the 43 `className` props on shared controls carry a visual class, mostly
  `text-foreground`, `font-mono` or a text size; the worst restyles a whole `Input`
  (`bg-transparent text-sm shadow-none focus-visible:ring-0`) at
  [`settings-option-a.tsx:126`](../../src/gallery/layout-mocks/surfaces/settings/settings-option-a.tsx).
- The prop is `className`, never `class` (DL-1.6).

### Arbitrary values and new tokens

- **An arbitrary value is for one-off geometry** fitted to one layout: 58 in the mocks, almost
  all widths, heights and grid tracks, such as `max-h-[45%]` at
  [`agent-dock.tsx:172`](../../src/gallery/layout-mocks/agent-dock.tsx) or
  `w-[calc(100%-0.75rem)]` at
  [`option-inbox.tsx:190`](../../src/gallery/layout-mocks/option-inbox.tsx).
- **A value that repeats, or that names a role, becomes a token instead**: a text size, a
  colour, a radius. The precedent is the type scale, where 51 arbitrary font sizes in the mock
  became five steps in one file (LAY-13,
  [`type-scale.css:1`](../../src/ui/type-scale.css)). A new token goes in `@theme`, never as a
  chrome custom property (DL-1.6 keeps the two token sets apart).

### How `cn` merges classes

- `cn` (the `cn` package, a `clsx` + `tailwind-merge` replacement) joins conditional classes
  and, when two classes set the same property, keeps the **last** one. Controls pass the
  caller's `className` last, as in
  [`button.tsx:50`](../../src/ui/controls/button.tsx), so the call site wins a conflict:
  `cn("px-2", "px-4")` is `px-4`.
- **Trap: `cn` reads `text-code` as a colour.** It knows `text-2xs` and `text-3xs` are sizes,
  but `cn("text-code", "text-muted-foreground")` returns `text-muted-foreground` and the size
  is silently lost; the reverse order drops the colour. Two mocks lose it today:
  [`mock-terminal.tsx:32`](../../src/gallery/layout-mocks/mock-terminal.tsx) (with
  `text-(--term-fg)`) and
  [`changes-parts.tsx:89`](../../src/gallery/layout-mocks/surfaces/changes/changes-parts.tsx)
  (with the status colour). Until `cn` is taught the step, keep `text-code` and a text colour
  out of the same `cn` call, for example on a wrapper.

## HTML elements

- **`Button` for an action.** 62 `<Button>` in the mocks. An icon-only one carries
  `aria-label`: 19 `size="icon*"` buttons, 0 without a label, for example
  [`option-inbox.tsx:67`](../../src/gallery/layout-mocks/option-inbox.tsx). A whole list or
  tree row that is one-click target is today a raw `<button type="button">`: 17 of them, all
  typed, for example the tree row at
  [`changes-tree.tsx:69`](../../src/gallery/layout-mocks/surfaces/changes/changes-tree.tsx).
- **`<a href>` for navigation.** The mocks have no navigation target (0 `<a>`). The shipping
  example is the install link at
  [`src/launcher/agent-install-control.tsx:44`](../../src/launcher/agent-install-control.tsx),
  which keeps `href` and routes the click through the host.
- **`Switch` for on/off settings**, 4 in the mocks, for example
  [`settings-option-a-rows.tsx:311`](../../src/gallery/layout-mocks/surfaces/settings/settings-option-a-rows.tsx);
  a pressed state on a toolbar button is `aria-pressed` (4), as at
  [`option-inbox.tsx:69`](../../src/gallery/layout-mocks/option-inbox.tsx).
- **`Input` and `Select` for values**: 10 `<Input>`, 3 `<Select>`, and 0 raw `<input>` or
  `<select>`, for example
  [`rail-option-c-create.tsx:54`](../../src/gallery/layout-mocks/surfaces/rail/rail-option-c-create.tsx).
- **No `<div onClick>`.** **Target**, with 1 violation: a `role="option"` row in a listbox at
  [`option-inbox-switcher.tsx:80`](../../src/gallery/layout-mocks/option-inbox-switcher.tsx).
  Pointer-down handlers sit on 4 other non-interactive elements (diff rows and cells, a scrim,
  a focusable `section`), for example
  [`diff-code.tsx:58`](../../src/gallery/layout-mocks/surfaces/diff/diff-code.tsx).
- **Headings and landmarks name the regions.** In the mocks: `<nav>` 5, `<main>` 2,
  `<header>` 10, `<section>` 13, `<footer>` 2, `<h1>` 1, `<h2>` 1, `<h3>` 8. A landmark that
  repeats carries `aria-label`, as the two `<nav>`s at
  [`option-inbox.tsx:368`](../../src/gallery/layout-mocks/option-inbox.tsx) and
  [`option-inbox.tsx:412`](../../src/gallery/layout-mocks/option-inbox.tsx) do.
- **Repeated rows are a list**: `<ul>` 11, `<li>` 10, with `list-none` and the margin reset
  written at the site, as at [`agent-dock.tsx:97`](../../src/gallery/layout-mocks/agent-dock.tsx).
- **`aria-label` names what the eye reads from an icon or a glyph**: 106 in the mocks,
  `aria-hidden` on the decorative glyph beside it 64.
- **`aria-disabled` rather than `disabled` where the reason must stay reachable** (DL-23.6):
  `disabled` removes a control from the tab order, so its tooltip can no longer be reached by
  keyboard. Shipping chrome does this, for example
  [`src/ui/toolbar/feature-toolbar.tsx:90`](../../src/ui/toolbar/feature-toolbar.tsx).
  **Target** in the mocks: 0 `aria-disabled`, 16 `disabled=`, for example the submit at
  [`rail-option-c-create.tsx:77`](../../src/gallery/layout-mocks/surfaces/rail/rail-option-c-create.tsx).
