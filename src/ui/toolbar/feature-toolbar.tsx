import { DotsThreeOutline } from "@phosphor-icons/react";
import { Fragment, type ComponentChildren, type RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ActionTooltip,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import {
  CHROME_ICON,
  DeckIcon,
  FEATURE_ICON,
  type DeckIconSize,
} from "../controls/deck-icon";
import {
  isUnavailable,
  unavailableReason,
  type ToolbarItem,
} from "./toolbar-item";
import { TOOLBAR_GAP, fitToolbarItems } from "./toolbar-overflow";
import { ToolbarOverflowMenu, type MenuAnchor } from "./toolbar-overflow-menu";

/**
 * The feature toolbar: groups of icon controls, hairlines between them, and a
 * `More` menu carrying both the actions pinned to it and whatever the window
 * is too narrow to show. Since 2026-08-16 the pinned half is the whole bar —
 * `DeckToolbar` hands every pane action to `pinnedMenu`, so what renders here
 * is the `More` control alone (DL-23.8).
 *
 * It owns presentation and nothing else. Activation calls straight back into
 * `item.onActivate`, which is the same command path the keyboard and the
 * native menu use, and every state it draws is projected in by the caller —
 * so a pressed tool, a disabled Prompts button or an actionable update stay
 * owned by the feature that already owns them.
 *
 * See docs/specs/2026-08-12-feature-toolbar-design.md.
 */

const MENU_OFFSET = 6;

interface ToolbarControlProps {
  readonly item: ToolbarItem;
  /** Lifted only when the parent has to anchor a surface to this control. */
  readonly controlRef?: RefObject<HTMLButtonElement>;
  /**
   * Presentation overrides for the one control this file itself constructs —
   * `More`, which draws at `FEATURE_ICON` and solid (DL-14.1's surface-scoped
   * `filled`, DL-14.2's role widening). They live here rather than on
   * `ToolbarItem` because no caller-supplied action gets to choose them.
   */
  readonly iconSize?: DeckIconSize;
  readonly iconFilled?: boolean;
}

/**
 * One icon control plus its tooltip.
 *
 * An unavailable action keeps `tabindex` and takes `aria-disabled` rather than
 * `disabled`: a disabled button is unfocusable, so the reason it is disabled
 * becomes unreachable for anyone not using a pointer. Activation is blocked
 * here instead, where the reason is also what the tooltip says.
 */
function ToolbarControl({
  item,
  controlRef,
  iconSize = CHROME_ICON,
  iconFilled = false,
}: ToolbarControlProps) {
  const fallbackRef = useRef<HTMLButtonElement>(null);
  const ref = controlRef ?? fallbackRef;
  const tooltip = useTooltipVisibility();
  const reason = unavailableReason(item);
  const active = item.state.kind === "active";
  const tooltipId = `action-tip-${item.id}`;
  // A trigger whose surface is open has already answered the question the
  // tooltip was asking, and the two would overlap: the menu opens directly
  // under the control the tooltip hangs from.
  const opensSurface = item.toggles === "dialog" || item.toggles === "menu";
  const showTooltip = tooltip.anchor !== null && !(active && opensSurface);

  const expansion =
    item.toggles === "dialog" || item.toggles === "menu"
      ? { "aria-haspopup": item.toggles, "aria-expanded": active }
      : item.toggles === "pressed"
        ? { "aria-pressed": active }
        : {};

  return (
    <span class="ftoolbar__slot">
      {/* DL-21.8: `active` reaches ARIA and the tooltip, never the paint —
          whatever a toolbar control opens is visible on the stage the moment
          it opens, so a wash here would say it a second time. */}
      <button
        ref={ref}
        type="button"
        class={`iconbtn ${item.controlClass ?? ""} ${
          reason !== null ? "is-unavailable" : ""
        }`}
        aria-label={item.label}
        aria-disabled={reason !== null}
        aria-describedby={showTooltip ? tooltipId : undefined}
        {...expansion}
        onPointerEnter={(event) => tooltip.open(event.currentTarget)}
        onPointerLeave={() => {
          // Focus outlives the pointer: tabbing to a control and then moving
          // the mouse across it must not take the description away.
          if (document.activeElement !== ref.current) {
            tooltip.close();
          }
        }}
        onFocus={(event) => tooltip.open(event.currentTarget)}
        onBlur={() => tooltip.close()}
        onClick={() => {
          if (isUnavailable(item)) {
            return;
          }
          item.onActivate();
        }}
      >
        <DeckIcon icon={item.icon} size={iconSize} filled={iconFilled} />
      </button>
      {showTooltip && tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={item.label}
          shortcut={item.shortcut}
          reason={reason}
          anchor={tooltip.anchor}
        />
      )}
      {item.anchored}
    </span>
  );
}

interface FeatureToolbarProps {
  /** In render order; the last item of the last group stays rightmost. */
  readonly items: readonly ToolbarItem[];
  /**
   * The update pill, which owns its own phase and width. It rides in the
   * global group ahead of `More`, and its measured width is what the fit
   * calculation reserves for it.
   */
  readonly updateAction?: ComponentChildren;
  /**
   * Controls that live in `More` no matter how wide the window is, ahead of
   * whatever overflowed into it. Two callers use it: the pane group, which
   * moved here wholesale on 2026-08-16 (DL-23.8), and top-tab mode's copy of
   * the actions the sidebar's own footer carries in the other layout — there
   * is no sidebar there, so one menu stands in for that footer rather than a
   * second row of icons appearing in a layout the other one does not have.
   */
  readonly pinnedMenu?: readonly ToolbarItem[];
  /**
   * A surface anchored to the `More` control while open — the Prompt Board
   * popover, when its row lives in the menu instead of on the bar. The row
   * that opened it is gone by then (activating a row closes the menu,
   * DL-23.5), so the trigger is the only thing left to hang it from.
   */
  readonly pinnedMenuAnchored?: ComponentChildren;
  /**
   * The external-app split-button, which owns its own icon and its own menu
   * and therefore cannot be a `ToolbarItem` (new DL-23.11). It renders
   * immediately before `More`, at the strip's trailing end, and is absent
   * entirely on a host that reports no installed apps.
   */
  readonly externalApp?: ComponentChildren;
}

