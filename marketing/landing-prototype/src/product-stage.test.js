// @vitest-environment jsdom
/**
 * T5's own assertions, next to the two files it owns.
 *
 * The DOM these tests mount into is built by the REAL renderers rather than
 * by a hand-written string: the point of the rail hooks is that the engine
 * and `marketing/stage/appwin.js` agree on where they are, and a hand-rolled
 * fixture would keep agreeing with itself after the markup moved.
 *
 * The one exception is the `think` / `rest` walk, which no shipped pane
 * script exercises — those steps carry no rail fields in the hero fixture, so
 * that case mocks `stage-data.js` with a script that does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as shim from "./appwin.js";
import {
  renderStagePane,
  renderStageRail,
  renderStageStrip,
} from "./appwin.js";
import * as barrel from "./product-stage.js";
import {
  mountStageStream,
  stagePanes,
  stageRail,
  stageStrip,
} from "./product-stage.js";

/**
 * The values a pane's script STARTS from, scanned the way §3.5 requires:
 * `tail` and `state` independently, never "the first step carrying either".
 */
function firstRailValues(pane) {
  return {
    tail: pane.steps.find((step) => step.tail !== undefined)?.tail,
    state: pane.steps.find((step) => step.state !== undefined)?.state,
  };
}

/** The values it ENDS on — what the reduced-motion frame must carry. */
function lastRailValues(pane) {
  return {
    tail: pane.steps.findLast((step) => step.tail !== undefined)?.tail,
    state: pane.steps.findLast((step) => step.state !== undefined)?.state,
  };
}

function tailNodes(root, paneId) {
  return [...root.querySelectorAll(`[data-tail="${paneId}"]`)];
}

function dotNodes(root, paneId) {
  return [...root.querySelectorAll(`[data-dot="${paneId}"]`)];
}

/**
 * The hero's own composition (§3.4): the rail and the strip stand OUTSIDE the
 * pane grid, which is the whole reason the mount takes a second root.
 */
function stageMarkup({ rail = stageRail, strip = stageStrip, panes }) {
  return `
    <figure class="a-appwin">
      <div class="a-appwin__body">
        ${renderStageRail(rail)}
        <div class="a-appwin__stage">
          ${renderStageStrip(strip)}
          <div class="a-appwin__grid">${panes.map(renderStagePane).join("")}</div>
        </div>
      </div>
    </figure>
  `;
}

function mountHeroMarkup(options = {}) {
  document.body.innerHTML = stageMarkup({ panes: stagePanes, ...options });

  const figure = document.querySelector(".a-appwin");

  return { figure, grid: figure.querySelector(".a-appwin__grid") };
}

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

function track(dispose) {
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()();
  }

  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("the product-stage export barrel", () => {
  it("re-exports all six stage-data names beside the engine", () => {
    // Spelled out rather than counted: dropping a name here is an immediate
    // ESM link error in the landing build, and `stageSidebar` / `stageStatus`
    // are the two with no new caller to notice their loss.
    expect(Object.keys(barrel).sort()).toEqual([
      "STAGE_ARIA_LABEL",
      "deepFreeze",
      "mountStageStream",
      "stagePanes",
      "stageRail",
      "stageSidebar",
      "stageStatus",
      "stageStrip",
    ]);
  });

  it("re-exports the data itself, not a copy", async () => {
    const source = await import("../../stage/stage-data.js");

    expect(barrel.stageRail).toBe(source.stageRail);
    expect(barrel.stageStrip).toBe(source.stageStrip);
    expect(barrel.stageSidebar).toBe(source.stageSidebar);
    expect(barrel.stageStatus).toBe(source.stageStatus);
  });
});

describe("the landing's appwin shim", () => {
  it("names all ten renderers", () => {
    expect(Object.keys(shim).sort()).toEqual([
      "BRAND_ICON_SRC",
      "STAGE_ICONS",
      "renderChromeIcon",
      "renderStageFrameRow",
      "renderStagePane",
      "renderStageRail",
      "renderStageSidebar",
      "renderStageStatus",
      "renderStageStrip",
      "renderStageTitlebar",
    ]);
  });

  it("keeps BRAND_ICON_SRC, which changelog-view.js imports through here", () => {
    expect(typeof shim.BRAND_ICON_SRC).toBe("string");
    expect(shim.BRAND_ICON_SRC.length).toBeGreaterThan(0);
  });

  it("exposes the three new renderers as functions", () => {
    expect(typeof shim.renderStageFrameRow).toBe("function");
    expect(typeof shim.renderStageRail).toBe("function");
    expect(typeof shim.renderStageStrip).toBe("function");
  });
});

