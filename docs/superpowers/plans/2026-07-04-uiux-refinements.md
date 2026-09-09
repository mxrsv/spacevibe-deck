# UI/UX Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-row window chrome with double-click zoom, info-only hideable pane bar with a hover drag anchor, a tab options popover (rename + dot color), and a JS-computed theme-derived color system with WCAG contrast floors.

**Architecture:** A new pure color-math module (`lib/derive-colors.ts`) computes all chrome CSS custom properties from the theme's bg/fg; `app.tsx` sets them on `:root`, and `styles.css` only consumes tokens. Tab name/color overrides live in a `Map` inside `tab-manager.ts` keyed by tab key, merged over process-derived values by a pure function in `tabs-store.ts`, and persisted by index in `session.json`. Pane bar visibility is a boolean setting applied as a CSS class per tab container.

**Tech Stack:** Preact + `@preact/signals`, Tauri v2 (`@tauri-apps/api`), xterm 6, Vitest, TypeScript strict. No new dependencies.

## Global Constraints

- **English-only**: all strings, comments, and docs in this repo are English.
- **No new npm dependencies.**
- **Flat design rule** (from `styles.css` header comment): no drop shadows anywhere; depth = background steps + 1px hairlines only.
- **Immutability**: never mutate objects/arrays in place in new code — spread/copy instead (the existing `overrides` `Map` pattern in `tab-manager.ts` closures is the local idiom for manager-internal state and is fine).
- **No `console.log`** in production code (`console.warn`/`console.error` for failures is the existing idiom).
- **Contrast floors are the app-wide standard**: `--text-primary` ≥ 4.5:1 against `--input-bg` and `--chrome-2`; `--text-muted` ≥ 4.5:1 against `--chrome-1`; `--text-faint` ≥ 3:1 against `--chrome-1`.
- **Sizes from spec, verbatim**: title bar ~26px; tab bar 33px; pane action glyphs 13px inside 24px buttons; anchor hover zone = top ~26px of a pane.
- Tests run with `npm test` (vitest run); build with `npm run build` (tsc + vite); manual checks with `npm run tauri dev`.
- Per the user's git rules: work and commit on the **current branch** (`main`); do NOT create a branch or worktree unless the user asks.
- All paths below are relative to `stackgrid/` (run commands from `stackgrid/`).

---

### Task 1: Color math library `lib/derive-colors.ts`

**Files:**

- Create: `src/lib/derive-colors.ts`
- Test: `src/lib/derive-colors.test.ts`

**Interfaces:**

- Consumes: nothing (pure module, no imports).
- Produces (used by Task 2):

  ```ts
  export interface ChromeColors {
    readonly tone: string; // "#ffffff" | "#000000"
    readonly chrome1: string; // hex
    readonly chrome2: string; // hex
    readonly tabActiveBg: string; // hex
    readonly inputBg: string; // hex
    readonly hair: string; // rgba() string
    readonly hairStrong: string; // rgba() string
    readonly textPrimary: string; // hex
    readonly textMuted: string; // hex
    readonly textFaint: string; // hex
  }
  export function luminance(hex: string): number;
  export function contrastRatio(a: string, b: string): number;
  export function mixHex(base: string, target: string, amount: number): string;
  export function deriveChromeColors(bg: string, fg: string): ChromeColors;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/derive-colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveChromeColors,
  luminance,
  mixHex,
} from "./derive-colors";
import { THEME_PRESETS } from "../settings/themes";

describe("luminance", () => {
  it("is 1 for white and 0 for black", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
  });

  it("is ~0.2158 for #808080", () => {
    expect(luminance("#808080")).toBeCloseTo(0.2158, 3);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#16161e", "#c0caf5")).toBeCloseTo(
      contrastRatio("#c0caf5", "#16161e"),
      5,
    );
  });
});

describe("mixHex", () => {
  it("returns base at 0 and target at 1", () => {
    expect(mixHex("#16161e", "#ffffff", 0)).toBe("#16161e");
    expect(mixHex("#16161e", "#ffffff", 1)).toBe("#ffffff");
  });

  it("mixes black and white to mid gray", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("deriveChromeColors", () => {
  it("mixes toward white on dark backgrounds, black on light ones", () => {
    expect(deriveChromeColors("#16161e", "#c0caf5").tone).toBe("#ffffff");
    expect(deriveChromeColors("#ffffff", "#333333").tone).toBe("#000000");
  });

  it("emits alpha hairlines from the foreground", () => {
    const chrome = deriveChromeColors("#16161e", "#c0caf5");
    expect(chrome.hair).toBe("rgba(192, 202, 245, 0.12)");
    expect(chrome.hairStrong).toBe("rgba(192, 202, 245, 0.2)");
  });

  // The spec's contrast floors — the app-wide standard. Every preset plus
  // the known-bad overrides must pass.
  const cases: Array<{ label: string; bg: string; fg: string }> = [
    ...THEME_PRESETS.map((preset) => ({
      label: preset.label,
      bg: preset.theme.background,
      fg: preset.theme.foreground,
    })),
    // Tokyo Night comment color used as fg override (1.02:1 raw on inputs)
    { label: "low-contrast fg override", bg: "#1a1b26", fg: "#565f89" },
    // Light background override that broke the old white-mix chrome
    { label: "light bg override", bg: "#ffffff", fg: "#c0caf5" },
    { label: "light bg, light fg", bg: "#fafafa", fg: "#e0e0e0" },
  ];

  for (const { label, bg, fg } of cases) {
    it(`meets all contrast floors for ${label}`, () => {
      const c = deriveChromeColors(bg, fg);
      expect(contrastRatio(c.textPrimary, c.inputBg)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(c.textPrimary, c.chrome2)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(c.textMuted, c.chrome1)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.textFaint, c.chrome1)).toBeGreaterThanOrEqual(3);
    });
  }

  it("keeps a high-contrast fg unchanged as textPrimary", () => {
    // Tokyo Night fg is already >> 4.5:1 on its surfaces — no raise needed
    expect(deriveChromeColors("#16161e", "#c0caf5").textPrimary).toBe(
      "#c0caf5",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/derive-colors.test.ts`
Expected: FAIL — `Cannot find module './derive-colors'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/lib/derive-colors.ts`:

