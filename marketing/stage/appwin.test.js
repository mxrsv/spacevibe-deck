// @vitest-environment jsdom
/**
 * T2's own assertions, next to the file it owns.
 *
 * Fixtures are LOCAL rather than imported from `stage-data.js`: the three new
 * renderers are pure functions of their argument, and a test that reached for
 * the shipped hero fixture would fail the day a scene changed a sentence.
 * The shapes below are §3.1's, spelled out.
 */

import { describe, expect, it } from "vitest";

/*
 * The module's own text, for the two rules that are about HOW it is written.
 * `?raw` rather than `readFileSync(new URL("./appwin.js", import.meta.url))`:
 * Vite rewrites that literal pattern into an asset URL, which is exactly the
 * transform this file relies on for the agent marks.
 */
import appwinSource from "./appwin.js?raw";

import {
  STAGE_ICONS,
  renderStageFrameRow,
  renderStageRail,
  renderStageSidebar,
  renderStageStatus,
  renderStageStrip,
  renderStageTitlebar,
} from "./appwin.js";

const FRAMED_CLUSTER = {
  project: "spacevibe-deck",
  tabs: [
    {
      framed: true,
      panes: [
        {
          id: "claude",
          agent: "claude",
          message: "I'll trace why the pane divider drifts on resize.",
          age: "now",
          state: "working",
        },
        {
          id: "codex",
          agent: "codex",
          message: "96 passed · 0 failed",
          age: "2m",
          state: "done",
        },
        {
          id: "opencode",
          agent: "opencode",
          message: "typecheck clean · the branch follows cwd now",
          age: "2m",
          state: "done",
        },
      ],
    },
  ],
};

const BARE_CLUSTER = {
  project: "spacevibe-api",
  tabs: [
    {
      framed: false,
      panes: [
        {
          id: null,
          agent: "gemini",
          message: "Should I apply the pending migration?",
          age: "3h",
          state: "asked",
        },
      ],
    },
  ],
};

const REMEMBERED_CLUSTER = {
  project: "spacevibe-hub",
  remembered: true,
  tabs: [],
};

const RAIL = [FRAMED_CLUSTER, BARE_CLUSTER, REMEMBERED_CLUSTER];

const STRIP = [
  {
    kind: "terminal",
    agent: "claude",
    paneId: "claude",
    label: "I'll trace why the pane divider drifts on resize.",
    active: true,
  },
  { kind: "file", label: "layout-engine.ts", active: false },
  { kind: "browser", label: "localhost:5173", active: false },
];

/**
 * Markup with every `src` emptied. Vite inlines a small asset as a data URI,
 * so a substring check for a literal like "null" would otherwise be reading a
 * base64 blob as well as the markup.
 */
function withoutAssetUrls(html) {
  return html.replace(/src="[^"]*"/g, 'src=""');
}

