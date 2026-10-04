import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { resolveTheme } from "../../settings/themes";
import "./before-after-2026-09-23.css";

/**
 * The before / after comparison frame, first drawn for the 2026-09-23 review
 * and now shared by the space-workflow pages. `before` is what ships today, drawn with the shipped component over
 * a fixture wherever one exists; `after` is the candidate. A candidate for a
 * surface Deck does not have yet is gallery-only markup built from the app's
 * own tokens and classes, and its note says so — the gallery must never pass
 * a drawing off as a component.
 */

/** One half of a pair: a label, why it looks the way it does, then the thing. */
export function Column({
  side,
  title,
  note,
  wide = false,
  children,
}: {
  readonly side: "before" | "after";
  readonly title: string;
  readonly note: string;
  /** Lets a stage-sized specimen (a pane, a panel) take the full row. */
  readonly wide?: boolean;
  readonly children: ComponentChildren;
}) {
  return (
    <div class={`gx-ba23__col${wide ? " gx-ba23__col--wide" : ""}`} data-side={side}>
      <p class="gx-ba23__title">
        <span class="gx-ba23__side">{side}</span>
        {title}
      </p>
      <p class="gx-ba23__note">{note}</p>
      <div class="gx-ba23__stage">{children}</div>
    </div>
  );
}

/** Before beside after; wraps to a stack when the gallery is narrow. */
export function Pair({ children }: { readonly children: ComponentChildren }) {
  return <div class="gx-ba23">{children}</div>;
}

/**
 * Pins one theme to a subtree, the `matrix-section.tsx` mechanism, so a pair
 * can show light beside dark whatever the gallery's own picker says.
 */
export function ThemeScope({
  themeId,
  children,
}: {
  readonly themeId: string;
  readonly children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) {
      applyThemeVars(node.style, resolveTheme({ ...settings.peek(), themeId, colorOverrides: {} }));
    }
  }, [themeId]);
  return (
    <div ref={ref} class="gx-ba23__theme">
      {children}
    </div>
  );
}
