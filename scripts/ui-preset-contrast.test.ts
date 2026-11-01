/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Migration plan gate G3, with the owner's floor (2026-10-22): a migrated surface meets
 * WCAG 2.2 AA, 4.5:1 for text and 3:1 for the boundary of a control, in both modes, for every
 * pair the preset defines. DL-3.5's 6:1 for muted text stays the chrome's rule until the
 * pattern is rewritten with the migration; this file does not touch it.
 *
 * The preset's own tokens are not retuned (UI-2), so a few stock pairs fall short. They are
 * named below, each must still fall short (an exception that starts passing has to be
 * deleted), and every other pair must clear the floor. The owner approves this list.
 */

const css = readFileSync(fileURLToPath(new URL("../src/ui/preset.css", import.meta.url)), "utf8");

type Rgb = readonly [number, number, number];
interface Color {
  readonly rgb: Rgb;
  readonly alpha: number;
}
type Mode = "light" | "dark";

/** `--name: oklch(L C H / A)` declarations of one block of the stylesheet. */
function tokens(block: ":root" | ".dark"): Map<string, Color> {
  const start = css.indexOf(`\n${block} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const found = new Map<string, Color>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*oklch\(([^)]*)\)/g)) {
    const [parts, alpha] = match[2].split("/").map((part) => part.trim());
    const [l, c, h] = parts.split(/\s+/).map(Number);
    found.set(match[1], {
      rgb: oklchToSrgb(l, c, h),
      alpha: alpha === undefined ? 1 : Number.parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1),
    });
  }
  return found;
}

const encode = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
const decode = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** Björn Ottosson's OKLab, to gamma-encoded sRGB, clipped to the gamut as a browser does. */
function oklchToSrgb(lightness: number, chroma: number, hue: number): Rgb {
  const angle = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => encode(clamp(channel))) as unknown as Rgb;
}

/** `top` laid over an opaque `base`, mixed in gamma-encoded sRGB as CSS does. */
function over(top: Color, base: Rgb, alpha = top.alpha): Rgb {
  return top.rgb.map((channel, i) => channel * alpha + base[i] * (1 - alpha)) as unknown as Rgb;
}

const luminance = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const BOUNDARY = 3;

interface Pair {
  readonly id: string;
  readonly kind: "text" | "boundary";
  /** The ink and the ground it sits on, resolved against the mode's tokens. */
  readonly pair: (t: Map<string, Color>) => readonly [Rgb, Rgb];
}

const solid = (t: Map<string, Color>, name: string): Rgb => {
  const color = t.get(name);
  if (color === undefined) throw new Error(`the stylesheet declares no ${name}`);
  return color.rgb;
};
/** A token with alpha, laid over the page background. */
const onPage = (t: Map<string, Color>, name: string): Rgb =>
  over(t.get(name) as Color, solid(t, "--background"));
const ink = (foreground: string, ground: string): Pair["pair"] => {
  return (t) => [solid(t, foreground), solid(t, ground)];
};

const PAIRS: readonly Pair[] = [
  { id: "foreground on background", kind: "text", pair: ink("--foreground", "--background") },
  { id: "card-foreground on card", kind: "text", pair: ink("--card-foreground", "--card") },
  {
    id: "popover-foreground on popover",
    kind: "text",
    pair: ink("--popover-foreground", "--popover"),
  },
  { id: "foreground on popover", kind: "text", pair: ink("--foreground", "--popover") },
  {
    id: "primary-foreground on primary",
    kind: "text",
    pair: ink("--primary-foreground", "--primary"),
  },
  {
    id: "secondary-foreground on secondary",
    kind: "text",
    pair: ink("--secondary-foreground", "--secondary"),
  },
  {
    id: "accent-foreground on accent",
    kind: "text",
    pair: ink("--accent-foreground", "--ui-accent"),
  },
  {
    id: "sidebar-foreground on sidebar",
    kind: "text",
    pair: ink("--sidebar-foreground", "--sidebar"),
  },
  {
    id: "muted-foreground on background",
    kind: "text",
    pair: ink("--muted-foreground", "--background"),
  },
  { id: "muted-foreground on card", kind: "text", pair: ink("--muted-foreground", "--card") },
  { id: "muted-foreground on popover", kind: "text", pair: ink("--muted-foreground", "--popover") },
  { id: "muted-foreground on muted", kind: "text", pair: ink("--muted-foreground", "--muted") },
  {
    id: "muted-foreground on secondary",
    kind: "text",
    pair: ink("--muted-foreground", "--secondary"),
  },
  { id: "destructive on background", kind: "text", pair: ink("--destructive", "--background") },
  {
    id: "primary as link text on background",
    kind: "text",
    pair: ink("--primary", "--background"),
  },
  {
    id: "destructive on its 10% tint",
    kind: "text",
    pair: (t) => [
      solid(t, "--destructive"),
      over(t.get("--destructive") as Color, solid(t, "--background"), 0.1),
    ],
  },
  {
    id: "destructive on its 20% hover tint",
    kind: "text",
    pair: (t) => [
      solid(t, "--destructive"),
      over(t.get("--destructive") as Color, solid(t, "--background"), 0.2),
    ],
  },
  {
    id: "tooltip text (background on foreground)",
    kind: "text",
    pair: ink("--background", "--foreground"),
  },
  {
    id: "foreground on the input fill",
    kind: "text",
    pair: (t) => [solid(t, "--foreground"), onPage(t, "--input")],
  },
  {
    id: "focus ring on background",
    kind: "boundary",
    pair: (t) => [solid(t, "--ring"), solid(t, "--background")],
  },
  {
    id: "input border on background",
    kind: "boundary",
    pair: (t) => [onPage(t, "--input"), solid(t, "--background")],
  },
  {
    id: "switch track off on background",
    kind: "boundary",
    pair: (t) => [onPage(t, "--input"), solid(t, "--background")],
  },
  {
    id: "switch track on (primary) on background",
    kind: "boundary",
    pair: ink("--primary", "--background"),
  },
];

/**
 * The stock pairs below the floor, per mode, with where they appear. Retuning them would
 * change the preset (UI-2); forbidding the variants would leave no destructive Button.
 */
const EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["dark|primary as link text on background", "Button and Badge `link` variant"],
  ["dark|switch track on (primary) on background", "the thumb, not the track, carries the state"],
  ["light|destructive on its 10% tint", "Button and Badge `destructive` variants"],
  ["light|destructive on its 20% hover tint", "Button and Badge `destructive` hover (3.31:1)"],
  ["light|muted-foreground on muted", "Kbd, and muted text on a muted fill"],
  ["light|muted-foreground on secondary", "text on a secondary fill"],
  ["light|input border on background", "Input, Select and outline Button borders"],
  ["dark|input border on background", "Input, Select and outline Button borders"],
  ["light|switch track off on background", "the thumb position carries the state"],
  ["dark|switch track off on background", "the thumb position carries the state"],
  [
    "light|focus ring on background",
    "the ring token itself (2.59:1); Deck draws it inset and solid, owner-approved 2026-10-22, still below 3:1 in light",
  ],
]);

describe("G3: the preset's pairs against the WCAG 2.2 AA floor", () => {
  const modes: Record<Mode, Map<string, Color>> = {
    light: tokens(":root"),
    dark: tokens(".dark"),
  };

  for (const mode of ["light", "dark"] as const) {
    describe(mode, () => {
      for (const { id, kind, pair } of PAIRS) {
        const named = EXCEPTIONS.has(`${mode}|${id}`);
        const floor = kind === "text" ? TEXT : BOUNDARY;
        it(`${id}${named ? " (named exception)" : ""}`, () => {
          const [ink, ground] = pair(modes[mode]);
          const ratio = contrast(ink, ground);
          if (named) {
            expect(ratio, `${id} now clears ${floor}:1; delete it from EXCEPTIONS`).toBeLessThan(
              floor,
            );
          } else {
            expect(ratio, `${mode}: ${id}`).toBeGreaterThanOrEqual(floor);
          }
        });
      }
    });
  }

  it("names no exception for a pair that does not exist", () => {
    const ids = new Set(PAIRS.flatMap((p) => ["light", "dark"].map((mode) => `${mode}|${p.id}`)));
    expect([...EXCEPTIONS.keys()].filter((key) => !ids.has(key))).toEqual([]);
  });

  it("reads the plan's measured stock figures", () => {
    // Anchors the converter to the figures in the migration plan (WCAG 2.x from computed colours).
    const dark = modes.dark;
    const link = contrast(solid(dark, "--primary"), solid(dark, "--background"));
    expect(link).toBeGreaterThan(2.1);
    expect(link).toBeLessThan(2.4);
    const muted = contrast(solid(modes.light, "--muted-foreground"), solid(modes.light, "--muted"));
    expect(muted).toBeGreaterThan(4.3);
    expect(muted).toBeLessThan(4.5);
  });
});
