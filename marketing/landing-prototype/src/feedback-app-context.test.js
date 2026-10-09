import { describe, expect, it } from "vitest";

import { BODY_MAX } from "./feedback-api.js";
import { appContextLine, withAppContext } from "./feedback-app-context.js";

const line = (search) => appContextLine(new URLSearchParams(search));

describe("feedback app context", () => {
  it("names the build Deck reported", () => {
    expect(line("?v=2.7.0&os=macos")).toBe("Deck 2.7.0 · macOS");
    expect(line("?os=windows&v=2.8.0-beta.1&lang=vi")).toBe("Deck 2.8.0-beta.1 · Windows");
  });

  it("drops the prefill for anything off shape", () => {
    for (const search of [
      "",
      "?v=2.7.0",
      "?os=macos",
      "?v=2.7.0&os=linux",
      "?v=2.7.0&os=constructor",
      "?v=<b>2.7.0</b>&os=macos",
      "?v=2.7&os=macos",
      `?v=2.7.0-${"x".repeat(40)}&os=macos`,
    ]) {
      expect(line(search)).toBeNull();
    }
  });

  it("leaves room above the line in an empty body", () => {
    expect(withAppContext("", "Deck 2.7.0 · macOS")).toBe("\n\nDeck 2.7.0 · macOS");
  });

  it("appends to a restored draft and replaces an older line", () => {
    const once = withAppContext("It froze.\n", "Deck 2.7.0 · macOS");
    expect(once).toBe("It froze.\n\nDeck 2.7.0 · macOS");
    expect(withAppContext(once, "Deck 2.8.0 · macOS")).toBe("It froze.\n\nDeck 2.8.0 · macOS");
  });

  it("never pushes the body past the limit", () => {
    const full = "x".repeat(BODY_MAX - 5);
    expect(withAppContext(full, "Deck 2.7.0 · macOS")).toBe(full);
  });
});
