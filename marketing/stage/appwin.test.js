// @vitest-environment jsdom
/**
 * T2's own assertions, next to the file it owns.
 *
 * Fixtures are LOCAL rather than imported from `stage-data.js`: the renderers
 * are pure functions of their argument, and a test that reached for the
 * shipped hero fixture would fail the day a scene changed a sentence. The
 * shapes below are the 1.1 rail's — project → checkout → pane — spelled out.
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
  renderStageStatusMark,
  renderStageStrip,
  renderStageTitlebar,
} from "./appwin.js";

const PRIMARY = { kind: "role", text: "Primary" };

const OPEN_PROJECT = {
  project: "spacevibe-deck",
  checkouts: [
    {
      name: "main",
      badge: PRIMARY,
      age: "now",
      open: true,
      active: true,
      panes: [
        {
          id: "claude",
          agent: "claude",
          label: "I'll trace why the pane divider drifts on resize.",
          state: "working",
          focused: true,
        },
        { id: "codex", agent: "codex", label: "96 passed · 0 failed", state: "done" },
        {
          id: "opencode",
          agent: "opencode",
          label: "typecheck clean · the branch follows cwd now",
          state: "done",
        },
      ],
    },
  ],
};

const CLOSED_PROJECT = {
  project: "spacevibe-api",
  checkouts: [
    {
      name: "main",
      badge: PRIMARY,
      age: "3h",
      panes: [
        {
          id: null,
          agent: "gemini",
          label: "Should I apply the pending migration?",
          state: "asked",
        },
      ],
    },
    { name: "billing", badge: { kind: "branch", text: "feat/billing" }, panes: [] },
  ],
};

const REMEMBERED_PROJECT = {
  project: "spacevibe-hub",
  remembered: true,
  checkouts: [{ name: "main", badge: PRIMARY, panes: [] }],
};

const RAIL = [OPEN_PROJECT, CLOSED_PROJECT, REMEMBERED_PROJECT];

/** One closed card holding `panes`, for the strip's own assertions. */
function closedCard(panes) {
  return [
    {
      project: "p",
      checkouts: [
        { name: "wt", badge: { kind: "branch", text: "feat/wt" }, age: "2m", panes },
      ],
    },
  ];
}

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
  { kind: "board", label: "Agents", active: false },
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
    for (const name of ["splitRow", "splitColumn", "closePane", "expand", "gear"]) {
      expect(typeof STAGE_ICONS[name]).toBe("string");
    }
  });

  it("carries every glyph the 1.1 chrome draws", () => {
    for (const name of [
      "sidebar",
      "plus",
      "squares",
      "branch",
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

  it("dropped the project header's framed launcher with the control", () => {
    // 1.1 took the header's `+` off (`rail-create-consolidation`); its
    // PlusSquare glyph had no other caller.
    expect(STAGE_ICONS.plusSquare).toBeUndefined();
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

  it("draws the bare Plus on `New`", () => {
    const glyph = row.querySelector(".a-appwin__newglyph");
    expect(glyph.querySelector("svg")).not.toBe(null);
    expect(glyph.querySelector("svg rect")).toBe(null);
  });

  it("reuses the titlebar's own traffic lights", () => {
    expect(row.querySelectorAll(".a-appwin__lights i")).toHaveLength(3);
  });
});

describe("renderStageRail — the frame and the project headers", () => {
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
    expect(childClasses(aside)).toEqual(["a-appwin__framerow", "a-appwin__raillist"]);
  });

  it("gives a live header exactly two children — the toggle and the close", () => {
    // A two-track grid with a third direct child auto-places onto an implicit
    // second row; the caret therefore lives INSIDE the toggle. The header's
    // `+` is gone since 1.1 — every checkout carries its own.
    const head = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__clusterhead");
    expect(childClasses(head)).toEqual(["a-appwin__clustertoggle", "a-appwin__clusterremove"]);

    const toggle = head.querySelector(".a-appwin__clustertoggle");
    expect(childClasses(toggle)).toEqual([
      "a-appwin__clusterfolder",
      "a-appwin__clustername",
      "a-appwin__clustercaret",
    ]);
    expect(toggle.querySelector(".a-appwin__clustername").textContent).toBe("spacevibe-deck");
  });

  it("gives a remembered header a still label, a ×, no caret, and bare checkouts", () => {
    const rail = parse(renderStageRail([REMEMBERED_PROJECT]));
    const head = rail.querySelector(".a-appwin__clusterhead");

    expect(head.classList.contains("is-still")).toBe(true);
    expect(rail.querySelectorAll(".a-appwin__clustercaret")).toHaveLength(0);
    expect(rail.innerHTML).not.toContain("clustercaret");
    expect(childClasses(head)).toEqual(["a-appwin__clusterstill", "a-appwin__clusterremove"]);
    // Nothing is open, so its checkout is a bare row and never a card.
    expect(rail.querySelectorAll(".a-appwin__bare")).toHaveLength(1);
    expect(rail.querySelectorAll(".a-appwin__card")).toHaveLength(0);
  });

  it("draws no `+` on any header", () => {
    const rail = renderStageRail([...RAIL, { ...OPEN_PROJECT, hovered: true }]);
    expect(rail).not.toContain("clusteradd");
  });

  it("hides a collapsed project's checkouts and keeps its caret", () => {
    const rail = parse(renderStageRail([{ ...OPEN_PROJECT, collapsed: true }]));

    expect(rail.querySelector(".a-appwin__cluster").classList.contains("is-collapsed")).toBe(true);
    expect(rail.querySelectorAll(".a-appwin__card")).toHaveLength(0);
    expect(rail.querySelectorAll(".a-appwin__bare")).toHaveLength(0);
    expect(rail.querySelectorAll(".a-appwin__clustercaret")).toHaveLength(1);
  });

  it("bakes a hover only when the data asks for one", () => {
    const resting = parse(renderStageRail(RAIL));
    expect(resting.querySelectorAll(".is-hover")).toHaveLength(0);

    const hovered = parse(
      renderStageRail([
        { ...OPEN_PROJECT, hovered: true },
        { ...REMEMBERED_PROJECT, hovered: true },
      ]),
    );
    expect(
      [...hovered.querySelectorAll(".a-appwin__clusterhead")].map((head) =>
        head.getAttribute("class"),
      ),
    ).toEqual(["a-appwin__clusterhead is-hover", "a-appwin__clusterhead is-still is-hover"]);
  });
});

describe("renderStageRail — the checkout card", () => {
  it("names the card by the head's four cells", () => {
    const head = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__cardhead");

    expect(childClasses(head)).toEqual([
      "a-appwin__cardmark",
      "a-appwin__cardname",
      "a-appwin__cardbadge",
      "a-appwin__cardchevron",
    ]);
    expect(head.querySelector(".a-appwin__cardname").textContent).toBe("main");
  });

  it("badges the primary by its role and a worktree by its branch", () => {
    // The app's naming rule: the primary is named by its branch, so its badge
    // says `Primary`; a worktree is named by its folder, so its badge carries
    // the branch and the GitBranch glyph.
    const primary = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__cardbadge");
    expect(primary.dataset.kind).toBe("role");
    expect(primary.textContent).toBe("Primary");
    expect(primary.querySelector("svg")).toBeNull();

    const branch = parse(renderStageRail([CLOSED_PROJECT])).querySelector(".a-appwin__barebadge");
    expect(branch.dataset.kind).toBe("branch");
    expect(branch.textContent).toBe("feat/billing");
    expect(branch.querySelector("svg")).not.toBeNull();
  });

  it("states open, active and the age on the card", () => {
    const card = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__card");

    expect(card.dataset.open).toBe("true");
    expect(card.dataset.active).toBe("true");
    expect(card.querySelector(".a-appwin__cardmeta").textContent).toBe("now");

    const closed = parse(renderStageRail([CLOSED_PROJECT])).querySelector(".a-appwin__card");
    expect(closed.dataset.open).toBe("false");
    expect(closed.dataset.active).toBe("false");
  });

  it("omits the age line when a checkout has none", () => {
    const rail = parse(
      renderStageRail(closedCard([{ id: null, agent: "codex", label: "x", state: "done" }]).map(
        (project) => ({
          ...project,
          checkouts: project.checkouts.map(({ age: _age, ...checkout }) => checkout),
        }),
      )),
    );
    expect(rail.querySelectorAll(".a-appwin__cardmeta")).toHaveLength(0);
  });

  it("lists an open card's agents as rows, then `New agent`, and draws no strip", () => {
    const card = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__card");

    expect(card.querySelector(".a-appwin__cardcount").textContent).toBe("3 active");
    expect(card.querySelectorAll(".a-appwin__cardrow")).toHaveLength(3);
    expect(card.lastElementChild.getAttribute("class")).toBe("a-appwin__cardnew");
    expect(card.lastElementChild.textContent.trim()).toBe("New agent");
    expect(card.querySelector(".a-appwin__cardstrip")).toBeNull();
  });

  it("gives a row its glyph, its sentence and one state slot", () => {
    const row = parse(renderStageRail([OPEN_PROJECT])).querySelector(".a-appwin__cardrow");

    expect(childClasses(row)).toEqual([
      "a-appwin__cardglyph",
      "a-appwin__cardlabel",
      "a-appwin__cardstatus",
    ]);
    expect(row.querySelector(".a-appwin__cardlabel").textContent).toBe(
      "I'll trace why the pane divider drifts on resize.",
    );
    expect(row.dataset.focused).toBe("true");
  });

  it("keeps both state marks in every status cell, in every state", () => {
    // CSS decides what paints, which is what lets the stream engine repaint a
    // pane's whole status by writing one attribute.
    const cells = parse(renderStageRail([OPEN_PROJECT])).querySelectorAll(".a-appwin__cardstatus");

    expect([...cells].map((cell) => cell.dataset.state)).toEqual(["working", "done", "done"]);
    for (const cell of cells) {
      expect(cell.querySelectorAll(".a-appwin__cardload > i")).toHaveLength(3);
      expect(cell.querySelectorAll(".a-appwin__carddot")).toHaveLength(1);
    }
  });

  it("hooks a pane that has an id, and only that pane", () => {
    const rail = parse(renderStageRail(RAIL));

    expect(rail.querySelectorAll("[data-tail]")).toHaveLength(3);
    expect(rail.querySelectorAll("[data-dot]")).toHaveLength(3);
    expect(rail.querySelector('[data-tail="claude"]').getAttribute("class")).toBe(
      "a-appwin__cardlabel",
    );
    expect(rail.querySelector('[data-dot="claude"]').getAttribute("class")).toBe(
      "a-appwin__cardstatus",
    );

    // A closed card has no row for a sentence to land in, and its static pane
    // carries no hook — an attribute spelled "null" would still match.
    const closed = parse(renderStageRail([CLOSED_PROJECT]));
    expect(closed.querySelector("[data-tail]")).toBe(null);
    expect(closed.querySelector("[data-dot]")).toBe(null);
  });

  it("draws a checkout with nothing open as a bare row", () => {
    const bare = parse(renderStageRail([CLOSED_PROJECT])).querySelector(".a-appwin__bare");

    expect(childClasses(bare)).toEqual([
      "a-appwin__baremark",
      "a-appwin__barename",
      "a-appwin__barebadge",
    ]);
    expect(bare.querySelector(".a-appwin__barename").textContent).toBe("billing");
  });

  it("draws a monogram for an agent with no brand file", () => {
    const rail = renderStageRail(
      closedCard([{ id: null, agent: "cursor-agent", label: "Ready.", state: "idle" }]),
    );

    expect(rail).not.toContain('src="null"');
    expect(rail).not.toContain('src="undefined"');
    const mono = parse(rail).querySelector(".a-appwin__cardlogo");
    expect(mono.tagName).toBe("SPAN");
    expect(mono.getAttribute("class")).toBe("a-appwin__cardlogo a-appwin__cardlogo--mono");
    expect(mono.textContent).toBe("C");
  });

  it("draws no close on a row — a control that cannot close is a lie", () => {
    const rail = renderStageRail(RAIL);
    expect(rail).not.toContain("rowclose");
    expect(rail).not.toContain("cardclose");
  });
});

describe("renderStageRail — the closed strip", () => {
  const segments = (rail) => [...parse(renderStageRail(rail)).querySelectorAll(".a-appwin__cardseg")];

  it("folds the agents into one segmented bar that ends in the checkout's `+`", () => {
    const strip = parse(renderStageRail([CLOSED_PROJECT])).querySelector(".a-appwin__cardstrip");
    const last = strip.lastElementChild;

    expect(strip.querySelectorAll(".a-appwin__cardseg")).toHaveLength(2);
    expect(last.getAttribute("class")).toBe("a-appwin__cardseg a-appwin__cardseg--add");
    // The bare Plus, not a framed launcher.
    expect(last.querySelector("svg path")).not.toBeNull();
    expect(last.querySelector("svg rect")).toBeNull();
  });

  it("gives every segment its glyph and a corner dot carrying the state", () => {
    const [segment] = segments([CLOSED_PROJECT]);

    expect(segment.dataset.state).toBe("asked");
    expect(segment.querySelectorAll(".a-appwin__cardglyph .a-appwin__carddot")).toHaveLength(1);
  });

  it("merges one agent kind into one segment, counted, wearing its loudest state", () => {
    const [claude] = segments(
      closedCard([
        { id: null, agent: "claude", label: "a", state: "done" },
        { id: null, agent: "claude", label: "b", state: "failed" },
      ]),
    );

    expect(claude.dataset.state).toBe("failed");
    expect(claude.querySelector(".a-appwin__cardtimes").textContent).toBe("×2");
  });

  it("puts the loudest kind first and draws the bars only on a working one", () => {
    const shown = segments(
      closedCard([
        { id: null, agent: "codex", label: "a", state: "done" },
        { id: null, agent: "claude", label: "b", state: "working" },
        { id: null, agent: "gemini", label: "c", state: "failed" },
        { id: null, agent: "opencode", label: "d", state: "ended" },
      ]),
    ).filter((segment) => segment.dataset.state !== undefined);

    expect(shown.map((segment) => segment.dataset.state)).toEqual([
      "failed",
      "working",
      "done",
      "ended",
    ]);
    expect(shown.map((segment) => segment.querySelectorAll(".a-appwin__cardload").length)).toEqual([
      0, 1, 0, 0,
    ]);
  });

  it("folds what does not fit into a `+N` tail and never folds the `+`", () => {
    // The gallery's own `ai-terminal` card: five kinds, three shown, `+2`.
    const all = segments(
      closedCard([
        { id: null, agent: "claude", label: "a", state: "working" },
        { id: null, agent: "codex", label: "b", state: "working" },
        { id: null, agent: "cursor-agent", label: "c", state: "done" },
        { id: null, agent: "opencode", label: "d", state: "asked" },
        { id: null, agent: "gemini", label: "e", state: "idle" },
      ]),
    );

    expect(all.map((segment) => segment.dataset.state ?? segment.className)).toEqual([
      "asked",
      "working",
      "working",
      "a-appwin__cardseg a-appwin__cardseg--more",
      "a-appwin__cardseg a-appwin__cardseg--add",
    ]);
    expect(all[3].textContent.trim()).toBe("+2");
  });
});

describe("renderStageStatusMark", () => {
  it("keeps the ring in the mark in every state", () => {
    for (const state of ["failed", "asked", "working", "done", "idle", "ended"]) {
      const mark = parse(renderStageStatusMark(state, "x")).firstElementChild;

      expect(mark.getAttribute("class")).toBe("a-appwin__mark x");
      expect(mark.dataset.state).toBe(state);
      expect(mark.querySelectorAll(".a-appwin__wsdot")).toHaveLength(8);
    }
  });

  it("numbers the ring's dots from ZERO", () => {
    // The delay is `calc((var(--dot) - 8) * 0.15s)`: at 1…8 nothing is
    // negative and the ring pops in on its first painted frame.
    const dots = [...parse(renderStageStatusMark("working", "x")).querySelectorAll(".a-appwin__wsdot")];
    const indices = dots.map((dot) => Number(dot.getAttribute("style").replace("--dot:", "").trim()));

    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("starts the ring at twelve o'clock on a 26 box", () => {
    const spinner = parse(renderStageStatusMark("working", "x")).querySelector(".a-appwin__wsspinner");
    const first = spinner.querySelector(".a-appwin__wsdot");

    expect(spinner.getAttribute("viewBox")).toBe("0 0 26 26");
    expect(first.getAttribute("cx")).toBe("13");
    expect(first.getAttribute("cy")).toBe("2.6");
    expect(first.getAttribute("r")).toBe("2.2");
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
      "board",
    ]);
    expect(chips.map((chip) => chip.classList.contains("is-active"))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    // One mark slot: an <img> for the agent, an <svg> for the other three.
    expect(chips.map((chip) => chip.querySelector(".a-appwin__chiplogo").tagName)).toEqual([
      "IMG",
      "SPAN",
      "SPAN",
      "SPAN",
    ]);
    for (const chip of chips.slice(1)) {
      expect(chip.querySelectorAll(".a-appwin__chiplogo svg")).toHaveLength(1);
    }
  });

  it("draws the Agent Board's chip as `Agents` with four squares", () => {
    const board = parse(renderStageStrip(STRIP)).querySelector('[data-kind="board"]');

    expect(board.querySelector(".a-appwin__chiplabel").textContent).toBe("Agents");
    expect(board.querySelectorAll(".a-appwin__chiplogo svg rect")).toHaveLength(4);
  });

  it("hooks the terminal chip's label and closes only the active chip", () => {
    const strip = parse(renderStageStrip(STRIP));
    const [terminal, ...others] = [...strip.querySelectorAll(".a-appwin__chip")];

    expect(childClasses(terminal)).toEqual([
      "a-appwin__chiplogo",
      "a-appwin__chiplabel",
      "a-appwin__chipclose",
    ]);
    expect(terminal.querySelector(".a-appwin__chiplabel").getAttribute("data-tail")).toBe("claude");
    for (const chip of others) {
      expect(childClasses(chip)).toEqual(["a-appwin__chiplogo", "a-appwin__chiplabel"]);
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

  it("ends the chips with no `+` — 1.1 took it off — then More and the panel toggle", () => {
    const strip = parse(renderStageStrip(STRIP)).firstElementChild;
    const chips = strip.querySelector(".a-appwin__chips");
    const actions = strip.querySelector(".a-appwin__stripactions");

    expect(childClasses(strip)).toEqual(["a-appwin__chips", "a-appwin__stripactions"]);
    expect([...chips.children].every((child) => child.classList.contains("a-appwin__chip"))).toBe(
      true,
    );
    expect(strip.outerHTML).not.toContain("chipadd");
    expect(childClasses(actions)).toEqual(["a-appwin__ctl", "a-appwin__ctl"]);
  });

  it("mirrors the panel toggle's glyph in the markup, not in CSS", () => {
    // The frame row's toggle and this one are the same icon; the app flips
    // this one because it points at a panel on the right.
    const actions = parse(renderStageStrip(STRIP)).querySelector(".a-appwin__stripactions");
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