```ts
/**
 * Theme-derived chrome color system (app-wide standard).
 *
 * All chrome UI derives from the terminal theme's bg/fg — no hardcoded
 * chrome colors. Text tokens are raised toward the tone until they meet
 * WCAG contrast floors, so a low-contrast theme or user override can
 * never sink the chrome below readability.
 */

export interface ChromeColors {
  readonly tone: string;
  readonly chrome1: string;
  readonly chrome2: string;
  readonly tabActiveBg: string;
  readonly inputBg: string;
  readonly hair: string;
  readonly hairStrong: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly textFaint: string;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// Background luminance below this mixes toward white, otherwise black
const DARK_LUMINANCE_THRESHOLD = 0.45;
// Step size when raising a text color toward the tone (2% per step)
const RAISE_STEP = 0.02;

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Linear interpolation from base toward target; amount in [0, 1]. */
export function mixHex(base: string, target: string, amount: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(target);
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  });
}

/** WCAG relative luminance in [0, 1]. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (n: number): number => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Mix `text` toward `tone` in small steps until it meets `floor` against
 * every surface. Caps at the tone itself when the floor is unreachable
 * (mid-gray backgrounds) — best achievable contrast wins.
 */
function ensureContrast(
  text: string,
  surfaces: readonly string[],
  floor: number,
  tone: string,
): string {
  for (let t = 0; t <= 1; t += RAISE_STEP) {
    const candidate = mixHex(text, tone, t);
    if (surfaces.every((s) => contrastRatio(candidate, s) >= floor)) {
      return candidate;
    }
  }
  return tone;
}

function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Derive every chrome token from the theme's background and foreground. */
export function deriveChromeColors(bg: string, fg: string): ChromeColors {
  const dark = luminance(bg) < DARK_LUMINANCE_THRESHOLD;
  const tone = dark ? "#ffffff" : "#000000";
  const chrome1 = mixHex(bg, tone, 0.04);
  const chrome2 = mixHex(bg, tone, 0.07);
  const tabActiveBg = mixHex(bg, tone, 0.15);
  // Kept soft on light themes — readability comes from the textPrimary floor
  const inputBg = mixHex(bg, tone, dark ? 0.12 : 0.06);
  return {
    tone,
    chrome1,
    chrome2,
    tabActiveBg,
    inputBg,
    hair: alpha(fg, 0.12),
    hairStrong: alpha(fg, 0.2),
    textPrimary: ensureContrast(fg, [inputBg, chrome2], 4.5, tone),
    textMuted: ensureContrast(mixHex(bg, fg, 0.52), [chrome1], 4.5, tone),
    textFaint: ensureContrast(mixHex(bg, fg, 0.34), [chrome1], 3, tone),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/derive-colors.test.ts`
Expected: PASS, all tests green.

Note: if the "keeps a high-contrast fg unchanged" test fails because `mixHex(fg, tone, 0)` rounds differently — `mixHex` with `amount 0` returns the input verbatim through round-tripping; `#c0caf5` round-trips exactly, so it must pass. If a floor test fails for a preset, print the failing token and ratio, and check the loop step (`t` accumulating floats is fine here: `0.02 * 50 ≈ 1.0000000000000002` still runs the `t = 0` and near-1 iterations; the final `return tone` is the backstop).

- [ ] **Step 5: Commit**

```bash
git add src/lib/derive-colors.ts src/lib/derive-colors.test.ts
git commit -m "feat: add theme-derived chrome color math with WCAG contrast floors"
```

---

### Task 2: Wire derived tokens into `app.tsx` and migrate `styles.css`

**Files:**

- Modify: `src/ui/app.tsx` (the `useSignalEffect` block, lines ~42–56)
- Modify: `src/styles.css` (`:root` tokens + every hardcoded `white` mix + chrome `var(--fg)` text usages)

**Interfaces:**

- Consumes: `deriveChromeColors(bg, fg): ChromeColors` from Task 1.
- Produces: CSS custom properties on `:root`, set from JS on every settings change: `--tone`, `--chrome-1`, `--chrome-2`, `--tab-active-bg`, `--input-bg`, `--hair`, `--hair-strong`, `--text-primary`, `--text-muted`, `--text-faint`. All later tasks' CSS may use these.

- [ ] **Step 1: Update `app.tsx` to compute and set the tokens**

In `src/ui/app.tsx`, add the import:

```ts
import { deriveChromeColors } from "../lib/derive-colors";
```

Replace the body of the existing `useSignalEffect` (currently setting `--bg`, `--fg`, `--accent`, …) with:

```ts
useSignalEffect(() => {
  const current = settings.value;
  tabsRef.current?.applySettings(current);
  const theme = resolveTheme(current);
  const bg = theme.background ?? "#16161e";
  const fg = theme.foreground ?? "#c0caf5";
  const chrome = deriveChromeColors(bg, fg);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--bg", bg);
  rootStyle.setProperty("--fg", fg);
  rootStyle.setProperty("--accent", theme.blue ?? "#7aa2f7");
  rootStyle.setProperty("--red", theme.red ?? "#f7768e");
  rootStyle.setProperty("--green", theme.green ?? "#9ece6a");
  rootStyle.setProperty("--yellow", theme.yellow ?? "#e0af68");
  rootStyle.setProperty("--magenta", theme.magenta ?? "#bb9af7");
  rootStyle.setProperty("--cyan", theme.cyan ?? "#7dcfff");
  rootStyle.setProperty("--tone", chrome.tone);
  rootStyle.setProperty("--chrome-1", chrome.chrome1);
  rootStyle.setProperty("--chrome-2", chrome.chrome2);
  rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
  rootStyle.setProperty("--input-bg", chrome.inputBg);
  rootStyle.setProperty("--hair", chrome.hair);
  rootStyle.setProperty("--hair-strong", chrome.hairStrong);
  rootStyle.setProperty("--text-primary", chrome.textPrimary);
  rootStyle.setProperty("--text-muted", chrome.textMuted);
  rootStyle.setProperty("--text-faint", chrome.textFaint);
});
```

- [ ] **Step 2: Update the `:root` token block in `styles.css`**

Replace lines 12–18 of `src/styles.css` (the "Derived chrome tones" block):

```css
/* Derived chrome tones — computed in JS (lib/derive-colors.ts) and set on
     :root by app.tsx; the values below are pre-JS fallbacks for first paint.
     --tone is white on dark themes, black on light ones. */
--tone: #ffffff;
--chrome-1: color-mix(in srgb, var(--bg) 96%, var(--tone));
--chrome-2: color-mix(in srgb, var(--bg) 93%, var(--tone));
--tab-active-bg: color-mix(in srgb, var(--bg) 85%, var(--tone));
--input-bg: color-mix(in srgb, var(--bg) 88%, var(--tone));
--hair: color-mix(in srgb, var(--fg) 12%, transparent);
--hair-strong: color-mix(in srgb, var(--fg) 20%, transparent);
--text-primary: var(--fg);
--text-muted: color-mix(in srgb, var(--fg) 52%, var(--bg));
--text-faint: color-mix(in srgb, var(--fg) 34%, var(--bg));
```

- [ ] **Step 3: Migrate every hardcoded `white` mix and chrome `var(--fg)` text usage**

