import { useSignal } from "@preact/signals";
import { PresetThumb } from "../../presets/preset-thumb";
import { AgentAttentionMark } from "../../ui/agent-attention-mark";
import { DesktopChrome } from "../../ui/desktop-chrome";
import { WorkspaceSpinner } from "../../ui/workspace-spinner";
import { SidebarBanner } from "../../ui/sidebar-banner";
import { activeTabIndex } from "../../terminal/tabs-store";
import { SIDEBAR_HIDDEN_WIDTH } from "../../ui/panel-resize";
import { SidebarToggle } from "../../ui/sidebar-toggle";
import { DockToggle } from "../../ui/dock/dock-toggle";
import { SidebarActions } from "../../ui/sidebar-actions";
import { DockTabs } from "../../ui/dock/dock-tabs";
import { DOCK_TABS } from "../../ui/dock/dock-tab-registry";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";

import { UpdateAction } from "../../updater/update-action";
import type { UpdatePhase } from "../../updater/update-controller";
import { agentStatusRailChromeSpecimen } from "../agent-status-rail";
import {
  agentRailNavigationSpecimen,
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
  sidebarFrameActionsSpecimen,
} from "../chrome-fixtures";
import { SEED_ATTENTION, SEED_LAYOUT } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/** Every phase the update pill can be in, `hidden` excluded — it renders nothing. */
const UPDATE_PHASES: readonly Exclude<UpdatePhase, "hidden">[] = [
  "available",
  "downloading",
  "downloaded",
  "download-failed",
  "installing",
  "install-failed",
  "relaunch-failed",
];

const WOVEN_FLAG_NOTE = "Textile grain · shallow fold light · matte colour";

