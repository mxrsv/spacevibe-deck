// @vitest-environment jsdom
/**
 * T7's own assertions, next to the one file it owns.
 *
 * Two things are checked here and nowhere else. The first is the hero's
 * COMPOSITION (§3.4): rail, then a `.a-appwin__stage` wrapper holding the
 * strip and the grid, with no status bar and no dock. The second is the
 * `chromeRoot` the mount passes — the rail and the tab chips stand OUTSIDE
 * the pane grid, so a mount that forgets the wider root resolves no hooks,
 * tolerates the miss by design, and ships a rail that never moves. There is
 * no throw and no build error to catch that, which is why it is asserted by
 * watching the rail actually change rather than by spying on the call.
 *
 * The module is imported through Vitest rather than plain Node on purpose:
 * `agent-strip.js` reaches `src/assets/agent-agy.png`, which needs the Vite
 * transform.
 */

import { afterEach, describe, expect, it } from "vitest";

import { messages } from "../copy.js";
import { stagePanes, stageRail } from "../product-stage.js";
import { renderDirectionA, updateDirectionALocale } from "./a.js";
import source from "./a.js?raw";

function setMotion(reduce) {
  window.matchMedia = () => ({
    matches: reduce,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener() {},
    removeEventListener() {},
  });
}

const originalMatchMedia = window.matchMedia;
const disposers = [];

/**
 * Render the hero into a detached root and, when asked, mount it. `mount`
 * takes the root the markup was written into, exactly as `main.js` does.
 */
function renderHero({ mount = false, reduceMotion = true } = {}) {
  const root = document.createElement("div");
  root.innerHTML = renderDirectionA(messages.en, "en").markup;
  document.body.append(root);

  if (mount) {
    setMotion(reduceMotion);
    disposers.push(renderDirectionA(messages.en, "en").mount(root));
  }

  return root;
}

/** The value a pane's script ENDS on — what the reduced-motion frame keeps. */
function lastTail(paneId) {
  const pane = stagePanes.find((entry) => entry.id === paneId);

  return pane.steps.findLast((step) => step.tail !== undefined).tail;
}

/** The sentence the RESTING rail fixture carries, before any mount. */
function restingMessage(paneId) {
  for (const cluster of stageRail) {
    for (const tab of cluster.tabs) {
      for (const pane of tab.panes) {
        if (pane.id === paneId) {
          return pane.message;
        }
      }
    }
  }

  return undefined;
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()();
  }

  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.directionTreatment;
});

