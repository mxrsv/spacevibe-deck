/**
 * The tab chips themselves: every open thing in ONE row, in the order it was
 * opened — terminal tabs, the active workspace's file tabs and the browser
 * chip interleaved (DL-18.6, 2026-08-16) — plus the new-tab button. Top-tab
 * mode shows the global terminal set; sidebar mode scopes it to the active
 * tab's repository, the unit `AgentRail` is built around.
 *
 * A chip says WHAT is open and nothing else (DL-18.10). It carried an agent
 * attention mark and opened a rename/colour popover until 2026-08-16, when the
 * owner removed both: agent state is the rail's job, and a chip that also
 * reported it made the strip a second status surface. `TabPopover` itself was
 * deleted later the same day, with the rename and workspace-logo features it
 * carried and the ⌘⇧R chord that raised it.
 *
 * Until 2026-08-16 this was two segments split by a hairline: every terminal
 * tab, `.tabbar__sep`, then every surface. One chip shape and one order
 * replaced both, so nothing about a chip says what KIND of thing it opened
 * except its glyph — an agent's brand mark, a file's type icon, the browser's
 * globe. The order itself is not computed here: `mergeStripOrder` is shared
 * with `TabManager`, which walks the same row for ⌘⇧[/], ⌘1–9 and ⌘9.
 *
 * Extracted from `TabBar` on 2026-08-14 because the strip now has TWO mounts,
 * not one: `TabBar` in top-tab mode, where the strip IS the window frame, and
 * `.stage__strip` in sidebar mode, where it is the frame row's column-2
 * occupant (DL-18.3, DL-18.6). One component so the two can never drift into
 * two different answers about what a chip does.
 *
 * Selection and close still leave through global tab indexes, so `TabManager`
 * keeps ownership. Only the sidebar projection is scoped; file chips continue
 * through `FileSurfaceController` exactly as before.
 */
import { Globe, Plus, TerminalWindow, X } from '@phosphor-icons/react';
import { activeTabIndex, tabViews, type TabView } from '../terminal/tabs-store';
import type { PaneAgent } from '../lib/process-info';
import { UNSEQUENCED } from '../lib/open-sequence';
import { mergeStripOrder } from '../lib/strip-order';
import { AgentGlyph } from './controls/agent-glyph';
import { fileIcon } from '../files/ui/file-icons';
import { CHROME_ICON, DeckIcon } from './controls/deck-icon';
import { titleWithShortcut } from '../lib/shortcut-label';
import type { FileSurfaceController } from '../files/file-surface-controller';
import { activeWorkspace } from '../files/file-surface-store';
import { fileTabViews } from '../files/file-tab-views';
import {
  browserOpen,
  browserOpenedAt,
  browserState,
  browserSurfaceActive,
} from '../browser/browser-store';
import { repositoryScans } from '../repositories/repositories-store';
import { activeRepositoryTabIndexes } from '../repositories/repository-model';
import { paneTails } from '../terminal/session-tail-store';
import { tabTail } from './agent-rail-model';

export interface TabStripProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  /**
   * The same `SurfaceStrip` wired into `TabManager` (Task 5) — read here
   * only for `fileTabViews`'s projection and the `activate`/`closePath`
   * calls its own chips need. The strip never learns what a file IS, only
   * what this projects (spec §2.3's seam, extended to the renderer).
   */
  fileController: FileSurfaceController;
  /**
   * The browser chip's two actions, owned by `App` like every other chip
   * callback: `App` is the one module that sees both the file store and the
   * browser store, so the mutual-exclusion rule ("exactly one surface owns
   * the stage") lives there, never in this presentation layer.
   */
  onSelectBrowser(): void;
  onCloseBrowser(): void;
  /**
   * Sidebar mode follows the active tab's REPOSITORY. Top-tab mode has no rail
   * to switch that scope, so it deliberately keeps the global strip.
   *
   * The unit was the worktree until 2026-08-16, when the rail stopped being
   * shaped like the repository layout: its rows are tabs in a project, so a
   * strip scoped tighter than the rail would hide a sibling tab the rail is
   * still listing (agent-status-rail spec §4.1). For the 46 of 51 repositories
   * with a single working directory the two answers are identical.
   */
  scopeToActiveRepository: boolean;
}

