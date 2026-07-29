import { describe, expect, it } from "vitest";
import {
  generatedTextMatches,
  rustfmtArguments,
} from "./generated-text";

describe("generatedTextMatches", () => {
  it("treats LF and CRLF as the same generated content", () => {
    expect(generatedTextMatches("first\nsecond\n", "first\r\nsecond\r\n")).toBe(
      true,
    );
  });

  it("still detects real generated content drift", () => {
    expect(generatedTextMatches("first\nsecond\n", "first\nchanged\n")).toBe(
      false,
    );
  });

  it("formats generated Rust with the crate edition", () => {
    expect(rustfmtArguments("menu_registry.rs")).toEqual([
      "--edition",
      "2021",
      "menu_registry.rs",
    ]);
  });
});
