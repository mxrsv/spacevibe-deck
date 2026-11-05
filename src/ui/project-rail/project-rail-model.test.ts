import { describe, expect, it } from "vitest";
import { isWideGlyph, projectInitials } from "./project-rail-model";

describe("projectInitials", () => {
  it("reads two initials off a Latin name", () => {
    expect(projectInitials("spacevibe-deck")).toBe("SD");
    expect(projectInitials("api")).toBe("A");
    expect(projectInitials("---")).toBe("?");
  });

  it("gives a wide first grapheme the 24 box alone (RCP-4)", () => {
    expect(projectInitials("東京 app")).toBe("東");
    expect(projectInitials("🚀 launch")).toBe("🚀");
    expect(projectInitials("한국 site")).toBe("한");
    expect(isWideGlyph("東")).toBe(true);
    expect(isWideGlyph("🚀")).toBe(true);
    expect(isWideGlyph("SD")).toBe(false);
  });
});
