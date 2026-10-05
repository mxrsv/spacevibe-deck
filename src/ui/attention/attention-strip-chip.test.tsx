// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stores the chip reads reach the host; none of it is exercised here.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));

import { repositoryScans } from "../../repositories/repositories-store";
import { workspacesData } from "../../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../../lib/workspace-recents";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { MINUTE, NOW, SCANS, pane, tab } from "../attention-list-fixtures";
import { AttentionStripChip, currentAttentionList } from "./attention-strip-chip";

describe("AttentionStripChip", () => {
  let host: HTMLDivElement;
  let onFocusPane: ReturnType<typeof vi.fn<(tabIndex: number, paneId: number) => void>>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    onFocusPane = vi.fn();
    repositoryScans.value = SCANS;
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/w/deck", lastOpenedAt: NOW },
        { path: "/w/deck-side", lastOpenedAt: NOW },
      ],
    };
    activeTabIndex.value = 0;
    tabViews.value = [];
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    tabViews.value = [];
  });

  const chip = (): HTMLButtonElement | null => host.querySelector(".attn-chip");

  it("reads the window's own tabs, and is absent while nothing needs the user", () => {
    tabViews.value = [tab(1, "/w/deck", { panes: [pane(1, { phase: "working" })] })];
    act(() => render(<AttentionStripChip onFocusPane={onFocusPane} />, host));
    expect(chip()).toBeNull();

    act(() => {
      tabViews.value = [
        tab(1, "/w/deck", {
          panes: [pane(1, { attention: "requested" }), pane(2, { attention: "error" })],
        }),
      ];
    });

    expect(chip()?.getAttribute("aria-label")).toBe("2 need you");
    expect(chip()?.dataset.tone).toBe("failed");
  });

  it("follows a pane being acknowledged, without a render from its parent", () => {
    tabViews.value = [tab(1, "/w/deck", { panes: [pane(1, { attention: "requested" })] })];
    act(() => render(<AttentionStripChip onFocusPane={onFocusPane} />, host));
    expect(chip()?.textContent).toBe("1");

    act(() => {
      tabViews.value = [tab(1, "/w/deck", { panes: [pane(1, { attention: "none" })] })];
    });

    expect(chip()).toBeNull();
  });

  it("hands the chosen pane's own tab and id to the app's callback, and no other", () => {
    tabViews.value = [
      tab(1, "/w/deck", { panes: [pane(1, { phase: "working" })] }),
      tab(2, "/w/deck-side", {
        panes: [
          pane(8, { attention: "requested", changedAt: NOW - 9 * MINUTE }),
          pane(9, { attention: "requested", changedAt: NOW - MINUTE }),
        ],
      }),
    ];
    act(() => render(<AttentionStripChip onFocusPane={onFocusPane} />, host));

    act(() => chip()?.click());
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".attn-row"));
    expect(rows.map((row) => row.querySelector(".attn-row__detail")?.textContent)).toEqual([
      "deck-side · release-hardening",
      "deck-side · release-hardening",
    ]);
    act(() => rows[1].click());

    expect(onFocusPane).toHaveBeenCalledTimes(1);
    expect(onFocusPane).toHaveBeenCalledWith(1, 9);
  });

  it("reads the rail's projection, so the chip and the sidebar agree on what is listed", () => {
    tabViews.value = [
      tab(1, "/w/deck", {
        panes: [
          pane(1, { attention: "completed", confidence: "inferred" }),
          pane(2, { agent: null, attention: "error" }),
        ],
      }),
    ];

    const list = currentAttentionList();

    expect(list.entries.map((entry) => entry.paneId)).toEqual([1]);
    expect(list.entries[0].inferred).toBe(true);
  });
});
