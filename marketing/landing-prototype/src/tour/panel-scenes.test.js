/**
 * The scene registry and the chrome the six scenes share.
 *
 * Six lanes rewrite six scene bodies concurrently, and every one of them has
 * to keep exporting a zero-argument function under its own key — this file is
 * that guard. It asserts the SHAPE of the registry and of `frame()`, never a
 * scene's contents, which each scene's own task owns.
 *
 * Run with `npx vitest run marketing/`, never plain Node: `agent-strip.js`
 * imports `src/assets/agent-agy.png` and only Vite's transform can resolve it.
 */

import { describe, expect, it } from "vitest";

import { SCENE_RAIL, frame, sceneAgentMark } from "./scenes/chrome.js";
import { SCENES } from "./panel-scenes.js";

const SCENE_KEYS = ["rail", "picker", "restore", "surfaces", "usage", "catalog"];

describe("SCENES", () => {
  it("holds exactly the six panel scenes", () => {
    expect(Object.keys(SCENES)).toEqual(SCENE_KEYS);
  });

  it("maps every key to a zero-argument function returning markup", () => {
    for (const key of SCENE_KEYS) {
      const scene = SCENES[key];
      expect(typeof scene, key).toBe("function");
      expect(scene.length, key).toBe(0);

      const html = scene();
      expect(typeof html, key).toBe("string");
      expect(html, key).toContain('<figure class="a-appwin tour__appwin"');
    }
  });

  it("draws no status bar and no workspace sidebar in any scene", () => {
    for (const key of SCENE_KEYS) {
      const html = SCENES[key]();
      expect(html, key).not.toContain("a-appwin__status");
      expect(html, key).not.toContain("a-appwin__wsitem");
    }
  });

  it("never prints a null brand source", () => {
    for (const key of SCENE_KEYS) {
      expect(SCENES[key](), key).not.toContain('src="null"');
    }
  });
});

describe("frame", () => {
  it("stands the body inside the stage, under the strip", () => {
    const html = frame("<b>body</b>", { strip: [{ kind: "browser", label: "x", active: false }] });

    expect(html.indexOf("a-appwin__stage")).toBeLessThan(html.indexOf("a-appwin__strip"));
    expect(html.indexOf("a-appwin__strip")).toBeLessThan(html.indexOf("<b>body</b>"));
  });

  it("defaults to the shared rail and to no strip", () => {
    const html = frame("");

    expect(html).toContain("a-appwin__rail");
    expect(html).not.toContain("a-appwin__strip");
  });

  it("omits the aside entirely when the rail is null", () => {
    const html = frame("", { rail: null });

    expect(html).not.toContain("<aside");
    expect(html).toContain("a-appwin__stage");
  });
});

describe("SCENE_RAIL", () => {
  it("is two clusters and four rows, all of them static", () => {
    expect(SCENE_RAIL).toHaveLength(2);

    const panes = SCENE_RAIL.flatMap((cluster) =>
      cluster.tabs.flatMap((tab) => tab.panes),
    );
    expect(panes).toHaveLength(4);
    expect(panes.every((pane) => pane.id === null)).toBe(true);
  });

  it("is a resting frame: nothing collapsed, nothing hovered", () => {
    expect(SCENE_RAIL.some((cluster) => cluster.collapsed)).toBe(false);
    expect(SCENE_RAIL.some((cluster) => cluster.hovered)).toBe(false);
  });

  it("is frozen, because six modules share the one object", () => {
    expect(Object.isFrozen(SCENE_RAIL)).toBe(true);
    expect(Object.isFrozen(SCENE_RAIL[0].tabs[0].panes[0])).toBe(true);
  });
});

describe("sceneAgentMark", () => {
  it("draws a brand file when the catalog has one", () => {
    expect(sceneAgentMark("claude", "scene-rail__mark")).toContain("<img");
  });

  it("falls back to a monogram instead of throwing on an unknown id", () => {
    expect(sceneAgentMark("mystery-agent", "scene-rail__mark")).toBe(
      '<span class="scene-rail__mark scene-rail__mark--mono">M</span>',
    );
  });
});
