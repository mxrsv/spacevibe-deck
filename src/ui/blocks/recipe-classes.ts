/**
 * RCP-9's one state cascade as class strings, for the surfaces drawn with Tailwind (spec
 * 2026-11-05-ui-recipes-ratchet). Weakest first: hover equals keyboard focus, then selected,
 * then selected with focus, then pressed, which lays black at 8% over whatever wash is under it.
 * Every value is a token, so each theme draws its own steps (RCP-2). A file under `src/ui/blocks/`
 * is in `preset.css`'s `@source` list, so these literals generate their utilities.
 */

/** DL-20.2: every state change runs in one motion pair, background only. */
export const STATE_MOTION = "transition-colors duration-(--duration) ease-(--ease) outline-none";

/** RCP-9's pressed layer: a background image, so a selected item keeps its wash beneath it. */
export const STATE_PRESSED =
  "active:bg-[linear-gradient(var(--state-pressed-bg),var(--state-pressed-bg))]";

/** An unselected pressable: no wash at rest, hover and keyboard focus are one wash. */
export const STATE_IDLE = `hover:bg-(--state-hover-bg) focus-visible:bg-(--state-hover-bg) ${STATE_PRESSED}`;

/** A selected pressable: the full wash, one step stronger under keyboard focus (DL-21.1). */
export const STATE_SELECTED = `bg-(--tab-active-bg) focus-visible:bg-(--tab-active-focus-bg) ${STATE_PRESSED}`;

/** Needs you: a tint under the other states, so hover and pressed still read on top of it. */
export const STATE_NEEDS_YOU =
  "bg-[linear-gradient(var(--state-needs-you-bg),var(--state-needs-you-bg))]";

/** Disabled: half opacity and no hover (DL-21.4). */
export const STATE_DISABLED =
  "disabled:pointer-events-none disabled:opacity-(--state-disabled-opacity)";

/** The cascade for one pressable, idle or selected. */
export function stateClasses(selected: boolean): string {
  return `${STATE_MOTION} ${selected ? STATE_SELECTED : STATE_IDLE}`;
}

/**
 * RCP-19: hover actions overlay a row's end on an opaque ground, the column's surface with the
 * row's own state on top, so a long title never shows through. `selected` matches the row.
 */
export function rowActionsGround(selected: boolean): string {
  return selected
    ? "absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-(--radius-control) px-1 bg-(--tab-active-bg)"
    : "absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-(--radius-control) px-1 bg-(--sidebar-bg) bg-[linear-gradient(var(--state-hover-bg),var(--state-hover-bg))]";
}
