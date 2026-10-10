/** One strip for every surface. Async actions resolve targets by identity;
 * display positions never replace the indexes owned by TabManager/files. */
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Globe, PushPin, SquaresFour, TerminalWindow, X } from "@phosphor-icons/react";
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import { UNSEQUENCED } from "../lib/open-sequence";
import {
  mergeStripOrder,
  moveStripTab,
  setStripPinned,
  stripPreferences,
} from "../lib/strip-order";
import { AgentGlyph } from "./controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { activeWorkspace, fileSurfaces, promoteFileTab } from "../files/file-surface-store";
import { browserState, browserSurfaceActive } from "../browser/browser-store";
import { agentBoardSurfaceActive } from "./agent-board-store";
import { stageSurfaceDescriptors } from "./stage-surface-strip";
import { repositoryScans } from "../repositories/repositories-store";
import { activeRepositoryTabIndexes } from "../repositories/repository-model";
import { paneTails } from "../terminal/session-tail-store";
import { tabTail } from "./agent-rail-model";
import { sessionTitlesFor } from "./agent-rail-card-model";
import { sessionEntries } from "../sessions/sessions-store";
import { TabStripMenu, type StripMenuAction, type StripMenuAnchor } from "./tab-strip-menu";
import { createTabStripDrag } from "./tab-strip-drag";
import { closeChips, closeTargets, type TabCloseTarget } from "./tab-strip-close";
import { SpaceBar } from "./spaces/space-bar";
import { buildSpaces, type Space } from "./spaces/space-model";
import { currentSpaceLayout } from "./spaces/space-order";

export interface TabStripProps {
  transientPageOpen?: boolean;
  onBeforeSelect?: () => void;
  onSelectTab(index: number): void;
  /** Name (or, with `null`, unname) the space at this owner index. */
  onRenameTab?(index: number, name: string | null): void;
  onCloseTab(index: number): void | Promise<void>;
  /** One existing Busy guard over the union of the targeted terminal panes. */
  onCloseTabs?(indexes: readonly number[]): Promise<boolean>;
  fileController: FileSurfaceController;
  onSelectBrowser(): void;
  onCloseBrowser(): void | Promise<void>;
  onSelectAgentBoard(): void;
  onCloseAgentBoard(): void | Promise<void>;
  scopeToActiveRepository: boolean;
  /** Drop the space marks, for a layout whose rail already lists the spaces.
   * Top-tab mode has no rail, so its marks are the only terminal tabs. */
  hideMarks?: boolean;
}

interface Chip {
  readonly key: string;
  readonly openedAt: number;
  readonly label: string;
  readonly closeLabel: string;
  readonly kind: "terminal" | "file" | "browser" | "agent-board";
  readonly active: boolean;
  readonly glyph: ComponentChildren;
  readonly dirty?: boolean;
  readonly preview?: boolean;
  readonly terminalKey?: number;
  readonly workspace?: string;
  readonly path?: string;
  readonly select: () => void;
  readonly close: () => void | Promise<void>;
}

function terminalChips(props: TabStripProps, surfaceActive: boolean): readonly Chip[] {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const indexes = props.scopeToActiveRepository
    ? activeRepositoryTabIndexes(tabs, active, repositoryScans.value)
    : tabs.map((_, index) => index);
  return indexes.flatMap((index) => {
    const tab = tabs[index];
    if (!tab) return [];
    const tail = tabTail(tab, paneTails.value);
    const agent = tab.agents.find((item) => item === tab.process) ?? tab.agents[0];
    return [
      {
        key: `tab-${tab.key}`,
        openedAt: tab.openedAt ?? UNSEQUENCED,
        label: tab.name ?? (tail || tab.process || "shell"),
        closeLabel: "Close tab",
        kind: "terminal" as const,
        terminalKey: tab.key,
        active: index === active && !surfaceActive,
        glyph: agent ? (
          <AgentGlyph agent={agent} className="tab__logo" />
        ) : (
          <DeckIcon icon={TerminalWindow} size={CHROME_ICON} />
        ),
        select: () => {
          if (
            index !== active ||
            surfaceActive ||
            props.fileController.activeIndex() >= 0 ||
            props.transientPageOpen
          )
            props.onSelectTab(index);
        },
        close: () => {
          const current = tabViews.value.findIndex((item) => item.key === tab.key);
          if (current >= 0) return props.onCloseTab(current);
        },
      },
    ];
  });
}

