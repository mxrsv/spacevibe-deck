// @vitest-environment jsdom
/**
 * The consolidated seam test for the landing stage: it pins the hero window's
 * markup contract.
 *
 * It pins the joins BETWEEN modules — the places the rewrite can break with
 * no error anywhere — and deliberately not appearance, which the screenshot
 * capture (`scripts/capture-landing-stage.mjs`) and the owner's eye review
 * cover. Each `describe` below is headed by the numbered seam assertion it
 * discharges.
 *
 * Three lanes' own `*.test.js` files were absorbed into it and deleted:
 * `agent-strip.test.js` (T3), `tour/panel-scenes.test.js` (T6) and
 * `tour/scenes/rail.test.js` (T11) — every assertion in the three was a claim
 * about two modules agreeing, which is this file's subject. The four that
 * stayed beside their modules are unit tests of one module's internals with
 * machinery this file cannot reproduce: `marketing/stage/appwin.test.js`
 * (per-renderer local fixtures), `product-stage.test.js` (a `vi.doMock`ed
 * script that walks `think` / `rest` steps no shipped pane carries),
 * `directions/a.test.js` (the hero's composition and the `chromeRoot`
 * mutation guard) and `tour/index.test.js` (the panel stack, an
 * IntersectionObserver stub and the disposer regression).
 *
 * Two mechanical rules this file obeys, both measured by earlier lanes:
 *
 * - It must run under Vitest's Vite transform, never plain Node.
 *   `agent-strip.js` imports `src/assets/agent-agy.png`, which dies with
 *   `Unknown file extension ".png"` under `node --input-type=module`.
 * - A module's own text is read with `import src from "./file.js?raw"`.
 *   `readFileSync(new URL("./file.js", import.meta.url))` FAILS here: Vite
 *   rewrites that literal pattern into an asset URL.
 */

import { afterEach, describe, expect, it } from "vitest";

import { BUILTIN_AGENTS } from "../../../src/lib/agent-catalog.ts";
import { AGENT_MARKS, renderAgentMark, renderAgentStrip } from "./agent-strip.js";
import {
  renderStageFrameRow,
  renderStagePane,
  renderStageRail,
  renderStageStrip,
  renderStageTitlebar,
} from "./appwin.js";
import { messages } from "./copy.js";
import { renderDirectionA } from "./directions/a.js";
import { mountStageStream, stagePanes, stageRail, stageStrip } from "./product-stage.js";
import { renderTour } from "./tour/index.js";
import { SCENES } from "./tour/panel-scenes.js";
import { SCENE_RAIL, frame, sceneAgentMark } from "./tour/scenes/chrome.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The values a pane's script STARTS from, scanned the way §3.5 requires:
 * `tail` and `state` INDEPENDENTLY, never "the first step carrying either".
 * Codex step 1 and opencode step 1 carry a `state` and no `tail`, so a single
 * scan seeds a working spinner beside a finished sentence.
 */
function firstRailValues(pane) {
  return {
    tail: pane.steps.find((step) => step.tail !== undefined)?.tail,
    state: pane.steps.find((step) => step.state !== undefined)?.state,
  };
}

/** The values it ENDS on — what the reduced-motion frame must keep. */
function lastRailValues(pane) {
  return {
    tail: pane.steps.findLast((step) => step.tail !== undefined)?.tail,
    state: pane.steps.findLast((step) => step.state !== undefined)?.state,
  };
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

/**
 * The REAL hero, rendered — and optionally mounted — exactly as `main.js`
 * does it. Every stream assertion below runs against this rather than against
 * a hand-composed figure: the point of the hooks is that `stage-data.js`,
 * `marketing/stage/appwin.js`, `directions/a.js` and the engine agree on
 * where they are, and a local fixture would keep agreeing with itself.
 */
function hero({ mount = false, reduceMotion = true } = {}) {
  const direction = renderDirectionA(messages.en, "en");
  const root = document.createElement("div");
  root.innerHTML = direction.markup;
  document.body.append(root);

  if (mount) {
    setMotion(reduceMotion);
    disposers.push(direction.mount(root));
  }

  return root;
}

/** The tour's six panels, rendered. `mount` is what needs an observer; this does not. */
function tour() {
  const root = document.createElement("div");
  root.innerHTML = renderTour(messages.en).markup;

  return root;
}

/** Every string this page's renderers produce, keyed for a readable failure. */
function everyRenderedString() {
  return {
    hero: renderDirectionA(messages.en, "en").markup,
    tour: renderTour(messages.en).markup,
    agentStrip: renderAgentStrip(messages.en),
    titlebar: renderStageTitlebar(),
    frameRow: renderStageFrameRow(),
    rail: renderStageRail(stageRail),
    strip: renderStageStrip(stageStrip),
    ...Object.fromEntries(stagePanes.map((pane) => [`pane:${pane.id}`, renderStagePane(pane)])),
    ...Object.fromEntries(Object.keys(SCENES).map((key) => [`scene:${key}`, SCENES[key]()])),
  };
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()();
  }

  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.directionTreatment;
});

