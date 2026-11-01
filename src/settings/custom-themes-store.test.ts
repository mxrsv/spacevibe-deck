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
import { DECK_DARK_THEME, DECK_LIGHT_THEME } from "./built-in-themes";
import { customThemes, getTheme } from "./themes";

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

const PAPER_LIKE = JSON.stringify({
  name: "Paper Like",
  background: "#fbf7ee",
  foreground: "#2b2b2b",
  red: "#a3332b",
});

beforeEach(() => {
  customThemes.value = [];
  themeImportFailures.value = [];
  themeLoadState.value = { status: "idle" };
  vi.clearAllMocks();
  mockedList.mockResolvedValue({ entries: [], rejected: [] });
});

describe("loadCustomThemes", () => {
  it("publishes one theme per file that parses", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });

    await loadCustomThemes();

    expect(customThemes.value).toEqual([
      {
        fileName: "orange.json",
        theme: expect.objectContaining({
          id: "file:orange.json",
          name: "Orange Mechanic",
          terminal: expect.objectContaining({ background: "#101014", foreground: "#e8e3d8" }),
        }),
      },
    ]);
    expect(themesLoading.value).toBe(false);
  });

  it("replaces only the terminal: the chrome and editor are Deck Dark's for a dark file", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });

    await loadCustomThemes();

    const { theme } = customThemes.value[0];
    expect(theme.type).toBe("dark");
    expect(theme.ui).toEqual(DECK_DARK_THEME.ui);
    expect(theme.editor).toEqual(DECK_DARK_THEME.editor);
    // A slot the file leaves out keeps the built-in's value; the cursor glyph
    // is drawn on the file's own ground.
    expect(theme.terminal.blue).toBe(DECK_DARK_THEME.terminal.blue);
    expect(theme.terminal.cursorAccent).toBe("#101014");
  });

  it("takes Deck Light's chrome for a light file", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "paper-like.json", content: PAPER_LIKE }],
      rejected: [],
    });

    await loadCustomThemes();

    const { theme } = customThemes.value[0];
    expect(theme.type).toBe("light");
    expect(theme.ui).toEqual(DECK_LIGHT_THEME.ui);
    expect(theme.terminal.background).toBe("#fbf7ee");
    expect(theme.terminal.red).toBe("#a3332b");
  });

  it("keeps a file that does not parse as a named reason", async () => {
    // Dropping it silently would look like the import never happened, and the
    // user would import the same broken file again.
    mockedList.mockResolvedValue({
      entries: [{ fileName: "broken.json", content: "{}" }],
      rejected: [],
    });

    await loadCustomThemes();

    expect(customThemes.value).toEqual([]);
    expect(themeImportFailures.value).toEqual([
      { fileName: "broken.json", reason: expect.any(String) },
    ]);
  });

  it("surfaces a file the host refused, beside the ones the parser refused", async () => {
    // DL-24.6 covers both halves: a file screened out before it reached the
    // folder and a file that reached the parser and failed are the same thing
    // to the user — "I picked this and got no theme".
    mockedList.mockResolvedValue({
      entries: [{ fileName: "broken.json", content: "{}" }],
      rejected: [{ fileName: "screenshot.png", reason: ".png is not a theme file" }],
    });

    await loadCustomThemes();

    expect(themeImportFailures.value).toEqual([
      { fileName: "screenshot.png", reason: ".png is not a theme file" },
      { fileName: "broken.json", reason: expect.any(String) },
    ]);
  });

  it("keeps the last-good themes and reports an unreachable host", async () => {
    customThemes.value = [
      {
        fileName: "stale.json",
        theme: { ...DECK_DARK_THEME, id: "file:stale.json", name: "Stale" },
      },
    ];
    mockedList.mockRejectedValue(new Error("Deck host bridge is unavailable"));

    await loadCustomThemes();

    expect(customThemes.value.map((entry) => entry.theme.name)).toEqual(["Stale"]);
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

    expect(customThemes.value.map((entry) => entry.theme.name)).toEqual(["Orange Mechanic"]);
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

    expect(customThemes.value.map((entry) => entry.theme.name)).toEqual(["Orange Mechanic"]);
    expect(mockedList).not.toHaveBeenCalled();
  });
});

describe("an imported theme across a relaunch", () => {
  it("survives settings validation with its file id intact", () => {
    // `themeId` is persisted before the folder is ever scanned, so a validator
    // that clamped unknown ids to a known preset would reset the user's
    // imported theme on every launch — silently, and only for imports.
    expect(validateSettings({ ...DEFAULT_SETTINGS, themeId: "file:orange.json" }).themeId).toBe(
      "file:orange.json",
    );
  });

  it("is resolvable once the boot scan lands", async () => {
    // `main.tsx` runs `loadCustomThemes()` at boot for exactly this: until it
    // lands, `getTheme` can only answer with the built-in fallback.
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });
    expect(getTheme("file:orange.json").id).toBe(DECK_DARK_THEME.id);

    await loadCustomThemes();

    expect(getTheme("file:orange.json").name).toBe("Orange Mechanic");
  });
});

describe("getTheme over both sources", () => {
  it("resolves an imported theme by its file id", async () => {
    mockedList.mockResolvedValue({
      entries: [{ fileName: "orange.json", content: ORANGE }],
      rejected: [],
    });
    await loadCustomThemes();

    expect(getTheme("file:orange.json").name).toBe("Orange Mechanic");
  });

  it("falls back to Deck Dark for a theme whose file is gone", () => {
    // `themeId` persists across launches; the file may not.
    expect(getTheme("file:deleted.json").id).toBe(DECK_DARK_THEME.id);
  });
});