describe("the hero's stage composition", () => {
  it("draws one rail with the stage wrapper immediately after it", () => {
    const root = renderHero();
    const rails = root.querySelectorAll(".a-appwin__sidebar");
    const stages = root.querySelectorAll(".a-appwin__stage");

    expect(rails).toHaveLength(1);
    expect(stages).toHaveLength(1);
    // `.a-appwin__sidebar + *` is the window's one structural seam, so the
    // wrapper has to be the ADJACENT sibling — not merely present.
    expect(rails[0].nextElementSibling).toBe(stages[0]);
  });

  it("puts the strip and the grid inside that wrapper, strip first", () => {
    const root = renderHero();
    const stage = root.querySelector(".a-appwin__stage");
    const strips = root.querySelectorAll(".a-appwin__strip");
    const grids = root.querySelectorAll(".a-appwin__grid");

    expect(strips).toHaveLength(1);
    expect(grids).toHaveLength(1);
    expect(stage.contains(strips[0])).toBe(true);
    expect(stage.contains(grids[0])).toBe(true);
    expect(strips[0].compareDocumentPosition(grids[0])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("draws no status bar and no workspace sidebar", () => {
    const root = renderHero();

    // The window bottom is the panes: `showStatusBar: false` and
    // `dockOpen: false` are the shipped defaults, and the July mock's
    // workspace column is what the rail replaced.
    expect(root.querySelectorAll(".a-appwin__status")).toHaveLength(0);
    expect(root.querySelectorAll(".a-appwin__wsitem")).toHaveLength(0);
  });

  it("no longer imports the sidebar or status renderers", () => {
    // They stay exported for the marketing video; this file just stopped
    // calling them. Read off the IMPORT SPECIFIERS rather than off the whole
    // source, because the composition comment names renderStageStatus on
    // purpose — and because an unused import is not an error anywhere in
    // this toolchain, so nothing else would catch one left behind.
    const specifiers = source
      .match(/import \{([^}]*)\} from "\.\.\/appwin\.js";/)[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    expect(specifiers).toEqual([
      "BRAND_ICON_SRC",
      "renderStagePane",
      "renderStageRail",
      "renderStageStrip",
    ]);
  });

  it("keeps today's pane split — claude and codex share a column", () => {
    const root = renderHero();
    const grid = root.querySelector(".a-appwin__grid");
    const columns = grid.querySelectorAll(".a-appwin__col");

    expect(columns).toHaveLength(1);
    expect(
      [...columns[0].querySelectorAll("[data-stream]")].map(
        (node) => node.dataset.stream,
      ),
    ).toEqual(["claude", "codex"]);
    // opencode is a bare grid child, not a second column.
    expect(
      [...grid.children].map((node) => node.className.split(" ")[0]),
    ).toContain("a-appwin__pane");
  });

  it("draws three transcript regions", () => {
    const root = renderHero();
    const streams = [...root.querySelectorAll("[data-stream]")];

    expect(streams).toHaveLength(3);
    expect(streams.map((node) => node.dataset.stream)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
  });

  it("hangs every rail and chip hook on a pane that exists", () => {
    const root = renderHero();
    const streamIds = [...root.querySelectorAll("[data-stream]")].map(
      (node) => node.dataset.stream,
    );
    const tails = [...root.querySelectorAll("[data-tail]")];
    const dots = [...root.querySelectorAll("[data-dot]")];

    expect(tails.length).toBeGreaterThan(0);
    expect(dots.length).toBeGreaterThan(0);

    for (const node of tails) {
      expect(streamIds).toContain(node.dataset.tail);
    }

    for (const node of dots) {
      expect(streamIds).toContain(node.dataset.dot);
    }
  });

  it("puts those hooks OUTSIDE the pane grid, which is why the mount needs two roots", () => {
    const root = renderHero();
    const grid = root.querySelector(".a-appwin__grid");

    // If this ever becomes false the `chromeRoot` argument stops mattering
    // and the test below stops proving anything.
    expect(grid.querySelectorAll("[data-tail]")).toHaveLength(0);
    expect(grid.querySelectorAll("[data-dot]")).toHaveLength(0);
  });
});

describe("the hero's mount", () => {
  it("reaches the rail, so the chrome root really was passed", () => {
    // The whole point: with `chromeRoot` omitted the engine looks the hooks
    // up inside the grid, finds none, tolerates the miss and leaves the
    // resting fixture sentence on screen forever. Reduced motion is used so
    // the expected value is the script's LAST tail, which differs from the
    // claude row's resting message — the one pane where the two are not the
    // same string, and therefore the only one that can tell them apart.
    const root = renderHero({ mount: true, reduceMotion: true });
    const rail = root.querySelector(".a-appwin__rail");
    const message = rail.querySelector('[data-tail="claude"]');
    const mark = rail.querySelector('[data-dot="claude"]');

    expect(restingMessage("claude")).not.toBe(lastTail("claude"));
    expect(message.textContent).toBe(lastTail("claude"));
    expect(mark.dataset.state).toBe("done");
  });

  it("reaches the active tab chip too", () => {
    const root = renderHero({ mount: true, reduceMotion: true });
    const chip = root.querySelector(
      '.a-appwin__chiplabel[data-tail="claude"]',
    );

    expect(chip.textContent).toBe(lastTail("claude"));
  });

  it("disposes without throwing and clears the treatment flag", () => {
    const root = renderHero({ mount: true, reduceMotion: true });

    expect(document.documentElement.dataset.directionTreatment).toBe("a");
    disposers.pop()();
    expect(document.documentElement.dataset.directionTreatment).toBeUndefined();
    expect(root.querySelector(".a-appwin")).not.toBeNull();
  });
});

describe("the locale swap", () => {
  it("still replaces every [data-copy] node in place", () => {
    const root = renderHero();

    updateDirectionALocale(root, messages.vi, "vi");

    expect(root.querySelector('[data-copy="headlineLead"]').textContent).toBe(
      messages.vi.headlineLead,
    );
    // The stage is untouched by a locale swap — it carries no [data-copy].
    expect(root.querySelectorAll(".a-appwin [data-copy]")).toHaveLength(0);
  });
});
