import type { ComponentChildren } from 'preact';
import { getDesktopEnvironment } from '../lib/platform';
import { SidebarGrip } from './sidebar-grip';

/**
 * The one-row window shell both layouts paint into: `App` supplies every
 * slot (frame row, sidebar or top tabs, stage, status), and the gallery
 * specimens that photograph a layout mount this directly with their own
 * static children. Purely presentational — it holds no app state of its
 * own and reads only the running platform (for `window--${platform}` and
 * the macOS traffic-light inset).
 */
interface DesktopChromeProps {
  readonly sidebar: boolean;
  /**
   * The sidebar's resize seam (DL-18.9). Optional as a set: `App` always
   * supplies all three, and the gallery specimens that mount this shell to
   * photograph a layout supply none — a seam they cannot drag would only be a
   * cursor change in a screenshot.
   *
   * The painted WIDTH and the collapsed flag do not travel through here; they
   * are written to `:root` by `applySidebarShell` (see that file for why).
   * This prop is the drag's starting point, which the grip needs regardless.
   */
  readonly sidebarWidth?: number;
  readonly onSidebarWidthChange?: (width: number) => void;
  readonly onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /**
   * The hide control, in the frame row immediately after the traffic lights
   * (DL-18.9, 2026-08-16). `App` passes it only while the column is SHOWN —
   * a hidden column has no frame row, so the control moves to the stage strip
   * and `App` mounts it there instead.
   */
  readonly sidebarToggle?: ComponentChildren;
  readonly toolbar: ComponentChildren;
  readonly sidebarNavigation: ComponentChildren;
  readonly topTabs: ComponentChildren;
  readonly stage: ComponentChildren;
  readonly status: ComponentChildren;
  readonly onMacTitlebarDoubleClick: () => void;
}

/** Platform shell only; native Windows system controls stay outside Preact. */
export function DesktopChrome(props: DesktopChromeProps) {
  const platform = getDesktopEnvironment().platform;
  const windows = platform === 'windows';
  // No occupant, no row: the grid reserves `--status-h` for the bottom band,
  // so leaving it at 28px with nothing in it would be a stripe of empty
  // chrome rather than a hidden bar.
  const hasStatus = props.status !== null && props.status !== undefined;
  const classes = [
    'window',
    `window--${platform}`,
    props.sidebar ? 'window--sidebar' : '',
    hasStatus ? '' : 'window--no-status',
  ]
    .filter(Boolean)
    .join(' ');
  const resizable =
    props.sidebar &&
    props.sidebarWidth !== undefined &&
    props.onSidebarWidthChange !== undefined &&
    props.onSidebarCollapsedChange !== undefined;

  // DL-18: one authored command row. On macOS the traffic lights sit INSIDE it
  // behind a fixed inset instead of owning an empty band of their own — the
  // frame is Deck's chrome, not OS spacing the app happens to sit under. In
  // top-tab mode the tabs occupy that same row; in sidebar mode the row carries
  // the actions and the sidebar starts beneath it.
  return (
    <div class={classes}>
      {props.sidebar ? (
        <div
          class="deck-frame"
          data-tauri-drag-region
          onDblClick={windows ? undefined : props.onMacTitlebarDoubleClick}
        >
          {!windows ? <div class="deck-frame__lights" aria-hidden="true" /> : null}
          {/* Beside the OS buttons, before anything else: hiding the column is
              a window gesture, and this is the row the window's own controls
              live in (DL-18.9). */}
          {props.sidebarToggle}
          <div class="deck-frame__spacer" data-tauri-drag-region />
          {props.toolbar}
        </div>
      ) : null}
      {props.sidebar ? props.sidebarNavigation : props.topTabs}
      {resizable ? (
        <SidebarGrip
          width={props.sidebarWidth!}
          onWidthChange={props.onSidebarWidthChange!}
          onCollapsedChange={props.onSidebarCollapsedChange!}
        />
      ) : null}
      {props.stage}
      {props.status}
    </div>
  );
}
