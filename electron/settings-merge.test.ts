/** Translated from `src-tauri/src/settings_merge.rs`. */
import { describe, expect, it } from "vitest";
import { mergeSettings } from "./settings-merge";

describe("mergeSettings", () => {
  it("replaces a patched key and keeps the rest", () => {
    expect(mergeSettings({ fontSize: 13, theme: "dark" }, { fontSize: 15 })).toEqual({
      fontSize: 15,
      theme: "dark",
    });
  });

  it("replaces a nested value outright rather than deep-merging", () => {
    // Matches `{ ...settings.value, ...patch }` on the renderer side.
    expect(
      mergeSettings({ colors: { fg: "#fff", bg: "#000" } }, { colors: { fg: "#eee" } }),
    ).toEqual({ colors: { fg: "#eee" } });
  });

  it("ignores a patch that is not an object", () => {
    // Otherwise a malformed patch would replace the whole settings object.
    expect(mergeSettings({ fontSize: 13 }, "nonsense")).toEqual({ fontSize: 13 });
    expect(mergeSettings({ fontSize: 13 }, null)).toEqual({ fontSize: 13 });
    expect(mergeSettings({ fontSize: 13 }, [1, 2])).toEqual({ fontSize: 13 });
  });

  it("treats absent current settings as empty", () => {
    expect(mergeSettings(null, { fontSize: 15 })).toEqual({ fontSize: 15 });
  });
});
