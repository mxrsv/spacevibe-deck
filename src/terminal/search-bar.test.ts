// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceSearch,
  formatMatchCount,
  openSearchBar,
  closeSearchBar,
  closeSearchBarForPane,
  pickNormalizationWinner,
} from "./search-bar";
import type { Pane, SelectionSnapshot } from "./pane";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";

vi.mock("../settings/settings-store", () => ({
  settings: {
    value: {
      themeId: "tokyo-night",
      colorOverrides: {},
    },
  },
}));

vi.mock("../settings/themes", () => ({
  resolveTheme: () => ({
    selectionBackground: "#33467c",
    yellow: "#e0af68",
  }),
}));

describe("formatMatchCount", () => {
  it("formats 1-based index over count", () => {
    expect(formatMatchCount(2, 17)).toBe("3/17");
    expect(formatMatchCount(0, 1)).toBe("1/1");
  });

  it("shows 0/0 when there are no matches", () => {
    expect(formatMatchCount(-1, 0)).toBe("0/0");
  });

  it("shows only the total when the active match is untracked", () => {
    expect(formatMatchCount(-1, 17)).toBe("17");
  });
});

describe("pickNormalizationWinner", () => {
  const at = (row: number, col: number): SelectionSnapshot => ({
    row,
    col,
    length: 4,
  });

  it("for next, prefers the non-wrapped hit when the other wrapped", () => {
    const origin = at(5, 0);
    expect(pickNormalizationWinner("next", origin, at(1, 0), at(8, 0))).toBe(
      "nfd",
    );
  });

  it("for next, prefers the earlier hit when neither wrapped", () => {
    const origin = at(5, 0);
    expect(pickNormalizationWinner("next", origin, at(10, 0), at(8, 0))).toBe(
      "nfd",
    );
  });

  it("for previous, prefers the later hit when neither wrapped", () => {
    const origin = at(5, 0);
    expect(
      pickNormalizationWinner("previous", origin, at(2, 0), at(4, 0)),
    ).toBe("nfd");
  });
});

describe("search term normalization", () => {
  afterEach(() => {
    closeSearchBar();
  });

  // Normalize explicitly so the forms cannot drift with the file's encoding:
  // NFC keeps the o-circumflex as one code point, NFD splits it in two.
  const NFC = "thôn".normalize("NFC");
  const NFD = NFC.normalize("NFD");

  function mountBar(
    findNext: (term: string) => boolean,
    options?: {
      findPrevious?: (term: string) => boolean;
      /** Selection after each successful findNext, by call index. */
      selectionsAfterFind?: Array<SelectionSnapshot | null>;
    },
  ) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selection: SelectionSnapshot | null = null;
    let findCall = 0;
    const selections = options?.selectionsAfterFind;

    const pane = {
      id: 1,
      element: host,
      search: {
        findNext: vi.fn((term: string) => {
          const hit = findNext(term);
          if (selections) {
            selection = selections[findCall] ?? null;
            findCall += 1;
          } else if (hit) {
            selection = { col: 0, row: findCall, length: term.length };
            findCall += 1;
          } else {
            selection = null;
            findCall += 1;
          }
          return hit;
        }),
        findPrevious: vi.fn(
          (term: string) => options?.findPrevious?.(term) ?? false,
        ),
        clearDecorations: vi.fn(),
        onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
      },
      captureSelection: vi.fn(() => selection),
      restoreSelection: vi.fn((next: SelectionSnapshot | null) => {
        selection = next;
      }),
      focus: vi.fn(),
    } as unknown as Pane;
    openSearchBar(pane);
    return {
      input: host.querySelector("input") as HTMLInputElement,
      findNext: pane.search.findNext as unknown as ReturnType<typeof vi.fn>,
      findPrevious: pane.search.findPrevious as unknown as ReturnType<
        typeof vi.fn
      >,
      restoreSelection: pane.restoreSelection as unknown as ReturnType<
        typeof vi.fn
      >,
      nextButton: host.querySelectorAll("button")[1] as HTMLButtonElement,
    };
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("tries NFC then NFD when NFC finds nothing (macOS paths are NFD)", () => {
    const bar = mountBar((term) => term === NFD);
    type(bar.input, NFC);

    expect(bar.findNext).toHaveBeenNthCalledWith(1, NFC, expect.anything());
    expect(bar.findNext).toHaveBeenNthCalledWith(2, NFD, expect.anything());
    expect(bar.restoreSelection).toHaveBeenCalled();
  });

  it("does not search twice when the term is normalization-invariant", () => {
    const bar = mountBar(() => false);
    type(bar.input, "plain");

    expect(bar.findNext).toHaveBeenCalledTimes(1);
  });

  it("restores selection after an NFC miss so Next can leave the first NFD match", () => {
    // Buffer has three NFD-only matches. Each successful NFD find advances the
    // fake selection; an NFC miss must not wipe that origin permanently.
    const nfdRows = [0, 2, 4];
    let nfdIndex = 0;
    const bar = mountBar(
      (term) => {
        if (term === NFC) {
          return false;
        }
        if (term === NFD && nfdIndex < nfdRows.length) {
          return true;
        }
        return false;
      },
      {
        selectionsAfterFind: [
          null, // NFC miss
          { col: 0, row: 0, length: NFD.length }, // NFD → match 0
          null, // NFC miss on Next
          { col: 0, row: 2, length: NFD.length }, // NFD → match 1
        ],
      },
    );

    type(bar.input, NFC);
    // After incremental search, selection is on row 0. Press Next.
    nfdIndex = 1;
    bar.nextButton.click();

    const nfdCalls = bar.findNext.mock.calls.filter(([term]) => term === NFD);
    expect(nfdCalls.length).toBeGreaterThanOrEqual(2);
    // Origin was restored before the second NFD probe (not left cleared).
    expect(bar.restoreSelection).toHaveBeenCalled();
    expect(bar.restoreSelection.mock.calls.some(([s]) => s === null)).toBe(
      true,
    );
  });

  it("probes NFD even when NFC already matched (mixed buffer)", () => {
    const bar = mountBar((term) => term === NFC || term === NFD, {
      selectionsAfterFind: [
        { col: 0, row: 1, length: NFC.length }, // NFC hit
        { col: 0, row: 0, length: NFD.length }, // NFD hit earlier → wins
        { col: 0, row: 0, length: NFD.length }, // re-apply winner
      ],
    });
    type(bar.input, NFC);

    const terms = bar.findNext.mock.calls.map(([term]) => term);
    expect(terms).toContain(NFC);
    expect(terms).toContain(NFD);
    // Winner re-applied: last call is NFD (earlier row).
    expect(terms[terms.length - 1]).toBe(NFD);
  });
});

