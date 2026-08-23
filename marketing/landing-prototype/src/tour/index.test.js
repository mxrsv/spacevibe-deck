// @vitest-environment jsdom
/**
 * T8's own assertions, next to the two files it owns.
 *
 * Two of these cannot be replaced by reading the source. The panel stack is a
 * private const, so its shape is asserted through the markup the page actually
 * renders — which also proves every `scene` key resolves in `SCENES`, since an
 * unknown one would call `undefined()`. And the disposer is asserted by being
 * RUN: the cut this task made removed a stream-mount declaration whose
 * consumption sat ten lines lower, inside the disposer `main.js` calls on
 * every locale switch. Rollup does not fail on a binding deleted out from
 * under a live reference — the page builds, and throws when the reader
 * presses the language toggle.
 */

import { afterEach, describe, expect, it } from "vitest";

import { messages } from "../copy.js";
import * as stageStates from "./stage-states.js";
import { PROOF_TERM_STEPS } from "./stage-states.js";
import { SCENES } from "./panel-scenes.js";
import { renderTour, updateTourLocale } from "./index.js";

/** §3.6, in order. The table is the contract; this is it transcribed. */
const PANEL_TABLE = [
  { key: "panelRail", scene: "rail", shape: "side", flip: true },
  { key: "panelWorktree", scene: "picker", shape: "side", flip: false },
  { key: "panelRestore", scene: "restore", shape: "wide", flip: false },
  { key: "panelSurfaces", scene: "surfaces", shape: "wide", flip: false },
  { key: "panelUsage", scene: "usage", shape: "side", flip: false },
  { key: "panelCatalog", scene: "catalog", shape: "side", flip: true },
];

/**
 * jsdom ships no IntersectionObserver, and both mounts build one. The stub
 * keeps every instance so a test can fire it — the proof terminal only writes
 * anything after it intersects.
 */
const observers = [];

class StubIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    observers.push(this);
  }

  observe(target) {
    this.targets.push(target);
  }

  unobserve(target) {
    this.targets = this.targets.filter((entry) => entry !== target);
  }

  disconnect() {
    this.targets = [];
  }
}

function intersectAll() {
  for (const observer of [...observers]) {
    observer.callback(
      observer.targets.map((target) => ({ isIntersecting: true, target })),
      observer,
    );
  }
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
const originalObserver = window.IntersectionObserver;
const disposers = [];

/** Render the tour into a detached root, exactly as `main.js` does. */
function renderIntoRoot({ mount = false, reduceMotion = true } = {}) {
  const root = document.createElement("div");
  const tour = renderTour(messages.en);
  root.innerHTML = tour.markup;
  document.body.append(root);

  if (mount) {
    setMotion(reduceMotion);
    window.IntersectionObserver = StubIntersectionObserver;
    disposers.push(tour.mount(root));
  }

  return root;
}

function panels(root) {
  return [...root.querySelectorAll("article.panel")];
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()();
  }

  observers.length = 0;
  window.matchMedia = originalMatchMedia;
  window.IntersectionObserver = originalObserver;
  document.body.innerHTML = "";
});

describe("the panel stack", () => {
  it("renders the six panels of the plan's table, in its order", () => {
    const rendered = panels(renderIntoRoot());

    expect(rendered).toHaveLength(6);
    expect(rendered.map((panel) => panel.dataset.scene)).toEqual(
      PANEL_TABLE.map((entry) => entry.scene),
    );
    expect(rendered.map((panel) => panel.dataset.shape)).toEqual(
      PANEL_TABLE.map((entry) => entry.shape),
    );
  });

  it("draws every scene the registry holds, each exactly once", () => {
    const drawn = panels(renderIntoRoot()).map((panel) => panel.dataset.scene);

    // Both directions: no panel points at a scene that is not there (which
    // would have called `undefined()` above), and no scene module is orphaned.
    expect([...drawn].sort()).toEqual(Object.keys(SCENES).sort());
  });

  it("flips the first and last panel only", () => {
    const flipped = panels(renderIntoRoot()).map((panel) =>
      panel.hasAttribute("data-flip"),
    );

    expect(flipped).toEqual(PANEL_TABLE.map((entry) => entry.flip));
    expect(flipped.filter(Boolean)).toHaveLength(2);
  });

  it("numbers the panels 01 through 06", () => {
    const numbers = panels(renderIntoRoot()).map(
      (panel) => panel.querySelector(".panel__num").textContent,
    );

    expect(numbers).toEqual(["01", "02", "03", "04", "05", "06"]);
  });

  it("prints a real sentence for every panel's copy keys", () => {
    for (const panel of panels(renderIntoRoot())) {
      const title = panel.querySelector("h2[data-copy]");
      const body = panel.querySelector("p[data-copy]");
      const key = PANEL_TABLE.find(
        (entry) => entry.scene === panel.dataset.scene,
      ).key;

      expect(title.dataset.copy).toBe(`${key}Title`);
      expect(body.dataset.copy).toBe(`${key}Body`);
      // A missing key stringifies to "undefined" rather than throwing, so the
      // page would ship the word itself in a heading.
      expect(title.textContent.trim()).toBe(messages.en[`${key}Title`]);
      expect(body.textContent.trim()).toBe(messages.en[`${key}Body`]);
      expect(title.textContent).not.toContain("undefined");
    }
  });

  it("draws one window mock per panel and no board or pane grid", () => {
    const root = renderIntoRoot();

    expect(root.querySelectorAll(".panel__stage .a-appwin")).toHaveLength(6);
    // The cut chain's own classes. Nothing renders them any more, so a hit
    // here means the stranded renderers came back.
    for (const dead of [
      ".tour__scenegrid",
      ".tour__board",
      ".tour__recent",
      ".tour__agentchip",
      ".tour__thumb",
    ]) {
      expect(root.querySelectorAll(dead)).toHaveLength(0);
    }
  });
});

