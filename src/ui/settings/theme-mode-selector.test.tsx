// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above every other statement in the file, so
// the spies they close over have to be hoisted with them.
const { ask, reportPersistError, updateSettings } = vi.hoisted(() => ({
  ask: vi.fn(async () => true),
  reportPersistError: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../host/dialog-host", () => ({
  ask,
  open: vi.fn(async () => null),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return { ...actual, reportPersistError };
});
vi.mock("../../settings/settings-store", async () => {
  const { signal } = await import("@preact/signals");
  const { DEFAULT_SETTINGS } = await import("../../settings/settings-schema");
  return { settings: signal(DEFAULT_SETTINGS), updateSettings };
});

import { ThemeModeSelector } from "./theme-mode-selector";
import { settings } from "../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { customPresets, getPreset } from "../../settings/themes";

describe("ThemeModeSelector", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = DEFAULT_SETTINGS;
    customPresets.value = [];
    ask.mockClear();
    ask.mockResolvedValue(true);
    updateSettings.mockClear();
    reportPersistError.mockClear();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (): void => {
    act(() => {
      render(<ThemeModeSelector />, host);
    });
  };

  const options = (): HTMLButtonElement[] => [
    ...host.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];

  const selected = (): string | undefined =>
    options()
      .find((option) => option.getAttribute("aria-checked") === "true")
      ?.textContent?.trim();

  // Awaits the promise `select` starts before asserting on what it did.
  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("offers exactly two modes as one radio group", () => {
    mount();

    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      "Light",
      "Dark",
    ]);
  });

  it("names the selected value without relying on colour alone", () => {
    settings.value = { ...DEFAULT_SETTINGS, themeId: "deck-light" };
    mount();

    expect(selected()).toBe("Light");
    // One tab stop for the pair, on the selected segment (radiogroup roving
    // tabindex) — Tab enters the control, arrows move within it.
    expect(options().map((option) => option.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
    ]);
  });

  it("shows a legacy theme as the mode its background belongs to, and writes nothing", () => {
    settings.value = { ...DEFAULT_SETTINGS, themeId: "tokyo-night" };
    mount();

    expect(selected()).toBe("Dark");
    expect(updateSettings).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("converts a legacy built-in on click without asking — nothing is lost", async () => {
    settings.value = { ...DEFAULT_SETTINGS, themeId: "tokyo-night" };
    mount();

    act(() => {
      options()[0].click();
    });
    await settle();

    expect(ask).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      themeId: "deck-light",
      colorOverrides: {},
    });
  });

  it("confirms before clearing colour overrides the user can no longer see", async () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      themeId: "tokyo-night",
      colorOverrides: { background: "#101014" },
    };
    mount();

    act(() => {
      options()[1].click();
    });
    await settle();

    expect(ask).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      themeId: "deck-dark",
      colorOverrides: {},
    });
  });

  it("changes nothing when that confirmation is declined", async () => {
    ask.mockResolvedValue(false);
    settings.value = {
      ...DEFAULT_SETTINGS,
      colorOverrides: { foreground: "#abcdef" },
    };
    mount();

    act(() => {
      options()[0].click();
    });
    await settle();

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("confirms before replacing an imported theme's selection", async () => {
    customPresets.value = [
      {
        id: "file:solarized.json",
        label: "Solarized",
        fileName: "solarized.json",
        theme: getPreset("deck-light").theme,
      },
    ];
    settings.value = { ...DEFAULT_SETTINGS, themeId: "file:solarized.json" };
    mount();

    // Classified by what it paints, not by its id.
    expect(selected()).toBe("Light");

    act(() => {
      options()[1].click();
    });
    await settle();

    expect(ask).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      themeId: "deck-dark",
      colorOverrides: {},
    });
  });

  it("treats a failed prompt as a refusal, not as consent", async () => {
    ask.mockRejectedValue(new Error("no dialog host"));
    settings.value = {
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: "#101014" },
    };
    mount();

    act(() => {
      options()[0].click();
    });
    await settle();

    expect(updateSettings).not.toHaveBeenCalled();
    expect(reportPersistError).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite the value when the selected segment is clicked again", async () => {
    settings.value = { ...DEFAULT_SETTINGS, themeId: "deck-dark" };
    mount();

    act(() => {
      options()[1].click();
    });
    await settle();

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("moves the selection with Left/Right, the way a radio group does", async () => {
    settings.value = { ...DEFAULT_SETTINGS, themeId: "deck-dark" };
    mount();

    act(() => {
      options()[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    await settle();

    expect(updateSettings).toHaveBeenCalledWith({
      themeId: "deck-light",
      colorOverrides: {},
    });
  });
});