/** Parse a markup string into one container element. */
function parse(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** The class list of an element's ELEMENT children, in order. */
function childClasses(element) {
  return [...element.children].map((child) => child.getAttribute("class"));
}

describe("STAGE_ICONS", () => {
  it("keeps the five the video's titlebar still reads", () => {
    for (const name of [
      "splitRow",
      "splitColumn",
      "closePane",
      "expand",
      "gear",
    ]) {
      expect(typeof STAGE_ICONS[name]).toBe("string");
    }
  });

  it("gains the ten the redesign draws", () => {
    for (const name of [
      "sidebar",
      "plus",
      "plusSquare",
      "dots",
      "globe",
      "file",
      "close",
      "folder",
      "caret",
      "refresh",
    ]) {
      expect(STAGE_ICONS[name]).toBeTruthy();
    }
  });

  it("keeps the framed launcher and the bare cross apart", () => {
    // The rail's per-project `+` became `PlusSquare` on 2026-08-20 and the
    // circled and bare forms were both rejected; the frame row's `New` and the
    // strip's tab-add stayed the bare `Plus`. One key cannot serve both.
    expect(STAGE_ICONS.plusSquare).not.toBe(STAGE_ICONS.plus);
    expect(STAGE_ICONS.plusSquare).toContain("<rect");
    expect(STAGE_ICONS.plus).not.toContain("<rect");
  });

  it("carries its own fill on the two the app draws solid", () => {
    // `renderChromeIcon` opens with `fill="none"`, so a filled Phosphor icon
    // has to say so on the shape itself.
    expect(STAGE_ICONS.sidebar).toContain('fill="currentColor"');
    expect(STAGE_ICONS.dots).toContain('fill="currentColor"');
  });
});

describe("renderStageFrameRow", () => {
  const row = parse(renderStageFrameRow()).firstElementChild;

  it("draws lights, the sidebar toggle, New, and the drag spacer — in that order", () => {
    expect(row.getAttribute("class")).toBe("a-appwin__framerow");
    expect(childClasses(row)).toEqual([
      "a-appwin__lights",
      "a-appwin__ctl a-appwin__sidebartoggle",
      "a-appwin__new",
      "a-appwin__framespacer",
    ]);
    expect(row.querySelector(".a-appwin__new").textContent.trim()).toBe("New");
  });

  it("carries no feature toolbar — in sidebar mode the app passes none", () => {
    expect(row.querySelectorAll(".a-appwin__ctl")).toHaveLength(1);
    expect(row.querySelectorAll(".a-appwin__iconbtn")).toHaveLength(0);
  });

  it("draws the bare Plus on `New`, not the rail's framed launcher", () => {
    const glyph = row.querySelector(".a-appwin__newglyph");
    expect(glyph.querySelector("svg")).not.toBe(null);
    expect(glyph.querySelector("svg rect")).toBe(null);
  });

  it("reuses the titlebar's own traffic lights", () => {
    expect(row.querySelectorAll(".a-appwin__lights i")).toHaveLength(3);
  });
});

describe("renderStageRail", () => {
  it("returns markup for a fixture and for an empty rail", () => {
    for (const html of [renderStageRail(RAIL), renderStageRail([])]) {
      expect(typeof html).toBe("string");
      const text = withoutAssetUrls(html);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("[object Object]");
      expect(text).not.toContain("null");
    }
  });

  it("keeps `.a-appwin__sidebar` on the outer element and adds the rail class", () => {
    const aside = parse(renderStageRail(RAIL)).firstElementChild;
    // The stage's one structural seam is `.a-appwin__sidebar + *`, and the
    // mobile strategy is `.a-appwin__sidebar { display: none }`. Both fire off
    // this class with no error if it is renamed.
    expect(aside.tagName).toBe("ASIDE");
    expect(aside.classList.contains("a-appwin__sidebar")).toBe(true);
    expect(aside.classList.contains("a-appwin__rail")).toBe(true);
  });

  it("stands the frame row inside the rail, above the list", () => {
    const aside = parse(renderStageRail(RAIL)).firstElementChild;
    expect(childClasses(aside)).toEqual([
      "a-appwin__framerow",
      "a-appwin__raillist",
    ]);
  });

  it("gives a live header exactly two children — the toggle and the +", () => {
    // A three-track grid with four direct children auto-places the caret onto
    // an implicit second row; the caret therefore lives INSIDE the toggle.
    const head = parse(renderStageRail([FRAMED_CLUSTER])).querySelector(
      ".a-appwin__clusterhead",
    );
    expect(childClasses(head)).toEqual([
      "a-appwin__clustertoggle",
      "a-appwin__clusteradd",
    ]);

    const toggle = head.querySelector(".a-appwin__clustertoggle");
    expect(childClasses(toggle)).toEqual([
      "a-appwin__clusterfolder",
      "a-appwin__clustername",
      "a-appwin__clustercaret",
    ]);
    expect(toggle.querySelector(".a-appwin__clustername").textContent).toBe(
      "spacevibe-deck",
    );
  });

  it("gives a remembered header a still label, a +, a ×, and no caret at all", () => {
    const rail = parse(renderStageRail([REMEMBERED_CLUSTER]));
    const head = rail.querySelector(".a-appwin__clusterhead");

    expect(head.classList.contains("is-still")).toBe(true);
    expect(rail.querySelectorAll(".a-appwin__clusterstill")).toHaveLength(1);
    expect(rail.querySelectorAll(".a-appwin__clustercaret")).toHaveLength(0);
    expect(rail.innerHTML).not.toContain("clustercaret");
    expect(childClasses(head)).toEqual([
      "a-appwin__clusterstill",
      "a-appwin__clusteradd",
      "a-appwin__clusterremove",
    ]);
    // Nothing is open, so nothing is drawn under the header.
    expect(rail.querySelectorAll(".a-appwin__item")).toHaveLength(0);
  });

  it("draws a framed tab as N leaves and no rows", () => {
    const rail = parse(renderStageRail([FRAMED_CLUSTER]));
    const item = rail.querySelector(".a-appwin__item");

    expect(item.classList.contains("is-framed")).toBe(true);
    expect(rail.querySelectorAll(".a-appwin__leaf")).toHaveLength(3);
    expect(rail.querySelectorAll(".a-appwin__row")).toHaveLength(0);
    // DL-27.19's frame is drawn on the item; no parent row stands above the
    // leaves, because `PANE_TREE_HIDDEN` is true in the app.
    expect(childClasses(item)).toEqual([
      "a-appwin__leaf",
      "a-appwin__leaf",
      "a-appwin__leaf",
    ]);
  });

  it("draws a bare tab as one row, under its own child class names", () => {
    const rail = parse(renderStageRail([BARE_CLUSTER]));

    expect(rail.querySelectorAll(".a-appwin__leaf")).toHaveLength(0);
    expect(rail.querySelectorAll(".a-appwin__row")).toHaveLength(1);
    expect(
      rail.querySelector(".a-appwin__item").classList.contains("is-framed"),
    ).toBe(false);
    expect(childClasses(rail.querySelector(".a-appwin__row"))).toEqual([
      "a-appwin__mark a-appwin__rowmark",
      "a-appwin__rowmsg",
      "a-appwin__rowage",
      "a-appwin__rowlogo",
    ]);
  });

  it("names a leaf's four cells apart from a row's", () => {
    const leaf = parse(renderStageRail([FRAMED_CLUSTER])).querySelector(
      ".a-appwin__leaf",
    );
    expect(childClasses(leaf)).toEqual([
      "a-appwin__mark a-appwin__leafmark",
      "a-appwin__leafmsg",
      "a-appwin__leafage",
      "a-appwin__leaflogo",
    ]);
  });

  it("hooks a pane that has an id, and only that pane", () => {
    const rail = parse(renderStageRail(RAIL));

    expect(rail.querySelectorAll("[data-tail]")).toHaveLength(3);
    expect(rail.querySelectorAll("[data-dot]")).toHaveLength(3);
    expect(
      rail.querySelector('[data-tail="claude"]').getAttribute("class"),
    ).toBe("a-appwin__leafmsg");
    expect(rail.querySelector('[data-dot="claude"]').getAttribute("class")).toBe(
      "a-appwin__mark a-appwin__leafmark",
    );

    // The bare row's pane is static — an attribute spelled "null" would be a
    // hook the stream engine could still match.
    const row = rail.querySelector(".a-appwin__row");
    expect(row.querySelector("[data-tail]")).toBe(null);
    expect(row.querySelector("[data-dot]")).toBe(null);
  });

  it("omits the age cell when a pane has no age", () => {
    const pane = { ...FRAMED_CLUSTER.tabs[0].panes[0], age: "" };
    const rail = parse(
      renderStageRail([{ project: "p", tabs: [{ framed: true, panes: [pane] }] }]),
    );

    expect(rail.querySelectorAll(".a-appwin__leafage")).toHaveLength(0);
    expect(childClasses(rail.querySelector(".a-appwin__leaf"))).toEqual([
      "a-appwin__mark a-appwin__leafmark",
      "a-appwin__leafmsg",
      "a-appwin__leaflogo",
    ]);
  });

  it("puts the state on the mark as well as on the button", () => {
    const rail = parse(renderStageRail(RAIL));
    const marks = [...rail.querySelectorAll(".a-appwin__mark")];

    expect(marks.map((mark) => mark.getAttribute("data-state"))).toEqual([
      "working",
      "done",
      "done",
      "asked",
    ]);
    expect(
      [...rail.querySelectorAll(".a-appwin__leaf, .a-appwin__row")].map((row) =>
        row.getAttribute("data-state"),
      ),
    ).toEqual(["working", "done", "done", "asked"]);
  });

  it("keeps the spinner in every mark, in every state", () => {
    // CSS decides what shows, which is what lets the stream engine repaint a
    // pane's whole status by writing one attribute.
    const rail = parse(renderStageRail(RAIL));
    const marks = rail.querySelectorAll(".a-appwin__mark");

    expect(marks).toHaveLength(4);
    for (const mark of marks) {
      expect(mark.querySelectorAll(".a-appwin__wsspinner")).toHaveLength(1);
      expect(mark.querySelectorAll(".a-appwin__wsdot")).toHaveLength(8);
    }
  });

  it("numbers the spinner's dots from ZERO", () => {
    // The delay is `calc((var(--dot) - 8) * 0.15s)`: at 1…8 nothing is
    // negative and the ring pops in on its first painted frame.
    const dots = [
      ...parse(renderStageRail([FRAMED_CLUSTER])).querySelectorAll(
        ".a-appwin__leafmark .a-appwin__wsdot",
      ),
    ].slice(0, 8);
    const indices = dots.map((dot) =>
      Number(dot.getAttribute("style").replace("--dot:", "").trim()),
    );

    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(7);
    }
  });

  it("starts the ring at twelve o'clock on a 26 box", () => {
    const spinner = parse(renderStageRail([FRAMED_CLUSTER])).querySelector(
      ".a-appwin__wsspinner",
    );
    const first = spinner.querySelector(".a-appwin__wsdot");

    expect(spinner.getAttribute("viewBox")).toBe("0 0 26 26");
    expect(first.getAttribute("cx")).toBe("13");
    expect(first.getAttribute("cy")).toBe("2.6");
    expect(first.getAttribute("r")).toBe("2.2");
  });

  it("hides a collapsed cluster's rows and keeps its caret", () => {
    const rail = parse(
      renderStageRail([{ ...FRAMED_CLUSTER, collapsed: true }]),
    );

    expect(
      rail
        .querySelector(".a-appwin__cluster")
        .classList.contains("is-collapsed"),
    ).toBe(true);
    expect(rail.querySelectorAll(".a-appwin__item")).toHaveLength(0);
    expect(rail.querySelectorAll(".a-appwin__leaf")).toHaveLength(0);
    expect(rail.querySelectorAll(".a-appwin__clustercaret")).toHaveLength(1);
  });

  it("bakes a hover only when the data asks for one", () => {
    const resting = parse(renderStageRail(RAIL));
    expect(resting.querySelectorAll(".is-hover")).toHaveLength(0);

    const hovered = parse(
      renderStageRail([
        { ...FRAMED_CLUSTER, hovered: true },
        { ...REMEMBERED_CLUSTER, hovered: true },
      ]),
    );
    const heads = [...hovered.querySelectorAll(".a-appwin__clusterhead")];
    expect(heads.map((head) => head.getAttribute("class"))).toEqual([
      "a-appwin__clusterhead is-hover",
      "a-appwin__clusterhead is-still is-hover",
    ]);
  });

  it("wears the app's framed launcher on a project header", () => {
    // `PlusSquare`'s frame is the one thing that tells the two glyphs apart in
    // the DOM: if a refactor collapses them, this rect goes missing here or
    // appears at the two bare `+` controls below.
    const add = parse(renderStageRail([FRAMED_CLUSTER])).querySelector(
      ".a-appwin__clusteradd",
    );
    expect(add.querySelector("svg rect")).not.toBe(null);
    expect(add.querySelectorAll("svg path")).toHaveLength(1);

    const remembered = parse(renderStageRail([REMEMBERED_CLUSTER])).querySelector(
      ".a-appwin__clusteradd",
    );
    expect(remembered.querySelector("svg rect")).not.toBe(null);
  });

  it("draws a monogram for an agent with no brand file", () => {
    const pane = {
      id: null,
      agent: "cursor-agent",
      message: "Ready.",
      age: "5w",
      state: "idle",
    };
    const rail = renderStageRail([
      { project: "p", tabs: [{ framed: false, panes: [pane] }] },
    ]);

    expect(rail).not.toContain('src="null"');
    expect(rail).not.toContain('src="undefined"');
    const mono = parse(rail).querySelector(".a-appwin__rowlogo");
    expect(mono.tagName).toBe("SPAN");
    expect(mono.getAttribute("class")).toBe(
      "a-appwin__rowlogo a-appwin__rowlogo--mono",
    );
    expect(mono.textContent).toBe("C");
  });

  it("draws no close on a row — a control that cannot close is a lie", () => {
    const rail = renderStageRail(RAIL);
    expect(rail).not.toContain("rowclose");
    expect(rail).not.toContain("leafclose");
  });
});

