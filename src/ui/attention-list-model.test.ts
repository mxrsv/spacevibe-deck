import { describe, expect, it } from "vitest";
import {
  attentionEntryName,
  attentionFooterText,
  buildAttentionList,
} from "./attention-list-model";
import { MINUTE, NOW, ids, list, pane, tab } from "./attention-list-fixtures";

describe("buildAttentionList", () => {
  it("is empty, with an empty footer, when no tab is open", () => {
    expect(buildAttentionList({ stream: [] })).toEqual({
      entries: [],
      failedCount: 0,
      footer: { working: 0, done: 0, idle: 0, ended: 0 },
    });
    expect(list([]).entries).toEqual([]);
  });

  it("lists nothing when every agent is quiet, and counts them in the footer", () => {
    const result = list([
      tab(1, "/w/deck", {
        panes: [
          pane(1, { phase: "working" }),
          pane(2, { phase: "idle", hasRun: true }),
          pane(3, { phase: "idle", hasRun: false }),
          pane(4, { phase: "exited" }),
        ],
      }),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.footer).toEqual({ working: 1, done: 1, idle: 1, ended: 1 });
  });

  it("lists failed and asked panes, loudest first, and never lists the rest", () => {
    const result = list([
      tab(1, "/w/deck", {
        panes: [
          pane(1, { phase: "working" }),
          pane(2, { attention: "completed", confidence: "inferred" }),
          pane(3, { attention: "requested", confidence: "explicit" }),
          pane(4, { attention: "error", confidence: "explicit" }),
          pane(5, { attention: "warning", confidence: "explicit" }),
          pane(6, { phase: "idle", hasRun: false }),
        ],
      }),
    ]);

    // failed, then the explicit asks (requested, warning), then the inferred one.
    expect(ids(result.entries)).toEqual([4, 3, 5, 2]);
    expect(result.entries.map((entry) => entry.state)).toEqual([
      "failed",
      "asked",
      "asked",
      "asked",
    ]);
    expect(result.failedCount).toBe(1);
    expect(result.footer).toEqual({ working: 1, done: 0, idle: 1, ended: 0 });
  });

  it("ranks a failure above an older ask, whichever tab holds it", () => {
    const result = list([
      tab(1, "/w/deck", {
        panes: [pane(1, { attention: "requested", changedAt: NOW - 30 * MINUTE })],
      }),
      tab(2, "/w/deck-side", {
        panes: [pane(2, { attention: "error", changedAt: NOW - MINUTE })],
      }),
    ]);

    expect(ids(result.entries)).toEqual([2, 1]);
  });

  it("puts the longest wait first within a rank, and an undated pane last", () => {
    const result = list([
      tab(1, "/w/deck", {
        panes: [
          pane(1, { attention: "requested", changedAt: NOW - 2 * MINUTE }),
          pane(2, { attention: "requested", changedAt: 0 }),
          pane(3, { attention: "requested", changedAt: NOW - 20 * MINUTE }),
        ],
      }),
    ]);

    expect(ids(result.entries)).toEqual([3, 1, 2]);
    expect(result.entries.map((entry) => entry.age)).toEqual(["20m", "2m", ""]);
  });

  it("breaks a tie by tab, then by pane id, whatever order the panes sit in", () => {
    const tabs = [
      tab(1, "/w/deck", { panes: [pane(7, { attention: "requested", changedAt: NOW })] }),
      tab(2, "/w/deck", {
        panes: [
          pane(9, { attention: "requested", changedAt: NOW }),
          pane(8, { attention: "requested", changedAt: NOW }),
        ],
      }),
    ];

    expect(ids(list(tabs).entries)).toEqual([7, 8, 9]);
  });

  describe("inferred entries", () => {
    it("says so on an ask Deck read off output timing, and sorts it after explicit asks", () => {
      const result = list([
        tab(1, "/w/deck", {
          panes: [
            pane(1, {
              attention: "completed",
              confidence: "inferred",
              changedAt: NOW - 40 * MINUTE,
            }),
            pane(2, {
              attention: "requested",
              confidence: "explicit",
              changedAt: NOW - MINUTE,
            }),
          ],
        }),
      ]);

      // The inferred ask has waited longer, and still sorts below the explicit one.
      expect(ids(result.entries)).toEqual([2, 1]);
      expect(result.entries.map((entry) => entry.inferred)).toEqual([false, true]);
      expect(result.entries[1].confidence).toBe("inferred");
    });

    it("reads an ask with no stated confidence as explicit, like the rail does", () => {
      const [entry] = list([
        tab(1, "/w/deck", { panes: [pane(1, { attention: "requested" })] }),
      ]).entries;

      expect(entry.confidence).toBe("explicit");
      expect(entry.inferred).toBe(false);
    });

    it("names the doubt in the accessible name, where it changes the meaning", () => {
      const [entry] = list([
        tab(1, "/w/deck", {
          panes: [pane(1, { attention: "completed", confidence: "inferred" })],
        }),
      ]).entries;

      expect(attentionEntryName(entry)).toBe("Focus Claude, needs you (inferred) in deck · main");
    });
  });

  describe("reason", () => {
    it("says Failed for a failure and Needs you for an ask", () => {
      const result = list([
        tab(1, "/w/deck", {
          panes: [pane(1, { attention: "error" }), pane(2, { attention: "warning" })],
        }),
      ]);

      expect(result.entries.map((entry) => entry.reason)).toEqual(["Failed", "Needs you"]);
    });

    it("adds what a contract-layer source says the agent waits on", () => {
      const [entry] = list([
        tab(1, "/w/deck", {
          panes: [pane(1, { attention: "requested", detail: "permission prompt" })],
        }),
      ]).entries;

      expect(entry.reason).toBe("Needs you — permission prompt");
      expect(attentionEntryName(entry)).toContain("needs you — permission prompt");
    });

    it("ignores a detail on a failure, which no contract layer sets", () => {
      const [entry] = list([
        tab(1, "/w/deck", { panes: [pane(1, { attention: "error", detail: "stale" })] }),
      ]).entries;

      expect(entry.reason).toBe("Failed");
    });
  });
});

describe("attentionFooterText", () => {
  it("is empty when no agent is running", () => {
    expect(attentionFooterText({ working: 0, done: 0, idle: 0, ended: 0 })).toBe("");
  });

  it("prints only the states that hold a pane, in a fixed order", () => {
    expect(attentionFooterText({ working: 2, done: 0, idle: 4, ended: 1 })).toBe(
      "2 working · 4 idle · 1 ended",
    );
  });
});
