import { describe, expect, it, vi } from "vitest";
import { CODEX_PAGE_DOWN, CODEX_PAGE_UP, createCodexWheelHandler } from "./codex-wheel";

interface WheelFixture {
  readonly event: WheelEvent;
  readonly preventDefault: ReturnType<typeof vi.fn>;
  readonly stopImmediatePropagation: ReturnType<typeof vi.fn>;
}

function wheel(
  deltaY: number,
  options: {
    deltaMode?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
): WheelFixture {
  const preventDefault = vi.fn();
  const stopImmediatePropagation = vi.fn();
  return {
    event: {
      deltaY,
      deltaMode: options.deltaMode ?? 1,
      ctrlKey: options.ctrlKey ?? false,
      shiftKey: options.shiftKey ?? false,
      altKey: options.altKey ?? false,
      metaKey: options.metaKey ?? false,
      preventDefault,
      stopImmediatePropagation,
    } as unknown as WheelEvent,
    preventDefault,
    stopImmediatePropagation,
  };
}

function setup(platform: "windows" | "macos" = "windows") {
  let agent: string | null = "codex";
  let alternate = true;
  const send = vi.fn();
  const handler = createCodexWheelHandler({
    platform,
    isCodex: () => agent === "codex",
    isAlternateBuffer: () => alternate,
    send,
  });
  return {
    handler,
    send,
    setAgent(next: string | null) {
      agent = next;
    },
    setAlternateBuffer(next: boolean) {
      alternate = next;
    },
  };
}

describe("createCodexWheelHandler", () => {
  it("maps Windows Codex wheel directions to PageUp and PageDown", () => {
    const { handler, send } = setup();
    const up = wheel(-3);
    const down = wheel(3);

    expect(handler(up.event)).toBe(false);
    expect(handler(down.event)).toBe(false);

    expect(send).toHaveBeenNthCalledWith(1, CODEX_PAGE_UP);
    expect(send).toHaveBeenNthCalledWith(2, CODEX_PAGE_DOWN);
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(up.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("accumulates small Windows touchpad deltas before sending one page", () => {
    const { handler, send } = setup();

    for (const delta of [8, 8, 8, 8]) {
      expect(handler(wheel(delta, { deltaMode: 0 }).event)).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();

    expect(handler(wheel(8, { deltaMode: 0 }).event)).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(CODEX_PAGE_DOWN);
  });

  it("resets a partial touchpad gesture when direction reverses", () => {
    const { handler, send } = setup();

    handler(wheel(24, { deltaMode: 0 }).event);
    handler(wheel(-24, { deltaMode: 0 }).event);
    expect(send).not.toHaveBeenCalled();

    handler(wheel(-16, { deltaMode: 0 }).event);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(CODEX_PAGE_UP);
  });

  it("leaves macOS, other agents, zero deltas and modified wheels to xterm", () => {
    const mac = setup("macos");
    expect(mac.handler(wheel(-3).event)).toBe(true);
    expect(mac.send).not.toHaveBeenCalled();

    const windows = setup();
    windows.setAgent("opencode");
    expect(windows.handler(wheel(-3).event)).toBe(true);
    windows.setAgent("codex");
    expect(windows.handler(wheel(0).event)).toBe(true);
    expect(windows.handler(wheel(-3, { ctrlKey: true }).event)).toBe(true);
    expect(windows.handler(wheel(-3, { shiftKey: true }).event)).toBe(true);
    expect(windows.handler(wheel(-3, { altKey: true }).event)).toBe(true);
    expect(windows.handler(wheel(-3, { metaKey: true }).event)).toBe(true);
    expect(windows.send).not.toHaveBeenCalled();
  });

  // Codex only shows the alternate screen while its Ctrl+T transcript overlay
  // is open, and that pager is the only surface binding PageUp/PageDown. On the
  // chat screen the wheel has to keep scrolling the pane's scrollback.
  it("leaves the normal buffer to xterm, untouched", () => {
    const { handler, send, setAlternateBuffer } = setup();
    setAlternateBuffer(false);
    const gesture = wheel(-3);

    expect(handler(gesture.event)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(gesture.preventDefault).not.toHaveBeenCalled();
    expect(gesture.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("drops a partial touchpad gesture when the overlay closes mid-scroll", () => {
    const { handler, send, setAlternateBuffer } = setup();

    handler(wheel(24, { deltaMode: 0 }).event);
    setAlternateBuffer(false);
    handler(wheel(24, { deltaMode: 0 }).event);
    setAlternateBuffer(true);
    handler(wheel(24, { deltaMode: 0 }).event);

    expect(send).not.toHaveBeenCalled();
  });
});