These are exact string edits in `src/styles.css`. Migration table (grep first to confirm: `grep -n ", white)" src/styles.css` and `grep -n "var(--fg)" src/styles.css`):

| Selector                       | Old                                                                             | New                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `.window`                      | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.tab:hover`                   | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.tab.is-active`               | `color: var(--fg);` and `background: color-mix(in srgb, var(--bg) 55%, white);` | `color: var(--text-primary);` and `background: var(--tab-active-bg);` |
| `.tab-add:hover`               | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.iconbtn:hover`               | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.theme-chip`                  | `background: color-mix(in srgb, var(--bg) 70%, white);`                         | `background: var(--input-bg);`                                        |
| `.theme-chip:hover`            | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.theme-chip.is-active`        | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.select, .text-input`         | `background: color-mix(in srgb, var(--bg) 70%, white);` and `color: var(--fg);` | `background: var(--input-bg);` and `color: var(--text-primary);`      |
| `.stepper`                     | `background: color-mix(in srgb, var(--bg) 70%, white);`                         | `background: var(--input-bg);`                                        |
| `.stepper__button`             | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.segmented`                   | `background: color-mix(in srgb, var(--bg) 70%, white);`                         | `background: var(--input-bg);`                                        |
| `.segmented__option.is-active` | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.panel__x:hover`              | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |
| `.btn-reset:hover`             | `color: var(--fg);`                                                             | `color: var(--text-primary);`                                         |

Deliberately **kept** as `var(--fg)` (decision, not an omission): low-alpha hover _tint backgrounds_ like `color-mix(in srgb, var(--fg) 6%, transparent)` (`.tab:hover`, `.tab-add:hover`, `.iconbtn:hover`, `.panel__x:hover`, `.status__kbd` background) — a fg-alpha tint self-adapts on light themes (dark fg = darkening tint) and is a surface, not text, so no contrast floor applies. Also kept: xterm scrollbar thumb (terminal area, not chrome) and `.pane__badge--agent` / `.status__seg--accent` (accent-colored, not fg-derived text).

After the edits, verify no hardcoded white mixes remain:

Run: `grep -n ", white)" src/styles.css`
Expected: no output.

- [ ] **Step 4: Build and eyeball**

Run: `npm run build`
Expected: tsc + vite succeed with no errors.

Run: `npm run tauri dev` — cycle all four theme presets in the settings panel; set a Background override to `#ffffff` and a Foreground override to `#565f89`: all bars, inputs, tabs and the panel must stay readable (no white-on-white, no invisible text).

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/styles.css
git commit -m "feat: switch chrome to JS-derived theme tokens with contrast floors"
```

---

### Task 3: Two-row window chrome + double-click zoom

**Files:**

- Modify: `src/ui/app.tsx` (add title bar row, remove `cycleTheme`)
- Modify: `src/ui/tab-bar.tsx` (remove traffic spacer, swatch, `onCycleTheme`; 13px icons)
- Modify: `src/styles.css` (grid rows, `.titlebar`, compact tab bar, remove `.swatch` and `.tabbar__traffic`)

**Interfaces:**

- Consumes: `getCurrentWindow` from `@tauri-apps/api/window` (already a dependency; see `src/lib/quit-guard.ts:1` for the import idiom).
- Produces: `TabBarProps` **loses** `onCycleTheme` — the final prop list is: `settingsOpen`, `onSelectTab`, `onCloseTab`, `onNewTab`, `onSplitRow`, `onSplitColumn`, `onClosePane`, `onToggleSettings`, `expandActive`, `onToggleExpand`. Task 9 will extend this component further.

- [ ] **Step 1: Add the title bar row in `app.tsx`**

Add the import:

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
```

In the returned JSX, insert the title bar as the first child of `.window`, above `<TabBar …>`:

```tsx
<div
  class="titlebar"
  data-tauri-drag-region
  onDblClick={() => {
    getCurrentWindow()
      .toggleMaximize()
      .catch((err: unknown) => {
        console.warn("toggleMaximize failed:", err);
      });
  }}
/>
```

Delete the `cycleTheme` function (lines ~63–70), the `onCycleTheme={cycleTheme}` prop, and the now-unused `THEME_PRESETS` import (keep `resolveTheme`). `updateSettings` stays imported (still used by `onToggleExpand`).

- [ ] **Step 2: Strip the tab bar in `tab-bar.tsx`**

- Remove `onCycleTheme(): void;` from `TabBarProps`.
- Delete the `<div class="tabbar__traffic" … />` element (traffic lights now live in row 1).
- Delete the theme swatch button (`<button type="button" class="swatch" … />`) and the `.tabbar__sep` element **stays** (it separates pane actions from the gear).
- Change every icon SVG (`SplitRowIcon`, `SplitColumnIcon`, `ClosePaneIcon`, `ExpandIcon`, `GearIcon`) from `width="18" height="18"` to `width="13" height="13"` (5 components, 2 attributes each).

- [ ] **Step 3: Update `styles.css` for the two rows**

In `:root`, replace `--tabbar-h: 44px;` with:

```css
--titlebar-h: 26px;
--tabbar-h: 33px;
```

In `.window`, replace the grid rows:

```css
grid-template-rows: var(--titlebar-h) var(--tabbar-h) 1fr var(--status-h);
```

Add after the `.window` rule:

```css
/* ── Title bar: traffic lights only, full-width drag region ── */

.titlebar {
  background: var(--bg);
}
```

Update the tab bar block:

- `.tabbar`: change `padding: 0 10px 0 0;` to `padding: 0 8px 0 6px;` (tabs start at the left edge).
- Delete the whole `.tabbar__traffic` rule.
- `.tab`: change `height: 30px;` to `height: 25px;`, `border-radius: 9px;` to `border-radius: 7px;`.
- `.tab-add`: change `width: 26px; height: 26px;` to `width: 24px; height: 24px;`.
- `.iconbtn`: change `width: 30px; height: 30px;` to `width: 24px; height: 24px;` and `border-radius: 8px;` to `border-radius: 7px;`.
- `.tabbar__sep`: change `height: 20px;` to `height: 16px;`.
- Delete the `.swatch` and `.swatch:hover` rules entirely.

- [ ] **Step 4: Build and manually verify**

Run: `npm run build`
Expected: PASS (this also catches any leftover `onCycleTheme` reference — tsc errors on unknown props).

Run: `npm run tauri dev` and check:

1. Row 1 shows only the traffic lights on the terminal background; row 2 has tabs from the left edge, `+`, then the four 13px action icons, hairline, gear. No theme swatch.
2. **Double-click row 1** → window zooms (maximizes); double-click again → restores.
   - If nothing happens (drag region swallows `dblclick` on this WebKit version): replace `onDblClick` with `onMouseDown={(e) => { if (e.detail === 2) { …same toggleMaximize call… } }}`.
   - If it maximizes then instantly restores (double toggle): Tauri's injected drag-region script already handles double-click on this platform — delete our handler and keep the bare drag region.