describe("the hooks a pane owns", () => {
  it("gives the focused pane two tail nodes — a rail row and its chip", () => {
    const { figure } = mountHeroMarkup();

    // The reason every lookup is querySelectorAll and not querySelector.
    expect(tailNodes(figure, "claude")).toHaveLength(2);
    expect(tailNodes(figure, "codex")).toHaveLength(1);
    expect(tailNodes(figure, "opencode")).toHaveLength(1);
  });

  it("emits nothing at all for a static row", () => {
    const { figure } = mountHeroMarkup();
    const staticRow = figure.querySelector(".a-appwin__row");

    // spacevibe-api's pane is `id: null` — a drawn row with no live pane
    // behind it, so it carries neither hook and the engine never finds it.
    expect(staticRow.querySelector("[data-tail]")).toBeNull();
    expect(staticRow.querySelector("[data-dot]")).toBeNull();
  });
});

describe("the reduced-motion frame", () => {
  it("leaves every hook on the pane's LAST tail and LAST state", () => {
    setMotion(true);

    const { figure, grid } = mountHeroMarkup();

    track(mountStageStream(grid, { chromeRoot: figure }));

    for (const pane of stagePanes) {
      const { tail, state } = lastRailValues(pane);

      for (const node of tailNodes(figure, pane.id)) {
        expect(node.textContent).toBe(tail);
      }

      for (const node of dotNodes(figure, pane.id)) {
        expect(node.dataset.state).toBe(state);
      }
    }
  });

  it("finishes all three panes on a done dot", () => {
    setMotion(true);

    const { figure, grid } = mountHeroMarkup();

    track(mountStageStream(grid, { chromeRoot: figure }));

    expect(dotNodes(figure, "claude")[0].dataset.state).toBe("done");
    expect(dotNodes(figure, "codex")[0].dataset.state).toBe("done");
    expect(dotNodes(figure, "opencode")[0].dataset.state).toBe("done");
  });
});

describe("the animated path", () => {
  it("opens on the pane's FIRST tail and FIRST state, not its last", () => {
    setMotion(false);

    const { figure, grid } = mountHeroMarkup();

    track(mountStageStream(grid, { chromeRoot: figure }));

    for (const pane of stagePanes) {
      const first = firstRailValues(pane);
      const last = lastRailValues(pane);

      for (const node of tailNodes(figure, pane.id)) {
        expect(node.textContent).toBe(first.tail);
        expect(node.textContent).not.toBe(last.tail);
      }

      for (const node of dotNodes(figure, pane.id)) {
        expect(node.dataset.state).toBe(first.state);
      }
    }
  });

  it("never pairs a working spinner with a finished sentence", () => {
    setMotion(false);

    const { figure, grid } = mountHeroMarkup();

    track(mountStageStream(grid, { chromeRoot: figure }));

    // codex and opencode open on a step carrying `state: "working"` and NO
    // `tail`. A seed that took both fields off the first step carrying either
    // would leave the previous cycle's finished sentence — the one the resting
    // markup holds — under a working spinner for four seconds every loop.
    for (const paneId of ["codex", "opencode"]) {
      const pane = stagePanes.find((entry) => entry.id === paneId);
      const resting = stageRail
        .flatMap((cluster) => cluster.tabs)
        .flatMap((tab) => tab.panes)
        .find((railPane) => railPane.id === paneId);

      expect(dotNodes(figure, paneId)[0].dataset.state).toBe("working");
      expect(tailNodes(figure, paneId)[0].textContent).not.toBe(
        resting.message,
      );
      expect(tailNodes(figure, paneId)[0].textContent).toBe(
        firstRailValues(pane).tail,
      );
    }
  });
});

describe("hook lookup", () => {
  it("completes with no rail or strip in the tree", () => {
    setMotion(false);
    document.body.innerHTML = `<div class="a-appwin__grid">${stagePanes
      .map(renderStagePane)
      .join("")}</div>`;

    const grid = document.querySelector(".a-appwin__grid");
    let dispose;

    // A tour panel draws a pane grid and no chrome. A miss is an empty array,
    // never a throw — unlike [data-lines] / [data-spinner] below.
    expect(() => {
      dispose = mountStageStream(grid);
    }).not.toThrow();
    expect(() => dispose()).not.toThrow();
  });

  it("stays inside the root it was given", () => {
    setMotion(true);
    document.body.innerHTML = `
      <div data-stage="a">${stageMarkup({ panes: stagePanes })}</div>
      <div data-stage="b">${stageMarkup({ panes: stagePanes })}</div>
    `;

    const first = document.querySelector('[data-stage="a"] .a-appwin');
    const second = document.querySelector('[data-stage="b"] .a-appwin');
    const restingClaude = stageRail[0].tabs[0].panes[0].message;

    track(
      mountStageStream(first.querySelector(".a-appwin__grid"), {
        chromeRoot: first,
      }),
    );

    // Widening the lookup to `document` would repaint the second stage too.
    expect(tailNodes(first, "claude")[0].textContent).not.toBe(restingClaude);
    expect(tailNodes(second, "claude")[0].textContent).toBe(restingClaude);
  });

  it("falls back to the grid when chromeRoot is explicitly null", () => {
    setMotion(true);

    const { grid } = mountHeroMarkup();

    expect(() =>
      track(mountStageStream(grid, { chromeRoot: null })),
    ).not.toThrow();
  });

  it("still throws for a missing grid root", () => {
    expect(() => mountStageStream(null)).toThrow("Stage grid root is missing.");
  });

  it("still throws for a pane whose transcript markup is missing", () => {
    setMotion(true);
    document.body.innerHTML = `<div class="a-appwin__grid"></div>`;

    expect(() =>
      mountStageStream(document.querySelector(".a-appwin__grid")),
    ).toThrow('Stage pane "claude" markup is missing.');
  });
});