/* ------------------------------------------------------------------ */
/* Seam assertion 1 — the stream hooks resolve                         */
/* ------------------------------------------------------------------ */

describe("the hero's stream hooks", () => {
  it("hangs every [data-tail] and [data-dot] on a pane that has a transcript", () => {
    const root = hero();
    const streams = new Set(
      [...root.querySelectorAll("[data-stream]")].map((node) => node.dataset.stream),
    );

    expect(streams.size).toBeGreaterThan(0);

    for (const node of root.querySelectorAll("[data-tail]")) {
      expect(streams, `data-tail="${node.dataset.tail}"`).toContain(node.dataset.tail);
    }

    for (const node of root.querySelectorAll("[data-dot]")) {
      expect(streams, `data-dot="${node.dataset.dot}"`).toContain(node.dataset.dot);
    }
  });

  it("names only panes the script data actually drives", () => {
    const root = hero();
    const scripted = new Set(stagePanes.map((pane) => pane.id));

    for (const node of root.querySelectorAll("[data-stream], [data-tail], [data-dot]")) {
      const id = node.dataset.stream ?? node.dataset.tail ?? node.dataset.dot;
      expect(scripted, id).toContain(id);
    }
  });

  it("gives a static rail row no hook at all, so nothing claims to be live", () => {
    // `id: null` in `stageRail` is §3.1's static pane. The hero's closed
    // cards hold them; a hook on one would be a promise the engine never
    // keeps, because `stagePanes` holds no script for it.
    const root = hero();
    const staticPanes = stageRail
      .flatMap((project) => project.checkouts.flatMap((checkout) => checkout.panes))
      .filter((pane) => pane.id === null);

    expect(staticPanes.length).toBeGreaterThan(0);
    expect(root.querySelectorAll("[data-tail]")).toHaveLength(4);
    expect(root.querySelectorAll("[data-dot]")).toHaveLength(3);
  });

  it("gives the focused pane a second hook — its rail row AND its tab chip", () => {
    // This is why the engine resolves hooks with `querySelectorAll`. With
    // `querySelector` the rail moves and the chip does not, or the reverse.
    const root = hero();
    const focused = stagePanes.find((pane) => pane.focused);

    expect(root.querySelectorAll(`[data-tail="${focused.id}"]`).length).toBeGreaterThan(1);
    expect(
      [...root.querySelectorAll(`[data-tail="${focused.id}"]`)].map((n) => n.className),
    ).toContain("a-appwin__chiplabel");
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertions 2 and 3 — the registry and both locales             */
/* ------------------------------------------------------------------ */

describe("the panel registry and its copy", () => {
  /** The panel stack is a private const in `tour/index.js`; the markup is how it is observed. */
  const panelsOf = (root) => [...root.querySelectorAll("article.panel")];

  it("draws every SCENES key exactly once, and no panel names a scene the registry lacks", () => {
    const drawn = panelsOf(tour()).map((panel) => panel.dataset.scene);

    expect([...drawn].sort()).toEqual(Object.keys(SCENES).sort());
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("gives every panel a Title and a Body in BOTH locales", () => {
    const keys = panelsOf(tour())
      .map((panel) => panel.querySelector("h2")?.dataset.copy)
      .map((copyKey) => copyKey?.replace(/Title$/, ""));

    expect(keys).toHaveLength(6);

    for (const key of keys) {
      for (const locale of ["en", "vi"]) {
        for (const suffix of ["Title", "Body"]) {
          const value = messages[locale][`${key}${suffix}`];
          expect(typeof value, `${locale}.${key}${suffix}`).toBe("string");
          expect(value.trim(), `${locale}.${key}${suffix}`).not.toHaveLength(0);
        }
      }
    }
  });

  it("keeps the two locales key-for-key identical", () => {
    // A missing key renders `undefined` in one locale only, and nobody
    // browses in the other (R11).
    expect(Object.keys(messages.vi).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("resolves every [data-copy] hook the page emits to a real string", () => {
    const root = document.createElement("div");
    root.innerHTML = renderDirectionA(messages.en, "en").markup + renderTour(messages.en).markup;

    const hooks = [...root.querySelectorAll("[data-copy]")].map((node) => node.dataset.copy);
    expect(hooks.length).toBeGreaterThan(10);

    for (const key of new Set(hooks)) {
      expect(messages.en, key).toHaveProperty(key);
      expect(messages.vi, key).toHaveProperty(key);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertion 4 — nothing prints a hole                            */
/* ------------------------------------------------------------------ */

describe("no renderer prints a hole", () => {
  const HOLES = ["undefined", "null", "NaN", "[object Object]"];

  it("emits no undefined, null, NaN or [object Object] anywhere", () => {
    for (const [name, html] of Object.entries(everyRenderedString())) {
      for (const hole of HOLES) {
        // `null` and `undefined` appear legitimately nowhere in this markup;
        // a missing fixture field is exactly how they arrive.
        expect(html, `${name} contains "${hole}"`).not.toContain(hole);
      }
    }
  });

  it("emits no empty or broken attribute value", () => {
    for (const [name, html] of Object.entries(everyRenderedString())) {
      expect(html, name).not.toContain('src=""');
      expect(html, name).not.toContain('class=""');
      expect(html, name).not.toContain("${");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertion 5 — the rail renderer's two shapes                   */
/* ------------------------------------------------------------------ */

describe("renderStageRail's three checkout shapes", () => {
  function railDom(fixture) {
    const host = document.createElement("div");
    host.innerHTML = renderStageRail(fixture);

    return host;
  }

  const checkoutsOf = (fixture) => fixture.flatMap((project) => project.checkouts);

  it("draws a remembered project with no caret and no toggle", () => {
    // DL-19.7: `.asr-cluster__still` has no caret at all, ever. The hero
    // fixture carries one (`spacevibe-hub`); `SCENE_RAIL`, the resting rail
    // the panels share, deliberately carries none — panel 1 passes its own
    // fixture for the remembered header, and asserts it further down.
    expect(stageRail.some((project) => project.remembered)).toBe(true);
    expect(SCENE_RAIL.some((project) => project.remembered)).toBe(false);

    const rememberedCount = stageRail.filter((project) => project.remembered).length;
    const remembered = [...railDom(stageRail).querySelectorAll(".a-appwin__clusterhead.is-still")];
    expect(remembered).toHaveLength(rememberedCount);

    for (const head of remembered) {
      expect(head.querySelector(".a-appwin__clustercaret")).toBeNull();
      expect(head.querySelector(".a-appwin__clustertoggle")).toBeNull();
      expect(head.querySelector(".a-appwin__clusterstill")).not.toBeNull();
    }
  });

  it("draws a live header as exactly two children — the toggle and the close", () => {
    // R6: a third child auto-places onto an implicit SECOND grid row and
    // drops the caret below the project name. The owner caught that class of
    // defect in the app on 2026-08-19. The header's `+` is gone since 1.1.
    const heads = [...railDom(stageRail).querySelectorAll(".a-appwin__clusterhead:not(.is-still)")];
    expect(heads.length).toBeGreaterThan(0);

    for (const head of heads) {
      expect([...head.children].map((child) => child.className)).toEqual([
        "a-appwin__clustertoggle",
        "a-appwin__clusterremove",
      ]);
    }
  });

  it("draws an open card's panes as rows, one per pane, and no strip", () => {
    for (const [name, fixture] of [
      ["hero", stageRail],
      ["scene", SCENE_RAIL],
    ]) {
      const open = checkoutsOf(fixture).filter((checkout) => checkout.open);
      const cards = [...railDom(fixture).querySelectorAll('.a-appwin__card[data-open="true"]')];

      expect(open.length, name).toBeGreaterThan(0);
      expect(cards, name).toHaveLength(open.length);

      cards.forEach((card, index) => {
        expect(card.querySelectorAll(".a-appwin__cardrow"), name).toHaveLength(
          open[index].panes.length,
        );
        expect(card.querySelector(".a-appwin__cardstrip"), name).toBeNull();
      });
    }
  });

  it("draws a closed card as a strip, never as rows", () => {
    const closed = [...railDom(stageRail).querySelectorAll('.a-appwin__card[data-open="false"]')];

    expect(closed.length).toBeGreaterThan(0);

    for (const card of closed) {
      expect(card.querySelectorAll(".a-appwin__cardrow")).toHaveLength(0);
      expect(card.querySelector(".a-appwin__cardstrip")).not.toBeNull();
    }
  });

  it("draws a checkout with nothing open as a bare row, never a card", () => {
    const empty = checkoutsOf(stageRail).filter((checkout) => checkout.panes.length === 0);

    expect(empty.length).toBeGreaterThan(0);
    expect(railDom(stageRail).querySelectorAll(".a-appwin__bare")).toHaveLength(empty.length);
  });

  it("keeps exactly one active card in the hero, and it is the open one", () => {
    // The active card is the checkout holding the window's focus; the hero's
    // streamed panes are in it, so it must be open for their rows to exist.
    const active = [...railDom(stageRail).querySelectorAll('.a-appwin__card[data-active="true"]')];

    expect(active).toHaveLength(1);
    expect(active[0].dataset.open).toBe("true");
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertion 6 — the reduced-motion frame, made automatic         */
/* ------------------------------------------------------------------ */

describe("the reduced-motion frame", () => {
  it("leaves every hook on its pane's LAST tail and LAST state", () => {
    const root = hero({ mount: true, reduceMotion: true });

    for (const pane of stagePanes) {
      const { tail, state } = lastRailValues(pane);
      const tails = [...root.querySelectorAll(`[data-tail="${pane.id}"]`)];
      const dots = [...root.querySelectorAll(`[data-dot="${pane.id}"]`)];

      expect(tails.length, pane.id).toBeGreaterThan(0);
      expect(dots.length, pane.id).toBeGreaterThan(0);

      for (const node of tails) {
        expect(node.textContent, pane.id).toBe(tail);
      }

      for (const node of dots) {
        expect(node.dataset.state, pane.id).toBe(state);
      }
    }
  });

  it("finishes on a completed frame — no pane left spinning", () => {
    const root = hero({ mount: true, reduceMotion: true });

    for (const node of root.querySelectorAll("[data-dot]")) {
      expect(node.dataset.state).not.toBe("working");
    }

    for (const spinner of root.querySelectorAll("[data-spinner]")) {
      expect(spinner.hidden).toBe(true);
    }
  });

  it("overwrites the resting fixture sentence, which is how a dead rail shows", () => {
    // Claude is the ONLY pane whose resting `stageRail` message differs from
    // its last tail, so it is the one pane that can tell a live rail from a
    // dead one. An assertion written against codex or opencode proves nothing.
    const resting = stageRail
      .flatMap((project) => project.checkouts.flatMap((checkout) => checkout.panes))
      .find((pane) => pane.id === "claude").label;

    expect(lastRailValues(stagePanes.find((pane) => pane.id === "claude")).tail).not.toBe(resting);

    const root = hero({ mount: true, reduceMotion: true });
    expect(root.querySelector('[data-tail="claude"]').textContent).not.toBe(resting);
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertion 8 — the animated seed (R4b)                          */
/* ------------------------------------------------------------------ */

describe("the animated path's seed", () => {
  it("opens on each pane's FIRST tail and FIRST state, not its last", () => {
    // Without this, assertion 6 passes while the page runs backwards: the
    // rail paints every pane's final sentence for one frame, jumps to step 1,
    // and repeats it on every loop.
    const root = hero({ mount: true, reduceMotion: false });

    for (const pane of stagePanes) {
      const { tail, state } = firstRailValues(pane);

      for (const node of root.querySelectorAll(`[data-tail="${pane.id}"]`)) {
        expect(node.textContent, pane.id).toBe(tail);
      }

      for (const node of root.querySelectorAll(`[data-dot="${pane.id}"]`)) {
        expect(node.dataset.state, pane.id).toBe(state);
      }
    }
  });

  it("resolves tail and state from two INDEPENDENT scans", () => {
    // The fixture is what makes this checkable: codex's and opencode's first
    // step carries a `state` and no `tail`. Seeding from "the first step
    // carrying either" pairs a working spinner with a finished sentence for
    // ~4s of every loop.
    const split = stagePanes.filter((pane) => {
      const firstTail = pane.steps.findIndex((step) => step.tail !== undefined);
      const firstState = pane.steps.findIndex((step) => step.state !== undefined);

      return firstTail !== firstState;
    });

    expect(split.length).toBeGreaterThan(0);

    const root = hero({ mount: true, reduceMotion: false });

    for (const pane of split) {
      const seeded = root.querySelector(`[data-tail="${pane.id}"]`).textContent;
      const naive = pane.steps.find((step) => step.tail !== undefined || step.state !== undefined);

      expect(seeded, pane.id).toBe(firstRailValues(pane).tail);
      expect(seeded, pane.id).not.toBe(naive.tail);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Seam assertion 7 — the agent catalog mirror                         */
/* (absorbed from `agent-strip.test.js`, T3)                           */
/* ------------------------------------------------------------------ */

describe("AGENT_MARKS mirrors the app's catalog", () => {
  it("carries six agents, in the catalog's ids, labels and order", () => {
    // The mirror reaches into `src/lib/agent-catalog.ts` on purpose: it is
    // the only thing that catches the landing drifting behind a seventh
    // built-in agent. Nothing enforced it until Cursor proved the list moves.
    expect(AGENT_MARKS).toHaveLength(6);
    expect(AGENT_MARKS.map((agent) => agent.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id));
    expect(AGENT_MARKS.map((agent) => agent.label)).toEqual(
      BUILTIN_AGENTS.map((agent) => agent.label),
    );
  });

  it("puts cursor-agent last and gives it no brand file", () => {
    expect(AGENT_MARKS.at(-1)).toEqual({ id: "cursor-agent", label: "Cursor", mark: null });

    for (const agent of AGENT_MARKS.slice(0, -1)) {
      expect(typeof agent.mark, agent.id).toBe("string");
      expect(agent.mark, agent.id).not.toHaveLength(0);
    }
  });

  it("draws an image for a branded agent and a monogram for a markless one", () => {
    const branded = renderAgentMark(AGENT_MARKS[0], "scene-picker__mark", 18);
    expect(branded).toContain(`src="${AGENT_MARKS[0].mark}"`);
    expect(branded).toContain('width="18"');
    expect(branded).not.toContain("--mono");

    // The letter comes off the ID, not the label, and skips non-alphanumerics.
    expect(renderAgentMark(AGENT_MARKS.at(-1), "agent-strip__mark", 20)).toBe(
      '<span class="agent-strip__mark agent-strip__mark--mono">C</span>',
    );
    expect(renderAgentMark({ id: " _ray", label: "Ray", mark: null }, "m", 15)).toBe(
      '<span class="m m--mono">R</span>',
    );
  });

  it('never prints src="null" on any surface of the page', () => {
    // R9: three renderers reach for `agent.mark`, not one. The strip, the
    // rail, the tab strip and all six scenes are checked together because
    // that is the whole set that can regress.
    for (const [name, html] of Object.entries(everyRenderedString())) {
      expect(html, name).not.toContain('src="null"');
      expect(html, name).not.toContain('src="undefined"');
    }
  });

  it("draws one chip per agent in the strip, exactly one of them a monogram", () => {
    const html = renderAgentStrip(messages.en);
    const count = (needle) => html.split(needle).length - 1;

    expect(count("agent-strip__chip")).toBe(6);
    expect(count("agent-strip__mark--mono")).toBe(1);
    expect(count("<img")).toBe(5);

    for (const agent of AGENT_MARKS) {
      expect(html, agent.id).toContain(`<span>${agent.label}</span>`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The shared scene chrome                                             */
/* (absorbed from `tour/panel-scenes.test.js`, T6)                     */
/* ------------------------------------------------------------------ */

describe("the scene registry", () => {
  const SCENE_KEYS = ["rail", "menu", "restore", "surfaces", "usage", "catalog"];

  it("holds exactly the six panel scenes, under the keys the panels name", () => {
    // `panel-scenes.js` is pure shorthand — `export const SCENES = { rail, … }`
    // — so renaming a scene module's export silently breaks the registry.
    expect(Object.keys(SCENES)).toEqual(SCENE_KEYS);
  });

  it("maps every key to a zero-argument function returning one window mock", () => {
    for (const key of SCENE_KEYS) {
      expect(typeof SCENES[key], key).toBe("function");
      expect(SCENES[key].length, key).toBe(0);
      expect(SCENES[key](), key).toContain('<figure class="a-appwin tour__appwin"');
    }
  });

  it("draws no status bar and no workspace sidebar in any scene", () => {
    // Both are `showStatusBar: false` / the July shell. They survive in
    // `marketing/stage/` for the video (D12) and must reach no panel.
    for (const key of SCENE_KEYS) {
      expect(SCENES[key](), key).not.toContain("a-appwin__status");
      expect(SCENES[key](), key).not.toContain("a-appwin__wsitem");
    }
  });

  it("mounts no stream in any scene, so no panel hook lies about being live", () => {
    for (const key of SCENE_KEYS) {
      const host = document.createElement("div");
      host.innerHTML = SCENES[key]();

      expect(host.querySelectorAll("[data-tail]"), key).toHaveLength(0);
      expect(host.querySelectorAll("[data-dot]"), key).toHaveLength(0);
    }
  });
});

describe("the scenes' shared frame", () => {
  it("stands the body inside the stage, under the strip", () => {
    const html = frame("<b>body</b>", {
      strip: [{ kind: "browser", label: "x", active: false }],
    });

    expect(html.indexOf("a-appwin__stage")).toBeLessThan(html.indexOf("a-appwin__strip"));
    expect(html.indexOf("a-appwin__strip")).toBeLessThan(html.indexOf("<b>body</b>"));
  });

  it("defaults to the shared rail and to no strip", () => {
    expect(frame("")).toContain("a-appwin__rail");
    expect(frame("")).not.toContain("a-appwin__strip");
  });

  it("omits the aside entirely when the rail is null", () => {
    expect(frame("", { rail: null })).not.toContain("<aside");
    expect(frame("", { rail: null })).toContain("a-appwin__stage");
  });

  it("shares one frozen resting rail across all six scenes", () => {
    expect(Object.isFrozen(SCENE_RAIL)).toBe(true);
    expect(Object.isFrozen(SCENE_RAIL[0].checkouts[0].panes[0])).toBe(true);

    const panes = SCENE_RAIL.flatMap((project) =>
      project.checkouts.flatMap((checkout) => checkout.panes),
    );
    expect(panes.every((pane) => pane.id === null)).toBe(true);
    expect(SCENE_RAIL.some((cluster) => cluster.collapsed)).toBe(false);
    expect(SCENE_RAIL.some((cluster) => cluster.hovered)).toBe(false);
  });

  it("falls back to a monogram instead of throwing on an id the catalog lacks", () => {
    expect(sceneAgentMark("claude", "scene-rail__mark")).toContain("<img");
    expect(sceneAgentMark("mystery-agent", "scene-rail__mark")).toBe(
      '<span class="scene-rail__mark scene-rail__mark--mono">M</span>',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Panel 1 — the rail panel draws through the shared renderer          */
/* (absorbed from `tour/scenes/rail.test.js`, T11)                     */
/* ------------------------------------------------------------------ */

describe("the rail panel", () => {
  function panel() {
    const host = document.createElement("div");
    host.innerHTML = SCENES.rail();

    return host;
  }

  it("draws its rail through the shared renderer, not markup of its own", () => {
    // The absence of the July scene's hand-rolled rows is what proves the
    // panel and the hero cannot drift apart.
    const host = panel();

    expect(host.querySelector("aside.a-appwin__sidebar.a-appwin__rail")).not.toBeNull();
    expect(host.querySelectorAll(".a-appwin__framerow")).toHaveLength(1);
    expect(host.querySelector(".scene-rail__leaf")).toBeNull();
    expect(host.querySelector(".scene-rail__list")).toBeNull();
  });

  it("is the one surface that carries all six card states", () => {
    // Open rows state theirs on the status cell, closed segments on the
    // segment itself — the same attribute either way.
    const states = [
      ...panel().querySelectorAll(".a-appwin__cardstatus, .a-appwin__cardseg[data-state]"),
    ].map((node) => node.dataset.state);

    expect(new Set(states)).toEqual(
      new Set(["failed", "asked", "working", "done", "idle", "ended"]),
    );
  });

  it("draws one open card and one closed card, the closed one ending in its `+`", () => {
    const host = panel();
    const open = host.querySelectorAll('.a-appwin__card[data-open="true"]');
    const closed = host.querySelectorAll('.a-appwin__card[data-open="false"]');

    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(1);
    expect(closed[0].querySelector(".a-appwin__cardstrip").lastElementChild.className).toBe(
      "a-appwin__cardseg a-appwin__cardseg--add",
    );
    // Two asked Claude panes fold into one counted segment.
    expect(closed[0].querySelector(".a-appwin__cardtimes").textContent).toBe("×2");
  });

  it("bakes exactly one hover, on the remembered header, and reveals its close", () => {
    // The forget control is said here or nowhere on the page — every other
    // header on the site is at rest.
    const hovered = [...panel().querySelectorAll(".a-appwin__clusterhead.is-hover")];

    expect(hovered).toHaveLength(1);
    expect(hovered[0].classList.contains("is-still")).toBe(true);
    expect(hovered[0].querySelector(".a-appwin__clusterremove")).not.toBeNull();
  });

  it("draws one collapsed project: its caret kept, its cards gone", () => {
    // The one legitimate resting state in which a caret is visible, and the
    // only place on the page one appears without a pointer.
    const collapsed = [...panel().querySelectorAll(".a-appwin__cluster.is-collapsed")];

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].querySelector(".a-appwin__clustercaret")).not.toBeNull();
    expect(collapsed[0].querySelectorAll(".a-appwin__card, .a-appwin__bare")).toHaveLength(0);
  });

  it("gives its idle row the agent's name, because it has said nothing yet", () => {
    const idle = [...panel().querySelectorAll(".a-appwin__cardrow")].find(
      (row) => row.querySelector(".a-appwin__cardstatus").dataset.state === "idle",
    );

    expect(idle.querySelector(".a-appwin__cardlabel").textContent).toBe("Gemini");
  });

  it("keeps the panel's work on the stage side and draws no tab strip", () => {
    const host = panel();

    expect(host.querySelectorAll(".scene-rail__pane")).toHaveLength(3);
    expect(host.querySelector(".scene-rail__hint").textContent).toBe("the panes keep running");
    expect(host.querySelector(".a-appwin__strip")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The engine's scoping — one page, several stages                     */
/* ------------------------------------------------------------------ */

describe("the mount's two roots", () => {
  it("moves the rail and the chip that stand OUTSIDE the pane grid", () => {
    // The single easiest way to ship a dead rail: `chromeRoot` defaults to
    // `gridRoot`, the hooks are not in the grid, the miss is tolerated by
    // design, and nothing throws. Asserted by watching the rail change.
    const root = hero({ mount: true, reduceMotion: true });
    const claude = stagePanes.find((pane) => pane.id === "claude");

    for (const node of root.querySelectorAll('[data-tail="claude"]')) {
      expect(node.textContent).toBe(lastRailValues(claude).tail);
    }
  });

  it("never widens its lookup past the root it was handed", () => {
    // R8: the page mounts several stages; a document-wide query would let one
    // panel's step repaint another's rail.
    const first = hero();
    const second = hero();
    const grid = second.querySelector(".a-appwin__grid");

    setMotion(true);
    disposers.push(mountStageStream(grid, { chromeRoot: second.querySelector(".a-appwin") }));

    const claude = stagePanes.find((pane) => pane.id === "claude");
    const resting = stageRail
      .flatMap((project) => project.checkouts.flatMap((checkout) => checkout.panes))
      .find((pane) => pane.id === "claude").label;

    expect(second.querySelector('[data-tail="claude"]').textContent).toBe(
      lastRailValues(claude).tail,
    );
    expect(first.querySelector('[data-tail="claude"]').textContent).toBe(resting);
  });
});
