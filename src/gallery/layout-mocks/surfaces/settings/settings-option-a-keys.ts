import { HEALTH } from "./settings-setup-data";
import { ROW_INPUT, refocusSearch } from "./settings-option-a-controls";
import {
  activeKey,
  closePanel,
  currentValue,
  expanded,
  openMenu,
  open,
  query,
  recording,
  resetTarget,
  resolveHealth,
  scope,
  setChord,
  setValue,
  togglePanel,
} from "./settings-option-a-state";
import { buildItems, isNavigable, type Item } from "./settings-option-a-view";

const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift"]);
const GLYPH: Readonly<Record<string, string>> = {
  Enter: "↵",
  Tab: "⇥",
  Backspace: "⌫",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Minus: "-",
  Equal: "=",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
};

/** The base key of a chord, read from `code` so Option does not turn a letter into a symbol. */
function keyGlyph(event: KeyboardEvent): string {
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  return GLYPH[event.code] ?? event.key.toUpperCase();
}

function record(event: KeyboardEvent, id: string): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recording.value = null;
    refocusSearch();
    return;
  }
  if (MODIFIERS.has(event.key)) return;
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
  const keys = [
    event.ctrlKey && "⌃",
    event.altKey && "⌥",
    event.metaKey && "⌘",
    event.shiftKey && "⇧",
    keyGlyph(event),
  ].filter((part): part is string => typeof part === "string");
  setChord(id, keys);
  recording.value = null;
  refocusSearch();
}

/** A select or dialog owns Esc and the arrows while it is open. */
function popupOpen(): boolean {
  return (
    document.querySelector('[data-slot="select-content"], [data-slot="dialog-content"]') !== null
  );
}

function isSingleAgent(items: readonly Item[]): boolean {
  return query.value.trim() !== "" && items.filter((item) => item.t === "agent").length === 1;
}

export function enterLabel(item: Item, single: boolean): string {
  switch (item.t) {
    case "setting": {
      const kind = item.setting.control.kind;
      return kind === "switch" ? "Toggle" : kind === "choice" ? "Change" : "Edit";
    }
    case "agent":
      return (expanded.value[item.config.id] ?? single) ? "Collapse" : "Expand";
    case "shortcut":
      return "Record";
    case "area":
      return "Open";
    case "health":
      return item.issue.action;
    case "update":
      return "Restart";
    default:
      return "Reset…";
  }
}

function activate(item: Item, single: boolean): void {
  switch (item.t) {
    case "setting": {
      const { setting } = item;
      const control = setting.control;
      if (control.kind === "switch") setValue(setting, currentValue(setting) !== true);
      else if (control.kind === "choice") {
        if (control.choices.length > 3) openMenu.value = String(setting.key);
        else {
          const at = control.choices.findIndex((choice) => choice.value === currentValue(setting));
          setValue(setting, control.choices[(at + 1) % control.choices.length].value);
        }
      } else {
        document.querySelector<HTMLElement>(`[${ROW_INPUT}="${setting.key}"]`)?.focus();
      }
      return;
    }
    case "agent": {
      const id = item.config.id;
      expanded.value = { ...expanded.value, [id]: !(expanded.value[id] ?? single) };
      return;
    }
    case "shortcut":
      recording.value = item.shortcut.id;
      return;
    case "area":
      scope.value = item.area;
      query.value = "";
      return;
    case "health":
      resolveHealth(item.issue);
      return;
    case "update": {
      const issue = HEALTH.find((entry) => entry.id === "update");
      if (issue) resolveHealth(issue);
      return;
    }
    case "reset":
      resetTarget.value = item.id;
      return;
    default:
  }
}

/** One capture-phase listener: ⌘, always, everything else only while the panel is open. */
export function handleKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
    return;
  }
  if (!open.value) return;
  if (recording.value) {
    record(event, recording.value);
    return;
  }
  if (popupOpen()) return;

  const target = event.target as HTMLElement;
  const inSearch = target.id === "a-search";
  const typing = target.tagName === "INPUT" && !inSearch;
  const free = inSearch || target === document.body || target.getAttribute("role") === "switch";
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (event.key === "Escape") {
    handled();
    if (typing) refocusSearch();
    else if (query.value !== "") query.value = "";
    else if (scope.value !== null) scope.value = null;
    else closePanel();
    return;
  }
  if (typing) {
    if (event.key === "Enter") {
      handled();
      refocusSearch();
    }
    return;
  }
  if (!free) return;

  const items = buildItems(query.value, scope.value);
  const navs = items.filter(isNavigable);
  const at = Math.max(
    0,
    navs.findIndex((item) => item.key === activeKey.value),
  );
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    handled();
    const next =
      navs[Math.min(navs.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) activeKey.value = next.key;
  } else if (event.key === "Enter" && (inSearch || target === document.body)) {
    handled();
    const item = navs[at];
    if (item) activate(item, isSingleAgent(items));
  } else if (event.key === "Backspace" && inSearch && query.value === "" && scope.value) {
    handled();
    scope.value = null;
  }
}