/**
 * The agent whose brand mark leads a terminal chip.
 *
 * Prefers the agent the LABEL already names — the chip reads as one thing,
 * and a tab running `claude` beside `gemini` must not show gemini's mark over
 * the word "claude". Falls back to whichever agent the tab runs first, and to
 * null for a plain shell, which wears the terminal glyph instead.
 */
function chipAgent(tab: TabView): PaneAgent | null {
  return tab.agents.find((agent) => agent === tab.process) ?? tab.agents[0] ?? null;
}

export function TabStrip(props: TabStripProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const visibleIndexes = props.scopeToActiveRepository
    ? activeRepositoryTabIndexes(tabs, active, repositoryScans.value)
    : tabs.map((_, index) => index);
  const visibleTabs = visibleIndexes.flatMap((index) => {
    const tab = tabs[index];
    return tab === undefined ? [] : [{ index, tab }];
  });
  // A file or browser surface can hold the stage while `active` still names
  // whichever terminal tab it sits on top of (selecting a surface never
  // touches `TabManager`'s own `active` index) — so a terminal chip is only
  // the VISIBLE active tab when neither is true.
  const fileTabs = fileTabViews(props.fileController);
  const surfaceActive = props.fileController.activeIndex() >= 0 || browserSurfaceActive.value;
  // The row, in open order. The surface list is built in the SurfaceStrip
  // index space on purpose — files, then the browser's one slot — because
  // that is the space `fileController.activate(index)` and the keyboard both
  // speak. Where a chip PAINTS is this merge's answer; what it addresses is
  // still its owner's own index.
  const slots = mergeStripOrder(
    visibleTabs.map(({ tab }) => ({ openedAt: tab.openedAt ?? UNSEQUENCED })),
    [
      // `?? UNSEQUENCED` is not defensive noise: the comparator is arithmetic,
      // so ONE undefined key would produce NaN and scramble the whole row
      // rather than misplace one chip. Every production path fills it in.
      ...fileTabs.map((tab) => ({ openedAt: tab.openedAt ?? UNSEQUENCED })),
      ...(browserOpen.value ? [{ openedAt: browserOpenedAt.value }] : []),
    ],
  );
  /**
   * One terminal chip. The glyph slot holds the agent's brand mark, or a
   * terminal glyph when no agent is recognised — one picture per chip and
   * nothing beside it.
   *
   * It carried the tab's colour dot as a corner badge for one day. The owner
   * removed both the dot and the picker behind it on 2026-08-16 (DL-18.10
   * amended): the chips are glyph-led, and a second mark on the same 15px box
   * was noise rather than identity. `TabView.dotColor` still exists and is
   * still carried across a window transfer, but nothing can set it since
   * `TabPopover` was deleted later that day.
   */
  function terminalChip(tab: TabView, index: number) {
    // The chip says what this tab's agent just said (DL-18.10, amended
    // 2026-08-17, owner) — the same sentence the rail row shows, through the
    // same precedence. A name the user typed still wins, exactly as it does
    // there, and a tab whose agent has said nothing keeps its process name.
    const tail = tabTail(tab, paneTails.value);
    const label = tab.name ?? (tail !== '' ? tail : (tab.process ?? 'shell'));
    const agent = chipAgent(tab);
    return (
      <div
        key={`tab-${tab.key}`}
        role="tab"
        aria-selected={index === active && !surfaceActive}
        tabIndex={0}
        class={`tab ${index === active && !surfaceActive ? 'is-active' : ''}`}
        // The chip is narrow by design, so the sentence it carries is trimmed
        // by the layout and kept whole here (DL-27.4's contract, which the
        // strip inherits along with the sentence).
        title={label}
        // A file surface sitting on top of THIS same index still needs the
        // click to take the stage back (spec §7, "selecting a terminal tab
        // takes the stage back"); clicking the chip that already holds it is
        // a no-op, since 2026-08-16 removed the popover it used to open.
        onClick={() => {
          if (index !== active || surfaceActive) {
            props.onSelectTab(index);
          }
        }}
      >
        <span class="tab__glyph">
          {agent === null ? (
            <DeckIcon icon={TerminalWindow} size={CHROME_ICON} />
          ) : (
            <AgentGlyph agent={agent} className="tab__logo" />
          )}
        </span>
        <span class="tab__label">{label}</span>
        <button
          type="button"
          class="tab__close"
          aria-label="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            props.onCloseTab(index);
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }

  /**
   * One file chip. Same shell as a terminal chip, with the tree's file-type
   * glyph in the slot the agent mark occupies there (DL §8's icon rule, which
   * stopped being docked-panel-only when the strip became one row).
   */
  function fileChip(tab: (typeof fileTabs)[number], index: number) {
    return (
      <div
        key={`file-${tab.path}`}
        role="tab"
        aria-selected={tab.active}
        tabIndex={0}
        class={`tab tab--file ${tab.active ? 'is-active' : ''}`}
        onClick={() => props.fileController.activate(index)}
      >
        <span class="tab__glyph">
          <DeckIcon icon={fileIcon(tab.name)} size={CHROME_ICON} />
        </span>
        <span class={`tab__label ${tab.preview ? 'tab__label--preview' : ''}`}>{tab.name}</span>
        {tab.dirty && <span class="tab__dot tab__dot--dirty" aria-hidden="true" />}
        <button
          type="button"
          class="tab__close"
          aria-label={`Close ${tab.name}`}
          onClick={(event) => {
            event.stopPropagation();
            const workspacePath = activeWorkspace.value;
            if (workspacePath !== null) {
              void props.fileController.closePath(workspacePath, tab.path);
            }
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }

  /**
   * The browser chip — one chip, present while the browser is open anywhere
   * (its page survives losing the stage). Identified by the page title so the
   * chip reads like the page, not like chrome.
   */
  function browserChip() {
    return (
      <div
        key="browser"
        role="tab"
        aria-selected={browserSurfaceActive.value}
        tabIndex={0}
        class={`tab tab--browser ${browserSurfaceActive.value ? 'is-active' : ''}`}
        onClick={() => {
          if (!browserSurfaceActive.value) {
            props.onSelectBrowser();
          }
        }}
      >
        <span class="tab__glyph" aria-hidden="true">
          <DeckIcon icon={Globe} size={CHROME_ICON} />
        </span>
        <span class="tab__label">
          {browserState.value.title || browserState.value.url || 'Browser'}
        </span>
        <button
          type="button"
          class="tab__close"
          aria-label="Close the browser tab"
          onClick={(event) => {
            event.stopPropagation();
            props.onCloseBrowser();
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div class="tabbar__tabs" role="tablist" aria-label="Open tabs">
        {/* One row, one order (DL-18.6). `slots` speaks two index spaces:
            a `"tab"` index addresses `visibleTabs`, a `"surface"` index
            addresses the SurfaceStrip space `composeSurfaceStrip` publishes —
            every file tab, then the browser slot — so the chip a keyboard
            command activates and the chip painted here are the same one. */}
        {slots.map((slot) => {
          if (slot.kind === 'tab') {
            const entry = visibleTabs[slot.index];
            return entry === undefined ? null : terminalChip(entry.tab, entry.index);
          }
          const fileTab = fileTabs[slot.index];
          return fileTab === undefined ? browserChip() : fileChip(fileTab, slot.index);
        })}
      </div>
      <button
        type="button"
        class="tab-add"
        title={titleWithShortcut('New tab', 'new-tab')}
        aria-label="New tab"
        onClick={props.onNewTab}
      >
        <DeckIcon icon={Plus} size={CHROME_ICON} />
      </button>
    </>
  );
}
