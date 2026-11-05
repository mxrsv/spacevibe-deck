import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { cn } from "@/lib/cn";
import { getTheme } from "../../settings/themes";
import { FORCE_CLASS, installForcedStates } from "../force-states";
import { applyScopedTheme } from "../scoped-theme";
import { installControlStateForcing } from "./control-states-force";
import "./recipe-states-section.css";

/**
 * The kit the recipe state sheets share (spec 2026-11-05-ui-recipes-ratchet, RCP-32, AC-2):
 * the nine states as columns, each cell a real component forced into its state, drawn twice,
 * in graphite and in Deck Light. Hover, focus and pressed are forced from the stylesheets
 * (`force-states.ts`); selected, disabled and needs-you are the component's own props; drag-over
 * lays the RCP-9 wash under the cell, the way a drop target paints it.
 */

export const RECIPE_STATES = [
  "rest",
  "hover",
  "focus",
  "selected",
  "selected + focus",
  "pressed",
  "disabled",
  "drag-over",
  "needs you",
] as const;
export type RecipeState = (typeof RECIPE_STATES)[number];

/** The two themes every sheet draws, dark first (RCP-2's "dark means graphite"). */
export const SHEET_THEMES = ["graphite", "deck-light"] as const;

const FORCED: Partial<Record<RecipeState, string>> = {
  hover: FORCE_CLASS.hover,
  focus: FORCE_CLASS.focus,
  "selected + focus": FORCE_CLASS.focus,
  pressed: FORCE_CLASS.active,
};

const SHEET = "sections/recipe-states-section.css";

/** Installs the forced copies of the app sheet and of this section's preset utilities. */
export function useForcedStates(): void {
  useLayoutEffect(() => {
    const app = installForcedStates();
    const preset = installControlStateForcing(SHEET);
    return () => {
      app.dispose();
      preset();
    };
  }, []);
}

/** True for the states that show the selected wash. */
export const isSelected = (state: RecipeState): boolean =>
  state === "selected" || state === "selected + focus";

/** One row of a sheet: a label and what each state draws, or null where it does not apply. */
export interface SheetRow {
  readonly label: string;
  readonly draw: (state: RecipeState) => JSX.Element | null;
}

/** A theme's own subtree: `applyScopedTheme` publishes the whole theme on one element. */
function ThemeScope({
  themeId,
  ground,
  children,
}: {
  readonly themeId: string;
  readonly ground: string;
  readonly children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) applyScopedTheme(ref.current, getTheme(themeId));
  }, [themeId]);
  return (
    <div ref={ref} class="gx-recipe-scope" style={{ "--ground": `var(${ground})` }}>
      <span class="gx-recipe-scope__name">{themeId}</span>
      {children}
    </div>
  );
}

/** Anything drawn twice, once per sheet theme, on the surface's own ground. */
export function ThemePair({
  ground = "--bg",
  children,
}: {
  readonly ground?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div class="gx-recipe-pair">
      {SHEET_THEMES.map((themeId) => (
        <ThemeScope key={themeId} themeId={themeId} ground={ground}>
          {children}
        </ThemeScope>
      ))}
    </div>
  );
}

/** The state grid of one surface. `ground` is the surface's own token, the rail's sidebar. */
export function StateSheet({
  rows,
  ground = "--bg",
  columnWidth = "minmax(9rem, 1fr)",
}: {
  readonly rows: readonly SheetRow[];
  readonly ground?: string;
  readonly columnWidth?: string;
}) {
  return (
    <ThemePair ground={ground}>
      <div
        class="gx-recipe-grid ui-preset"
        style={{ gridTemplateColumns: `6rem repeat(${RECIPE_STATES.length}, ${columnWidth})` }}
      >
        <span />
        {RECIPE_STATES.map((state) => (
          <span key={state} class="gx-recipe-grid__head">
            {state}
          </span>
        ))}
        {rows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </div>
    </ThemePair>
  );
}

function Row({ row }: { readonly row: SheetRow }) {
  return (
    <>
      <span class="gx-recipe-grid__label">{row.label}</span>
      {RECIPE_STATES.map((state) => {
        const node = row.draw(state);
        return (
          <div
            key={state}
            class={cn(
              "gx-recipe-grid__cell",
              FORCED[state],
              state === "drag-over" &&
                node !== null &&
                "rounded-(--radius-control) bg-(--state-dragover-bg)",
            )}
          >
            {node ?? <div class="gx-recipe-grid__na">n/a</div>}
          </div>
        );
      })}
    </>
  );
}
