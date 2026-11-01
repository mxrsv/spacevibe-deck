import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listenNotificationActivated,
  openNotificationSettings,
  sendNotification,
  setAttentionBadge,
} from "./shell-host";

afterEach(() => vi.unstubAllGlobals());

describe("notification facade", () => {
  it("sends flat command payloads and unwraps validated activation events", async () => {
    const invoke = vi.fn(async () => true);
    const stop = vi.fn();
    let event!: (payload: unknown) => void;
    const listen = vi.fn((_name: string, handler: (payload: unknown) => void) => {
      event = handler;
      return stop;
    });
    vi.stubGlobal("__deckHost", { invoke, listen });
    await sendNotification({ title: "Deck", body: "Claude finished", paneId: 7 });
    await setAttentionBadge(2);
    await openNotificationSettings();
    expect(invoke.mock.calls).toEqual([
      ["notification_send", { title: "Deck", body: "Claude finished", paneId: 7 }],
      ["attention_badge_set", { count: 2 }],
      ["notification_open_settings", undefined],
    ]);
    const activated = vi.fn();
    const unlisten = await listenNotificationActivated(activated);
    expect(listen.mock.calls[0][0]).toBe("notification:activated");
    for (const bad of [null, {}, { paneId: -1 }, { paneId: "7" }, { paneId: 1.5 }]) event(bad);
    event({ paneId: 7 });
    expect(activated).toHaveBeenCalledExactlyOnceWith(7);
    unlisten();
    expect(stop).toHaveBeenCalledOnce();
  });
});
