import { h, render } from "preact";
import { ChevronLeft, ChevronRight, X, type LucideIcon } from "lucide-preact";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import type { ISearchOptions } from "@xterm/addon-search";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import type { Pane, SelectionSnapshot } from "./pane";
import { matchBinding } from "./keymap";

/** "resultIndex/resultCount" for the bar counter; "0/0" when empty. */
export function formatMatchCount(
  resultIndex: number,
  resultCount: number,
): string {
  if (resultCount === 0) {
    return "0/0";
  }
  // The addon reports -1 when the active match is not tracked (e.g. beyond
  // its highlight limit) — show only the total instead of a bogus "0/N".
  return resultIndex < 0
    ? `${resultCount}`
    : `${resultIndex + 1}/${resultCount}`;
}

interface OpenBar {
  readonly pane: Pane;
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly disposeResults: () => void;
}

// One search bar at a time across all panes and tabs.
let current: OpenBar | null = null;

/**
 * Last non-empty term actually searched — survives `closeSearchBar()` so
 * the platform find-next/find-previous chords (`advanceSearch` below) can
 * repeat it once the bar itself is gone.
 * Deliberately ONE app-wide string, not keyed by pane id: the bar is already
 * a single global instance (`current` above), and CONTEXT.md's "Search…
 * scoped to one pane at a time" describes which pane a term is applied
 * against, not which pane it was typed on. Because it is a plain string with
 * no pane reference, `closeSearchBarForPane` (a pane dying mid-search) never
 * needs to touch it — there is nothing pane-specific here to leak.
 */
let lastQuery: string | null = null;

function searchOptions(incremental: boolean): ISearchOptions {
  const theme = resolveTheme(settings.value);
  const match = theme.selectionBackground ?? "#33467c";
  const activeMatch = theme.yellow ?? "#e0af68";
  return {
    incremental,
    decorations: {
      matchBackground: match,
      activeMatchBackground: activeMatch,
      // Painted on the overview ruler (pane sets overviewRuler.width).
      matchOverviewRuler: match,
      activeMatchColorOverviewRuler: activeMatch,
    },
  };
}

function positionBefore(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.row < b.row || (a.row === b.row && a.col < b.col);
}

/**
 * Pick which normalization's hit is the real next/previous match.
 *
 * A wrapped findNext lands at/before the origin; a wrapped findPrevious lands
 * at/after it. Prefer a non-wrapped hit, then the earlier (next) or later
 * (previous) of the two.
 */
export function pickNormalizationWinner(
  direction: "next" | "previous",
  origin: SelectionSnapshot | null,
  nfcSel: SelectionSnapshot,
  nfdSel: SelectionSnapshot,
): "nfc" | "nfd" {
  if (origin === null) {
    if (direction === "next") {
      return positionBefore(nfcSel, nfdSel) ? "nfc" : "nfd";
    }
    return positionBefore(nfcSel, nfdSel) ? "nfd" : "nfc";
  }

  if (direction === "next") {
    const nfcWrapped = !positionBefore(origin, nfcSel);
    const nfdWrapped = !positionBefore(origin, nfdSel);
    if (nfcWrapped !== nfdWrapped) {
      return nfcWrapped ? "nfd" : "nfc";
    }
    return positionBefore(nfcSel, nfdSel) ? "nfc" : "nfd";
  }

  const nfcWrapped = !positionBefore(nfcSel, origin);
  const nfdWrapped = !positionBefore(nfdSel, origin);
  if (nfcWrapped !== nfdWrapped) {
    return nfcWrapped ? "nfd" : "nfc";
  }
  return positionBefore(nfcSel, nfdSel) ? "nfd" : "nfc";
}

/**
 * Run find against both Unicode normalizations of the term.
 *
 * Neither side can be normalized on its own: an IME types Vietnamese as NFD
 * while most program output is NFC, but macOS hands back filenames in NFD —
 * and the addon searches the raw buffer, which we cannot normalize. Probe both
 * forms from the same selection origin (a failed probe clears selection, so we
 * restore), then keep the nearer hit so mixed NFC/NFD buffers stay reachable.
 */
function findNormalized(
  pane: Pane,
  direction: "next" | "previous",
  value: string,
  options: ISearchOptions,
): boolean {
  const find =
    direction === "next"
      ? (term: string, opts: ISearchOptions) => pane.search.findNext(term, opts)
      : (term: string, opts: ISearchOptions) =>
          pane.search.findPrevious(term, opts);

  const nfc = value.normalize("NFC");
  const nfd = value.normalize("NFD");
  if (nfd === nfc) {
    return find(nfc, options);
  }

  const origin = pane.captureSelection();

  const nfcHit = find(nfc, options);
  const nfcSel = nfcHit ? pane.captureSelection() : null;

  pane.restoreSelection(origin);
  const nfdHit = find(nfd, options);
  const nfdSel = nfdHit ? pane.captureSelection() : null;

  if (!nfcHit && !nfdHit) {
    return false;
  }
  if (nfcHit && !nfdHit) {
    // NFD miss cleared selection — re-apply the NFC hit for decorations.
    pane.restoreSelection(origin);
    return find(nfc, options);
  }
  if (!nfcHit && nfdHit) {
    return true;
  }

  const winner = pickNormalizationWinner(direction, origin, nfcSel!, nfdSel!);
  pane.restoreSelection(origin);
  return find(winner === "nfc" ? nfc : nfd, options);
}

