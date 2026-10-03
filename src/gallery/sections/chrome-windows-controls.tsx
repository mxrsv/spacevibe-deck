import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { DesktopChrome } from "../../ui/desktop-chrome";
import { DockPanel } from "../../ui/dock/dock-panel";
import { DOCK_TABS } from "../../ui/dock/dock-tab-registry";
import { DockToggle } from "../../ui/dock/dock-toggle";
import { SIDEBAR_HIDDEN_WIDTH } from "../../ui/panel-resize";
import { SettingsScreen } from "../../ui/settings/settings-screen";
import { SidebarToggle } from "../../ui/sidebar-toggle";
import {
  agentRailNavigationSpecimen,
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
  sidebarFrameActionsSpecimen,
  tabBarSpecimen,
} from "../chrome-fixtures";
import { Specimen } from "../specimen";
import "./chrome-windows-controls.css";

/**
 * The Windows + Electron window, one specimen per layout state that puts
 * something at the frame row's right end (`22-caption-overlay.css`).
 *
 * The OS paints the caption buttons over the web contents, so a browser can
 * only show where they WOULD sit: a hatched box of the buttons' footprint at
 * the window's top-right (`.gx-caption-standin`). It is a stand-in for the
 * reservation, not a picture of the buttons — theming, Snap Layouts and DPI
 * scaling cannot be seen here.
 *
 * The gallery boots as macOS, so `DesktopChrome` itself never adds the marker.
 * It is forced on a wrapper instead: every Windows rule is a descendant
 * selector and the token inherits, so an ancestor marker reaches the same
 * elements a root marker would. The shell inside is still the macOS build of
 * the component (root class `window--macos`, labels and chords for macOS), which
 * matters on the left edge only; nothing on the right reads the platform.
 *
 * Each frame carries `data-caption-state` so a script can find it and probe
 * what sits under the stand-in.
 */

interface CaptionState {
  readonly id: string;
  readonly name: string;
  readonly sidebar: boolean;
  /** Sidebar layout only: the column is hidden and the strip is the frame row. */
  readonly collapsed?: boolean;
  /** The docked column is shown, and its hide control with it. */
  readonly dock?: boolean;
  readonly settings?: boolean;
}

const CAPTION_STATES: readonly CaptionState[] = [
  { id: "sidebar", name: "sidebar layout, sidebar expanded", sidebar: true },
  {
    id: "sidebar-collapsed",
    name: "sidebar layout, sidebar hidden",
    sidebar: true,
    collapsed: true,
  },
  { id: "sidebar-dock", name: "sidebar layout, docked panel open", sidebar: true, dock: true },
  { id: "top-tab", name: "top-tab layout", sidebar: false },
  { id: "top-tab-dock", name: "top-tab layout, docked panel open", sidebar: false, dock: true },
  { id: "sidebar-settings", name: "sidebar layout, Settings open", sidebar: true, settings: true },
  { id: "top-tab-settings", name: "top-tab layout, Settings open", sidebar: false, settings: true },
];

/** The three caption buttons, in the order Windows draws them. */
const CAPTION_BUTTONS = ["min", "max", "close"] as const;

/** `App` mounts the dock's way back only while the panel is absent. */
function closedDockToggle(state: CaptionState) {
  return state.dock ? null : <DockToggle open={false} onToggle={NOOP} />;
}

function CaptionStage({ state, collapsed }: { state: CaptionState; collapsed: boolean }) {
  return (
    <main
      class={`stage ${state.sidebar ? "stage--strip" : ""} ${state.dock ? "stage--dock" : ""}`}
      // The same wiring `App` gives its stage: one number for the panel's
      // column and the inset that keeps the terminal grid clear of it.
      style={state.dock ? { "--dock-w": `${DEFAULT_SETTINGS.dockWidth}px` } : undefined}
    >
      {state.sidebar ? (
        <div class="stage__strip" data-tauri-drag-region>
          {collapsed ? <SidebarToggle collapsed onToggle={NOOP} /> : null}
          {repositoryScopedTabStripSpecimen()}
          <div class="stage__strip-actions">{deckToolbarSpecimen()}</div>
          {closedDockToggle(state)}
        </div>
      ) : null}
      <div class="stage__tabs">
        <div class="gx-scoped-terminal" aria-label="Terminal preview">
          <span class="gx-scoped-terminal__prompt">❯</span>
          <span> npm test</span>
        </div>
      </div>
      {state.dock ? (
        <DockPanel
          tabs={DOCK_TABS}
          activeTab="explorer"
          onSelectTab={NOOP}
          width={DEFAULT_SETTINGS.dockWidth}
          onWidthChange={NOOP}
          onClose={NOOP}
        >
          <p class="gx-caption-dock-body">panel body</p>
        </DockPanel>
      ) : null}
      {state.settings ? <SettingsScreen open onClose={NOOP} /> : null}
    </main>
  );
}

function CaptionFrame({ state }: { state: CaptionState }) {
  // Same wrapper-level attribute and variable `chrome-section` uses for its
  // collapsible rail: the shipped CSS reads them from any ancestor.
  const collapsed = state.collapsed === true;
  return (
    <div
      class="gx-caption-frame window--windows window--caption-overlay"
      data-caption-state={state.id}
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      style={{
        "--sidebar-w": `${collapsed ? SIDEBAR_HIDDEN_WIDTH : DEFAULT_SETTINGS.sidebarWidth}px`,
      }}
    >
      <DesktopChrome
        sidebar={state.sidebar}
        sidebarToggle={state.sidebar && !collapsed ? sidebarFrameActionsSpecimen() : null}
        toolbar={null}
        sidebarNavigation={state.sidebar ? agentRailNavigationSpecimen() : null}
        topTabs={state.sidebar ? null : tabBarSpecimen({ trailing: closedDockToggle(state) })}
        stage={<CaptionStage state={state} collapsed={collapsed} />}
        status={null}
        onMacTitlebarDoubleClick={NOOP}
      />
      <div class="gx-caption-standin" aria-hidden="true">
        {CAPTION_BUTTONS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function WindowsControlsSpecimens() {
  return (
    <>
      {CAPTION_STATES.map((state) => (
        <Specimen
          key={state.id}
          name={`Windows + Electron · ${state.name}`}
          note="hatched box = where the OS caption buttons would sit (138px wide, 34px tall: three 46px buttons); nothing interactive may reach it"
          surface="none"
          tall
        >
          <CaptionFrame state={state} />
        </Specimen>
      ))}
    </>
  );
}