/*
 * No shipped pane script hangs a rail field on a `think` or a `rest` step, so
 * the hero fixture cannot tell a full walk from a line/chunk one. This block
 * swaps in a script that can.
 */
describe("every step kind carries the rail", () => {
  const FIXTURE = [
    {
      id: "solo",
      focused: true,
      startOffset: 0,
      restGap: 1000,
      maxLines: 6,
      prompt: "❯",
      footer: [],
      steps: [
        { kind: "line", text: "start", delay: 5000, state: "working" },
        { kind: "chunk", text: "…", delay: 10, tail: "first sentence" },
        { kind: "line", text: "done", delay: 10, tail: "middle", state: "failed" },
        { kind: "think", text: "✳ thinking", delay: 10, state: "done" },
        { kind: "rest", delay: 10, tail: "last sentence" },
      ],
    },
  ];

  const FIXTURE_RAIL = [
    {
      project: "solo-project",
      tabs: [
        {
          framed: false,
          panes: [
            {
              id: "solo",
              agent: "claude",
              message: "resting sentence",
              age: "2m",
              state: "idle",
            },
          ],
        },
      ],
    },
  ];

  let mod;

  beforeEach(async () => {
    vi.resetModules();

    const actual = await vi.importActual("../../stage/stage-data.js");

    vi.doMock("../../stage/stage-data.js", () => ({
      ...actual,
      stagePanes: FIXTURE,
    }));

    mod = await import("./product-stage.js");

    document.body.innerHTML = stageMarkup({
      rail: FIXTURE_RAIL,
      strip: [],
      panes: FIXTURE,
    });
  });

  afterEach(() => {
    vi.doUnmock("../../stage/stage-data.js");
    vi.resetModules();
  });

  function roots() {
    const figure = document.querySelector(".a-appwin");

    return { figure, grid: figure.querySelector(".a-appwin__grid") };
  }

  it("takes the reduced-motion state off a think step and the tail off a rest step", () => {
    setMotion(true);

    const { figure, grid } = roots();

    track(mod.mountStageStream(grid, { chromeRoot: figure }));

    // A walk limited to line/chunk would stop at "middle" / "failed".
    expect(dotNodes(figure, "solo")[0].dataset.state).toBe("done");
    expect(tailNodes(figure, "solo")[0].textContent).toBe("last sentence");
  });

  it("leaves no spinner behind when the script's last printing step is a think", () => {
    setMotion(true);

    const { figure, grid } = roots();

    track(mod.mountStageStream(grid, { chromeRoot: figure }));

    // The spinner is cleared AFTER the walk, not before it: a completed frame
    // is not a thinking one whatever kind the script ends on.
    expect(grid.querySelector("[data-spinner]").hidden).toBe(true);
  });

  it("seeds the animated path from two different steps", () => {
    setMotion(false);

    const { figure, grid } = roots();

    track(mod.mountStageStream(grid, { chromeRoot: figure }));

    // state from step 1, tail from step 2 — two independent scans.
    expect(dotNodes(figure, "solo")[0].dataset.state).toBe("working");
    expect(tailNodes(figure, "solo")[0].textContent).toBe("first sentence");
  });

  it("re-seeds at the top of every loop", () => {
    vi.useFakeTimers();

    try {
      setMotion(false);

      const { figure, grid } = roots();

      track(mod.mountStageStream(grid, { chromeRoot: figure }));

      // Past the whole script — its last step lands near +5048 — and short of
      // the loop, which restarts one restGap (1000ms) later.
      vi.advanceTimersByTime(6000);

      expect(tailNodes(figure, "solo")[0].textContent).toBe("last sentence");
      expect(dotNodes(figure, "solo")[0].dataset.state).toBe("done");

      // Past the restart, and still short of cycle 2's first step at +5000.
      vi.advanceTimersByTime(500);

      // The rest gap resets `index` without clearing anything, so without the
      // seed the rail would sit on `done` while the transcript replays.
      expect(tailNodes(figure, "solo")[0].textContent).toBe("first sentence");
      expect(dotNodes(figure, "solo")[0].dataset.state).toBe("working");
    } finally {
      vi.useRealTimers();
    }
  });
});