/**
 * The bar is imperative DOM, but its icons come from the same `DeckIcon` as
 * every other surface — rendered into the button with Preact rather than by
 * copying path data into a second icon path (DL-14.1). The name is set
 * explicitly: an aria-hidden icon leaves nothing for the accessible name to
 * fall back to except the tooltip.
 */
function barButton(
  icon: LucideIcon,
  name: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-bar__btn";
  button.setAttribute("aria-label", name);
  render(h(DeckIcon, { icon, size: ROW_ICON }), button);
  button.title = title;
  // Keep the input focused while clicking the bar's buttons
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);
  return button;
}

/** Open (or refocus) the bar on `pane`; any bar on another pane closes. */
export function openSearchBar(pane: Pane): void {
  if (current?.pane.id === pane.id) {
    current.input.focus();
    current.input.select();
    return;
  }
  closeSearchBar();

  const element = document.createElement("div");
  element.className = "search-bar";
  const input = document.createElement("input");
  input.className = "search-bar__input";
  input.type = "text";
  input.placeholder = "Find";
  input.spellcheck = false;
  const counter = document.createElement("span");
  counter.className = "search-bar__count";

  const findNext = (): void => {
    if (input.value !== "") {
      findNormalized(pane, "next", input.value, searchOptions(false));
    }
  };
  const findPrevious = (): void => {
    if (input.value !== "") {
      findNormalized(pane, "previous", input.value, searchOptions(false));
    }
  };

  element.append(
    input,
    counter,
    barButton(ChevronLeft, "Previous match", "Previous match (⇧↩)", findPrevious),
    barButton(ChevronRight, "Next match", "Next match (↩)", findNext),
    barButton(X, "Close", "Close (Esc)", closeSearchBar),
  );

  const results = pane.search.onDidChangeResults(
    ({ resultIndex, resultCount }) => {
      counter.textContent = formatMatchCount(resultIndex, resultCount);
    },
  );

  input.addEventListener("input", () => {
    if (input.value === "") {
      pane.search.clearDecorations();
      counter.textContent = "";
      return;
    }
    // Remembered for platform repeat-search chords after the bar closes.
    lastQuery = input.value;
    // Incremental: the current selection expands instead of jumping ahead
    findNormalized(pane, "next", input.value, searchOptions(true));
  });

  // The global shortcut handler skips inputs outside .pane__term, so the
  // bar handles its own keys. Platform bindings still resolve through the
  // shared matcher so local and global search behavior cannot drift.
  element.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchBar();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      findPrevious();
    } else if (event.key === "Enter") {
      event.preventDefault();
      findNext();
    } else {
      const action = matchBinding(event);
      if (action === "find-next") {
        event.preventDefault();
        findNext();
      } else if (action === "find-previous") {
        event.preventDefault();
        findPrevious();
      } else if (action === "find") {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }
  });

  pane.element.appendChild(element);
    const buttons = Array.from(element.querySelectorAll("button"));
  current = {
    pane,
    element,
    input,
    disposeResults: () => {
      results.dispose();
      // Preact keeps a root per container; dropping the bar's DOM without
      // unmounting would leave those roots pointing at detached nodes.
      for (const button of buttons) {
        render(null, button);
      }
    },
  };
  input.focus();
}

/** Close the bar, clear highlights, refocus the terminal. */
export function closeSearchBar(): void {
  if (current === null) {
    return;
  }
  const { pane, element, disposeResults } = current;
  current = null;
  disposeResults();
  pane.search.clearDecorations();
  element.remove();
  pane.focus();
}

/** Drop the bar when its pane is being disposed — no decoration/focus calls. */
export function closeSearchBarForPane(paneId: number): void {
  if (current?.pane.id !== paneId) {
    return;
  }
  const { element, disposeResults } = current;
  current = null;
  disposeResults();
  element.remove();
}

/**
 * Advance the match on `pane` (the app's currently active pane,
 * which may or may not be the one a bar is open on).
 *
 *  - Bar open ON `pane`: behaves exactly like pressing Enter/⇧Enter in it —
 *    uses the bar's own live `input.value`, so an empty input is a no-op,
 *    same as the bar's own Enter handling.
 *  - Bar closed, or open on a DIFFERENT pane: falls back to `lastQuery` and
 *    searches `pane` directly. This is deliberately silent (decorations
 *    highlight the match in the terminal; no bar/counter appears) — the
 *    iTerm2/vim `n`/`N` model, not "reopen the bar with the old query": the
 *    whole reason to repeat a search after Escape is that the bar is already out of
 *    the way and should stay that way. No query has ever been run → safe
 *    no-op (nothing to repeat).
 */
export function advanceSearch(
  pane: Pane,
  direction: "next" | "previous",
): void {
  const openOnThisPane = current !== null && current.pane.id === pane.id;
  const query = openOnThisPane ? current!.input.value : (lastQuery ?? "");
  if (query === "") {
    return;
  }
  findNormalized(pane, direction, query, searchOptions(false));
}
