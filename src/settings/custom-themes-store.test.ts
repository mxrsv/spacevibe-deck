import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/theme-host", () => ({
  listThemeFiles: vi.fn(async () => ({ entries: [], rejected: [] })),
  importThemeFiles: vi.fn(async () => ({ entries: [], rejected: [] })),
  revealThemesFolder: vi.fn(async () => {}),
}));

import { importThemeFiles, listThemeFiles } from "../host/theme-host";
import { DEFAULT_SETTINGS, validateSettings } from "./settings-schema";
import {
  importCustomThemes,
  loadCustomThemes,
  themeImportFailures,
  themeLoadState,
  themesLoading,
} from "./custom-themes-store";
import { customPresets, getPreset, THEME_PRESETS } from "./themes";

const mockedList = vi.mocked(listThemeFiles);
const mockedImport = vi.mocked(importThemeFiles);

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
} {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, decline) => {
    reject = decline;
  });
  return { promise, reject };
}

const ORANGE = JSON.stringify({
  name: "Orange Mechanic",
  background: "#101014",
  foreground: "#e8e3d8",
});

const MID_GRAY = JSON.stringify({
  name: "Mid Gray",
  background: "#777777",
  foreground: "#000000",
});

beforeEach(() => {
  customPresets.value = [];
  themeImportFailures.value = [];
  themeLoadState.value = { status: "idle" };
  vi.clearAllMocks();
  mockedList.mockResolvedValue({ entries: [], rejected: [] });
});

describe("loadCustomThemes", () => {
  it("publishes one preset per file that parses", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });

    await loadCustomThemes();

    expect(customPresets.value).toEqual([
      {
        id: "file:orange.json",
        label: "Orange Mechanic",
        fileName: "orange.json",
        theme: expect.objectContaining({ background: "#101014" }),
      },
    ]);
    expect(themesLoading.value).toBe(false);
  });

  it("keeps a file that does not parse as a named reason", async () => {
    // Dropping it silently would look like the import never happened, and the
    // user would import the same broken file again.
    mockedList.mockResolvedValue({
      entries: [{ fileName: "broken.json", content: "{}" }],
      rejected: [],
    });

    await loadCustomThemes();

    expect(customPresets.value).toEqual([]);
    expect(themeImportFailures.value).toEqual([
      { fileName: "broken.json", reason: expect.any(String) },
    ]);
  });

  it("surfaces a parseable theme that cannot keep Deck chrome readable", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "mid-gray.json", content: MID_GRAY }],
      rejected: [],
    });

    await loadCustomThemes();

    expect(customPresets.value).toEqual([]);
    expect(themeImportFailures.value).toEqual([
      { fileName: "mid-gray.json", reason: expect.stringContaining("DL-3.5") },
    ]);
  });

  it("surfaces a file the host refused, beside the ones the parser refused", async () => {
    // DL-24.6 covers both halves: a file screened out before it reached the
    // folder and a file that reached the parser and failed are the same thing
    // to the user — "I picked this and got no theme".
    mockedList.mockResolvedValue({
      entries: [{ fileName: "broken.json", content: "{}" }],
      rejected: [
        { fileName: "screenshot.png", reason: ".png is not a theme file" },
      ],
    });

    await loadCustomThemes();

    expect(themeImportFailures.value).toEqual([
      { fileName: "screenshot.png", reason: ".png is not a theme file" },
      { fileName: "broken.json", reason: expect.any(String) },
    ]);
  });

  it("keeps the last-good themes and reports an unreachable host", async () => {
    customPresets.value = [
      { id: "file:stale.json", label: "Stale", theme: THEME_PRESETS[0].theme },
    ];
    mockedList.mockRejectedValue(new Error("Deck host bridge is unavailable"));

    await loadCustomThemes();

    expect(customPresets.value.map((preset) => preset.label)).toEqual([
      "Stale",
    ]);
    expect(themeLoadState.value).toEqual({
      status: "error",
      message: "Couldn't read the themes folder.",
    });
    expect(themesLoading.value).toBe(false);
  });

  it("ignores an older scan failure after a retry succeeds", async () => {
    const oldScan = deferred<never>();
    mockedList
      .mockImplementationOnce(() => oldScan.promise)
      .mockResolvedValueOnce({
        entries: [{ fileName: "orange.json", content: ORANGE }],
        rejected: [],
      });

    const first = loadCustomThemes();
    const retry = loadCustomThemes();
    await retry;
    oldScan.reject(new Error("stale scan failure"));
    await first;

    expect(customPresets.value.map((preset) => preset.label)).toEqual([
      "Orange Mechanic",
    ]);
    expect(themeLoadState.value).toEqual({ status: "ready" });
    expect(themesLoading.value).toBe(false);
  });
});

describe("importCustomThemes", () => {
  it("publishes the folder the host returns after the copy", async () => {
    // The host answers with the WHOLE folder, not just the new files, so the
    // renderer never has to merge two lists and get the order wrong.
    mockedImport.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });

    await importCustomThemes();

    expect(customPresets.value.map((preset) => preset.label)).toEqual([
      "Orange Mechanic",
    ]);
    expect(mockedList).not.toHaveBeenCalled();
  });
});

describe("an imported theme across a relaunch", () => {
  it("survives settings validation with its file id intact", () => {
    // `themeId` is persisted before the folder is ever scanned, so a validator
    // that clamped unknown ids to a known preset would reset the user's
    // imported theme on every launch — silently, and only for imports.
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, themeId: "file:orange.json" })
        .themeId,
    ).toBe("file:orange.json");
  });

  it("is resolvable once the boot scan lands", async () => {
    // `main.tsx` runs `loadCustomThemes()` at boot for exactly this: until it
    // lands, `getPreset` can only answer with the built-in fallback.
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });
    expect(getPreset("file:orange.json").id).toBe(THEME_PRESETS[0].id);

    await loadCustomThemes();

    expect(getPreset("file:orange.json").label).toBe("Orange Mechanic");
  });
});

describe("getPreset over both sources", () => {
  it("resolves an imported theme by its file id", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });
    await loadCustomThemes();

    expect(getPreset("file:orange.json").label).toBe("Orange Mechanic");
  });

  it("falls back to the first built-in for a theme whose file is gone", () => {
    // `themeId` persists across launches; the file may not.
    expect(getPreset("file:deleted.json").id).toBe(THEME_PRESETS[0].id);
  });
});
