// @vitest-environment jsdom
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phosphor components are React `forwardRef` objects; jsdom under Vitest
// cannot use them as a tag name (the same trap `worktree-card.test.tsx`
// documents). The strip reaches Phosphor only through `DeckIcon`.
vi.mock("./controls/deck-icon", () => ({
  CHROME_ICON: 13,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import type { RailCardPane, RailWorktreeGroup } from "./agent-rail-model";
import { CardStrip, fitKey, resetStripMeasurementsForTests } from "./worktree-card-strip";

/**
 * The closed strip's measuring half (DECK-62).
 *
 * `useStripMetrics` learns real segment widths into a cache every card in the
 * rail shares. On 2026-09-10 the shipped 1.1.0 build froze because two cards
 * read the SAME shape one pixel apart — `codex|1|still` measured 47px on a
 * card where it sat behind a fractional-width `×5` segment and 46px on the
 * cards where it sat first — and each card's layout effect re-learned its own
 * number and re-rendered, inside one synchronous Preact `process()` call that
 * never drained. jsdom reports `offsetWidth` 0 for everything, which is why
 * the component's other tests never saw it; this file stubs the getter per
 * card so the disagreement is real.
 */

function pane(overrides: Partial<RailCardPane> = {}): RailCardPane {
  return {
    kind: "agent",
    paneId: 11,
    agent: "claude",
    state: "idle",
    message: "",
    age: "",
    changedAt: 0,
    focused: false,
    tabIndex: 0,
    model: "",
    label: "Claude",
    ...overrides,
  };
}

function group(panes: readonly RailCardPane[], key: string): RailWorktreeGroup {
  return {
    key,
    branch: "main",
    name: key,
    path: `/repo/${key}`,
    repositoryPath: `/repo/${key}`,
    primary: true,
    labelled: true,
    entries: panes,
    panes,
    live: true,
    age: "",
    active: false,
    rows: [],
  };
}

const DECK = group(
  [
    ...[1, 2, 3, 4, 5].map((paneId) => pane({ paneId, agent: "claude" })),
    pane({ paneId: 6, agent: "codex", label: "Codex" }),
  ],
  "deck",
);
const BENCH = group(
  [pane({ paneId: 7, agent: "codex", label: "Codex" }), pane({ paneId: 8, agent: "claude" })],
  "bench",
);

/** Widths the rail measured while frozen: 47px for a segment on the first
 *  card, 46px for the same shape anywhere else; roles keep one width. */
function stubbedWidth(element: HTMLElement): number {
  if (element.dataset.fitKey !== undefined) {
    return element.closest('[data-card="a"]') === null ? 46 : 47;
  }
  if (element.dataset.fitRole !== undefined) {
    return 30;
  }
  return 0;
}

const RENDER_LIMIT = 40;
let host: HTMLDivElement;
let renders: number;
let originalWidth: PropertyDescriptor | undefined;
let originalDiffed: typeof options.diffed;

function Rail() {
  const noop = () => {};
  return (
    <div>
      <section data-card="a">
        <CardStrip
          project="deck"
          group={DECK}
          onFocusPane={noop}
          onClosePane={noop}
          onOpenActions={noop}
          actionsOpen={false}
        />
      </section>
      <section data-card="b">
        <CardStrip
          project="bench"
          group={BENCH}
          onFocusPane={noop}
          onClosePane={noop}
          onOpenActions={noop}
          actionsOpen={false}
        />
      </section>
    </div>
  );
}

beforeEach(() => {
  resetStripMeasurementsForTests();
  host = document.createElement("div");
  document.body.append(host);
  originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return stubbedWidth(this);
    },
  });
  // The loop lives inside ONE synchronous `process()` call, so a scheduler
  // counter never trips; count diffs of the strip itself and throw past the
  // limit. Without this a regression hangs vitest instead of failing it.
  renders = 0;
  originalDiffed = options.diffed;
  options.diffed = (vnode) => {
    originalDiffed?.(vnode);
    if (vnode.type === CardStrip) {
      renders += 1;
      if (renders > RENDER_LIMIT) {
        throw new Error(`render loop: CardStrip diffed ${renders} times in one flush`);
      }
    }
  };
});

afterEach(() => {
  options.diffed = originalDiffed;
  if (originalWidth === undefined) {
    delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
  } else {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
  }
  act(() => {
    render(null, host);
  });
  host.remove();
  resetStripMeasurementsForTests();
});

describe("two cards that measure one shape a pixel apart", () => {
  it("settle instead of re-learning each other's width forever", () => {
    expect(() => {
      act(() => {
        render(<Rail />, host);
      });
    }).not.toThrow();

    // One initial render and at most one re-fold per card once the
    // measurements landed; anything beyond that is the cache thrashing.
    expect(renders).toBeLessThanOrEqual(4);
    expect(host.querySelectorAll('[data-card="a"] [data-fit-key]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-card="b"] [data-fit-key]')).toHaveLength(2);
  });

  it("keeps the first width a shape was measured at", () => {
    act(() => {
      render(<Rail />, host);
    });
    const before = renders;
    // A later render with the same DOM must not learn anything new.
    act(() => {
      render(<Rail />, host);
    });
    expect(renders - before).toBeLessThanOrEqual(2);
  });
});

describe("fitKey", () => {
  it("separates merged counts by their digit count, so ×5 and ×12 never share a width", () => {
    expect(fitKey("claude", 5, false)).not.toBe(fitKey("claude", 12, false));
    expect(fitKey("claude", 5, false)).toBe(fitKey("claude", 9, false));
    expect(fitKey("claude", 1, false)).not.toBe(fitKey("claude", 2, false));
    expect(fitKey("claude", 1, true)).not.toBe(fitKey("claude", 1, false));
  });

  it("is the key the rendered segment carries", () => {
    act(() => {
      render(<Rail />, host);
    });
    const merged = host.querySelector<HTMLElement>('[data-card="a"] [data-fit-key^="claude"]');
    expect(merged?.dataset.fitKey).toBe(fitKey("claude", 5, false));
    const single = host.querySelector<HTMLElement>('[data-card="b"] [data-fit-key^="codex"]');
    expect(single?.dataset.fitKey).toBe(fitKey("codex", 1, false));
  });
});
