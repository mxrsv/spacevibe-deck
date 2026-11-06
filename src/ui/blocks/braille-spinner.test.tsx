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

const STATUSES = ["needs-input", "unread", "working", "failed", "done", "ended", "idle"] as const;

describe("AgentStateMark", () => {
  it.each(STATUSES)(
    "names %s as its state and draws the spinner only while working (SR-7)",
    (status) => {
      const host = document.createElement("div");
      render(<AgentStateMark status={status} />, host);
      const mark = host.querySelector("[data-state]");
      expect(mark?.getAttribute("data-state")).toBe(status);
      // Hidden from assistive tech: the row or word beside it carries the state (SR-8).
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      expect(mark?.querySelector("svg") !== null).toBe(status === "working");
      render(null, host);
    },
  );

  it("is explicit unless told otherwise, and passes an inferred or unknown reading through", () => {
    const host = document.createElement("div");
    const confidence = () => host.querySelector("[data-state]")?.getAttribute("data-confidence");
    render(<AgentStateMark status="unread" />, host);
    expect(confidence()).toBe("explicit");
    render(<AgentStateMark status="unread" confidence="inferred" />, host);
    expect(confidence()).toBe("inferred");
    render(<AgentStateMark status="unread" confidence="unknown" />, host);
    expect(confidence()).toBe("unknown");
    render(null, host);
  });

  it("takes its box from the surface that draws it, and from --mark-size when none is named", () => {
    const host = document.createElement("div");
    const surface = () => host.querySelector("[data-state]")?.getAttribute("data-surface");
    render(<AgentStateMark status="idle" />, host);
    expect(surface()).toBeNull();
    render(<AgentStateMark status="idle" surface="pane" />, host);
    expect(surface()).toBe("pane");
    render(<AgentStateMark status="idle" surface="pill" />, host);
    expect(surface()).toBe("pill");
    render(null, host);
  });
});
