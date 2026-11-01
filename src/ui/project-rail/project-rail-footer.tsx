import {
  ArrowDown01Icon,
  BrowserIcon,
  ChartHistogramIcon,
  Clock01Icon,
  Folder01Icon,
  Message01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { shortcutCaps } from "../../lib/shortcut-label";
import type { ActionId } from "../../terminal/action-registry";
import { Chord } from "../blocks/chord";
import { Button } from "../controls/button";
import { DeckIcon, type DeckGlyph } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { AgentUsageViewContext } from "../usage/agent-usage-summary";
import { railToolItems, type SidebarActionsProps } from "../sidebar-actions";
import { isUnavailable, unavailableReason, type ToolbarItem } from "../toolbar/toolbar-item";
import { RailPopupGuard } from "./project-rail-menu-parts";
import { ProjectRailUsageRings } from "./project-rail-usage-rings";

/** The mock's glyphs; the tools row keeps its own icons for what the mock draws differently. */
const ICON = {
  "toggle-settings": Settings02Icon,
  "toggle-sessions": Clock01Icon,
  "toggle-explorer": Folder01Icon,
  "toggle-prompts": Message01Icon,
  "toggle-browser": BrowserIcon,
  "toggle-usage": ChartHistogramIcon,
} as const satisfies Readonly<Partial<Record<ActionId, DeckGlyph>>>;

/** An action the foot draws a glyph for; the rest of the registry has none here. */
type FooterId = keyof typeof ICON;

/** The Tools menu, in the order LAY-3 lists it. Settings and Session history stand beside it. */
const MENU: readonly FooterId[] = [
  "toggle-explorer",
  "toggle-prompts",
  "toggle-browser",
  "toggle-usage",
];

export interface ProjectRailFooterProps extends SidebarActionsProps {
  /** The agent usage summary (`RailAgentLimits`); the foot draws it as one ring per agent. */
  readonly usage?: ComponentChildren;
}

/** An icon button with its name and chord in a tooltip. */
function FooterIconButton({ item, id }: { readonly item: ToolbarItem; readonly id: FooterId }) {
  const caps = shortcutCaps(id);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={item.label} onClick={item.onActivate} />
        }
      >
        <DeckIcon icon={ICON[id]} />
      </TooltipTrigger>
      <TooltipContent>
        {item.label}
        {caps === null ? null : <Chord keys={caps} />}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The project rail's foot (LAY-3): Settings on the left, Session history and a Tools menu on
 * the right. Every button runs the callback the shipped tools row (`SidebarActions`) runs, so
 * a surface opens exactly as it does there; labels, chords and availability come from the
 * same items (`railToolItems`). The usage summary sits between them as one ring per agent
 * (owner 2026-11-01: progress over words); the mock drops the usage line (OD-7), the owner's
 * task keeps it.
 *
 * This root is the Prompt Board popover's positioning context (`sidebar-actions__slot`, whose
 * CSS flies the popover up from the foot).
 */
export function ProjectRailFooter({ usage, ...tools }: ProjectRailFooterProps) {
  const items = new Map(railToolItems(tools).map((item) => [item.id, item]));
  const settings = items.get("toggle-settings");
  const sessions = items.get("toggle-sessions");
  const menu = MENU.flatMap((id) => {
    const item = items.get(id);
    return item === undefined ? [] : [{ id, item }];
  });
  // Set when a row is chosen: the surface it opened keeps the keyboard, so the menu does not
  // hand focus back to its button. Escape and an outside press still do.
  const chosen = useRef(false);
  return (
    // The root stays outside `.ui-preset`: the Prompt Board popover is shipped chrome, and the
    // preset's reset (margins, borders, line height, font) would restyle it. The row of
    // controls takes the preset, and the rings sit in that row so their `text-*` utilities
    // resolve.
    <div className="sidebar-actions__slot relative shrink-0 pb-1.5">
      <div className="ui-preset flex items-center justify-between border-t border-sidebar-border bg-transparent px-2 pt-1.5">
        {settings === undefined ? (
          <span />
        ) : (
          <FooterIconButton item={settings} id="toggle-settings" />
        )}
        <AgentUsageViewContext.Provider value={ProjectRailUsageRings}>
          {usage}
        </AgentUsageViewContext.Provider>
        <div className="flex items-center gap-1">
          {sessions === undefined ? null : (
            <FooterIconButton item={sessions} id="toggle-sessions" />
          )}
          <DropdownMenu
            onOpenChange={(open: boolean) => {
              if (open) {
                chosen.current = false;
              }
            }}
          >
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
              Tools
              <DeckIcon icon={ArrowDown01Icon} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="min-w-52"
              finalFocus={() => !chosen.current}
            >
              <RailPopupGuard />
              {menu.map(({ id, item }) => {
                const reason = unavailableReason(item);
                return (
                  <DropdownMenuItem
                    key={id}
                    disabled={isUnavailable(item)}
                    onClick={() => {
                      chosen.current = true;
                      item.onActivate();
                    }}
                  >
                    <DeckIcon icon={ICON[id]} />
                    {item.label}
                    <DropdownMenuShortcut>{reason ?? item.shortcut}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {tools.promptsOpen ? tools.promptPopover : null}
    </div>
  );
}
