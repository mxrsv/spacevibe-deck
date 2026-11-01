import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settings } from "../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { tabViews } from "../../terminal/tabs-store";
import { pane, tab } from "../attention-list-fixtures";
import { setAttentionBadge } from "../../host/shell-host";
import { installAttentionBadgeSync } from "./attention-badge-sync";

vi.mock("../../host/shell-host", () => ({ setAttentionBadge: vi.fn(async () => {}) }));

describe("attention badge sync", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    tabViews.value = [];
    settings.value = { ...DEFAULT_SETTINGS, agentNotifications: false };
    vi.clearAllMocks();
  });
  afterEach(() => stop?.());
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("sends the chip count, dedupes it, and clears when attention is acknowledged", async () => {
    stop = installAttentionBadgeSync();
    await flush();
    expect(setAttentionBadge).toHaveBeenCalledExactlyOnceWith(0);
    tabViews.value = [
      tab(1, "/w/deck", {
        panes: [
          pane(1, { attention: "requested" }),
          pane(2, { attention: "error" }),
          pane(3, { attention: "completed" }),
          pane(4, { attention: "warning" }),
        ],
      }),
    ];
    await flush();
    expect(setAttentionBadge).toHaveBeenLastCalledWith(4);
    expect(setAttentionBadge).toHaveBeenCalledTimes(2);
    tabViews.value = tabViews.value.map((view) => ({ ...view, name: "Renamed" }));
    await flush();
    expect(setAttentionBadge).toHaveBeenCalledTimes(2);
    tabViews.value = [tab(1, "/w/deck", { panes: [pane(2, { attention: "error" })] })];
    await flush();
    expect(setAttentionBadge).toHaveBeenLastCalledWith(1);
    tabViews.value = [];
    await flush();
    expect(setAttentionBadge).toHaveBeenLastCalledWith(0);
    stop();
    tabViews.value = [tab(1, "/w/deck", { panes: [pane(1, { attention: "requested" })] })];
    await flush();
    expect(setAttentionBadge).toHaveBeenCalledTimes(4);
    stop = installAttentionBadgeSync();
    await flush();
    expect(setAttentionBadge).toHaveBeenLastCalledWith(1);
  });
});
