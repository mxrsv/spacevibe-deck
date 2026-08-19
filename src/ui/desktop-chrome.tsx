import type { ComponentChildren } from "preact";
import { getDesktopEnvironment } from "../lib/platform";
import { SidebarGrip } from "./sidebar-grip";

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
   * The sidebar's leading controls, in the frame row immediately after the
   * traffic lights (DL-18.9). `App` passes the hide control followed by `New`
   * only while the column is SHOWN — a hidden column has no frame row, so only
   * the toggle moves to the stage strip.
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
  const windows = platform === "windows";
  // No occupant, no row: the grid reserves `--status-h` for the bottom band,
  // so leaving it at 28px with nothing in it would be a stripe of empty
  // chrome rather than a hidden bar.
  const hasStatus = props.status !== null && props.status !== undefined;
  const classes = [
    "window",
    `window--${platform}`,
    props.sidebar ? "window--sidebar" : "",
    hasStatus ? "" : "window--no-status",
  ]
    .filter(Boolean)
    .join(" ");
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
          // NOT a drag region itself (2026-08-19). It was, with every button
          // inside it opted back out through `[data-tauri-drag-region] button`,
          // and that arrangement is what made the cursor flicker: Chromium
          // hit-tests app-regions on its own path, so a pointer MOVING across a
          // no-drag island inside a drag surface alternates between the OS
          // arrow and the element's own cursor — reported over the `New`
          // launcher, which asks for `grab`. Standing still was fine, which is
          // what pointed at hit-testing rather than at a re-render.
          // The row is still draggable where it should be: `__lights` and
          // `__spacer` declare it themselves, and the spacer is `flex: 1`, so
          // everything that is not a control still moves the window. What is
          // lost is the 8px gap between the controls and the row's padding —
          // dead space either way.
          class="deck-frame"
          onDblClick={windows ? undefined : props.onMacTitlebarDoubleClick}
        >
          {!windows ? (
            <div class="deck-frame__lights" aria-hidden="true" />
          ) : null}
          {/* Beside the OS buttons, before anything else: the sidebar's hide
              control and `New` launcher form its leading frame cluster
              (DL-18.9). */}
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