3. Dragging the window works from **both** rows (row 2's drag region attrs are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/ui/tab-bar.tsx src/styles.css
git commit -m "feat: two-row window chrome with double-click zoom, compact tab bar"
```

---

### Task 4: `showPaneBar` setting

**Files:**

- Modify: `src/settings/settings-schema.ts`
- Test: `src/settings/settings-schema.test.ts` (extend existing file)
- Modify: `src/ui/settings-panel.tsx` (new "Panes" section)
- Modify: `src/terminal/terminal-manager.ts` (CSS class on the tab container)

**Interfaces:**

- Consumes: existing `Settings`, `validateSettings`, `DEFAULT_SETTINGS` shapes shown below.
- Produces: `Settings.showPaneBar: boolean` (default `false`); the CSS class `pane-bar-hidden` on each `.tab-stage` container when the bar is hidden. Task 5's CSS keys off this class.

- [ ] **Step 1: Write the failing test**

In `src/settings/settings-schema.test.ts`, add (match the existing test style in that file):

```ts
describe("showPaneBar", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.showPaneBar).toBe(false);
    expect(validateSettings({}).showPaneBar).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ showPaneBar: true }).showPaneBar).toBe(true);
    expect(validateSettings({ showPaneBar: "yes" }).showPaneBar).toBe(false);
  });
});
```

(If the file does not already import `DEFAULT_SETTINGS`/`validateSettings`, extend its imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: FAIL — `showPaneBar` does not exist on `Settings` (tsc error) or is `undefined`.

- [ ] **Step 3: Implement the schema change**

In `src/settings/settings-schema.ts`:

- Add to `interface Settings` (after `focusExpand: boolean;`):

```ts
showPaneBar: boolean;
```

- Add to `DEFAULT_SETTINGS`:

```ts
  showPaneBar: false,
```

- Add to the return object of `validateSettings` (after the `focusExpand` entry):

```ts
    showPaneBar:
      typeof source.showPaneBar === "boolean"
        ? source.showPaneBar
        : DEFAULT_SETTINGS.showPaneBar,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the settings panel toggle**

In `src/ui/settings-panel.tsx`, insert a new section between the "Colors" and "Tabs" sections:

```tsx
<section class="panel__sec">
  <h3 class="panel__sec-title">Panes</h3>
  <div class="field">
    <span class="field__label">Show pane bar</span>
    <div class="segmented" role="radiogroup" aria-label="Show pane bar">
      <button
        type="button"
        role="radio"
        aria-checked={current.showPaneBar}
        class={`segmented__option ${current.showPaneBar ? "is-active" : ""}`}
        onClick={() => updateSettings({ showPaneBar: true })}
      >
        On
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!current.showPaneBar}
        class={`segmented__option ${current.showPaneBar ? "" : "is-active"}`}
        onClick={() => updateSettings({ showPaneBar: false })}
      >
        Off
      </button>
    </div>
  </div>
</section>
```

- [ ] **Step 6: Drive the container class from settings**

In `src/terminal/terminal-manager.ts`, inside `createTerminalManager` right after the `let activeId …` declarations, add (the file already imports `settings` from `../settings/settings-store`):

```ts
// Pane bar visibility is CSS-only: pane.ts always builds and populates the
// bar (the drag ghost and anchor still read its cwd) — this class hides it.
container.classList.toggle("pane-bar-hidden", !settings.value.showPaneBar);
```

And in the returned `applySettings(next)` method, add as the first line:

```ts
container.classList.toggle("pane-bar-hidden", !next.showPaneBar);
```

(No visible effect until Task 5 adds the CSS rule.)

- [ ] **Step 7: Full test run, build, commit**

Run: `npm test` — Expected: PASS.
Run: `npm run build` — Expected: PASS.

```bash
git add src/settings/settings-schema.ts src/settings/settings-schema.test.ts src/ui/settings-panel.tsx src/terminal/terminal-manager.ts
git commit -m "feat: add showPaneBar setting with panel toggle (default hidden)"
```

---

### Task 5: Hide pane bar + hover anchor pill + anchor drag

**Files:**

- Modify: `src/terminal/pane.ts` (anchor element + hover detection)
- Modify: `src/terminal/pane-drag.ts` (accept `.pane__anchor` as drag handle)
- Modify: `src/styles.css` (hide rule, anchor pill styles)

**Interfaces:**

- Consumes: the `pane-bar-hidden` class on `.tab-stage` (Task 4).
- Produces: a `.pane__anchor` element inside every `.pane` (child of the pane root, so `.pane-slot` lookups in `pane-drag.ts` keep working). `setHeaderInfo` also fills the anchor's cwd. `pane-drag.ts` starts drags from `.pane__bar` **or** `.pane__anchor`.

- [ ] **Step 1: Add the anchor to `pane.ts`**

In `createPane`, after the `bar.append(dot, cwdEl, badge);` line, add:

```ts
// Hover anchor: shown only while the pane bar is hidden (CSS-gated).
// It is the pane-drag handle and shows the cwd; revealed when the
// pointer enters the top ~26px of the pane.
const anchor = document.createElement("div");
anchor.className = "pane__anchor";
const anchorGrip = document.createElement("span");
anchorGrip.className = "pane__anchor-grip";
anchorGrip.textContent = "⋮⋮";
const anchorCwd = document.createElement("span");
anchorCwd.className = "pane__anchor-cwd";
anchor.append(anchorGrip, anchorCwd);
```

Change `element.append(bar, termEl);` to `element.append(bar, anchor, termEl);`

After the existing `element.addEventListener("mousedown", …)` line, add the hover-zone detection (a real element overlay would steal clicks from xterm; class toggling keeps the top strip clickable):

```ts
const ANCHOR_ZONE_PX = 26;
element.addEventListener("mousemove", (event) => {
  const top = element.getBoundingClientRect().top;
  element.classList.toggle(
    "is-anchor-zone",
    event.clientY - top < ANCHOR_ZONE_PX,
  );
});
element.addEventListener("mouseleave", () => {
  element.classList.remove("is-anchor-zone");
});
```

In `setHeaderInfo`, after `cwdEl.textContent = info.cwd;` add:

```ts
anchorCwd.textContent = info.cwd;
```

- [ ] **Step 2: Accept the anchor as a drag handle in `pane-drag.ts`**

In `onPointerDown`, replace:

```ts
const bar = el.closest(".pane__bar");
if (!bar) {
  return; // only drag from the header bar, not the xterm area
}
```

with:

```ts
const handle = el.closest(".pane__bar, .pane__anchor");
if (!handle) {
  return; // only drag from the header bar or the hover anchor
}
```