export function FeatureToolbar({
  items,
  updateAction,
  pinnedMenu,
  pinnedMenuAnchored,
  externalApp,
}: FeatureToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const measure = (): void => {
      setAvailable(root.clientWidth);
      setReserved(updateRef.current?.offsetWidth ?? 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [updateAction]);

  // Zero means "not laid out yet", never "no room at all" — treating an
  // unmeasured row as a full one would send every action into `More` for a
  // frame and then bring them back, which reads as a flicker on every mount.
  // One gap is deducted for the drag filler, which the row arithmetic does
  // not know about: it is a flex sibling like any control, so the `gap`
  // after it is real spent width.
  const fit = fitToolbarItems(
    items,
    available > 0 ? available - TOOLBAR_GAP : Number.POSITIVE_INFINITY,
    reserved,
  );

  const toggleMenu = (): void => {
    if (menu !== null) {
      setMenu(null);
      return;
    }
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    setMenu({
      right: Math.max(0, window.innerWidth - rect.right),
      top: rect.bottom + MENU_OFFSET,
    });
  };

  // Pinned first, then whatever the width pushed out: the menu reads as
  // "the things that live here" followed by "the things that had to move".
  const menuItems: readonly ToolbarItem[] = [
    ...(pinnedMenu ?? []),
    ...fit.overflow,
  ];

  // `DotsThreeOutline` solid, never `DotsThree` at `fill` — the latter is the
  // bare-glyph case DL-14.1 records: its fill variant becomes a knocked-out
  // tile, while the outline icon's fill is exactly three readable dots.
  const moreItem: ToolbarItem = {
    id: "toolbar-more",
    label: "More actions",
    icon: DotsThreeOutline,
    group: "global",
    shortcut: null,
    state: menu !== null ? { kind: "active" } : { kind: "idle" },
    overflowOrder: null,
    toggles: "menu",
    anchored: pinnedMenuAnchored,
    onActivate: toggleMenu,
  };

  const lastGroup = fit.groups.length - 1;

  // The update pill and `More`, as one unit so they can be placed in two
  // spots without drifting: inside the trailing group when the bar drew any
  // controls, and on their own when it drew none. Since 2026-08-16 the second
  // case is the shipping one — every pane action lives in `More` (DL-23.8),
  // so `items` arrives empty and the group loop below has nothing to run
  // over. Rendering `More` only from inside that loop would have left the
  // toolbar blank.
  const trailingExtras = (
    <>
      {externalApp}
      {updateAction !== undefined && (
        <span ref={updateRef} class="ftoolbar__update">
          {updateAction}
        </span>
      )}
      {/* DL-14.2's role widening (owner, 2026-08-20): `More` is the entry
          point to every pane action since DL-23.8, standing icon-only at the
          strip's trailing end, so it draws at 15 like the dock header — the
          glyph grew, the 24px `.iconbtn` box did not. */}
      {menuItems.length > 0 && (
        <ToolbarControl
          item={moreItem}
          controlRef={moreRef}
          iconSize={FEATURE_ICON}
          iconFilled
        />
      )}
    </>
  );

  return (
    <div ref={rootRef} class="ftoolbar">
      {/* The row claims free width so overflow can be computed from it
          (`flex: 1` below is load-bearing); this filler hands that free width
          back to the window as a drag surface, so the titlebar band the
          toolbar sits in stays grabbable on both hosts. */}
      <div class="ftoolbar__drag" data-tauri-drag-region />
      {fit.groups.map((view, index) => {
        // The trailing control of the trailing group is the one the design
        // pins rightmost (Settings); the update pill and `More` slot in just
        // before it, which is why this group renders in two halves.
        const trailing = index === lastGroup;
        const lead = trailing ? view.items.slice(0, -1) : view.items;
        const anchorItem = trailing
          ? view.items[view.items.length - 1]
          : undefined;
        return (
          <Fragment key={view.group}>
            {index > 0 && <span class="tabbar__sep" aria-hidden="true" />}
            {lead.map((item) => (
              <ToolbarControl key={item.id} item={item} />
            ))}
            {trailing && trailingExtras}
            {anchorItem !== undefined && (
              <ToolbarControl key={anchorItem.id} item={anchorItem} />
            )}
          </Fragment>
        );
      })}
      {fit.groups.length === 0 && trailingExtras}
      {menu !== null && menuItems.length > 0 && (
        <ToolbarOverflowMenu
          items={menuItems}
          anchor={menu}
          triggerEl={moreRef.current}
          onClose={() => {
            setMenu(null);
            // Every dismissal path inside ToolbarOverflowMenu (Escape,
            // outside click, activating a row) calls this one callback, so
            // restoring focus here covers all three at once (DL-13.2). This
            // runs after the state that unmounts the menu, not inside the
            // outside-pointerdown listener's own dispatch, so it cannot
            // re-trigger that listener — `focus()` never fires a pointer
            // event.
            moreRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
