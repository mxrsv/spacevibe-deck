// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_DECORATION_IDS,
  isSidebarDecorationId,
  nextSidebarDecoration,
  type SidebarDecorationId,
} from "../lib/sidebar-decorations";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { SidebarDecoration } from "./sidebar-decoration";

// Artwork and stylesheet coverage for these ids is checked on disk by
// scripts/sidebar-decoration-assets.test.ts — that scan cannot live here,
// because Vite rewrites asset paths inside `src/` before the test can read them.
const ART_IDS = SIDEBAR_DECORATION_IDS.filter((id) => id !== "off");

describe("SidebarDecoration", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = DEFAULT_SETTINGS;
  });

  const mount = (id: SidebarDecorationId): void => {
    settings.value = { ...DEFAULT_SETTINGS, sidebarDecoration: id };
    act(() => {
      render(<SidebarDecoration />, host);
    });
  };

  it("is off by default, so no ornament appears unasked", () => {
    expect(DEFAULT_SETTINGS.sidebarDecoration).toBe("off");
    mount("off");
    expect(host.querySelector(".wsbar__decor")).toBeNull();
  });

  it("renders the chosen mark, tagged by id for the CSS mask", () => {
    for (const id of ART_IDS) {
      mount(id);
      const decor = host.querySelector<HTMLElement>(".wsbar__decor");
      expect(decor).not.toBeNull();
      expect(decor?.dataset.decor).toBe(id);
    }
  });

  it("hides the ornament from assistive tech — it means nothing", () => {
    mount("orbit");
    expect(
      host.querySelector(".wsbar__decor")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("switching back to off removes the element rather than blanking it", () => {
    mount("comet");
    expect(host.querySelector(".wsbar__decor")).not.toBeNull();
    mount("off");
    expect(host.querySelector(".wsbar__decor")).toBeNull();
  });
});

describe("sidebar decoration catalog", () => {
  it("cycles through every id and wraps back to off", () => {
    const walk: SidebarDecorationId[] = [];
    let id: SidebarDecorationId = "off";
    for (let step = 0; step < SIDEBAR_DECORATION_IDS.length; step += 1) {
      id = nextSidebarDecoration(id);
      walk.push(id);
    }
    expect(walk).toEqual([...ART_IDS, "off"]);
  });

  it("rejects anything not in the set — a stale store value falls back", () => {
    expect(isSidebarDecorationId("orbit")).toBe(true);
    expect(isSidebarDecorationId("nebula")).toBe(false);
    expect(isSidebarDecorationId(null)).toBe(false);
    expect(isSidebarDecorationId(3)).toBe(false);
  });

});
