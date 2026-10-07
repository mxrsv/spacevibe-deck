import deckLogoUrl from "../../.github/assets/icon.svg";
import { Plus, SidebarSimple } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { createNewPaneDragController, type NewPaneDropDeps } from "./new-pane-drag";
import { appVersion } from "../updater/app-version";
import { getDesktopEnvironment } from "../lib/platform";

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
  readonly disabled?: boolean;
  onOpenWorkspace(): void;
  readonly newPaneDrop?: NewPaneDropDeps;
}

/**
 * The workspace launcher (DL-27.14). On Electron it is a small `+ New` at the trailing end of the
 * sidebar identity row (amended 2026-10-07, mock D); Tauri's legacy rail still pins it, full
 * width, above its list. The visible word is `New`; the accessible name stays `New Workspace`.
 */
export function SidebarNewButton({
  disabled = false,
  onOpenWorkspace,
  newPaneDrop,
}: SidebarNewButtonProps) {
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
      disabled={disabled}
      title="Open a workspace — or drag onto a pane to add an agent there"
      aria-label="New Workspace"
      onClick={onOpenWorkspace}
    >
      <DeckIcon icon={Plus} size={CHROME_ICON} />
      <span>New</span>
    </button>
  );
}

/** The sidebar identity row, following the native traffic lights (DL-18.9). */
export function SidebarFrameActions(
  props: SidebarToggleProps & { readonly newButton?: ComponentChildren },
) {
  const isDevelopment = getDesktopEnvironment().isDevelopment === true;
  return (
    <div class="sidebar-frame-actions">
      <SidebarToggle collapsed={props.collapsed} onToggle={props.onToggle} />
      <span class="sidebar-frame-actions__spacer" data-tauri-drag-region />
      <span class="sidebar-brand">
        <img src={deckLogoUrl} alt="" width={20} height={20} draggable={false} />
        <span>Deck</span>
        {isDevelopment ? (
          <span class="sidebar-brand__dev" title="Local development build">
            DEV
          </span>
        ) : appVersion.value ? (
          <span class="sidebar-brand__version" title={`Version ${appVersion.value}`}>
            V{appVersion.value}
          </span>
        ) : null}
      </span>
      {props.newButton}
    </div>
  );
}
