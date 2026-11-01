import type { Signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import type { MockAgent } from "./layout-fixture";

/**
 * Slots of the hybrid shell (Inbox rail + dock) that a surface board can replace with an
 * option under review. Each receives the focused agent; `focus` moves the focus.
 */
export interface ShellSlots {
  /** The right column. Replaces the agent dock; the stage bar's dock toggle still hides it. */
  readonly dock?: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
  /** The stage body under the bar. Replaces the focused space's panes; null keeps them. */
  readonly stage?: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
  /** The whole left rail. Replaces the Inbox rail; `focus` moves the focused agent. */
  readonly rail?: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
  /** Extra buttons in the rail footer, after Settings. */
  readonly footer?: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
  /** The rail footer's Settings button: whether it reads pressed, and what pressing it does. */
  readonly settings?: { readonly open: () => boolean; readonly toggle: () => void };
  /** Drawn above the whole shell, for floating or overlay placements. */
  readonly overlay?: (agent: MockAgent, focus: (id: string) => void) => ComponentChildren;
}

/** What the mock shell hands each layout option. */
export interface OptionProps {
  /** The agent the option opens focused on (`?focus=`). */
  readonly initialFocus: string;
  /** The option's one deep-linkable overlay state (`?overlay=`), or null. */
  readonly overlay: string | null;
  /** Surface boards only; layout options ignore it. */
  readonly slots?: ShellSlots;
  /** Surface boards only: whether the dock starts open (default: open, or `?dock=0`). */
  readonly dockOpen?: boolean;
  /** The hybrid only: the stage view it opens on (`diff` or `browser`). */
  readonly stage?: string;
  /** The hybrid only: a dock state the caller owns, so opening a stage view can fold it. */
  readonly dock?: Signal<boolean>;
}