/** A pane whose `search` is a full spy set — real enough to drive advanceSearch. */
function fakeSearchPane(id: number): Pane {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return {
    id,
    element: host,
    search: {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
      onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
    },
    captureSelection: vi.fn(() => null),
    restoreSelection: vi.fn(),
    focus: vi.fn(),
  } as unknown as Pane;
}

function typeQuery(pane: Pane, value: string): void {
  const input = pane.element.querySelector(
    ".search-bar__input",
  ) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the search bar's own controls", () => {
  it("names its buttons and draws them as icons", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);

    const named = (name: string): HTMLButtonElement => {
      const found = Array.from(
        pane.element.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.getAttribute("aria-label") === name);
      if (found === undefined) {
        throw new Error(`no button named ${name}`);
      }
      return found;
    };

    // Named explicitly, not by their text: once the glyph is an aria-hidden
    // icon, the only name left would be the tooltip.
    expect(
      named("Previous match").querySelector(".deck-icon--caret-left"),
    ).not.toBeNull();
    expect(
      named("Next match").querySelector(".deck-icon--caret-right"),
    ).not.toBeNull();
    expect(named("Close").querySelector(".deck-icon--x")).not.toBeNull();
    expect(named("Close").textContent).toBe("");
  });

  it("leaves no icon roots behind on either disposal path", () => {
    // A bar left open on pane 1 by the test above would short-circuit
    // `openSearchBar` and hand this test a pane with no bar in it.
    closeSearchBar();
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    const bar = pane.element.querySelector(".search-bar") as HTMLElement;
    closeSearchBar();
    expect(bar.querySelectorAll("svg")).toHaveLength(0);

    openSearchBar(pane);
    const second = pane.element.querySelector(".search-bar") as HTMLElement;
    closeSearchBarForPane(pane.id);
    expect(second.querySelectorAll("svg")).toHaveLength(0);
  });
});