And three lines below, replace `const slot = bar.closest<HTMLElement>(".pane-slot");` with `const slot = handle.closest<HTMLElement>(".pane-slot");`

(The ghost label keeps reading `.pane__cwd` — the bar stays in the DOM when hidden, so `slot?.querySelector(".pane__cwd")?.textContent` still returns the cwd.)

- [ ] **Step 3: Add the CSS**

In `src/styles.css`, in the Pane section:

Add `position: relative;` to the `.pane` rule (the anchor positions against it).

After the `.pane__bar` rule, add:

```css
/* Pane bar hidden mode: the bar stays in the DOM (drag ghost and anchor
   read its cwd) — only its visibility is CSS-driven (showPaneBar setting) */
.pane-bar-hidden .pane__bar {
  display: none;
}

/* ── Hover anchor: centered pill, drag handle when the bar is hidden ── */

.pane__anchor {
  position: absolute;
  top: 5px;
  left: 50%;
  z-index: 5;
  display: none;
  align-items: center;
  gap: 7px;
  max-width: 60%;
  padding: 3px 11px;
  border: 1px solid var(--hair-strong);
  border-radius: 999px;
  background: var(--chrome-2);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  cursor: grab;
  opacity: 0;
  transform: translate(-50%, -6px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.pane-bar-hidden .pane__anchor {
  display: flex;
}

.pane-bar-hidden .pane.is-anchor-zone .pane__anchor {
  opacity: 1;
  transform: translate(-50%, 0);
}

.pane__anchor-grip {
  color: var(--text-faint);
  letter-spacing: -2px;
  flex-shrink: 0;
}

.pane__anchor-cwd {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Also extend the existing drag-cursor rule:

```css
.has-multiple-panes .pane__bar {
  cursor: grab;
}
```

stays as-is (the anchor already sets `cursor: grab` itself).

- [ ] **Step 4: Build and manually verify**

Run: `npm run build` — Expected: PASS.

Run: `npm run tauri dev`:

1. Default (`showPaneBar` off): pane bars are gone; hovering the top ~26px of a pane fades in the centered pill showing grip dots + cwd; moving the pointer down fades it out; the top strip of the terminal still accepts clicks.
2. Split (⌘D), then drag one pane by its anchor pill onto another pane's edge → drop-dock works, ghost shows the cwd.
3. Settings → Panes → On: bars return, anchor never appears, dragging by the bar still works.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane.ts src/terminal/pane-drag.ts src/styles.css
git commit -m "feat: hideable pane bar with hover anchor pill as drag handle"
```

---

### Task 6: Tab override model (name + dot color)

**Files:**

- Create: `src/lib/tab-colors.ts`
- Modify: `src/terminal/tabs-store.ts` (extend `TabView`, add `TabOverride` + `applyTabOverride`)
- Test: `src/terminal/tabs-store.test.ts` (new file)
- Modify: `src/terminal/tab-manager.ts` (overrides map, `renameTab`, `setTabDotColor`, merge in `syncViews`)
- Modify: `src/ui/tab-bar.tsx` (render merged name/color)

**Interfaces:**

- Consumes: `TabView`, `tabViews`, `syncViews` as they exist today; `dotColor(process)` from `src/lib/process-info.ts`.
- Produces (Tasks 7 and 9 rely on these exact names):

  ```ts
  // lib/tab-colors.ts
  export const TAB_DOT_COLORS = ["accent", "red", "green", "yellow", "magenta", "cyan"] as const;
  export type TabDotColor = (typeof TAB_DOT_COLORS)[number];
  export function isTabDotColor(value: unknown): value is TabDotColor;
  export function tabDotCssColor(color: TabDotColor): string; // "var(--accent)" etc.

  // terminal/tabs-store.ts
  export interface TabView {
    readonly key: number;
    readonly process: string | null;
    readonly name: string | null;      // custom name override, null = derived
    readonly dotColor: TabDotColor | null;
  }
  export interface TabOverride {
    readonly name?: string;
    readonly dotColor?: TabDotColor;
  }
  export function applyTabOverride(view: TabView, override: TabOverride | undefined): TabView;

  // terminal/tab-manager.ts — TabManager interface gains:
  renameTab(index: number, name: string | null): void;      // null clears
  setTabDotColor(index: number, color: TabDotColor | null): void; // null clears
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/terminal/tabs-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTabOverride, type TabView } from "./tabs-store";
import { isTabDotColor } from "../lib/tab-colors";

const base: TabView = { key: 1, process: "claude", name: null, dotColor: null };

describe("applyTabOverride", () => {
  it("returns the view unchanged without an override", () => {
    expect(applyTabOverride(base, undefined)).toBe(base);
  });

  it("merges a rename on top of the derived values", () => {
    const merged = applyTabOverride(base, { name: "backend" });
    expect(merged).toEqual({ ...base, name: "backend" });
    expect(base.name).toBeNull(); // no mutation
  });

  it("merges a dot color independently of the name", () => {
    expect(applyTabOverride(base, { dotColor: "red" })).toEqual({
      ...base,
      dotColor: "red",
    });
  });

  it("merges both when both are set", () => {
    expect(applyTabOverride(base, { name: "api", dotColor: "cyan" })).toEqual({
      key: 1,
      process: "claude",
      name: "api",
      dotColor: "cyan",
    });
  });
});

describe("isTabDotColor", () => {
  it("accepts every preset token and rejects everything else", () => {
    expect(isTabDotColor("accent")).toBe(true);
    expect(isTabDotColor("magenta")).toBe(true);
    expect(isTabDotColor("hotpink")).toBe(false);
    expect(isTabDotColor(7)).toBe(false);
    expect(isTabDotColor(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/terminal/tabs-store.test.ts`
Expected: FAIL — `../lib/tab-colors` not found / `applyTabOverride` not exported.

- [ ] **Step 3: Implement `lib/tab-colors.ts` and the store changes**

Create `src/lib/tab-colors.ts`:

```ts
/** Preset dot colors a user can pick for a tab — theme accent tokens. */
export const TAB_DOT_COLORS = [
  "accent",
  "red",
  "green",
  "yellow",
  "magenta",
  "cyan",
] as const;

export type TabDotColor = (typeof TAB_DOT_COLORS)[number];

export function isTabDotColor(value: unknown): value is TabDotColor {
  return (
    typeof value === "string" &&
    (TAB_DOT_COLORS as readonly string[]).includes(value)
  );
}

/** CSS value for a dot color token — follows the active theme. */
export function tabDotCssColor(color: TabDotColor): string {
  return `var(--${color})`;
}
```

In `src/terminal/tabs-store.ts`, add the import and extend/add:

```ts
import type { TabDotColor } from "../lib/tab-colors";
```

Replace the `TabView` interface with:

