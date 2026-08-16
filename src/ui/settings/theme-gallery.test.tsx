// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gallery pulls in the settings store; stub its host so the tree mounts.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

// The folder round trip is `custom-themes-store`'s job and has its own test
// (`src/settings/custom-themes-store.test.ts`). Stubbing it here keeps this
// file about what the component does with the result: which cards exist, which
// one is checked, and what the two action rows call.
vi.mock("../../settings/custom-themes-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    themeImportFailures: signal([]),
    themesLoading: signal(false),
    loadCustomThemes: vi.fn(async () => {}),
    importCustomThemes: vi.fn(async () => {}),
    openThemesFolder: vi.fn(async () => {}),
  };
});

import {
  importCustomThemes,
  loadCustomThemes,
  openThemesFolder,
  themeImportFailures,
} from "../../settings/custom-themes-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { customPresets, THEME_PRESETS } from "../../settings/themes";
import { ThemeGallery } from "./theme-gallery";

const IMPORTED = {
  id: "file:orange.json",
  label: "Orange Mechanic",
  fileName: "orange.json",
  theme: { ...THEME_PRESETS[0].theme, background: "#101014" },
};

describe("ThemeGallery", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS };
    customPresets.value = [];
    themeImportFailures.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    vi.clearAllMocks();
  });

  const mount = (): void => {
    act(() => render(<ThemeGallery />, host));
  };

  const cards = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".theme-card"));

  const pill = (text: string): HTMLButtonElement | undefined =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".cfg-btn")).find(
      (button) => button.textContent?.includes(text),
    );

  it("renders one radio per theme, the saved one checked", () => {
    mount();

    expect(cards()).toHaveLength(THEME_PRESETS.length);
    const checked = cards().filter(
      (card) => card.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain(THEME_PRESETS[0].label);
  });

  it("re-reads the themes folder on mount", () => {
    // The documented way to remove a theme is deleting the file in Finder, so
    // a list cached for the session would keep showing a card for a dead file.
    mount();

    expect(vi.mocked(loadCustomThemes)).toHaveBeenCalledTimes(1);
  });

  it("checks the fallback card when the selected theme's file is gone", () => {
    // The documented way to remove a theme is deleting its file, so a saved
    // `file:` id outliving its file is a NORMAL state, not a corrupt one.
    // Comparing the raw id here left the grid with nothing selected while the
    // status bar and the running terminal both showed the fallback — a radio
    // group with no selection reads as broken.
    settings.value = { ...DEFAULT_SETTINGS, themeId: "file:deleted.json" };

    mount();

    const checked = cards().filter(
      (card) => card.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain(THEME_PRESETS[0].label);
  });

  it("shows imported themes after the built-ins", () => {
    customPresets.value = [IMPORTED];

    mount();

    const themeCards = cards();
    expect(themeCards).toHaveLength(THEME_PRESETS.length + 1);
    expect(themeCards[themeCards.length - 1]?.textContent).toContain(
      "Orange Mechanic",
    );
  });

  it("selecting a theme clears the previous colour overrides", () => {
    // An override is an edit to ONE theme; carrying it onto the next silently
    // corrupts the theme the user just picked from a picture of it.
    settings.value = {
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: "#ff0000" },
    };
    mount();

    act(() => cards()[1].click());

    expect(settings.value.themeId).toBe(THEME_PRESETS[1].id);
    expect(settings.value.colorOverrides).toEqual({});
  });

  it("selects an imported theme by its file id", () => {
    customPresets.value = [IMPORTED];
    mount();

    const themeCards = cards();
    act(() => {
      themeCards[themeCards.length - 1]?.click();
    });

    expect(settings.value.themeId).toBe("file:orange.json");
  });

  it("moves selection with the arrow keys and wraps", () => {
    mount();

    act(() => {
      host
        .querySelector(".theme-gallery")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
    });

    expect(settings.value.themeId).toBe(
      THEME_PRESETS[THEME_PRESETS.length - 1].id,
    );
  });

  it("names the file and the reason when one does not parse", () => {
    // A scan that silently dropped a file would look like the import never
    // happened, and the user would import the same broken file again.
    themeImportFailures.value = [
      { fileName: "broken.json", reason: "the file is empty" },
    ];

    mount();

    expect(host.textContent).toContain("broken.json");
    expect(host.textContent).toContain("the file is empty");
  });

  it("wires the import and reveal rows", () => {
    mount();

    act(() => pill("choose files")?.click());
    act(() => pill("reveal")?.click());

    expect(vi.mocked(importCustomThemes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openThemesFolder)).toHaveBeenCalledTimes(1);
  });
});
