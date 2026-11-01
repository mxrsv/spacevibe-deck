import type { Icon } from "@phosphor-icons/react";
import type { ComponentChildren, JSX } from "preact";
import { agentLaunchPage } from "../../launcher/agent-launch-page-store";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { DropdownMenuItem } from "../controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { useStageOverlayFlag } from "../worktree-card-menus";

/** Hover actions show on hover, keyboard focus or while their menu is open; they never take room. */
export const REVEAL =
  "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

/**
 * A project header's version: keyboard focus, not any focus. A press on the header focuses it
 * for good, and the folded count and mark must stay readable once the pointer has moved off.
 */
export const REVEAL_HEADER =
  "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-has-[:focus-visible]/item:pointer-events-auto group-has-[:focus-visible]/item:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

/** An icon button's tooltip: `button` is the trigger element, `children` its glyph. */
export function Tip({
  label,
  button,
  children,
}: {
  readonly label: string;
  readonly button: JSX.Element;
  readonly children: ComponentChildren;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A menu item that leads with its icon. */
export function MenuEntry({
  icon,
  onClick,
  disabled,
  variant,
  children,
}: {
  readonly icon: Icon;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly variant?: "destructive";
  readonly children: ComponentChildren;
}) {
  return (
    <DropdownMenuItem onClick={onClick} disabled={disabled} variant={variant}>
      <DeckIcon icon={icon} size={ROW_ICON} />
      {children}
    </DropdownMenuItem>
  );
}

/**
 * Mount inside a surface that covers the stage (a dialog): the native browser view paints over
 * any DOM, so it must hide while one is up, and Esc must reach the surface, not the launch page.
 */
export function StageCover() {
  useStageOverlayFlag();
  return null;
}

/**
 * Mount inside a rail popup's content. While the agent launch page is up, the shortcut handler
 * would close it on Esc before the popup saw the key; the shipped rail menus raise
 * `railCardMenuOpen` for exactly this (`agentLaunchPageIsTop`), and so does an open popup here.
 * Only while the page is up: these popups sit inside the rail, so hiding the native browser
 * under them, the flag's other job, is not needed.
 */
export function RailPopupGuard() {
  return agentLaunchPage.request.value === null ? null : <StageCover />;
}
