import type { ComponentChildren } from "preact";
import type { MockAgent } from "../layout-fixture";
import type { ShellSlots } from "../option-props";

/** What an option touches, in the scout's vocabulary. */
export type SurfaceArea = "chrome-only" | "terminal-area" | "needs-new-signal";

interface OptionBase {
  /** Short and stable: `a`, `b`, `c`. Used in `?option=`. */
  readonly id: string;
  readonly label: string;
  /** One sentence: the idea, not a feature list. */
  readonly concept: string;
  readonly area: readonly SurfaceArea[];
  /** The agent the board focuses for this option; defaults to the fixture's DEFAULT_FOCUS. */
  readonly focus?: string;
}

/** Rendered alone in a fixed-width column, side by side with its sibling panel options. */
export interface PanelOption extends OptionBase {
  readonly frame: "panel";
  /** Column width in px; the dock's content slot is 340. */
  readonly width: number;
  readonly render: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
}

/** Rendered inside the hybrid shell (Inbox rail + stage + dock) through its slots. */
export interface ShellOption extends OptionBase {
  readonly frame: "shell";
  readonly slots: ShellSlots;
  /** Whether the shell's dock starts open; the stage bar's toggle still opens it. */
  readonly dock?: "open" | "closed";
}

/** Rendered full board over the whole overview: the option brings its own panel on top of it. */
export interface OverviewOption extends OptionBase {
  readonly frame: "overview";
  readonly render: () => ComponentChildren;
}

export type SurfaceOption = PanelOption | ShellOption | OverviewOption;

export interface SurfaceSpec {
  readonly id: string;
  readonly label: string;
  /** How Deck does it today, in one line, so the owner sees the delta. */
  readonly today: string;
  /** The option the owner picked by eye, once there is one. */
  readonly picked?: string;
  readonly options: readonly SurfaceOption[];
}
