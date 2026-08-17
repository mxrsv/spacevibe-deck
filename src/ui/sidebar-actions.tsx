import {
  ChatText,
  ClockCounterClockwise,
  Gauge,
  Gear,
  Globe,
} from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { DeckIcon, FEATURE_ICON } from "./controls/deck-icon";

/**
 * The rail's own footer of window actions (DL §28).
 *
 * Every row here is a **shortcut that opens**, and nothing else. It shows no
 * selection state and it never closes what it opened: pressing an already-open
 * surface's row is a no-op, and putting that surface away is the job of its own
 * close control — the dock's toggle, the browser chip's ✕, a screen's close
 * button, Escape. That is what separates these rows from the toolbar and from
 * the dock's tab row, both of which DO report state (DL-28.2's selection
 * language does not apply here).
 *
 * Rows, not icons: the column has prose width, so a row can say what it does
 * instead of teaching a glyph. Top-tab mode has no rail — `DeckToolbar`'s
 * `compact` mode carries the same rows in its `More` menu there.
 *
 * State-free in the strongest sense: the only flag it takes is whether Prompts
 * can run at all, which is availability, not selection.
 */
export interface SidebarActionsProps {
  /** False on a host with no `sessions_list`; the row is then not built. */
  readonly sessionsAvailable: boolean;
  /** Why Prompts cannot run right now, or null when it can. */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the Prompts row while the popover is open. */
  readonly promptPopover?: ComponentChildren;
  /** Only so the popover mounts in this row's slot — never painted as state. */
  readonly promptsOpen: boolean;
  onOpenBrowser(): void;
  onOpenUsage(): void;
  onOpenSessions(): void;
  onOpenPrompts(): void;
  onOpenSettings(): void;
}

interface ActionRowProps {
  readonly label: string;
  readonly icon: typeof Globe;
  onActivate(): void;
}

function ActionRow({ label, icon, onActivate }: ActionRowProps) {
  return (
    <button type="button" class="sidebar-actions__row" onClick={onActivate}>
      <DeckIcon icon={icon} size={FEATURE_ICON} class="feature-glyph" />
      <span>{label}</span>
    </button>
  );
}

/**
 * The footer is HIDDEN for now (owner, 2026-08-17): the rail ends at its last
 * workspace row and the `Tools` block is gone from the column. DL §28, this
 * component and its CSS all stand — restoring it is flipping this one
 * constant, the same revert seam `PANE_TREE_HIDDEN` and `GRAB_PASTE_DISABLED`
 * established.
 *
 * It is NOT just a hide: `DeckToolbar` reads this flag too, because these five
 * rows were mounted in exactly one place per layout — the footer in sidebar
 * mode, `More` in top-tab mode — and the Prompt Board popover is anchored to
 * the `Prompts` row. Dropping the footer alone would leave ⌘⇧P toggling a
 * popover with nowhere to render. With the flag on, `More` carries the global
 * group in BOTH layouts, which is where the popover then anchors.
 */
export const SIDEBAR_TOOLS_HIDDEN = true;

export function SidebarActions(props: SidebarActionsProps) {
  const unavailable = props.promptsUnavailable !== null;
  return (
    <nav class="sidebar-actions" aria-label="Tools">
      {/* DL-4.4: a group label NAMES something, so it is sentence case. */}
      <span class="sidebar-actions__label">Tools</span>
      <ActionRow
        label="Open browser"
        icon={Globe}
        onActivate={props.onOpenBrowser}
      />
      <ActionRow
        label="Token usage"
        icon={Gauge}
        onActivate={props.onOpenUsage}
      />
      {/* Omitted entirely on a host that cannot answer `sessions_list`, the
          same precedent the dock's own tab row follows: a row that opens an
          empty surface is worse than no row. */}
      {props.sessionsAvailable ? (
        <ActionRow
          label="Session history"
          icon={ClockCounterClockwise}
          onActivate={props.onOpenSessions}
        />
      ) : null}
      <div class="sidebar-actions__slot">
        {/* DL-23.6: unavailable is not disabled — the row keeps its place in
            the tab order, reads faint, drops the hover wash, blocks activation
            and carries the reason as its description. A `disabled` attribute
            would put that reason out of reach of the keyboard. */}
        {/* `aria-haspopup` without `aria-expanded`: this row opens the popover
            but never reports or reverses its state, so claiming to be expanded
            would promise a control the row does not offer. */}
        <button
          type="button"
          class={`sidebar-actions__row ${unavailable ? "is-unavailable" : ""}`}
          aria-haspopup="dialog"
          aria-disabled={unavailable}
          title={props.promptsUnavailable ?? "Prompts"}
          onClick={() => {
            if (unavailable) {
              return;
            }
            props.onOpenPrompts();
          }}
        >
          <DeckIcon icon={ChatText} size={FEATURE_ICON} class="feature-glyph" />
          <span>Prompts</span>
        </button>
        {props.promptsOpen ? props.promptPopover : null}
      </div>
      <ActionRow
        label="Settings"
        icon={Gear}
        onActivate={props.onOpenSettings}
      />
    </nav>
  );
}
