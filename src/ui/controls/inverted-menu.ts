/**
 * The preset inverts its menus: they carry `dark` whatever the mode, on Deck Dark and Deck Light.
 * `.dark` redeclares every preset token on the popup, which would beat the palette a non-default
 * theme publishes inline on the root (`applyThemeVars`), so a menu follows that palette instead.
 * Read while the popup renders, and a popup renders each time it opens.
 */
export function invertedMenuClass(): string {
  return document.documentElement.style.getPropertyValue("--background") === "" ? "dark" : "";
}
