import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserClient, BrowserGrab, BrowserState } from "./browser-client";
import {
  browserNotice,
  browserOpen,
  browserState,
  closeBrowser,
  deliverGrab,
  EMPTY_STATE,
  initBrowserBridge,
  openBrowser,
  resetBrowserStore,
  type GrabTarget,
} from "./browser-store";

const GRAB: BrowserGrab = {
  text: "[<button> in Save (at src/save.tsx:3:1)]",
  url: "http://localhost:3000/",
  title: "App",
  count: 1,
};

function state(overrides: Partial<BrowserState> = {}): BrowserState {
  return { ...EMPTY_STATE, ...overrides };
}

function fakeClient(overrides: Partial<BrowserClient> = {}): BrowserClient {
  return {
    open: vi.fn(async () => state()),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async (url: string) => url),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setBounds: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
    setInspect: vi.fn(async () => {}),
    onState: vi.fn(async () => () => {}),
    onGrab: vi.fn(async () => () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  resetBrowserStore();
});

describe("deliverGrab", () => {
  const target = (
    paneId: number | null,
    paste = vi.fn(async () => true),
  ): GrabTarget => ({ activePaneId: () => paneId, paste });

  it("pastes into the focused pane", async () => {
    const paste = vi.fn(async () => true);
    expect(await deliverGrab(GRAB, target(7, paste))).toBe("pasted");
    expect(paste).toHaveBeenCalledWith(7, expect.stringContaining("in Save"));
  });

  it("never asks for a submit", async () => {
    // The paste seam takes no `autoSend`, so there is no argument that could
    // turn a page's text into a command an agent runs. This asserts the shape
    // stays that way.
    const paste = vi.fn(async () => true);
    await deliverGrab(GRAB, target(7, paste));
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste.mock.calls[0]).toHaveLength(2);
  });

  it("falls back to the clipboard when there is no pane", async () => {
    // react-grab already wrote the same text to the clipboard from the page,
    // so this outcome is a message, not a recovery step.
    expect(await deliverGrab(GRAB, target(null))).toBe("clipboard");
  });

  it("reports a paste that did not land", async () => {
    expect(await deliverGrab(GRAB, target(1, vi.fn(async () => false)))).toBe(
      "failed",
    );
  });

  it("survives a paste that throws", async () => {
    const paste = vi.fn(async () => {
      throw new Error("pane went away");
    });
    expect(await deliverGrab(GRAB, target(1, paste))).toBe("failed");
  });

  it("refuses an empty grab before touching a pane", async () => {
    const paste = vi.fn(async () => true);
    const outcome = await deliverGrab({ ...GRAB, text: "  " }, target(1, paste));
    expect(outcome).toBe("failed");
    expect(paste).not.toHaveBeenCalled();
  });
});

describe("initBrowserBridge", () => {
  it("stores published state and summarises a delivered grab", async () => {
    let onState: ((s: BrowserState) => void) | undefined;
    let onGrab: ((g: BrowserGrab) => void) | undefined;
    const client = fakeClient({
      onState: vi.fn(async (handler: (s: BrowserState) => void) => {
        onState = handler;
        return () => {};
      }),
      onGrab: vi.fn(async (handler: (g: BrowserGrab) => void) => {
        onGrab = handler;
        return () => {};
      }),
    });
    await initBrowserBridge({
      client,
      target: { activePaneId: () => 3, paste: async () => true },
    });

    onState?.(state({ url: "http://localhost:3000/", canGoForward: true }));
    expect(browserState.value.canGoForward).toBe(true);

    onGrab?.({ ...GRAB, count: 2 });
    await vi.waitFor(() =>
      expect(browserNotice.value).toBe("2 elements sent to the focused pane"),
    );
  });

  it("unsubscribes both listeners on teardown", async () => {
    const stateOff = vi.fn();
    const grabOff = vi.fn();
    const client = fakeClient({
      onState: vi.fn(async () => stateOff),
      onGrab: vi.fn(async () => grabOff),
    });
    const teardown = await initBrowserBridge({
      client,
      target: { activePaneId: () => null, paste: async () => true },
    });
    teardown();
    expect(stateOff).toHaveBeenCalled();
    expect(grabOff).toHaveBeenCalled();
  });
});

describe("openBrowser", () => {
  it("loads the home address the first time and nothing after", async () => {
    const client = fakeClient({
      open: vi.fn(async () => state({ url: "http://localhost:5173/" })),
    });
    await openBrowser(client, "http://localhost:5173");
    expect(client.open).toHaveBeenCalledWith("http://localhost:5173");
    expect(browserOpen.value).toBe(true);

    await openBrowser(client, "http://localhost:5173");
    // Reopening is a view toggle: it must not reload the page the user left.
    expect(client.open).toHaveBeenLastCalledWith(null);
  });

  it("stays closed when the host refuses", async () => {
    const client = fakeClient({
      open: vi.fn(async () => {
        throw new Error("no window");
      }),
    });
    await openBrowser(client, "http://localhost:3000");
    expect(browserOpen.value).toBe(false);
  });
});

describe("closeBrowser", () => {
  it("clears the panel's state even if the host call fails", async () => {
    browserOpen.value = true;
    browserState.value = state({ url: "http://localhost:3000/" });
    browserNotice.value = "something";
    const client = fakeClient({
      close: vi.fn(async () => {
        throw new Error("gone");
      }),
    });
    await closeBrowser(client);
    expect(browserOpen.value).toBe(false);
    expect(browserState.value).toEqual(EMPTY_STATE);
    expect(browserNotice.value).toBeNull();
  });
});
