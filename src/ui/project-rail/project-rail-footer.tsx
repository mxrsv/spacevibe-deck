import {
  Browser,
  CaretDown,
  ChartBar,
  ChatText,
  ClockCounterClockwise,
  FolderSimple,
  Gear,
} from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { shortcutCaps } from "../../lib/shortcut-label";
import type { ActionId } from "../../terminal/action-registry";
import { Chord } from "../blocks/chord";
import { Button } from "../controls/button";
import { CHROME_ICON, DeckIcon, ROW_ICON, type DeckIconComponent } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { railToolItems, type SidebarActionsProps } from "../sidebar-actions";
import { isUnavailable, unavailableReason, type ToolbarItem } from "../toolbar/toolbar-item";
import { RailPopupGuard } from "./project-rail-menu-parts";

/** The mock's glyphs; the tools row keeps its own icons for what the mock draws differently. */
const ICON: Readonly<Partial<Record<ActionId, DeckIconComponent>>> = {
  "toggle-settings": Gear,
  "toggle-sessions": ClockCounterClockwise,
  "toggle-explorer": FolderSimple,
  "toggle-prompts": ChatText,
  "toggle-browser": Browser,
  "toggle-usage": ChartBar,
};

/** The Tools menu, in the order LAY-3 lists it. Settings and Session history stand beside it. */
const MENU: readonly ActionId[] = [
  "toggle-explorer",
  "toggle-prompts",
  "toggle-browser",
  "toggle-usage",
];

export interface ProjectRailFooterProps extends SidebarActionsProps {
  /** The agent usage line (`RailAgentLimits`), kept under the buttons as one quiet row. */
  readonly usage?: ComponentChildren;
}

/** An icon button with its name and chord in a tooltip. */
function FooterIconButton({ item, id }: { readonly item: ToolbarItem; readonly id: ActionId }) {
  const caps = shortcutCaps(id);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={item.label} onClick={item.onActivate} />
        }
      >
        <DeckIcon icon={ICON[id] ?? item.icon} size={ROW_ICON} />
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
 * same items (`railToolItems`). The usage line sits under the buttons: the mock drops it
 * (OD-7), the owner's task keeps it.
 *
 * This root is the Prompt Board popover's positioning context (`sidebar-actions__slot`, whose
 * CSS flies the popover up from the foot) and the usage summary's host.
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
    // The root stays outside `.ui-preset`: the Prompt Board popover and the usage line are
    // shipped chrome, and the preset's reset (margins, borders, line height, font) would
    // restyle them. Only the row of controls takes the preset.
    <div className="sidebar-actions__slot relative shrink-0 pb-1.5">
      <div className="ui-preset flex items-center justify-between border-t border-sidebar-border bg-transparent px-2 pt-1.5">
        {settings === undefined ? (
          <span />
        ) : (
          <FooterIconButton item={settings} id="toggle-settings" />
        )}
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
              <DeckIcon icon={CaretDown} size={CHROME_ICON} />
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
                    <DeckIcon icon={ICON[id] ?? item.icon} size={ROW_ICON} />
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
      {usage}
    </div>
  );
}