function surfaceChips(props: TabStripProps): readonly Chip[] {
  return stageSurfaceDescriptors().flatMap((surface): Chip[] => {
    const browser = surface.kind === "browser";
    return [
      {
        key: `${surface.kind}-${surface.openedAt}`,
        openedAt: surface.openedAt,
        label: browser ? browserState.value.title || browserState.value.url || "Browser" : "Agents",
        closeLabel: browser ? "Close the browser tab" : "Close the agent board tab",
        kind: surface.kind,
        active: browser ? browserSurfaceActive.value : agentBoardSurfaceActive.value,
        glyph: <DeckIcon icon={browser ? Globe : SquaresFour} size={CHROME_ICON} />,
        select: () => {
          if (
            props.transientPageOpen ||
            (browser ? !browserSurfaceActive.value : !agentBoardSurfaceActive.value)
          ) {
            (browser ? props.onSelectBrowser : props.onSelectAgentBoard)();
          }
        },
        close: browser ? props.onCloseBrowser : props.onCloseAgentBoard,
      },
    ];
  });
}

export function TabStrip(props: TabStripProps) {
  const surfaceActive = browserSurfaceActive.value || agentBoardSurfaceActive.value;
  const terminals = terminalChips(props, surfaceActive);
  const surfaces = surfaceChips(props);
  const preferences = stripPreferences.value;
  // DL-35.3: every terminal tab first, as a space mark in the RAIL's order
  // (owner, 2026-09-29 — a mark sits where its tab sits in the sidebar and
  // never moves because something else opened), then the documents and the
  // browser as chips in the strip's merged order, so a pinned or dragged
  // surface keeps its place among surfaces. `TabManager.stripSlots` reads the
  // same `currentSpaceLayout`, so ⌘1–9 counts what is drawn.
  const merged = mergeStripOrder(terminals, surfaces, preferences).map(
    (slot) => (slot.kind === "tab" ? terminals : surfaces)[slot.index]!,
  );
  const layout = currentSpaceLayout();
  const rank = new Map<number, number>(
    layout.order.flatMap((index, position) => {
      const key = tabViews.value[index]?.key;
      return key === undefined ? [] : [[key, position] as const];
    }),
  );
  const railRank = (chip: Chip): number =>
    rank.get(chip.terminalKey ?? -1) ?? Number.MAX_SAFE_INTEGER;
  const chips = [
    ...[...merged.filter((chip) => chip.kind === "terminal")].sort(
      (left, right) => railRank(left) - railRank(right),
    ),
    ...merged.filter((chip) => chip.kind !== "terminal"),
  ];
  const spaces = buildSpaces({
    tabs: tabViews.value,
    order: chips.flatMap((chip) =>
      chip.kind === "terminal"
        ? [tabViews.value.findIndex((tab) => tab.key === chip.terminalKey)]
        : [],
    ),
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
    groups: layout.groups,
    // The breadcrumb's session crumb reads the rail's first prompts (DL-27.28).
    titles: sessionTitlesFor(tabViews.value, sessionEntries.value),
  });
  const chipFor = (space: Space): Chip | undefined =>
    chips.find((chip) => chip.kind === "terminal" && chip.terminalKey === space.key);
  const [menu, setMenu] = useState<StripMenuAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const latest = useRef(chips);
  latest.current = chips;
  const owner = chips.find((chip) => chip.key === menu?.key);
  const scope = props.scopeToActiveRepository ? activeWorkspace.value : null;

  useLayoutEffect(() => {
    setMenu(null);
  }, [scope]);
  useLayoutEffect(() => {
    if (menu && !owner) setMenu(null);
  }, [menu, owner]);
  useEffect(() => {
    if (!list.current) return;
    return createTabStripDrag(list.current, {
      onStart: () => setMenu(null),
      onDrop: (source, before) => {
        const all = [
          ...tabViews.value.map((tab) => tab.openedAt ?? UNSEQUENCED),
          ...[...fileSurfaces.value.values()].flatMap((surface) =>
            surface.tabs.map((tab) => tab.openedAt),
          ),
          ...latest.current.map((chip) => chip.openedAt),
        ];
        moveStripTab(
          source,
          before,
          latest.current.map((chip) => chip.openedAt),
          all,
        );
      },
    });
  }, []);

  const close = (targets: readonly TabCloseTarget[], bulk = false): void => {
    if (closing.current) return;
    closing.current = true;
    setError(null);
    void closeChips(targets, props, bulk)
      .catch((cause: unknown) => {
        console.error("[tab-strip] Close failed", cause);
        setError("Could not close the selected tabs. Please try again.");
      })
      .finally(() => {
        closing.current = false;
      });
  };
  const openMenu = (chip: Chip, trigger: HTMLElement, x: number, y: number): void => {
    setMenu({ key: chip.key, trigger, rect: { left: x, right: x, top: y, bottom: y } });
  };
  const actOnMenu = (action: StripMenuAction): void => {
    if (!owner) return;
    setMenu(null);
    if (action !== "pin") {
      close(closeTargets(chips, owner.key, action), action !== "close");
      return;
    }
    const pinned = preferences.pinned.includes(owner.openedAt);
    if (!pinned && owner.workspace && owner.path) promoteFileTab(owner.workspace, owner.path);
    setStripPinned(owner.openedAt, !pinned);
  };

  return (
    <>
      {spaces.length > 0 && (
        <SpaceBar
          spaces={spaces}
          hideMarks={props.hideMarks}
          menuKey={owner?.kind === "terminal" ? (owner.terminalKey ?? null) : null}
          onGo={(space) => {
            props.onBeforeSelect?.();
            chipFor(space)?.select();
          }}
          onMenu={(space, trigger, x, y) => {
            const chip = chipFor(space);
            if (chip) openMenu(chip, trigger, x, y);
          }}
          onRename={(space, name) => props.onRenameTab?.(space.tabIndex, name)}
        />
      )}
      <div ref={list} class="tabbar__tabs" role="tablist" aria-label="Open tabs">
        {chips.flatMap((chip) => {
          if (chip.kind === "terminal") return [];
          const pinned = preferences.pinned.includes(chip.openedAt);
          return (
            <div
              key={chip.key}
              role="tab"
              aria-selected={chip.active}
              tabIndex={0}
              aria-label={pinned ? `${chip.label}, pinned` : chip.label}
              aria-haspopup="menu"
              aria-expanded={menu?.key === chip.key}
              data-strip-key={chip.openedAt}
              data-pinned={String(pinned)}
              class={`tab tab--${chip.kind} ${chip.active ? "is-active" : ""} ${pinned ? "is-pinned" : ""}`}
              title={chip.label}
              onClick={() => {
                props.onBeforeSelect?.();
                chip.select();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openMenu(chip, event.currentTarget, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(chip, event.currentTarget, rect.left, rect.bottom);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onBeforeSelect?.();
                  chip.select();
                }
              }}
            >
              <span class="tab__glyph">{chip.glyph}</span>
              <span class={`tab__label ${chip.preview ? "tab__label--preview" : ""}`}>
                {chip.label}
              </span>
              {chip.dirty && <span class="tab__dot tab__dot--dirty" aria-hidden="true" />}
              {pinned ? (
                <span class="tab__pin" aria-hidden="true">
                  <DeckIcon icon={PushPin} size={CHROME_ICON} />
                </span>
              ) : (
                <button
                  type="button"
                  class="tab__close"
                  aria-label={chip.closeLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    close([chip]);
                  }}
                >
                  <DeckIcon icon={X} size={CHROME_ICON} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && owner && (
        <TabStripMenu
          key={menu.key}
          anchor={menu}
          label={owner.label}
          pinned={preferences.pinned.includes(owner.openedAt)}
          // DL-35.3: a space mark is not pinned; its place is the strip's
          // order. An earlier pin can still be taken off.
          canPin={
            owner.openedAt > UNSEQUENCED &&
            (owner.kind !== "terminal" || preferences.pinned.includes(owner.openedAt))
          }
          canCloseOthers={closeTargets(chips, owner.key, "others").length > 0}
          canCloseRight={closeTargets(chips, owner.key, "right").length > 0}
          onAction={actOnMenu}
          onClose={() => setMenu(null)}
        />
      )}
      {error && (
        <span role="alert" class="tab-strip-error">
          {error}
        </span>
      )}
    </>
  );
}
