// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveGuiZoom, textFontSize } from "./gui-zoom";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("effectiveGuiZoom", () => {
  it("is the setting under the Electron host", () => {
    vi.stubGlobal("__deckHost", {});
    expect(effectiveGuiZoom({ guiZoom: 1.25 })).toBe(1.25);
  });

  it("is 1 without a host, where nothing zooms the page", () => {
    expect(effectiveGuiZoom({ guiZoom: 1.25 })).toBe(1);
  });

  it("is 1 for a value that is no step", () => {
    vi.stubGlobal("__deckHost", {});
    expect(effectiveGuiZoom({ guiZoom: 0.5 })).toBe(1);
  });
});

describe("textFontSize", () => {
  it("divides the font by the zoom under the host, so text keeps its size", () => {
    vi.stubGlobal("__deckHost", {});
    expect(textFontSize({ fontSize: 14, guiZoom: 1.25 })).toBe(11.2);
    expect(textFontSize({ fontSize: 14, guiZoom: 0.9 })).toBe(15.556);
  });

  it("leaves the font alone without a host", () => {
    expect(textFontSize({ fontSize: 14, guiZoom: 1.25 })).toBe(14);
  });
});
