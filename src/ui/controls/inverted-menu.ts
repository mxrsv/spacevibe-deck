/** Shared popup appearance; each control owns its geometry and positioning. */
export const MENU_SURFACE_CLASS =
  "animate-none! relative bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground!";

/**
 * The preset inverts its menus: they carry `dark` whatever the mode, on Deck Dark and Deck Light.
 * `.dark` redeclares every preset token on the popup, which would beat the palette a non-default
 * theme publishes inline on the root (`applyThemeVars`), so a menu follows that palette instead.
 * Call it from the popup's `className` function, which runs on each open because the popup mounts
 * then. The wrapper around the popup does not render on open, so a call there keeps a stale theme.
 */
export function invertedMenuClass(): string {
  return document.documentElement.style.getPropertyValue("--background") === "" ? "dark" : "";
}
