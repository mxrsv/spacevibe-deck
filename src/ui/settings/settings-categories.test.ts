import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-categories";

describe("SETTINGS_CATEGORIES", () => {
  it("lists exactly the ten navigable categories, in rail display order", () => {
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
      // The usage-analytics consent view (spec 2026-08-22 §7): after about,
      // before reset, per the plan — the disclosure reads as an app-level
      // statement beside the build info, not a day-to-day preference.
      "privacy",
      "reset",
    ]);
  });

  /**
   * `reset` INCLUDES since 2026-08-19 (owner, DL-11.5 amended) — it was a
   * pinned rail-foot action until then, and this file asserted its absence.
   * Last on purpose: it is still the one stop that throws work away, and what
   * makes that safe is the native confirm it raises, not where it sits.
   */
  it("puts reset last rather than in the middle of the list", () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids[ids.length - 1]).toBe("reset");
  });

  it('excludes "colors" — the colour rows are a group inside appearance', () => {
    const ids: readonly string[] = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("colors");
  });

  /**
   * The description is printed on screen under every section title, so an
   * empty one is a blank line the user reads as a rendering bug, and a
   * duplicated one means two categories claim the same purpose.
   */
  describe("every category carries its own one-sentence description", () => {
    it.each(SETTINGS_CATEGORIES)(
      "$id says what it is for, in one finished sentence",
      (category) => {
        expect(category.description.trim().length).toBeGreaterThan(0);
        expect(category.description).toMatch(/\.$/);
        expect(category.description).toBe(category.description.trim());
      },
    );

    it("never repeats a description across categories", () => {
      const descriptions = SETTINGS_CATEGORIES.map((c) => c.description);
      expect(new Set(descriptions).size).toBe(descriptions.length);
    });
  });
});
