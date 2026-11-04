// @vitest-environment jsdom
import { render } from "preact";
import { describe, expect, it } from "vitest";
import { AgentStateMark } from "./agent-state-mark";
import { brailleDots, BrailleSpinner } from "./braille-spinner";

describe("brailleDots", () => {
  it("reads a glyph's raised dots, dots 1-3 down the left column", () => {
    expect(brailleDots("⠋")).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(brailleDots("⠹")).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  });
});

describe("BrailleSpinner", () => {
  it("draws ten frames as dots, never as braille text, and holds ⠹ still", () => {
    const host = document.createElement("div");
    render(<BrailleSpinner />, host);
    const frames = [...host.querySelectorAll("svg > g")];
    expect(frames).toHaveLength(10);
    // Drawn, so a font without the braille block still shows the mark.
    expect(host.textContent).toBe("");
    const still = frames.filter((frame) => frame.hasAttribute("data-still"));
    expect(still).toHaveLength(1);
    expect(still[0].querySelectorAll("circle")).toHaveLength(brailleDots("⠹").length);
    render(null, host);
  });
});

describe("AgentStateMark", () => {
  it("names its state and draws the spinner only while working (RCP-15)", () => {
    const host = document.createElement("div");
    render(<AgentStateMark status="working" />, host);
    expect(host.querySelector('[data-state="working"] svg')).not.toBeNull();
    render(<AgentStateMark status="needs-input" confidence="inferred" />, host);
    const mark = host.querySelector("[data-state]");
    expect(mark?.getAttribute("data-state")).toBe("needs-input");
    expect(mark?.getAttribute("data-confidence")).toBe("inferred");
    expect(mark?.querySelector("svg")).toBeNull();
    render(null, host);
  });
});