describe("advanceSearch (⌘G / ⌘⇧G — repeat the last search, with or without an open bar)", () => {
  afterEach(() => {
    closeSearchBar();
  });

  it("nothing has ever been searched: silent no-op", async () => {
    // `lastQuery` is module-level state and earlier describe blocks above
    // (real `openSearchBar` + typing) already set it — reset the module so
    // this test genuinely observes a pane that has never been searched,
    // rather than depending on file-wide test order.
    vi.resetModules();
    const fresh = await import("./search-bar");
    const pane = fakeSearchPane(1);

    fresh.advanceSearch(pane, "next");

    expect(pane.search.findNext).not.toHaveBeenCalled();
  });

  it("bar open on this pane with a query typed: behaves exactly like pressing Enter", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    (pane.search.findNext as ReturnType<typeof vi.fn>).mockClear(); // drop the incremental-typing call

    advanceSearch(pane, "next");

    expect(pane.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });

  it("bar open on this pane but the input is empty: no-op, matching the bar's own Enter handling", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);

    advanceSearch(pane, "next");

    expect(pane.search.findNext).not.toHaveBeenCalled();
  });

  it("bar closed after a search (Escape): repeats the last query silently — no bar reopens", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    closeSearchBar();
    (pane.search.findNext as ReturnType<typeof vi.fn>).mockClear();

    advanceSearch(pane, "next");

    expect(pane.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
    expect(pane.element.querySelector(".search-bar__input")).toBeNull();
  });

  it("⌘⇧G direction calls findPrevious instead", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    closeSearchBar();

    advanceSearch(pane, "previous");

    expect(pane.search.findPrevious).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });

  it("the remembered query is app-wide, not tied to the pane it was typed on: a different (never-searched) active pane still gets it", () => {
    const paneA = fakeSearchPane(1);
    openSearchBar(paneA);
    typeQuery(paneA, "needle");
    closeSearchBar();

    const paneB = fakeSearchPane(2);
    advanceSearch(paneB, "next");

    expect(paneB.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });

  it("bar still open on a DIFFERENT pane: the active pane's advanceSearch uses the remembered query, not the other pane's live (possibly unsaved) input", () => {
    const paneA = fakeSearchPane(1);
    openSearchBar(paneA);
    typeQuery(paneA, "needle");
    (paneA.search.findNext as ReturnType<typeof vi.fn>).mockClear();

    const paneB = fakeSearchPane(2);
    advanceSearch(paneB, "next");

    expect(paneB.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
    expect(paneA.search.findNext).not.toHaveBeenCalled(); // pane A's own bar/search untouched
  });

  it("closeSearchBarForPane on the searching pane (e.g. its tab closed) does not erase the remembered query for whatever pane is active next", () => {
    const paneA = fakeSearchPane(1);
    openSearchBar(paneA);
    typeQuery(paneA, "needle");
    closeSearchBarForPane(1); // pane died mid-search — no Escape, no closeSearchBar()

    const paneB = fakeSearchPane(2);
    advanceSearch(paneB, "next");

    expect(paneB.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });
});

describe("⌘G / ⌘⇧G while the bar's own input has focus", () => {
  afterEach(() => {
    closeSearchBar();
  });

  // The global shortcut handler skips chrome text fields (search-bar.ts:216-234
  // already does this for Escape/Enter/⌘F), so the bar must handle ⌘G itself —
  // same reasoning as the existing ⌘F-refocuses-the-input branch.
  it("⌘G in the input calls findNext, same as Enter", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    const input = pane.element.querySelector(
      ".search-bar__input",
    ) as HTMLInputElement;
    (pane.search.findNext as ReturnType<typeof vi.fn>).mockClear();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", metaKey: true, bubbles: true }),
    );

    expect(pane.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });

  it("⌘⇧G in the input calls findPrevious", () => {
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    const input = pane.element.querySelector(
      ".search-bar__input",
    ) as HTMLInputElement;

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(pane.search.findPrevious).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });
});

describe("Windows search shortcuts while the bar input has focus", () => {
  afterEach(() => {
    closeSearchBar();
    resetDesktopEnvironmentForTests();
  });

  it("routes Ctrl+Shift+F, F3, and Shift+F3 through the Windows keymap", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\Deck",
    });
    const pane = fakeSearchPane(1);
    openSearchBar(pane);
    typeQuery(pane, "needle");
    const input = pane.element.querySelector(
      ".search-bar__input",
    ) as HTMLInputElement;
    const select = vi.spyOn(input, "select");
    (pane.search.findNext as ReturnType<typeof vi.fn>).mockClear();

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F3", bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F3",
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(select).toHaveBeenCalledOnce();
    expect(pane.search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
    expect(pane.search.findPrevious).toHaveBeenCalledWith(
      "needle",
      expect.anything(),
    );
  });
});
