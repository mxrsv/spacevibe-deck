import { useSignal } from '@preact/signals';
import { activeTabIndex, NO_PANES, tabViews } from '../terminal/tabs-store';
import { AgentGlyph } from '../ui/controls/agent-glyph';
import { DesktopChrome } from '../ui/desktop-chrome';
import { SidebarToggle } from '../ui/sidebar-toggle';
import { DockToggle } from '../ui/dock/dock-toggle';
import {
  agentRailNavigationSpecimen,
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
} from './chrome-fixtures';

/**
 * Gallery specimens for the agent status rail — the SHIPPED `AgentRail`, not a
 * drawing of it.
 *
 * Until 2026-08-16 this file carried a hand-built copy of the rail, frozen at
 * the design-study shape it was approved in: a pinned `Needs you` block,
 * recency order, one flat list naming the project on every row. The shipped
 * rail then moved on — project clusters (DL-27.9), no pinned block, age inline
 * with the row — and the copy did not, so the gallery
 * showed one sidebar and the app another. That is the failure
 * `repositorySidebarSpecimen` already names: a hand-built specimen tree means
 * the gallery reviews a drawing of the rail rather than the rail.
 *
 * So both specimens now mount `src/ui/agent-rail.tsx` itself, rendering the
 * stores `src/gallery/main.tsx` seeds (`tabViews` panes, the session archive,
 * workspace history) through the real `agent-rail-model.ts`. What remains in
 * this file is only the harness around it: the study frame, and the fake pane
 * grid the chrome specimen's focus ping is demonstrated against.
 *
 * `showAgentPresence` is forced on: the shipped default reads the Electron
 * host marker, which a browser gallery never has, and without it the rail
 * draws no chips, no disclosure and no per-agent rows.
 */

/** Rail clicks land where the app sends them: on the shared active index. */
function selectTab(index: number): void {
  activeTabIndex.value = index;
}

/** The rail alone, at the width the window shell actually gives it. */
export function agentStatusRailSpecimen() {
  return (
    <div class="asr-study">
      <div class="asr-study__stage">
        {agentRailNavigationSpecimen({
          onSelectTab: selectTab,
          onFocusPane: selectTab,
          showFooter: false,
        })}
      </div>
    </div>
  );
}

/**
 * The same rail inside the real window shell, so the sidebar can be judged
 * against the frame and stage rather than on its own. `DesktopChrome`, the
 * strip, the toolbar and `SidebarActions` are all current components — only
 * the data underneath is seeded. The status slot stays null, matching the
 * default-off setting represented by this specimen.
 */
export function agentStatusRailChromeSpecimen() {
  return <AgentStatusRailChrome />;
}

function AgentStatusRailChrome() {
  // The pane the rail last sent focus to. In the app this is `TabManager`'s
  // own focus; here it stands in for it so a chip click has a visible answer.
  const focusedPaneId = useSignal<number | null>(null);
  // Bumped on every focus so re-picking the same pane restarts the ring —
  // an animation only replays when its element is new.
  const ping = useSignal(0);
  const activeTab = tabViews.value[activeTabIndex.value];
  const stagePanes = (activeTab?.panes ?? NO_PANES).filter((pane) => pane.agent !== null);
  return (
    <DesktopChrome
      sidebar
      sidebarToggle={<SidebarToggle collapsed={false} onToggle={NOOP} />}
      toolbar={null}
      sidebarNavigation={agentRailNavigationSpecimen({
        onSelectTab: selectTab,
        onFocusPane: (index, paneId) => {
          selectTab(index);
          focusedPaneId.value = paneId;
          ping.value += 1;
        },
      })}
      topTabs={null}
      stage={
        <main class="stage stage--strip">
          <div class="stage__strip" data-tauri-drag-region>
            {repositoryScopedTabStripSpecimen()}
            <div class="stage__strip-actions">{deckToolbarSpecimen()}</div>
            <DockToggle open={false} onToggle={NOOP} />
          </div>
          <div class="stage__tabs">
            <div class="asr-stage" aria-label="Terminal panes">
              {stagePanes.map((pane) => (
                <section
                  key={pane.paneId}
                  class="asr-stage__pane"
                  data-active={pane.paneId === focusedPaneId.value}
                >
                  <header class="asr-stage__head">
                    {pane.agent !== null && (
                      <AgentGlyph agent={pane.agent} className="asr-stage__logo" />
                    )}
                    <span>{pane.agent}</span>
                  </header>
                  {pane.paneId === focusedPaneId.value && (
                    <span
                      key={`${pane.paneId}-${ping.value}`}
                      class="asr-stage__ring"
                      aria-hidden="true"
                    />
                  )}
                </section>
              ))}
            </div>
          </div>
        </main>
      }
      status={null}
      onMacTitlebarDoubleClick={NOOP}
    />
  );
}