export function ChromeSection() {
  const selectGalleryTab = (index: number): void => {
    activeTabIndex.value = index;
  };
  // The specimen owns this the way `App` owns the setting — same component,
  // different owner (DL-18.9). Local, so toggling it in the gallery cannot
  // write the running app's settings.
  const railCollapsed = useSignal(false);
  const workingAttention = SEED_ATTENTION.find(
    (summary) => summary.kind === "working",
  );
  return (
    <>
      <SectionHead
        title="Window chrome"
        blurb="The selected Electron target shell is mounted from Deck's current components: AgentRail, one unified stage strip and the current toolbar placement. The specimens beneath it cover component states rather than alternative compositions."
      />

      <Specimen
        name="Current Electron target shell"
        note="real AgentRail · unified mixed-surface strip · toolbar on the stage · status and dock follow their default-off settings"
        surface="none"
        tall
      >
        {agentStatusRailChromeSpecimen()}
      </Specimen>

      <Specimen
        name="SidebarBanner · Woven Flag"
        note="selected treatment · real 40px artwork · gallery-only reference"
        surface="chrome-1"
      >
        <div class="gx-banner-directions">
          <article class="gx-banner-direction gx-banner-direction--woven">
            <header class="gx-banner-direction__head">
              <span class="gx-banner-direction__label">Woven Flag</span>
            </header>
            <div class="gx-banner-direction__rail">
              <span class="gx-banner-direction__eyebrow">repositories</span>
              <span class="gx-banner-direction__repository">
                <span>spacevibe-deck</span>
                <small>main · primary</small>
              </span>
              <SidebarBanner />
            </div>
            <p>{WOVEN_FLAG_NOTE}</p>
          </article>
        </div>
      </Specimen>

      <Specimen
        name="Worktree-scoped TabStrip"
        note="click a tab row or agent row in the real rail — the real stage strip follows that project and hides tabs from every other project"
        surface="none"
        tall
      >
        {/* The shipped app writes these two onto `:root` (sidebar-shell.ts);
            a specimen writes them onto its own wrapper instead, so one
            collapsed rail here does not collapse every other rail on the
            page. Same attribute, same variable, same CSS. */}
        <div
          data-sidebar-collapsed={railCollapsed.value ? "true" : "false"}
          style={{
            "--sidebar-w": `${
              railCollapsed.value
                ? SIDEBAR_HIDDEN_WIDTH
                : DEFAULT_SETTINGS.sidebarWidth
            }px`,
          }}
        >
          <DesktopChrome
            sidebar
            // `onSidebarWidthChange` is left out on purpose: that is the drag
            // seam, and a seam a screenshot cannot drag is only a cursor
            // change.
            sidebarToggle={
              railCollapsed.value ? null : (
                sidebarFrameActionsSpecimen(() => {
                  railCollapsed.value = true;
                })
              )
            }
            toolbar={null}
            sidebarNavigation={agentRailNavigationSpecimen({
              onSelectTab: selectGalleryTab,
            })}
            topTabs={null}
            stage={
              <main class="stage stage--strip">
                <div class="stage__strip" data-tauri-drag-region>
                  {/* The shipped control, not a redraw of it — the reason it
                      became a component at all (sidebar-toggle.tsx). */}
                  {railCollapsed.value ? (
                    <SidebarToggle
                      collapsed
                      onToggle={() => {
                        railCollapsed.value = false;
                      }}
                    />
                  ) : null}
                  {repositoryScopedTabStripSpecimen()}
                  <div class="stage__strip-actions">
                    {deckToolbarSpecimen()}
                  </div>
                  <DockToggle open={false} onToggle={NOOP} />
                </div>
                <div class="stage__tabs">
                  <div class="gx-scoped-terminal" aria-label="Terminal preview">
                    <span class="gx-scoped-terminal__prompt">❯</span>
                    <span> npm test</span>
                    <span class="gx-scoped-terminal__result">
                      ✓ active worktree tabs only
                    </span>
                  </div>
                </div>
              </main>
            }
            status={null}
            onMacTitlebarDoubleClick={NOOP}
          />
        </div>
      </Specimen>

      {/*
        Component-state coverage, not composition review — which is why the
        narrowing to one direction above left these standing
        (docs/specs/2026-08-12-agent-workbench-gallery-design.md §3.3). Nothing
        else in the gallery shows all seven update phases at once.
      */}

      <Specimen
        name="AgentAttentionMark"
        note="every kind the rail can summarise; idle renders nothing at all"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {SEED_ATTENTION.map((summary) => (
            <span key={summary.kind} class="gx-inline__item">
              <StateLabel>{summary.kind}</StateLabel>
              <span class="tab__attn">
                <AgentAttentionMark
                  summary={summary}
                  label={`${summary.kind} tab`}
                  onActivate={NOOP}
                />
              </span>
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="UpdateAction"
        note="all seven visible phases — the app only ever shows one"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {UPDATE_PHASES.map((phase) => (
            <span key={phase} class="gx-inline__item">
              <StateLabel>{phase}</StateLabel>
              <UpdateAction
                view={{
                  phase,
                  currentVersion: "0.12.2",
                  availableVersion: "0.12.3",
                  notes: "Fixes the thing.",
                }}
                onDownload={NOOP}
                onInstall={NOOP}
                onRelaunch={NOOP}
              />
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="Neutral feature glyph emphasis"
        note="draft · 15px high-contrast neutral glyph · hover and selection stay neutral"
        surface="chrome-1"
      >
        <div class="gx-icon-trial">
          <div class="gx-icon-trial__dock">
            <DockTabs items={DOCK_TABS} active="explorer" onSelect={NOOP} />
          </div>
          <div class="gx-icon-trial__rail">
            <SidebarActions
              sessionsAvailable
              promptsOpen={false}
              promptsUnavailable={null}
              onOpenBrowser={NOOP}
              onOpenUsage={NOOP}
              onOpenSessions={NOOP}
              onOpenPrompts={NOOP}
              onOpenSettings={NOOP}
            />
          </div>
          <span class="gx-icon-trial__spinner">
            <StateLabel>agent working</StateLabel>
            {workingAttention !== undefined ? (
              <AgentAttentionMark
                summary={workingAttention}
                label="Neutral icon treatment"
              />
            ) : null}
          </span>
        </div>
      </Specimen>

      <Specimen
        name="WorkspaceSpinner · PresetThumb"
        note="DL-14.6 exempts both from the icon system — one is a status visual, one is a diagram"
        surface="chrome-1"
      >
        <div class="gx-inline">
          <span class="gx-inline__item">
            <StateLabel>agent pending</StateLabel>
            <WorkspaceSpinner />
          </span>
          <span class="gx-inline__item">
            <StateLabel>layout thumbnail</StateLabel>
            <PresetThumb layout={SEED_LAYOUT} />
          </span>
        </div>
      </Specimen>
    </>
  );
}
