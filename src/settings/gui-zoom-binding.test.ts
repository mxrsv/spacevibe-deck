// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindGuiZoom } from "./gui-zoom-binding";
import { DEFAULT_SETTINGS } from "./settings-schema";
import { settings } from "./settings-store";

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(1);
  vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
  settings.value = DEFAULT_SETTINGS;
  document.documentElement.style.removeProperty("--gui-zoom");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bindGuiZoom", () => {
  it("applies the stored zoom at once and again on each change", () => {
    settings.value = { ...DEFAULT_SETTINGS, guiZoom: 1.25 };
    const stop = bindGuiZoom();

    expect(document.documentElement.style.getPropertyValue("--gui-zoom")).toBe("1.25");
    expect(invoke).toHaveBeenLastCalledWith("window_set_gui_zoom", { factor: 1.25 });

    settings.value = { ...settings.value, guiZoom: 0.85 };
    expect(document.documentElement.style.getPropertyValue("--gui-zoom")).toBe("0.85");
    expect(invoke).toHaveBeenLastCalledWith("window_set_gui_zoom", { factor: 0.85 });
    stop();
  });

  it("applies a bad stored value as 1", () => {
    settings.value = { ...DEFAULT_SETTINGS, guiZoom: 7 };
    const stop = bindGuiZoom();
    expect(document.documentElement.style.getPropertyValue("--gui-zoom")).toBe("1");
    expect(invoke).toHaveBeenLastCalledWith("window_set_gui_zoom", { factor: 1 });
    stop();
  });

  it("stops following the setting once stopped", () => {
    const stop = bindGuiZoom();
    stop();
    invoke.mockClear();
    settings.value = { ...DEFAULT_SETTINGS, guiZoom: 1.1 };
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not zoom or call the host in the browser preview", () => {
    vi.unstubAllGlobals();
    settings.value = { ...DEFAULT_SETTINGS, guiZoom: 1.25 };
    const stop = bindGuiZoom();
    expect(document.documentElement.style.getPropertyValue("--gui-zoom")).toBe("1");
    expect(invoke).not.toHaveBeenCalled();
    stop();
  });
});
