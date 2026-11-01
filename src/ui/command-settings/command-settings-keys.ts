import {
  activeKeyIn,
  isNavigable,
  moveActive,
  type CommandItem,
} from "../../settings/command-hits";
import { focusableItems, trapTab } from "../focus-trap";
import { chooseArea, openItem } from "./command-settings-actions";
import { isLiveHit, LIVE_ROW_ATTRIBUTE, rowDomId } from "./command-settings-live";
import { commandActiveKey, commandQuery, commandScope } from "./command-settings-state";

/*
 * One keydown decision for the whole surface, on `window` in the BUBBLE phase.
 * That phase is the point: a field with an uncommitted draft stops its own
 * Escape (`commit-input.tsx`) and the shortcut recorder stops every key in the
 * capture phase, so what reaches this function is a key nothing inside claimed.
 * A capture listener here would run first and close or clear over a live draft.
 */

const KEYS = new Set(["Escape", "Tab", "ArrowUp", "ArrowDown", "Enter", "Backspace"]);

/** Popups a control portals out of the surface; each owns Escape and the arrows while it is up. */
const POPUPS = [
  '[data-slot="select-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dialog-content"]',
].join(", ");

/** A closed Select keeps its popup in the document, hidden. */
function popupOpen(): boolean {
  return [...document.querySelectorAll(POPUPS)].some((popup) => popup.closest("[hidden]") === null);
}

function isField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export interface CommandKeyContext {
  readonly root: HTMLElement | null;
  readonly search: HTMLInputElement | null;
  /** The list as drawn, so the arrows walk what the user sees. */
  readonly items: readonly CommandItem[];
  readonly onClose: () => void;
}

/** Focus inside a live row's control: a switch, a menu trigger, a segment or a field. */
function inLiveRow(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${LIVE_ROW_ATTRIBUTE}]`) !== null;
}

/** Escape: a control hands focus back to the search, then the query, the area, the surface. */
function escape(event: KeyboardEvent, context: CommandKeyContext): void {
  const { search } = context;
  const target = event.target;
  event.preventDefault();
  if ((isField(target) && target !== search) || inLiveRow(target)) {
    // Blur first: a text field commits its draft on blur, so leaving never drops what was typed.
    // An UNCOMMITTED draft never gets here; the field reverts it and stops the event. Without
    // this step the ladder below would clear the query or leave the area under a focused
    // control, unmount the row, and strand focus on the body.
    if (target instanceof HTMLElement) target.blur();
    search?.focus({ preventScroll: true });
    return;
  }
  if (commandQuery.peek() !== "") {
    commandQuery.value = "";
    return;
  }
  if (commandScope.peek() !== null) {
    chooseArea(null);
    search?.focus({ preventScroll: true });
    return;
  }
  if (target instanceof HTMLElement) {
    target.blur();
  }
  context.onClose();
}

export function handleCommandKey(event: KeyboardEvent, context: CommandKeyContext): void {
  // Key first, then the DOM walk: this fires for every keystroke typed into a field here.
  if (!KEYS.has(event.key)) {
    return;
  }
  const target = event.target;
  // A terminal owns its own Escape (vim, fzf). Guard the type: keydown can target a non-Element.
  if (target instanceof Element && target.closest(".xterm")) {
    return;
  }
  // A menu portals out of the surface and owns Tab, Escape and the arrows while it is open.
  if (popupOpen()) {
    return;
  }
  if (event.key === "Tab") {
    trapTab(event, context.root);
    return;
  }
  if (event.key === "Escape") {
    escape(event, context);
    return;
  }
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  // The arrows, Enter and Backspace belong to the list only while the search field (or
  // nothing) has focus; inside a section's own control they mean what that control says.
  const { search, items } = context;
  if (target !== search && target !== document.body) {
    return;
  }
  const active = commandActiveKey.peek();
  if (event.key === "Backspace") {
    if (target === search && commandQuery.peek() === "" && commandScope.peek() !== null) {
      event.preventDefault();
      chooseArea(null);
    }
    return;
  }
  // No row to walk (an area's section): leave the key to scroll or edit.
  if (!items.some(isNavigable)) {
    return;
  }
  if (event.key === "Enter") {
    const key = activeKeyIn(items, active);
    const item = items.find((entry) => entry.key === key);
    if (item !== undefined) {
      event.preventDefault();
      // Enter on a live row goes into its control and never changes the value itself.
      if (item.type === "hit" && isLiveHit(item.hit)) {
        const row = document.getElementById(rowDomId(item.key));
        if (row !== null) focusableItems(row)[0]?.focus();
      } else {
        openItem(item);
      }
    }
    return;
  }
  event.preventDefault();
  commandActiveKey.value = moveActive(items, active, event.key === "ArrowDown" ? 1 : -1);
}
