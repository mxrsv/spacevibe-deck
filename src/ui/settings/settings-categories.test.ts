import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-categories";

describe("SETTINGS_CATEGORIES", () => {
  it("lists exactly the five navigable categories, in rail display order", () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      "appearance",
      "colors",
      "terminal",
      "links-editor",
      "notifications",
    ]);
  });

  it('excludes "reset" — it is rendered by the rail foot, not the category registry', () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("reset");
  });
});
