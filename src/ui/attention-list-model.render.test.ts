import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView } from "../terminal/tabs-store";
import { buildAgentRail } from "./agent-rail-model";
import { buildAttentionList } from "./attention-list-model";
import { MINUTE, NOW, SCANS, ids, list, pane, repo, tab } from "./attention-list-fixtures";

describe("buildAttentionList", () => {
  describe("place", () => {
    it("is the space's folder and the checkout's branch", () => {
      const [entry] = list([
        tab(1, "/w/deck", { panes: [pane(1, { attention: "requested" })] }),
      ]).entries;

      expect(entry.space).toBe("deck");
      expect(entry.branch).toBe("main");
      expect(entry.place).toBe("deck · main");
    });

    it("reads a linked worktree's own branch", () => {
      const [entry] = list([
        tab(1, "/w/deck-side", { panes: [pane(1, { attention: "requested" })] }),
      ]).entries;

      expect(entry.place).toBe("deck-side · release-hardening");
    });

    it("uses the name the user gave the space", () => {
      const [entry] = list([
        tab(1, "/w/deck", {
          name: "auth rewrite",
          panes: [pane(1, { attention: "requested" })],
        }),
      ]).entries;

      expect(entry.space).toBe("auth rewrite");
      expect(entry.place).toBe("auth rewrite · main");
    });

    it("leaves out a branch it has already said", () => {
      const scans = new Map<string, RepositoryScan>([
        ["/w/fix-login", repo("/w/deck/.git", [{ path: "/w/fix-login", branch: "fix-login" }])],
      ]);
      const [entry] = list(
        [tab(1, "/w/fix-login", { panes: [pane(1, { attention: "requested" })] })],
        { scans, workspaceHistoryPaths: ["/w/fix-login"] },
      ).entries;

      expect(entry.place).toBe("fix-login");
    });

    it("has no branch for a folder git does not know", () => {
      const [entry] = list(
        [tab(1, "/w/scratch", { panes: [pane(1, { attention: "requested" })] })],
        { scans: new Map(), workspaceHistoryPaths: ["/w/scratch"] },
      ).entries;

      expect(entry.branch).toBeNull();
      expect(entry.place).toBe("scratch");
    });
  });

  describe("the pane an entry names", () => {
    it("carries the exact tab and pane, so a choice can focus only that one", () => {
      const result = list([
        tab(1, "/w/deck", { panes: [pane(1, { phase: "working" })] }),
        tab(2, "/w/deck", {
          panes: [pane(5, { attention: "requested" }), pane(6, { attention: "requested" })],
        }),
      ]);

      expect(
        result.entries.map(({ key, paneId, tabIndex }) => ({ key, paneId, tabIndex })),
      ).toEqual([
        { key: 5, paneId: 5, tabIndex: 1 },
        { key: 6, paneId: 6, tabIndex: 1 },
      ]);
    });

    it("never lists a shell pane, however loud", () => {
      const result = list([
        tab(1, "/w/deck", {
          panes: [pane(1, { agent: null, attention: "error" }), pane(2, { phase: "working" })],
        }),
      ]);

      expect(result.entries).toEqual([]);
      expect(result.footer.working).toBe(1);
    });
  });

  describe("a pane whose state changes between renders", () => {
    const asking = (over: Partial<PaneView> = {}) => [
      tab(1, "/w/deck", {
        panes: [pane(1, { attention: "requested", changedAt: NOW - 5 * MINUTE, ...over })],
      }),
    ];

    it("leaves the list, and joins the footer, once it is acknowledged", () => {
      const before = list(asking());
      const after = list([tab(1, "/w/deck", { panes: [pane(1, { attention: "none" })] })]);

      expect(ids(before.entries)).toEqual([1]);
      expect(before.footer.done).toBe(0);
      expect(after.entries).toEqual([]);
      expect(after.footer.done).toBe(1);
    });

    it("keeps its key and moves up when an ask becomes a failure", () => {
      const tabs = (attention: PaneView["attention"]) => [
        tab(1, "/w/deck", {
          panes: [
            pane(1, { attention }),
            pane(2, { attention: "requested", changedAt: NOW - 90 * MINUTE }),
          ],
        }),
      ];

      const before = list(tabs("requested"));
      const after = list(tabs("error"));

      // Pane 2 has waited longer, so it leads while both are asks.
      expect(ids(before.entries)).toEqual([2, 1]);
      expect(ids(after.entries)).toEqual([1, 2]);
      expect(after.entries[0].key).toBe(before.entries[1].key);
      expect(after.failedCount).toBe(1);
    });

    it("drops to inferred when the contract that backed it goes stale", () => {
      const before = list(asking({ confidence: "explicit" }));
      const after = list(asking({ confidence: "inferred" }));

      expect(before.entries[0].inferred).toBe(false);
      expect(after.entries[0].inferred).toBe(true);
    });

    it("re-ages against the clock the rail was given, never one of its own", () => {
      const view = (now: number) =>
        buildAgentRail({
          tabs: asking(),
          activeIndex: 0,
          scans: SCANS,
          workspaceHistoryPaths: ["/w/deck"],
          now,
        });

      expect(buildAttentionList(view(NOW)).entries[0].age).toBe("5m");
      expect(buildAttentionList(view(NOW + 10 * MINUTE)).entries[0].age).toBe("15m");
    });
  });
});
