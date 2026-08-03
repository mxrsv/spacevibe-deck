import { describe, expect, it } from "vitest";
import { activeCategory } from "./active-category-store";

describe("activeCategory", () => {
  it("defaults to appearance", () => {
    expect(activeCategory.value).toBe("appearance");
  });

  it("sticks when assigned", () => {
    activeCategory.value = "colors";
    expect(activeCategory.value).toBe("colors");

    activeCategory.value = "notifications";
    expect(activeCategory.value).toBe("notifications");
  });
});
