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
import { fileIcon } from "../files/ui/file-icons";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { activeWorkspace, fileSurfaces, promoteFileTab } from "../files/file-surface-store";
import { fileTabViews } from "../files/file-tab-views";
import { browserState, browserSurfaceActive } from "../browser/browser-store";
import { agentBoardSurfaceActive } from "./agent-board-store";
import { stageSurfaceDescriptors } from "./stage-surface-strip";
import { repositoryScans } from "../repositories/repositories-store";
import { activeRepositoryTabIndexes } from "../repositories/repository-model";
import { paneTails } from "../terminal/session-tail-store";
import { tabTail } from "./agent-rail-model";
import { TabStripMenu, type StripMenuAction, type StripMenuAnchor } from "./tab-strip-menu";
import { createTabStripDrag } from "./tab-strip-drag";
import { closeChips, closeTargets, type TabCloseTarget } from "./tab-strip-close";

export interface TabStripProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void | Promise<void>;
  /** One existing Busy guard over the union of the targeted terminal panes. */
  onCloseTabs?(indexes: readonly number[]): Promise<boolean>;
  fileController: FileSurfaceController;
  onSelectBrowser(): void;
  onCloseBrowser(): void | Promise<void>;
  onSelectAgentBoard(): void;
  onCloseAgentBoard(): void | Promise<void>;
  scopeToActiveRepository: boolean;
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
          if (index !== active || surfaceActive) props.onSelectTab(index);
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
  const files = fileTabViews(props.fileController);
  const workspace = activeWorkspace.value;
  return stageSurfaceDescriptors(props.fileController).flatMap((surface): Chip[] => {
    if (surface.kind === "file") {
      const tab = files[surface.index];
      if (!tab || !workspace) return [];
      return [
        {
          key: `file-${workspace}-${tab.path}-${surface.openedAt}`,
          openedAt: surface.openedAt,
          label: tab.name,
          closeLabel: `Close ${tab.name}`,
          kind: "file",
          workspace,
          path: tab.path,
          active: tab.active,
          dirty: tab.dirty,
          preview: tab.preview,
          glyph: <DeckIcon icon={fileIcon(tab.name)} size={CHROME_ICON} />,
          select: () => props.fileController.activate(surface.index),
          close: () => props.fileController.closePath(workspace, tab.path),
        },
      ];
    }
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
          if (browser ? !browserSurfaceActive.value : !agentBoardSurfaceActive.value) {
            (browser ? props.onSelectBrowser : props.onSelectAgentBoard)();
          }
        },
        close: browser ? props.onCloseBrowser : props.onCloseAgentBoard,
      },
    ];
  });
}

export function TabStrip(props: TabStripProps) {
  const surfaceActive =
    props.fileController.activeIndex() >= 0 ||
    browserSurfaceActive.value ||
    agentBoardSurfaceActive.value;
  const terminals = terminalChips(props, surfaceActive);
  const surfaces = surfaceChips(props);
  const preferences = stripPreferences.value;
  const chips = mergeStripOrder(terminals, surfaces, preferences).map(
    (slot) => (slot.kind === "tab" ? terminals : surfaces)[slot.index]!,
  );
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
      <div ref={list} class="tabbar__tabs" role="tablist" aria-label="Open tabs">
        {chips.map((chip) => {
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
              class={`tab ${chip.kind === "terminal" ? "" : `tab--${chip.kind}`} ${chip.active ? "is-active" : ""} ${pinned ? "is-pinned" : ""}`}
              title={chip.label}
              onClick={chip.select}
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
          canPin={owner.openedAt > UNSEQUENCED}
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
