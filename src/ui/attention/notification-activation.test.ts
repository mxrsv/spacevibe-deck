import { afterEach, describe, expect, it, vi } from "vitest";
import { listenNotificationActivated } from "../../host/shell-host";
import { tabViews } from "../../terminal/tabs-store";
import { pane, tab } from "../attention-list-fixtures";
import { installNotificationActivation } from "./notification-activation";

vi.mock("../../host/shell-host", () => ({ listenNotificationActivated: vi.fn() }));

afterEach(() => {
  tabViews.value = [];
  vi.clearAllMocks();
});

describe("notification activation lifetime", () => {
  it("resolves the live tab at click time and ignores unknown panes", async () => {
    const unlisten = vi.fn();
    vi.mocked(listenNotificationActivated).mockResolvedValue(unlisten);
    const focus = vi.fn();
    const stop = installNotificationActivation(focus);
    await Promise.resolve();
    const click = vi.mocked(listenNotificationActivated).mock.lastCall![0];
    tabViews.value = [tab(1, "/w/deck", { panes: [pane(7)] })];
    click(7);
    expect(focus).toHaveBeenLastCalledWith(0, 7);
    tabViews.value = [tab(2, "/w/other"), tab(1, "/w/deck", { panes: [pane(7)] })];
    click(7);
    expect(focus).toHaveBeenLastCalledWith(1, 7);
    click(99);
    expect(focus).toHaveBeenCalledTimes(2);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
    click(7);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("releases a listener that resolves after unmount", async () => {
    let ready!: (stop: () => void) => void;
    vi.mocked(listenNotificationActivated).mockReturnValue(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    const focus = vi.fn();
    const stop = installNotificationActivation(focus);
    stop();
    const unlisten = vi.fn();
    ready(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
