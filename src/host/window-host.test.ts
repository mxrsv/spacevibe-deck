// @vitest-environment jsdom
/**
 * These cover the three things that were silently broken after the host swap:
 * drag-and-drop had no emitter, focus tracking had no emitter, and the scale
 * factor came from the zoom level. None of them failed a test, and none of
 * them would have failed one — the renderer suite mocks the host.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWebview, getCurrentWindow, PhysicalPosition } from "./window-host";

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("PhysicalPosition", () => {
  it("converts physical pixels to CSS pixels", () => {
    // On a 2x display a physical coordinate is double the CSS one; skipping
    // this drops a folder onto the wrong pane.
    expect(new PhysicalPosition(200, 100).toLogical(2)).toEqual({
      x: 100,
      y: 50,
    });
  });
});

describe("scaleFactor", () => {
  it("reports the display scale, not the zoom level", async () => {
    vi.stubGlobal("devicePixelRatio", 2);

    expect(await getCurrentWindow().scaleFactor()).toBe(2);
  });

  it("falls back to 1 when devicePixelRatio is unavailable", async () => {
    vi.stubGlobal("devicePixelRatio", undefined);

    expect(await getCurrentWindow().scaleFactor()).toBe(1);
  });
});

describe("onFocusChanged", () => {
  it("reports focus and blur", async () => {
    // Drives whether native notifications fire: without it, an agent finishing
    // in an unfocused window notifies nobody.
    const seen: boolean[] = [];
    const unlisten = await getCurrentWindow().onFocusChanged(({ payload }) => seen.push(payload));

    globalThis.dispatchEvent(new Event("focus"));
    globalThis.dispatchEvent(new Event("blur"));

    expect(seen).toEqual([true, false]);

    unlisten();
    globalThis.dispatchEvent(new Event("focus"));
    expect(seen).toEqual([true, false]);
  });
});

describe("onDragDropEvent", () => {
  function dragEvent(type: string, init: Partial<DragEvent> = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      clientX: 0,
      clientY: 0,
      relatedTarget: null,
      ...init,
    });
    return event;
  }

  it("reports a drop with its file paths", async () => {
    // `File.path` is gone in modern Electron; the preload's getPathForFile is
    // the only route from a DOM drop to a real filesystem path.
    vi.stubGlobal("__deckHost", {
      getPathForFile: (file: File) => `/workspaces/${file.name}`,
    });
    vi.stubGlobal("devicePixelRatio", 1);
    const drops: Array<{ paths: string[]; x: number; y: number }> = [];
    const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop") {
        drops.push({
          paths: [...payload.paths],
          x: payload.position.x,
          y: payload.position.y,
        });
      }
    });

    globalThis.dispatchEvent(
      dragEvent("drop", {
        clientX: 40,
        clientY: 20,
        dataTransfer: {
          files: [new File([], "repo")],
        } as unknown as DataTransfer,
      }),
    );

    expect(drops).toEqual([{ paths: ["/workspaces/repo"], x: 40, y: 20 }]);
    unlisten();
  });

  it("scales drop coordinates to physical pixels", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "/x" });
    vi.stubGlobal("devicePixelRatio", 2);
    let position = { x: 0, y: 0 };
    const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "over") {
        position = { x: payload.position.x, y: payload.position.y };
      }
    });

    globalThis.dispatchEvent(dragEvent("dragover", { clientX: 50, clientY: 25 }));

    // Physical out, so `toLogical(2)` returns the original CSS coordinates.
    expect(position).toEqual({ x: 100, y: 50 });
    unlisten();
  });

  it("cancels dragover so the browser allows a drop at all", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "/x" });
    const unlisten = await getCurrentWebview().onDragDropEvent(() => {});
    const event = dragEvent("dragover");

    globalThis.dispatchEvent(event);

    // Without preventDefault the browser refuses the drop and no `drop` event
    // ever fires — the whole feature dies silently.
    expect(event.defaultPrevented).toBe(true);
    unlisten();
  });

  it("reports leave only when the pointer actually left the window", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "/x" });
    let leaves = 0;
    const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        leaves += 1;
      }
    });

    // Crossing a child element fires dragleave with a relatedTarget; treating
    // that as a real leave makes the drop target flicker off mid-drag.
    globalThis.dispatchEvent(
      dragEvent("dragleave", { relatedTarget: document.createElement("div") }),
    );
    expect(leaves).toBe(0);

    globalThis.dispatchEvent(dragEvent("dragleave", { relatedTarget: null }));
    expect(leaves).toBe(1);
    unlisten();
  });

  it("drops files with no disk backing rather than reporting empty paths", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "" });
    const drops: string[][] = [];
    const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop") {
        drops.push([...payload.paths]);
      }
    });

    globalThis.dispatchEvent(
      dragEvent("drop", {
        dataTransfer: {
          files: [new File([], "js-made")],
        } as unknown as DataTransfer,
      }),
    );

    expect(drops).toEqual([[]]);
    unlisten();
  });
});

describe("setTitleBarOverlay", () => {
  const COLORS = { color: "#0a0a0a", symbolColor: "#cbcbcb" };

  it("sends the two colours as flat keys", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });

    await getCurrentWindow().setTitleBarOverlay(COLORS);

    expect(invoke).toHaveBeenCalledWith("window_set_title_bar_overlay", COLORS);
  });

  // A Windows renderer under the browser preview or Tauri has no bridge and
  // must read as "nothing to paint".
  it("resolves quietly when there is no host", async () => {
    await expect(getCurrentWindow().setTitleBarOverlay(COLORS)).resolves.toBeUndefined();
  });

  it("resolves when the host refuses the call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("__deckHost", {
      invoke: vi.fn().mockRejectedValue(new Error("no handler")),
      listen: vi.fn(),
    });

    await expect(getCurrentWindow().setTitleBarOverlay(COLORS)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("setGuiZoom", () => {
  it("sends the factor as one flat key and resolves to the factor in force", async () => {
    const invoke = vi.fn().mockResolvedValue(1.25);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });

    await expect(getCurrentWindow().setGuiZoom(1.25)).resolves.toBe(1.25);

    expect(invoke).toHaveBeenCalledWith("window_set_gui_zoom", { factor: 1.25 });
  });

  it("resolves null without a host", async () => {
    await expect(getCurrentWindow().setGuiZoom(1.25)).resolves.toBeNull();
  });

  it("resolves null and warns once when the host refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("__deckHost", {
      invoke: vi.fn().mockRejectedValue(new Error("no handler")),
      listen: vi.fn(),
    });

    await expect(getCurrentWindow().setGuiZoom(1.25)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("a drop after a zoom change", () => {
  // Page zoom moves devicePixelRatio. The drop path multiplies by the ratio it
  // read when it installed and `installFileDrop` divides by the one it read at
  // the same moment, so the position handed on is the pointer's CSS position at
  // any zoom. A zoom between install and drop must not skew it.
  it("lands at the pointer's CSS position when devicePixelRatio changed since install", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "/x" });
    vi.stubGlobal("devicePixelRatio", 2);
    const scaleFactor = await getCurrentWindow().scaleFactor();
    const seen: Array<{ x: number; y: number }> = [];
    const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "over") {
        seen.push(payload.position.toLogical(scaleFactor));
      }
    });

    vi.stubGlobal("devicePixelRatio", 2.5);
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 100, clientY: 40 });
    globalThis.dispatchEvent(event);

    expect(seen).toEqual([{ x: 100, y: 40 }]);
    unlisten();
  });
});
