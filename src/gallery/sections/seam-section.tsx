import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { settings } from "../../settings/settings-store";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/**
 * The seam study: three treatments of the boundary between surfaces, on the
 * app's own chrome classes, side by side.
 *
 * The question is not whether a component is right — it is whether the TOKEN
 * relationship is. Until 2026-08-12 a seam was `alpha(--fg, 0.12)`, which
 * landed 15 to 24 luminance units ABOVE the surface it edged, while the step
 * from `--bg` to `--chrome-1` was only 8 to 9: the line out-shouted the step
 * it marked and read as ink drawn across the chrome rather than as the edge of
 * a plane.
 *
 * Column C is now what `derive-colors.ts` emits, so it carries no overrides at
 * all. A and B pin their own values instead — the study is kept, rather than
 * deleted with the decision, because the next person to widen a hairline
 * should have to look at this first. The numbers under each shell are measured
 * from what the browser actually painted, not read off the tokens.
 */

interface SeamVariant {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly variantClass: string;
}

const VARIANTS: readonly SeamVariant[] = [
  {
    id: "before",
    label: "A · before",
    note: "one --hair for every seam, mixed from --fg",
    variantClass: "gx-seam--before",
  },
  {
    id: "bevel",
    label: "B · two-tone bevel",
    note: "dark line + 1px counter-edge; 2px of seam",
    variantClass: "gx-seam--bevel",
  },
  {
    id: "shipped",
    label: "C · shipped",
    note: "wider step, seam below the surface, three roles",
    variantClass: "",
  },
];

type Rgba = readonly [number, number, number, number];

/**
 * A probe's resolved `background-color`, in 0–255.
 *
 * Two forms, because the browser answers differently depending on how the
 * value was written: a plain colour comes back as `rgb()`/`rgba()`, while
 * anything that went through `color-mix()` comes back as
 * `color(srgb 0.07 0.07 0.10)` with 0–1 components. Reading only the first
 * form is what left the two proposal columns unmeasured.
 */
function parseColor(value: string): Rgba | null {
  const srgb = /color\(srgb([^)]+)\)/.exec(value);
  if (srgb !== null) {
    const parts = srgb[1]
      .split(/[\s/]+/)
      .filter((part) => part !== "")
      .map((part) => Number.parseFloat(part));
    if (parts.length < 3 || parts.some(Number.isNaN)) {
      return null;
    }
    return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts[3] ?? 1];
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(value);
  if (rgb === null) {
    return null;
  }
  const parts = rgb[1].split(/[,/]/).map((part) => Number.parseFloat(part));
  if (parts.length < 3 || parts.some(Number.isNaN)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function over(top: Rgba, bottom: Rgba): Rgba {
  return [
    top[3] * top[0] + (1 - top[3]) * bottom[0],
    top[3] * top[1] + (1 - top[3]) * bottom[1],
    top[3] * top[2] + (1 - top[3]) * bottom[2],
    1,
  ];
}

function luminance(color: Rgba): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

const signed = (value: number): string => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;

function SeamShell({ variant }: { variant: SeamVariant }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const readout = useSignal<string | null>(null);

  useSignalEffect(() => {
    // Read the theme so a theme switch re-measures. The frame of delay is
    // what lets the gallery shell publish the new theme variables first —
    // one rAF, not a loop; DL-1.2 governs app chrome, and this is a harness
    // measurement, not motion.
    void settings.value.themeId;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const read = (name: string): Rgba | null => {
        const probe = root.querySelector(`[data-probe="${name}"]`);
        return probe === null ? null : parseColor(getComputedStyle(probe).backgroundColor);
      };
      const bg = read("bg");
      const chrome = read("chrome");
      const seam = read("seam");
      if (bg === null || chrome === null || seam === null) {
        return;
      }
      const step = luminance(chrome) - luminance(bg);
      const lift = luminance(over(seam, chrome)) - luminance(chrome);
      readout.value = `${signed(step)} / ${signed(lift)}`;
    });
    return () => cancelAnimationFrame(frame);
  });

  return (
    <div class="gx-seamcol">
      <StateLabel>{variant.label}</StateLabel>
      <div ref={rootRef} class={`gx-seamshell ${variant.variantClass}`}>
        <span class="gx-seamprobe" data-probe="bg" style={{ background: "var(--bg)" }} />
        <span class="gx-seamprobe" data-probe="chrome" style={{ background: "var(--chrome-1)" }} />
        <span
          class="gx-seamprobe"
          data-probe="seam"
          style={{ background: "var(--seam-recessed)" }}
        />

        <div class="window">
          <div class="titlebar" />
          <div class="tabbar">
            <span class="tab is-active">
              <span class="tab__dot" style={{ background: "var(--cyan)" }} />
              <span class="tab__label">deck</span>
            </span>
            <span class="tabbar__spacer" />
            <span class="tabbar__sep" aria-hidden="true" />
          </div>

          <div class="gx-seamshell__body">
            <aside class="wsbar">
              <span class="gx-seamshell__ws" />
              <span class="gx-seamshell__ws" />
              <span class="gx-seamshell__ws" />
            </aside>

            <div class="stage">
              <div class="split split--row">
                <div class="split__child">
                  <div class="pane-slot">
                    <div class="pane">
                      <div class="pane__bar">~/deck</div>
                      <div class="gx-seamshell__panebody">
                        <span class="gx-seamshell__line" />
                        <span class="gx-seamshell__line gx-seamshell__line--half" />
                        <span class="gx-seamshell__line gx-seamshell__line--third" />
                      </div>
                    </div>
                  </div>
                </div>
                <div class="split__divider" />
                <div class="split__child">
                  <div class="split split--column">
                    <div class="split__child">
                      <div class="pane-slot">
                        <div class="pane">
                          <div class="pane__bar">~/api</div>
                          <div class="gx-seamshell__panebody">
                            <span class="gx-seamshell__line gx-seamshell__line--half" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="split__divider" />
                    <div class="split__child">
                      <div class="pane-slot">
                        <div class="pane">
                          <div class="pane__bar">~/hub</div>
                          <div class="gx-seamshell__panebody">
                            <span class="gx-seamshell__line gx-seamshell__line--third" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside class="gx-seamshell__dock" />
          </div>

          <div class="status">
            <span>3 panes</span>
          </div>
        </div>

        <div class="gx-seamshell__popover">
          <span class="gx-seamshell__popline" />
          <span class="gx-seamshell__popline gx-seamshell__popline--short" />
        </div>
      </div>
      <div class="gx-seamread">
        <span>{variant.note}</span>
      </div>
      <div class="gx-seamread">
        <span>
          step / seam <strong>{readout.value ?? "…"}</strong>
        </span>
      </div>
    </div>
  );
}

export function SeamSection() {
  return (
    <>
      <SectionHead
        title="Seam system"
        blurb="How a 1px line sits against the surfaces it separates — the same shell three times, differing only in tokens. Switch theme in the top bar: the numbers re-measure."
      />

      <Specimen
        name="shell boundaries · pane dividers · dock edge · raised frame"
        note="step = --bg → --chrome-1 in luminance · seam = the painted line against the surface it edges. A seam louder than its step reads as a drawn line; a seam below it reads as an edge."
        surface="bg"
      >
        <div class="gx-seamrow">
          {VARIANTS.map((variant) => (
            <SeamShell key={variant.id} variant={variant} />
          ))}
        </div>
      </Specimen>
    </>
  );
}
