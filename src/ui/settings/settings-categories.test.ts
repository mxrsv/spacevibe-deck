import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-categories";

describe("SETTINGS_CATEGORIES", () => {
  it("lists exactly the eight navigable categories, in rail display order", () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      "appearance",
      "browser",
      "terminal",
      "agents",
      "links-editor",
      "shortcuts",
      "notifications",
      "about",
    ]);
  });

  it('excludes "reset" — it is rendered by the rail foot, not the category registry', () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("reset");
  });

  it('excludes "colors" — the colour rows are a group inside appearance', () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("colors");
  });
});