```ts
/** What the tab bar needs to render one tab. */
export interface TabView {
  /** Stable identity for list rendering (not a pane/PTY id). */
  readonly key: number;
  /** Foreground process of the tab's active pane — null until the first poll. */
  readonly process: string | null;
  /** Custom name override — null means "derive from process". */
  readonly name: string | null;
  /** Dot color override token — null means "derive from process". */
  readonly dotColor: TabDotColor | null;
}
```

Add below it:

```ts
/** User overrides for one tab; absent fields fall back to derived values. */
export interface TabOverride {
  readonly name?: string;
  readonly dotColor?: TabDotColor;
}

/**
 * Merge overrides on top of process-derived values. syncViews rebuilds
 * tabViews from the process poll every 2s — running derived values through
 * this is what makes a rename survive polling.
 */
export function applyTabOverride(
  view: TabView,
  override: TabOverride | undefined,
): TabView {
  if (override === undefined) {
    return view;
  }
  return {
    ...view,
    name: override.name ?? view.name,
    dotColor: override.dotColor ?? view.dotColor,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/terminal/tabs-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the overrides map into `tab-manager.ts`**

In `src/terminal/tab-manager.ts`:

Add imports:

```ts
import {
  activeTabIndex,
  applyTabOverride,
  statusInfo,
  tabViews,
  type TabOverride,
} from "./tabs-store";
```

(replacing the existing `./tabs-store` import line), and:

```ts
import type { TabDotColor } from "../lib/tab-colors";
```

Add to the `TabManager` interface (after `selectTab(index: number): void;`):

```ts
  /** Set or clear (null) a custom tab name; overrides the process label. */
  renameTab(index: number, name: string | null): void;
  /** Set or clear (null) a custom tab dot color token. */
  setTabDotColor(index: number, color: TabDotColor | null): void;
```

In `createTabManager`, next to `const infoByPane = …`, add:

```ts
// Per-tab user overrides (rename, dot color), keyed by tab key —
// merged over process-derived values on every syncViews.
const overrides = new Map<number, TabOverride>();
```

In `syncViews`, replace the `tabViews.value = tabs.map(…)` statement with:

```ts
tabViews.value = tabs.map((tab) => {
  const paneId = tab.manager.activePaneId();
  const info = paneId === null ? undefined : infoByPane.get(paneId);
  return applyTabOverride(
    {
      key: tab.key,
      process: info?.process ?? null,
      name: null,
      dotColor: null,
    },
    overrides.get(tab.key),
  );
});
```

Add the override setter (near `selectTab`):

```ts
function setOverride(index: number, patch: TabOverride): void {
  const entry = tabs[index];
  if (!entry) {
    return;
  }
  const next = { ...(overrides.get(entry.key) ?? {}), ...patch };
  if (next.name === undefined && next.dotColor === undefined) {
    overrides.delete(entry.key);
  } else {
    overrides.set(entry.key, next);
  }
  syncViews();
  persist();
}
```

Note: spreading `{ name: undefined }` intentionally overwrites a previous name — that is how a clear works.

In `closeTab`, after `tabs.splice(index, 1);` add:

```ts
overrides.delete(entry.key);
```

In the returned object, add:

```ts
    renameTab(index, name) {
      const trimmed = name?.trim() ?? "";
      setOverride(index, { name: trimmed === "" ? undefined : trimmed });
    },
    setTabDotColor(index, color) {
      setOverride(index, { dotColor: color ?? undefined });
    },
```

- [ ] **Step 6: Render the merged values in `tab-bar.tsx`**

Add the import:

```ts
import { tabDotCssColor } from "../lib/tab-colors";
```

In the tab render, change the dot and label:

```tsx
<span
  class="tab__dot"
  style={{
    background: tab.dotColor
      ? tabDotCssColor(tab.dotColor)
      : dotColor(tab.process),
  }}
/>
<span class="tab__label">{tab.name ?? tab.process ?? "shell"}</span>
```

- [ ] **Step 7: Full test run, build, commit**

Run: `npm test` — Expected: PASS.
Run: `npm run build` — Expected: PASS.

```bash
git add src/lib/tab-colors.ts src/terminal/tabs-store.ts src/terminal/tabs-store.test.ts src/terminal/tab-manager.ts src/ui/tab-bar.tsx
git commit -m "feat: tab name and dot color overrides merged over process-derived values"
```

---

### Task 7: Persist tab overrides in the session

**Files:**

- Modify: `src/lib/session-schema.ts` (`SessionTab` + `validateSession`)
- Test: `src/lib/session-schema.test.ts` (extend existing file)
- Modify: `src/terminal/tab-manager.ts` (`buildSessionData` + restore in `init`)

**Interfaces:**

- Consumes: `TabOverride`, `overrides` map, `addTab` from Task 6; `isTabDotColor` from `lib/tab-colors.ts`.
- Produces:

  ```ts
  export interface SessionTab {
    readonly layout: SerializedNode;
    readonly name?: string; // 1–64 chars after trim check
    readonly dotColor?: TabDotColor;
  }
  ```

  `SESSION_VERSION` stays `1` — both fields are optional, old files remain valid, and old builds ignore unknown keys.

- [ ] **Step 1: Write the failing tests**

In `src/lib/session-schema.test.ts`, add (reuse the file's existing helper for a valid session object if one exists; otherwise use this literal):

```ts
const validTab = { layout: { type: "leaf" } };

