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
