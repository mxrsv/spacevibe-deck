import { describe, expect, it } from "vitest";

import { paneTranscriptAt } from "./transcript.js";

/** startOffset 100 → first line at 400ms, think at 700, chunk at 900. */
const pane = Object.freeze({
  id: "test",
  startOffset: 100,
  restGap: 1000,
  maxLines: 3,
  steps: [
    { kind: "line", text: "one", cls: "t-body", delay: 300 },
    { kind: "think", text: "working…", delay: 300 },
    { kind: "chunk", text: "+more", delay: 200 },
    { kind: "line", text: "two", delay: 200 },
    { kind: "line", text: "three", delay: 200 },
    { kind: "line", text: "four", delay: 200 },
  ],
});

const boot = [{ text: "banner", cls: "t-dim" }];

describe("paneTranscriptAt", () => {
  it("shows only the boot lines before the first step is due", () => {
    const state = paneTranscriptAt(pane, 399, boot);

    expect(state.lines).toEqual(boot);
    expect(state.spinner).toBeNull();
  });

  it("appends a line when its step comes due", () => {
    const state = paneTranscriptAt(pane, 400, boot);

    expect(state.lines.at(-1)).toEqual({ text: "one", cls: "t-body" });
  });

  it("raises the spinner on think and clears it on the next line", () => {
    expect(paneTranscriptAt(pane, 700, boot).spinner).toBe("working…");
    expect(paneTranscriptAt(pane, 1100, boot).spinner).toBeNull();
  });

  it("extends the last line on chunk instead of adding one", () => {
    const before = paneTranscriptAt(pane, 899, boot);
    const after = paneTranscriptAt(pane, 900, boot);

    expect(after.lines.length).toBe(before.lines.length);
    expect(after.lines.at(-1).text).toBe("one+more");
  });

  it("keeps at most maxLines rows", () => {
    const state = paneTranscriptAt(pane, 1500, boot);

    expect(state.lines.length).toBe(pane.maxLines);
    expect(state.lines.map((line) => line.text)).toEqual([
      "two",
      "three",
      "four",
    ]);
  });

  it("loops without clearing, so the pane always reads as live", () => {
    const state = paneTranscriptAt(pane, 3000, boot);

    expect(state.lines.length).toBe(pane.maxLines);
    expect(state.lines.at(-1).text).not.toBe("");
  });

  it("never mutates the boot lines it was handed", () => {
    const seed = [{ text: "banner" }];

    paneTranscriptAt(pane, 5000, seed);

    expect(seed).toEqual([{ text: "banner" }]);
  });

  it("returns the same snapshot for the same timestamp", () => {
    const first = paneTranscriptAt(pane, 1234, boot);
    const second = paneTranscriptAt(pane, 1234, boot);

    expect(first).toEqual(second);
  });

  it("rejects a pane with no steps", () => {
    expect(() => paneTranscriptAt({ ...pane, steps: [] }, 0, boot)).toThrow(
      /no steps/i,
    );
  });
});