describe("the closing band", () => {
  it("lists eight chords, including the two surface toggles", () => {
    const root = renderIntoRoot();
    const chords = [...root.querySelectorAll(".tour__sc")];

    expect(chords).toHaveLength(8);

    const pairs = chords.map((chord) => [
      chord.querySelector("kbd").textContent.trim(),
      chord.querySelector("[data-copy]").dataset.copy,
    ]);

    expect(pairs).toContainEqual(["⌘⇧B", "scExplorer"]);
    expect(pairs).toContainEqual(["⌘⇧Y", "scSessions"]);
    // Both keys came from T9; a missing one renders the literal word.
    for (const chord of chords) {
      expect(chord.querySelector("[data-copy]").textContent).not.toContain(
        "undefined",
      );
    }
  });

  it("still types the proof terminal off PROOF_TERM_STEPS", () => {
    const root = renderIntoRoot({ mount: true, reduceMotion: true });
    intersectAll();

    const lines = [
      ...root.querySelectorAll(".tour__proofterm-body .tour__tl"),
    ].map((line) => line.textContent);

    for (const step of PROOF_TERM_STEPS) {
      expect(lines).toContain(`❯ ${step.cmd}`);
    }
    // Every chip a step names is lit by the finished session.
    for (const step of PROOF_TERM_STEPS) {
      expect(
        root.querySelector(`[data-proof="${step.chip}"]`).classList,
      ).toContain("is-lit");
    }
  });

  it("keeps the brand icon in the footer", () => {
    const src = renderIntoRoot().querySelector(".site-footer__mark img").src;

    expect(src).toBeTruthy();
    expect(src).not.toMatch(/undefined|null/);
  });
});

describe("mount and dispose", () => {
  it("disposes without throwing", () => {
    const root = document.createElement("div");
    const tour = renderTour(messages.en);
    root.innerHTML = tour.markup;
    document.body.append(root);
    setMotion(true);
    window.IntersectionObserver = StubIntersectionObserver;

    const dispose = tour.mount(root);

    // The regression this task could have shipped: a disposer referencing a
    // binding the same commit deleted. It throws here and nowhere else.
    expect(() => dispose()).not.toThrow();
  });

  it("survives the locale switch main.js performs", () => {
    const root = renderIntoRoot({ mount: true });

    expect(() => updateTourLocale(root, messages.vi)).not.toThrow();
    expect(
      root.querySelector('[data-copy="panelRailTitle"]').textContent,
    ).toBe(messages.vi.panelRailTitle);

    // main.js disposes the old tour and renders a new one; both halves run.
    expect(() => disposers.pop()()).not.toThrow();
    expect(() => renderIntoRoot({ mount: true })).not.toThrow();
  });
});

describe("stage-states.js", () => {
  it("is the proof-terminal script and nothing else", () => {
    expect(Object.keys(stageStates)).toEqual(["PROOF_TERM_STEPS"]);
  });

  it("keeps the script frozen and quoting the page's own repo", () => {
    expect(Object.isFrozen(PROOF_TERM_STEPS)).toBe(true);
    expect(PROOF_TERM_STEPS).toHaveLength(4);
    expect(PROOF_TERM_STEPS.map((step) => step.chip)).toEqual([
      "Pty",
      "Pty",
      "Open",
      "Local",
    ]);
    expect(PROOF_TERM_STEPS[2].cmd).toContain("gh repo clone ");
    // The Local proof is a CONTRACT read since the analytics landed (spec
    // 2026-08-22; default-on since 2026-08-23): the payload file replaces the
    // empty grep, and the quoted lines must keep saying no-permanent-id.
    expect(PROOF_TERM_STEPS[3].cmd).toContain("cat ");
    expect(PROOF_TERM_STEPS[3].cmd).toContain("src/telemetry/payload.ts");
    const localProof = PROOF_TERM_STEPS[3].out.join(" ");
    expect(localProof).toContain("random UUID per day");
  });
});
