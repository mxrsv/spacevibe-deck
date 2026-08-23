import { describe, expect, it } from "vitest";
import { activeCategory } from "./active-category-store";

describe("activeCategory", () => {
  it("defaults to appearance", () => {
    expect(activeCategory.value).toBe("appearance");
  });

  it("sticks when assigned", () => {
    activeCategory.value = "terminal";
    expect(activeCategory.value).toBe("terminal");

    activeCategory.value = "notifications";
    expect(activeCategory.value).toBe("notifications");

    activeCategory.value = "privacy";
    expect(activeCategory.value).toBe("privacy");
  });
});
