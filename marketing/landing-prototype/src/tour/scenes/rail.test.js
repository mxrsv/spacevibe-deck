// @vitest-environment jsdom
/**
 * T11's own assertions, next to the file it owns.
 *
 * The scene is parsed as DOM rather than matched as a string on purpose: every
 * claim below is about STRUCTURE that `renderStageRail` produces — which child
 * a header emits, which cluster keeps a caret, how many rows a framed item
 * holds — and a `toContain` on a class name cannot tell a caret inside the
 * still header from a caret three clusters away.
 *
 * Run with `npx vitest run marketing/`, never plain Node: the module reaches
 * `agent-strip.js`, which imports a `.png` only Vite's transform can resolve.
 */

import { describe, expect, it } from "vitest";

import { rail } from "./rail.js";

/** The scene, parsed once per assertion into a detached host element. */
function scene() {
  const host = document.createElement("div");
  host.innerHTML = rail();

  return host;
}

describe("rail scene", () => {
  it("draws its rail through the shared renderer, not its own markup", () => {
    const host = scene();

    expect(host.querySelector("aside.a-appwin__sidebar.a-appwin__rail")).not.toBeNull();
    expect(host.querySelectorAll(".a-appwin__framerow")).toHaveLength(1);
    // The rows the July scene hand-rolled. Their absence is what proves the
    // panel and the hero cannot drift apart.
    expect(host.querySelector(".scene-rail__leaf")).toBeNull();
    expect(host.querySelector(".scene-rail__list")).toBeNull();
  });

  it("draws four clusters", () => {
    expect(scene().querySelectorAll(".a-appwin__cluster")).toHaveLength(4);
  });

  it("carries all five rail states across its marks", () => {
    const states = [...scene().querySelectorAll(".a-appwin__mark")].map(
      (mark) => mark.dataset.state,
    );

    expect(new Set(states)).toEqual(
      new Set(["failed", "asked", "working", "done", "idle"]),
    );
  });

  it("bakes exactly one hover, and it is the remembered header", () => {
    const host = scene();
    const hovered = host.querySelectorAll(".a-appwin__clusterhead.is-hover");

    expect(hovered).toHaveLength(1);
    expect(hovered[0].classList.contains("is-still")).toBe(true);
    // The reveal is the whole reason this hover is baked (D6): the launcher
    // and the forget control are said here or nowhere on the page.
    expect(hovered[0].querySelector(".a-appwin__clusteradd")).not.toBeNull();
    expect(hovered[0].querySelector(".a-appwin__clusterremove")).not.toBeNull();
  });

  it("has one still header and it holds no caret element at all", () => {
    const still = scene().querySelectorAll(".a-appwin__clusterhead.is-still");

    expect(still).toHaveLength(1);
    expect(still[0].querySelector(".a-appwin__clustercaret")).toBeNull();
    expect(still[0].querySelector(".a-appwin__clustertoggle")).toBeNull();
    expect(still[0].querySelector(".a-appwin__clusterstill")).not.toBeNull();
  });

  it("has one collapsed cluster: caret kept, rows gone", () => {
    const host = scene();
    const collapsed = host.querySelectorAll(".a-appwin__cluster.is-collapsed");

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].querySelector(".a-appwin__clustercaret")).not.toBeNull();
    expect(collapsed[0].querySelectorAll(".a-appwin__item")).toHaveLength(0);
  });

  it("frames one multi-agent tab of three leaves and draws no parent row", () => {
    const host = scene();
    const framed = host.querySelectorAll(".a-appwin__item.is-framed");

    expect(framed).toHaveLength(1);
    expect(framed[0].querySelectorAll(".a-appwin__leaf")).toHaveLength(3);
    expect(framed[0].querySelectorAll(".a-appwin__row")).toHaveLength(0);

    expect(host.querySelectorAll(".a-appwin__leaf")).toHaveLength(3);
    expect(host.querySelectorAll(".a-appwin__row")).toHaveLength(3);
  });

  it("prints a red row and a yellow row among the bare ones", () => {
    const states = [...scene().querySelectorAll(".a-appwin__row")].map(
      (row) => row.dataset.state,
    );

    expect(states).toContain("failed");
    expect(states).toContain("asked");
  });

  it("gives the idle row its agent's name and no age", () => {
    const idle = [...scene().querySelectorAll(".a-appwin__row")].find(
      (row) => row.dataset.state === "idle",
    );

    expect(idle.querySelector(".a-appwin__rowmsg").textContent).toBe("Gemini CLI");
    expect(idle.querySelector(".a-appwin__rowage")).toBeNull();
  });

  it("mounts no stream, so it emits no hook that claims to be live", () => {
    const host = scene();

    expect(host.querySelectorAll("[data-tail]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-dot]")).toHaveLength(0);
  });

  it("holds the work down on the stage side and draws no tab strip", () => {
    const host = scene();

    expect(host.querySelectorAll(".scene-rail__pane")).toHaveLength(3);
    expect(host.querySelector(".scene-rail__hint").textContent).toBe(
      "the panes keep running",
    );
    expect(host.querySelector(".a-appwin__strip")).toBeNull();
  });
});
