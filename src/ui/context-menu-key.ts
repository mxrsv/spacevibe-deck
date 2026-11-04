/** The keyboard's way to a right-click menu: the Menu key, or Shift+F10 where there is none. */
export function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}
