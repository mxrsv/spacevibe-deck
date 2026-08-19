import type { ComponentChildren } from "preact";

/**
 * The gallery's own presentation primitives.
 *
 * Deliberately prefixed `gx-` and styled in `gallery.css`, never in
 * `styles.css`: the frame around a specimen must not be mistaken for the
 * specimen. It is also why the frame uses a different type scale and a visible
 * label — app chrome recedes, gallery chrome announces itself.
 */

/** Which app background a specimen is laid on — chrome reads differently on each. */
export type SpecimenSurface = "bg" | "chrome-1" | "chrome-2" | "none";

interface SpecimenProps {
  /** What this is, in the app's own vocabulary (a class name or component). */
  name: string;
  /** Why it is here: the state being shown, or the rule it should obey. */
  note?: string;
  surface?: SpecimenSurface;
  /**
   * Wraps the children in a `.window` grid. Bars are laid out by the window
   * grid in the app, so a specimen without it shows the wrong height.
   */
  framed?: boolean;
  /**
   * Gives the stage a screen's worth of height. Surfaces that position
   * themselves `absolute; inset: 0` (the settings screen, the modal scrim)
   * collapse to nothing without it.
   */
  tall?: boolean;
  children: ComponentChildren;
}

export function Specimen({
  name,
  note,
  surface = "chrome-1",
  framed = false,
  tall = false,
  children,
}: SpecimenProps) {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">{name}</span>
        {note !== undefined && <span class="gx-specimen__note">{note}</span>}
      </header>
      <div class={`gx-stage gx-stage--${surface} ${tall ? "gx-stage--tall" : ""}`}>
        {framed ? <div class="window">{children}</div> : children}
      </div>
    </section>
  );
}

/** A row of small specimens that are only meaningful next to each other. */
export function SpecimenRow({ children }: { children: ComponentChildren }) {
  return <div class="gx-row">{children}</div>;
}

/** Section heading + the one sentence that says what the section is for. */
export function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <header class="gx-sectionhead">
      <h1>{title}</h1>
      <p>{blurb}</p>
    </header>
  );
}

/**
 * States a specimen cannot reach on its own. Hover and focus are live — the
 * gallery runs in a real browser and the pointer is right there — so this is
 * only for the states the app drives from data.
 */
export function StateLabel({ children }: { children: ComponentChildren }) {
  return <span class="gx-statelabel">{children}</span>;
}
