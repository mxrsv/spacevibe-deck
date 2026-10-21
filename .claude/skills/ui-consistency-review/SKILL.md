---
name: ui-consistency-review
description: Review the changed lines of a Deck UI diff against AGENTS.md R11-R13 for what lint cannot see — a raw element dressed as an existing control, a caller overriding a control's height, copied control markup, new global CSS, static inline style, theme selectors written by hand. Use before committing a change to src/**/*.tsx or src/**/*.css outside the gallery. Not a general code review (use review-change) and not a visual judgement (that needs a screenshot and the owner's eye).
---

# UI consistency review

A styling guard, not a general review. Read only the changed lines of the diff
(`git diff` against the commit's base) and answer the three questions below. Do not build,
run the app, inspect emitted CSS, trace selector consumers across the codebase or ask for
screenshots. If the diff does not make a violation obvious, there is no finding.

Run `npx oxlint <changed files>` first. Lint already rejects restyling a preset control,
raw palette colours, arbitrary values outside layout, dynamic class strings on a control,
outset focus rings and imports of Base UI, Hugeicons or a `*Variants` recipe outside
`src/ui/controls/`. Do not repeat its findings; report the lint output as it is.

## 1. Controls come from `src/ui/controls/` (R11, R12)

- Flag a bare `<button>`, `<input>`, `<select>` or `<textarea>` styled to look like a control
  that `src/ui/controls/` provides.
- Flag a caller that sets a control's height or size (`h-*`, `size-*`, `min-h-*`): lint lets
  sizing through as layout. A look several places need is a new size on the primitive.
- Do not flag raw elements that are not a control by design: rows, tabs, resize handles,
  swatches, the terminal, editor surfaces, and the native `<select>` laid over a pill (DL-1.4)
  on surfaces not yet migrated.

## 2. Styling lives on the component that renders it (R13)

- Flag new rules in a `.css` file that classes on the owning component could express. Global
  CSS is right only for the xterm and Monaco hosts, rendered markdown, Electron drag regions,
  keyframes and runtime theme variables.
- Flag a new `style={{ … }}` carrying a static value a class covers; runtime values are fine.
- Flag a hand-written `.dark` selector; theme-only styling goes through the preset's `dark`
  variant.

## 3. Compose, do not copy (R11)

- Flag a new component that copies a primitive's markup and classes instead of composing it.
- Flag a long class string that repeats a treatment another call site already uses: the fix
  is a variant on the primitive or a slot on a shared composite.
- A composite with several parts (row, banner, card) exports one object of small slots that
  own their classes, take `className` and spread their other props; flag a new member of
  such a family that hand-builds its row, icon column or actions instead.

## Reporting

Report only violations the changed lines introduce, one line each: the file and line, the
rule (R11/R12/R13), and the primitive or place the code should use instead. Do not comment
on untouched legacy code, class order or taste, and do not ask for cleanup outside the
change. With no findings, the whole report is `All clear`.
