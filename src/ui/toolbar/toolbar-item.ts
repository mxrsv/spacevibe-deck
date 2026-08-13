import type { LucideIcon } from "lucide-preact";
import type { ComponentChildren } from "preact";

/**
 * What a toolbar entry is, as far as the toolbar is concerned.
 *
 * Presentation only — icon, group, overflow order, and the strings a tooltip
 * shows. Command behaviour stays where it already lives: `onActivate` is the
 * same call the keyboard and the native menu make, and `state` is projected
 * from whatever already owns that state, never stored here. The toolbar has no
 * opinion about what an action does; it only knows how to draw it and in which
 * order to give it up when the window narrows.
 *
 * See docs/specs/2026-08-12-feature-toolbar-design.md.
 */

/** The three clusters, in the order they render, separated by hairlines. */
export type ToolbarGroup = "tools" | "pane" | "global";

export const TOOLBAR_GROUP_ORDER: readonly ToolbarGroup[] = Object.freeze([
  "tools",
  "pane",
  "global",
]);

/**
 * `unavailable` is not `disabled`: the control keeps its place in the tab
 * order so the reason can be read by someone who never uses a pointer. Only
 * activation is blocked.
 */
export type ToolbarItemState =
  | { readonly kind: "idle" }
  | { readonly kind: "active" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ToolbarItem {
  /** Stable identity for keys and tests — the action id once one exists. */
  readonly id: string;
  /** English label: the accessible name and the tooltip's first line. */
  readonly label: string;
  readonly icon: LucideIcon;
  readonly group: ToolbarGroup;
  /**
   * The chord as the active platform writes it, already formatted through
   * `shortcut-label.ts`, or `null` when this platform has no binding. A
   * platform with no binding renders no shortcut at all — never an empty
   * bracket or a placeholder chord.
   */
  readonly shortcut: string | null;
  readonly state: ToolbarItemState;
  /**
   * Lower moves into `More` first; `null` never leaves the bar. The order is
   * the design's: Usage, then Focus expand, then Close pane, then the splits.
   */
  readonly overflowOrder: number | null;
  /**
   * How the control announces itself when `state` is `active`: a toggle is
   * `aria-pressed`, a trigger that opens a surface is `aria-expanded` plus the
   * matching `aria-haspopup`. A one-shot action (a split, a close) sets
   * neither — `aria-pressed="false"` on a button that never stays pressed
   * describes a state it does not have.
   */
  readonly toggles?: "pressed" | "dialog" | "menu";
  /**
   * Extra class on the control itself, for the one or two controls whose
   * presentation carries history — the Settings gear keeps `iconbtn--gear`
   * so its §7-budgeted spin survives the move off `ChromeActions`.
   */
  readonly controlClass?: string;
  /**
   * A surface anchored to this control, rendered inside its slot while
   * present — the Prompt Board popover hangs off its trigger this way
   * (DL-13.1). The slot is the positioning context; the surface positions
   * itself.
   */
  readonly anchored?: ComponentChildren;
  readonly onActivate: () => void;
}

export function isUnavailable(item: ToolbarItem): boolean {
  return item.state.kind === "unavailable";
}

/** The tooltip's second line — a reason, or nothing at all. */
export function unavailableReason(item: ToolbarItem): string | null {
  return item.state.kind === "unavailable" ? item.state.reason : null;
}