describe("renderStageStrip", () => {
  it("returns markup for a fixture and for an empty strip", () => {
    for (const html of [renderStageStrip(STRIP), renderStageStrip([])]) {
      expect(typeof html).toBe("string");
      const text = withoutAssetUrls(html);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("[object Object]");
      expect(text).not.toContain("null");
    }
  });

  it("draws one chip shape per surface, differing only by its glyph", () => {
    const strip = parse(renderStageStrip(STRIP));
    const chips = [...strip.querySelectorAll(".a-appwin__chip")];

    expect(chips.map((chip) => chip.getAttribute("data-kind"))).toEqual([
      "terminal",
      "file",
      "browser",
    ]);
    expect(chips.map((chip) => chip.classList.contains("is-active"))).toEqual([
      true,
      false,
      false,
    ]);
    // One mark slot: an <img> for the agent, an <svg> for the other two.
    expect(
      chips.map((chip) => chip.querySelector(".a-appwin__chiplogo").tagName),
    ).toEqual(["IMG", "SPAN", "SPAN"]);
    for (const chip of chips.slice(1)) {
      expect(chip.querySelectorAll(".a-appwin__chiplogo svg")).toHaveLength(1);
    }
  });

  it("hooks the terminal chip's label and closes only the active chip", () => {
    const strip = parse(renderStageStrip(STRIP));
    const [terminal, file, browser] = [
      ...strip.querySelectorAll(".a-appwin__chip"),
    ];

    expect(childClasses(terminal)).toEqual([
      "a-appwin__chiplogo",
      "a-appwin__chiplabel",
      "a-appwin__chipclose",
    ]);
    expect(
      terminal.querySelector(".a-appwin__chiplabel").getAttribute("data-tail"),
    ).toBe("claude");
    for (const chip of [file, browser]) {
      expect(childClasses(chip)).toEqual([
        "a-appwin__chiplogo",
        "a-appwin__chiplabel",
      ]);
      expect(chip.querySelector("[data-tail]")).toBe(null);
    }
  });

  it("shows no colour dot, no attention mark and no rename affordance", () => {
    // All three came off the strip on 2026-08-16; agent state is the rail's
    // job. The child-class assertions above are the real guard; this names it.
    const strip = renderStageStrip(STRIP);
    for (const gone of ["chipdot", "chipattn", "chipname", "chiprename"]) {
      expect(strip).not.toContain(gone);
    }
  });

  it("closes the chips with the +, then More, then the panel toggle", () => {
    const strip = parse(renderStageStrip(STRIP)).firstElementChild;
    const chips = strip.querySelector(".a-appwin__chips");
    const actions = strip.querySelector(".a-appwin__stripactions");

    expect(childClasses(strip)).toEqual([
      "a-appwin__chips",
      "a-appwin__stripactions",
    ]);
    expect(chips.lastElementChild.getAttribute("class")).toBe(
      "a-appwin__chipadd",
    );
    // The strip's `+` is the bare Plus the app draws at 13px, not the rail's
    // framed launcher.
    expect(chips.lastElementChild.querySelector("svg rect")).toBe(null);
    expect(childClasses(actions)).toEqual(["a-appwin__ctl", "a-appwin__ctl"]);
  });

  it("mirrors the panel toggle's glyph in the markup, not in CSS", () => {
    // The frame row's toggle and this one are the same icon; the app flips
    // this one because it points at a panel on the right.
    const actions = parse(renderStageStrip(STRIP)).querySelector(
      ".a-appwin__stripactions",
    );
    const [more, dock] = [...actions.children];

    expect(more.querySelectorAll("circle")).toHaveLength(3);
    expect(dock.innerHTML).toContain("translate(24 0) scale(-1 1)");
    expect(more.innerHTML).not.toContain("scale(-1 1)");
  });
});

describe("the file's idiom", () => {
  it("builds every string by template literal — no DOM API", () => {
    expect(appwinSource).not.toContain("document.");
    expect(appwinSource).not.toContain("createElement");
  });

  it("keeps the three renderers the marketing video links against", () => {
    // Removing `renderStageStatus` alone breaks eight call sites.
    expect(typeof renderStageSidebar).toBe("function");
    expect(typeof renderStageStatus).toBe("function");
    expect(typeof renderStageTitlebar).toBe("function");
  });
});