describe("session tab overrides", () => {
  it("keeps valid name and dotColor", () => {
    const session = validateSession({
      version: 1,
      activeTab: 0,
      tabs: [{ ...validTab, name: "backend", dotColor: "red" }],
    });
    expect(session?.tabs[0].name).toBe("backend");
    expect(session?.tabs[0].dotColor).toBe("red");
  });

  it("drops invalid overrides without rejecting the session", () => {
    const session = validateSession({
      version: 1,
      activeTab: 0,
      tabs: [
        { ...validTab, name: "   ", dotColor: "hotpink" },
        { ...validTab, name: 42, dotColor: 7 },
        { ...validTab, name: "x".repeat(65) },
      ],
    });
    expect(session).not.toBeNull();
    for (const tab of session?.tabs ?? []) {
      expect(tab.name).toBeUndefined();
      expect(tab.dotColor).toBeUndefined();
    }
  });

  it("leaves overrides undefined when absent (old session files)", () => {
    const session = validateSession({
      version: 1,
      activeTab: 0,
      tabs: [validTab],
    });
    expect(session?.tabs[0].name).toBeUndefined();
    expect(session?.tabs[0].dotColor).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/session-schema.test.ts`
Expected: FAIL — `name`/`dotColor` missing on `SessionTab` (tsc) or `undefined` vs expected value.

- [ ] **Step 3: Implement the schema extension**

In `src/lib/session-schema.ts`:

Add the import:

```ts
import { isTabDotColor, type TabDotColor } from "./tab-colors";
```

Extend `SessionTab`:

```ts
export interface SessionTab {
  readonly layout: SerializedNode;
  /** Custom tab name override — restored by tab order, not by key. */
  readonly name?: string;
  /** Custom tab dot color token — restored by tab order, not by key. */
  readonly dotColor?: TabDotColor;
}
```

Add a validator above `validateSession`:

```ts
const MAX_TAB_NAME_LENGTH = 64;

function validateTabName(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_TAB_NAME_LENGTH) {
    return undefined;
  }
  return trimmed;
}
```

In `validateSession`, replace `tabs.push({ layout });` with:

```ts
const tabSource = rawTab as Record<string, unknown>;
const name = validateTabName(tabSource.name);
const dotColor = isTabDotColor(tabSource.dotColor)
  ? tabSource.dotColor
  : undefined;
tabs.push({
  layout,
  ...(name !== undefined ? { name } : {}),
  ...(dotColor !== undefined ? { dotColor } : {}),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/session-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Save and restore overrides in `tab-manager.ts`**

Extend the session-schema import to include `SessionTab`:

```ts
import {
  SESSION_VERSION,
  type SessionData,
  type SessionTab,
} from "../lib/session-schema";
```

Replace `buildSessionData` (overrides ride along with each tab's layout; the filter-then-map version would misalign indexes when a layout is null):

```ts
function buildSessionData(): SessionData | null {
  const sessionTabs: SessionTab[] = [];
  for (const tab of tabs) {
    const layout = tab.manager.serializeLayout();
    if (layout === null) {
      continue;
    }
    const override = overrides.get(tab.key);
    sessionTabs.push({
      layout,
      ...(override?.name !== undefined ? { name: override.name } : {}),
      ...(override?.dotColor !== undefined
        ? { dotColor: override.dotColor }
        : {}),
    });
  }
  if (sessionTabs.length === 0) {
    return null;
  }
  return {
    version: SESSION_VERSION,
    activeTab: Math.min(Math.max(active, 0), sessionTabs.length - 1),
    tabs: sessionTabs,
  };
}
```

In `init`, replace the restore loop (tab keys regenerate per launch, so overrides are re-attached to whichever tab was just created for that session entry — order/index based):

```ts
if (session !== null) {
  for (const sessionTab of session.tabs) {
    if (!(await addTab(sessionTab.layout))) {
      continue; // spawn failed — skip its overrides too
    }
    const key = tabs[tabs.length - 1].key;
    const override: TabOverride = {
      ...(sessionTab.name !== undefined ? { name: sessionTab.name } : {}),
      ...(sessionTab.dotColor !== undefined
        ? { dotColor: sessionTab.dotColor }
        : {}),
    };
    if (override.name !== undefined || override.dotColor !== undefined) {
      overrides.set(key, override);
    }
  }
}
```

- [ ] **Step 6: Full test run, build, commit**

Run: `npm test` — Expected: PASS.
Run: `npm run build` — Expected: PASS.

```bash
git add src/lib/session-schema.ts src/lib/session-schema.test.ts src/terminal/tab-manager.ts
git commit -m "feat: persist tab name/color overrides in session, restore by tab order"
```

---

### Task 8: Shortcut guard for text inputs

**Files:**

- Modify: `src/terminal/tab-manager.ts` (`handleShortcut`)

**Interfaces:**

- Consumes: nothing new.
- Produces: the capture-phase shortcut handler ignores events targeting an `<input>`/`<textarea>` — required before Task 9's rename field, otherwise ⌘W/⌘D etc. fire while typing.

- [ ] **Step 1: Add the guard**

In `handleShortcut`, immediately after the IME guard (`if (event.isComposing || event.keyCode === 229) { return; }`), add:

```ts
// Never fire shortcuts while typing in a text field (same approach as
// the IME guard above) — e.g. the tab rename input in the popover.
if (
  event.target instanceof HTMLInputElement ||
  event.target instanceof HTMLTextAreaElement
) {
  return;
}
```

(xterm's hidden textarea does NOT hit this path: xterm attaches its own key handling inside the terminal and this window-level capture listener must still work there — verify in Step 2.)

- [ ] **Step 2: Verify terminal shortcuts still work**

Run: `npm run tauri dev` — with focus in a terminal pane, press ⌘T (new tab) and ⌘D (split).
Expected: both still work. If they do NOT (xterm's internal textarea now swallows them), narrow the guard to inputs outside the terminal:

```ts
if (
  (event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement) &&
  !(event.target as HTMLElement).closest(".pane__term")
) {
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/terminal/tab-manager.ts
git commit -m "feat: ignore global shortcuts while typing in text fields"
```

---

### Task 9: Tab options popover (rename + dot color)

**Files:**

- Create: `src/ui/tab-popover.tsx`
- Modify: `src/ui/tab-bar.tsx` (open on active-tab click, render popover)
- Modify: `src/ui/app.tsx` (wire `onRenameTab` / `onSetTabColor` to the manager)
- Modify: `src/styles.css` (popover styles)

**Interfaces:**

- Consumes: `TabView.name`/`TabView.dotColor` (Task 6), `TabManager.renameTab` / `TabManager.setTabDotColor` (Task 6), `TAB_DOT_COLORS`, `tabDotCssColor`, `TabDotColor` (Task 6), shortcut guard (Task 8).
- Produces: `TabBarProps` gains:

  ```ts
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  ```

- [ ] **Step 1: Create `src/ui/tab-popover.tsx`**

```tsx
import { useEffect, useRef } from "preact/hooks";
import {
  TAB_DOT_COLORS,
  tabDotCssColor,
  type TabDotColor,
} from "../lib/tab-colors";

interface TabPopoverProps {
  /** Viewport coordinates of the anchor tab (fixed positioning). */
  left: number;
  top: number;
  /** Current overrides — null means "derived from process". */
  name: string | null;
  dotColor: TabDotColor | null;
  onRename(name: string | null): void;
  onPickColor(color: TabDotColor | null): void;
  onClose(): void;
}

/** Options popover anchored under the active tab: rename + dot color. */
export function TabPopover(props: TabPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on any pointerdown outside the popover (capture phase so a click
  // that also hits another tab closes us before it selects that tab).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    inputRef.current?.focus();
    inputRef.current?.select();
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const commitRename = (): void => {
    const value = inputRef.current?.value.trim() ?? "";
    props.onRename(value === "" ? null : value);
    props.onClose();
  };

  return (
    <div
      ref={rootRef}
      class="tab-popover"
      role="dialog"
      aria-label="Tab options"
      style={{ left: `${props.left}px`, top: `${props.top}px` }}
    >
      <div class="tab-popover__label">Name</div>
      <input
        ref={inputRef}
        type="text"
        class="text-input"
        maxLength={64}
        placeholder="Process name"
        defaultValue={props.name ?? ""}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitRename();
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          }
        }}
      />
      <div class="tab-popover__label">Dot color</div>
      <div class="tab-popover__colors" role="group" aria-label="Dot color">
        <button
          type="button"
          class={`tab-popover__swatch tab-popover__swatch--auto ${
            props.dotColor === null ? "is-active" : ""
          }`}
          title="Auto (from process)"
          aria-label="Automatic dot color"
          onClick={() => props.onPickColor(null)}
        >
          A
        </button>
        {TAB_DOT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            class={`tab-popover__swatch ${
              props.dotColor === color ? "is-active" : ""
            }`}
            style={{ background: tabDotCssColor(color) }}
            title={color}
            aria-label={`Dot color ${color}`}
            onClick={() => props.onPickColor(color)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Open it from the active tab in `tab-bar.tsx`**

Add imports:

```ts
import { useSignal } from "@preact/signals";
import type { TabDotColor } from "../lib/tab-colors";
import { TabPopover } from "./tab-popover";
```

Extend `TabBarProps`:

```ts
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
```

Inside `TabBar`, before the `return`:

```ts
const popover = useSignal<{ index: number; left: number; top: number } | null>(
  null,
);
```

Replace the tab's `onClick={() => props.onSelectTab(index)}` with:

```tsx
onClick={(event) => {
  if (index !== active) {
    props.onSelectTab(index); // inactive tab: just select
    return;
  }
  if (popover.value?.index === index) {
    popover.value = null; // second click on the active tab toggles it off
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  popover.value = { index, left: rect.left, top: rect.bottom + 6 };
}}
```

Before the closing `</header>`, render it:

```tsx
{
  popover.value !== null && tabs[popover.value.index] !== undefined && (
    <TabPopover
      left={popover.value.left}
      top={popover.value.top}
      name={tabs[popover.value.index].name}
      dotColor={tabs[popover.value.index].dotColor}
      onRename={(name) => {
        if (popover.value !== null) {
          props.onRenameTab(popover.value.index, name);
        }
      }}
      onPickColor={(color) => {
        if (popover.value !== null) {
          props.onSetTabColor(popover.value.index, color);
        }
      }}
      onClose={() => {
        popover.value = null;
      }}
    />
  );
}
```

- [ ] **Step 3: Wire the props in `app.tsx`**

Add to the `<TabBar …>` props:

```tsx
onRenameTab={(index, name) => tabsRef.current?.renameTab(index, name)}
onSetTabColor={(index, color) => tabsRef.current?.setTabDotColor(index, color)}
```

- [ ] **Step 4: Add the popover CSS**

Append to `src/styles.css` (after the settings panel / form controls section):

```css
/* ── Tab options popover ─────────────────────────────────── */

.tab-popover {
  position: fixed;
  z-index: 100;
  width: 216px;
  padding: 10px 12px 12px;
  background: var(--chrome-2);
  border: 1px solid var(--hair-strong);
  border-radius: 10px;
}

.tab-popover__label {
  margin: 8px 0 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: var(--text-faint);
}

.tab-popover__label:first-child {
  margin-top: 0;
}

.tab-popover__colors {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-popover__swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--hair-strong);
  border-radius: 50%;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  color: var(--text-muted);
  background: transparent;
}

.tab-popover__swatch.is-active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
```

- [ ] **Step 5: Build and manually verify**

Run: `npm run build` — Expected: PASS.

Run: `npm run tauri dev`:

1. Click an inactive tab → it just selects (no popover). Click the active tab → popover opens under it, rename input focused with the current custom name selected.
2. Type "backend", Enter → tab label becomes "backend"; wait >2s (process poll) → the name survives. Reopen, clear the input, Enter → label falls back to the process name.
3. Pick a color swatch → dot recolors immediately; pick "A" → dot falls back to the process-derived color.
4. While the rename input is focused, press ⌘W and ⌘D → nothing happens to tabs/panes (Task 8 guard).
5. Click anywhere outside → popover closes. Escape closes without committing.
6. Rename a tab + set a color, quit, relaunch → both restored on the same tab position.

- [ ] **Step 6: Commit**

```bash
git add src/ui/tab-popover.tsx src/ui/tab-bar.tsx src/ui/app.tsx src/styles.css
git commit -m "feat: tab options popover with rename and dot color presets"
```

---

### Task 10: Final verification pass

**Files:**

- No new files — verification only.

- [ ] **Step 1: Full automated pass**

Run: `npm test`
Expected: PASS — including `derive-colors`, `tabs-store`, `session-schema`, `settings-schema`, and all pre-existing suites.

Run: `npm run build`
Expected: PASS with zero tsc errors.

- [ ] **Step 2: Manual checklist (spec §Testing) in `npm run tauri dev`**

1. Double-click zoom on row 1; window drag from both rows.
2. Pane drag-dock via the hover anchor (pane bar hidden) and via the bar (shown).
3. Popover: open/close/rename/recolor; overrides survive the 2s poll and an app relaunch.
4. Cycle all four theme presets from the settings panel watching chrome contrast; then set Background `#ffffff` and Foreground `#565f89` overrides — everything stays readable.
5. Settings → Panes toggle flips the pane bar live in every tab (also in a second tab created after toggling).

- [ ] **Step 3: Report**

Report any failed manual item back to the human partner before declaring the plan done. Do not fix-forward beyond trivial CSS tweaks without flagging it.

---

## Self-Review Notes (already applied)

- Spec §1 double-click zoom → Task 3 (with drag-region fallback documented).
- Spec §2 pane bar hidden by default, anchor drag → Tasks 4–5; `pane.ts` keeps building/populating the bar; visibility is CSS-only; `pane-drag.ts` accepts both handles; ghost still reads `.pane__cwd`.
- Spec §3 override model + persistence + shortcut guard → Tasks 6–9; overrides merge in `syncViews`, persist by tab order, guard mirrors the IME guard.
- Spec §4 color system → Tasks 1–2; all four floors unit-tested per preset + the two override cases named in the spec; migration table covers every `, white)` mix (`.tab.is-active`, `.theme-chip`, `.select`/`.text-input`, `.stepper`, `.segmented`, plus the old `--chrome-1/2` definitions) and every chrome `var(--fg)` text usage; fg-alpha hover tints kept deliberately (documented in Task 2 Step 3).
- Spec "Out of scope": status bar untouched (inherits tokens automatically); no pane-bar keyboard shortcut; no tab reordering.
- Type consistency: `TabDotColor` token strings flow store → manager → session schema → popover; `renameTab`/`setTabDotColor` names match across Tasks 6, 7, 9.
