import { Plus, SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { createNewPaneDragController, type NewPaneDropDeps } from "./new-pane-drag";

interface SidebarToggleProps {
  /** Painted state, not the setting: a live drag arms this before it writes. */
  readonly collapsed: boolean;
  onToggle(): void;
}

/**
 * The navigation sidebar's own hide control (DL-18.9).
 *
 * A component rather than markup inlined at its mount, because the gallery
 * composes `DesktopChrome` and its stage itself: anything written inside
 * `App`'s stage JSX is invisible to every specimen, so the shell the gallery
 * photographs would be missing a control the shipped shell has.
 *
 * State-free on purpose. It takes the painted `collapsed` and a callback and
 * reads no store, so a specimen can drive it from a local signal while `App`
 * drives it from settings — one component, one look, two owners.
 *
 * `collapsed` drives the label and `aria-pressed` and NOTHING visual (DL-21.8):
 * a hidden sidebar is a change to the whole window, so painting the 24px button
 * as well said it twice. The ARIA state is the only readout a screen reader
 * gets, which is why it stays.
 */
export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  const label = collapsed ? "Expand the sidebar" : "Collapse the sidebar";
  return (
    <button
      type="button"
      class="iconbtn"
      aria-label={label}
      aria-pressed={collapsed}
      title={label}
      onClick={onToggle}
    >
      <DeckIcon icon={SidebarSimple} size={CHROME_ICON} />
    </button>
  );
}

interface SidebarNewButtonProps {
  onOpenWorkspace(): void;
  readonly newPaneDrop?: NewPaneDropDeps;
}

/** The sidebar's `New` launcher, now in the frame beside its hide control. */
function SidebarNewButton({ onOpenWorkspace, newPaneDrop }: SidebarNewButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<NewPaneDropDeps | undefined>(newPaneDrop);
  dropRef.current = newPaneDrop;

  useEffect(() => {
    const handle = buttonRef.current;
    if (handle === null) {
      return;
    }
    const controller = createNewPaneDragController(handle, {
      ghostLabel: "New agent pane",
      slotRects: () => dropRef.current?.slotRects() ?? [],
      onDragStart: () => dropRef.current?.onDragStart?.(),
      onDrop: (targetPaneId, edge) => {
        dropRef.current?.onDrop(targetPaneId, edge);
      },
    });
    return () => controller.dispose();
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      class="sidebar-new"
      title="Open a workspace — or drag onto a pane to add an agent there"
      aria-label="New"
      onClick={onOpenWorkspace}
    >
      <DeckIcon icon={Plus} size={CHROME_ICON} />
      <span>New</span>
    </button>
  );
}

interface SidebarFrameActionsProps extends SidebarNewButtonProps {
  readonly collapsed: boolean;
  onToggle(): void;
}

/** The compact action cluster immediately after the macOS traffic lights. */
export function SidebarFrameActions(props: SidebarFrameActionsProps) {
  return (
    <div class="sidebar-frame-actions">
      <SidebarToggle collapsed={props.collapsed} onToggle={props.onToggle} />
      <SidebarNewButton onOpenWorkspace={props.onOpenWorkspace} newPaneDrop={props.newPaneDrop} />
    </div>
  );
}
