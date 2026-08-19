// The strip's own guard, written beside it while `stage-markup.test.js` does
// not exist yet (plan 2026-08-20-landing-stage-redesign, §4.1 point 3).
//
// It has to run under Vitest's Vite transform rather than plain Node: this
// module imports `src/assets/agent-agy.png`, and `node --input-type=module`
// dies on it with `Unknown file extension ".png"` before a single assertion
// runs. No DOM is needed — every renderer here returns a string.
import { describe, expect, it } from "vitest";

import { BUILTIN_AGENTS } from "../../../src/lib/agent-catalog.ts";
import { AGENT_MARKS, renderAgentMark, renderAgentStrip } from "./agent-strip.js";

const COPY = {
  agentStripLabel: "Runs the CLIs you already use",
  agentStripTail: "…or any command you declare.",
};

/** Number of non-overlapping matches, so "exactly one" can be asserted. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe("AGENT_MARKS", () => {
  it("mirrors the app catalog's ids, labels and order", () => {
    // The file's header claims this mirror; nothing enforced it until the
    // sixth agent proved the list can drift.
    expect(AGENT_MARKS.map((agent) => agent.id)).toEqual(
      BUILTIN_AGENTS.map((agent) => agent.id),
    );
    expect(AGENT_MARKS.map((agent) => agent.label)).toEqual(
      BUILTIN_AGENTS.map((agent) => agent.label),
    );
  });

  it("carries six agents with Cursor last", () => {
    expect(AGENT_MARKS).toHaveLength(6);
    expect(AGENT_MARKS.at(-1)).toEqual({
      // `cursor-agent`, not `cursor` — the id is the binary name.
      id: "cursor-agent",
      label: "Cursor",
      mark: null,
    });
  });

  it("gives every other agent a real asset URL", () => {
    for (const agent of AGENT_MARKS.slice(0, -1)) {
      expect(typeof agent.mark).toBe("string");
      expect(agent.mark).not.toHaveLength(0);
    }
  });
});

describe("renderAgentMark", () => {
  it("draws an image when the agent ships a brand file", () => {
    const html = renderAgentMark(AGENT_MARKS[0], "scene-picker__mark", 18);

    expect(html).toContain('class="scene-picker__mark"');
    expect(html).toContain(`src="${AGENT_MARKS[0].mark}"`);
    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
    expect(html).not.toContain("--mono");
  });

  it("draws the monogram when it does not, and never an empty src", () => {
    const html = renderAgentMark(AGENT_MARKS.at(-1), "agent-strip__mark", 20);

    // The letter is `letterAvatar`'s rule applied to the id, not the label.
    expect(html).toBe(
      '<span class="agent-strip__mark agent-strip__mark--mono">C</span>',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
  });

  it("skips past non-alphanumerics to find the letter", () => {
    const html = renderAgentMark({ id: " _ray", label: "Ray", mark: null }, "m", 15);

    expect(html).toBe('<span class="m m--mono">R</span>');
  });
});

describe("renderAgentStrip", () => {
  const html = renderAgentStrip(COPY);

  it("draws one chip per agent", () => {
    expect(count(html, "agent-strip__chip")).toBe(6);
    for (const agent of AGENT_MARKS) {
      expect(html).toContain(`<span>${agent.label}</span>`);
    }
  });

  it("draws exactly one monogram and no broken image", () => {
    expect(count(html, "agent-strip__mark--mono")).toBe(1);
    expect(count(html, "<img")).toBe(5);
    // The defect the shared helper exists to prevent: a bare
    // `src="${agent.mark}"` prints these literally for a markless agent.
    expect(html).not.toContain('src="null"');
    expect(html).not.toContain('src="undefined"');
    expect(html).not.toContain("[object Object]");
  });

  it("keeps the band's copy hooks", () => {
    expect(html).toContain('data-copy="agentStripLabel"');
    expect(html).toContain(COPY.agentStripLabel);
    expect(html).toContain('data-copy="agentStripTail"');
    expect(html).toContain(COPY.agentStripTail);
  });
});
