// @vitest-environment jsdom
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings-schema";
import { createPane, isInterruptKey, toFontStack, type PaneEvents } from "./pane";

beforeAll(() => {
  // Never fires: nothing in this file resizes anything, and `fit()` is
  // already try/caught in pane.ts for the zero-sized case. This exists only
  // so the constructor at pane.ts:251 does not throw.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const silentEvents: PaneEvents = {
  onData: () => Promise.resolve(true),
  onResize: () => {},
  onFocus: () => {},
};

describe("Pane transfer primitives", () => {
  it("keeps control bytes inside programmatic text from ending bracketed paste", async () => {
    const writes: string[] = [];
    const originalPaste = Terminal.prototype.paste;
    // Exercise xterm's real framing without mounting its canvas renderer.
    const paste = vi.spyOn(Terminal.prototype, "paste").mockImplementation(function (
      this: Terminal,
      text,
    ) {
      const core = (this as unknown as { _core: { textarea?: HTMLTextAreaElement } })._core;
      core.textarea ??= document.createElement("textarea");
      originalPaste.call(this, text);
    });
    const pane = createPane(99, DEFAULT_SETTINGS as Settings, {
      ...silentEvents,
      onData: (_id, data) => {
        writes.push(data);
        return Promise.resolve(true);
      },
    });
    try {
      pane.write("\u001b[?2004h");
      await pane.flush();
      await pane.pasteText("first\n\u001b[201~\rmarker\u009b201~\tlast\n\n");
      expect(writes).toHaveLength(1);
      expect(writes[0].split("\u001b[201~")).toHaveLength(2);
      expect(writes[0]).not.toContain("\u009b");
      expect(writes[0]).toBe("\u001b[200~first\r[201~\rmarker201~\tlast\r\r\u001b[201~");
    } finally {
      paste.mockRestore();
      pane.dispose();
    }
  });
  it("flush() resolves after xterm has parsed everything already written", async () => {
    const pane = createPane(1, DEFAULT_SETTINGS as Settings, silentEvents);
    pane.write("hello");
    await pane.flush();
    expect(pane.serializeScrollback(100)).toContain("hello");
    pane.dispose();
  });

  it("flush() resolves on an idle terminal with nothing queued", async () => {
    const pane = createPane(2, DEFAULT_SETTINGS as Settings, silentEvents);
    await expect(pane.flush()).resolves.toBeUndefined();
    pane.dispose();
  });

  it("serializeScrollback keeps the newest lines when the buffer is longer", async () => {
    const pane = createPane(3, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 20,
      rows: 4,
    });
    for (let i = 0; i < 40; i += 1) {
      pane.write(`line-${i}\r\n`);
    }
    await pane.flush();
    const serialized = pane.serializeScrollback(5);
    expect(serialized).toContain("line-39");
    expect(serialized).not.toContain("line-0\r");
    pane.dispose();
  });

  it("constructs at the requested geometry so an adopted pane starts at capture size", () => {
    const pane = createPane(4, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 133,
      rows: 41,
    });
    expect(pane.cols).toBe(133);
    expect(pane.rows).toBe(41);
    pane.dispose();
  });
});

describe("Pane input provenance", () => {
  it("distinguishes an automatic cursor report from a real paste", async () => {
    const writes: Array<{ data: string; userInput: boolean }> = [];
    const pane = createPane(7, DEFAULT_SETTINGS as Settings, {
      ...silentEvents,
      onData: async (_id, data, userInput = false) => {
        writes.push({ data, userInput });
        return true;
      },
    });
    // Keep the real onData path; only bypass browser textarea cleanup.
    const paste = vi.spyOn(Terminal.prototype, "paste").mockImplementation(function (
      this: Terminal,
      text,
    ) {
      this.input(text, true);
    });
    pane.write("\x1b[6n");
    await pane.flush();
    expect(writes.some((write) => write.data.endsWith("R") && !write.userInput)).toBe(true);
    await pane.pasteText("first prompt");
    paste.mockRestore();
    expect(writes.at(-1)).toEqual({ data: "first prompt", userInput: true });
    pane.dispose();
  });
});

describe("Pane column floor", () => {
  it("never resizes the terminal below 24 columns, however narrow the box measures", () => {
    const propose = vi
      .spyOn(FitAddon.prototype, "proposeDimensions")
      .mockReturnValue({ cols: 18, rows: 3 });
    const resize = vi.spyOn(Terminal.prototype, "resize");
    const pane = createPane(30, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 101,
      rows: 16,
    });
    try {
      pane.fit();
      expect(resize).toHaveBeenLastCalledWith(24, 3);
      expect(pane.cols).toBe(24);
      propose.mockReturnValue({ cols: 18, rows: 1 });
      pane.fit();
      expect(resize).toHaveBeenLastCalledWith(24, 1);
      propose.mockReturnValue({ cols: 90, rows: 30 });
      pane.fit();
      expect(resize).toHaveBeenLastCalledWith(90, 30);
    } finally {
      pane.dispose();
      propose.mockRestore();
      resize.mockRestore();
    }
  });
});

describe("toFontStack", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it("is the original stack byte for byte on macOS", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    expect(toFontStack("SF Mono")).toBe('"SF Mono", Menlo, Monaco, monospace');
  });

  it("is the macOS stack where the platform is unsupported", () => {
    initializeDesktopEnvironment({ platform: "unsupported", homeDir: "" });
    expect(toFontStack("SF Mono")).toBe('"SF Mono", Menlo, Monaco, monospace');
  });

  it("ends on the Windows faces before the generic family on Windows", () => {
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    expect(toFontStack("SF Mono")).toBe(
      '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, monospace',
    );
  });

  it("uses a user-entered fallback list verbatim", () => {
    expect(toFontStack('"Iosevka", monospace')).toBe('"Iosevka", monospace');
  });
});

describe("Pane interrupt keys (INT1)", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("reports Escape and Ctrl+C, and not the copy chords", () => {
    expect(isInterruptKey(key({ key: "Escape" }))).toBe(true);
    expect(isInterruptKey(key({ key: "c", ctrlKey: true }))).toBe(true);
    expect(isInterruptKey(key({ key: "c", metaKey: true }))).toBe(false);
    expect(isInterruptKey(key({ key: "C", ctrlKey: true }))).toBe(true); // Caps Lock
    expect(isInterruptKey(key({ key: "C", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isInterruptKey(key({ key: "c", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isInterruptKey(key({ key: "c" }))).toBe(false);
    expect(isInterruptKey(key({ key: "a", ctrlKey: true }))).toBe(false);
  });

  it("reports a key from xterm's onKey to the owner and nothing else", () => {
    type KeyListener = (event: { key: string; domEvent: KeyboardEvent }) => void;
    let listener: KeyListener | null = null;
    const onKey = vi
      .spyOn(Terminal.prototype as unknown as { onKey: unknown }, "onKey", "get")
      .mockReturnValue(((fn: KeyListener) => {
        listener = fn;
        return { dispose() {} };
      }) as never);
    const interrupts: number[] = [];
    const pane = createPane(7, DEFAULT_SETTINGS as Settings, {
      ...silentEvents,
      onInterruptKey: (id) => interrupts.push(id),
    });
    const press = (key: string, init: KeyboardEventInit = {}) =>
      listener!({ key, domEvent: new KeyboardEvent("keydown", { key, ...init }) });
    press("\x1b", { key: "Escape" });
    press("\x03", { key: "c", ctrlKey: true });
    press("c", { key: "c", metaKey: true });
    press("a", { key: "a" });
    expect(interrupts).toEqual([7, 7]);
    pane.dispose();
    onKey.mockRestore();
  });
});

describe("Pane under GUI zoom", () => {
  const BOX = { cols: 90, rows: 30 };
  const FIT_DEBOUNCE_MS = 90;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function hostedPane() {
    vi.useFakeTimers();
    vi.stubGlobal("__deckHost", {});
    const propose = vi.spyOn(FitAddon.prototype, "proposeDimensions").mockReturnValue(BOX);
    // The pane keeps its xterm private; the fit addon is handed the terminal.
    let term: Terminal | undefined;
    const activate = FitAddon.prototype.activate;
    vi.spyOn(FitAddon.prototype, "activate").mockImplementation(function (this: FitAddon, t) {
      term = t;
      return activate.call(this, t);
    });
    const resizes: Array<[number, number]> = [];
    const pane = createPane(
      40,
      { ...DEFAULT_SETTINGS, fontSize: 13 } as Settings,
      { ...silentEvents, onResize: (_id, cols, rows) => resizes.push([cols, rows]) },
      BOX,
    );
    const at = (guiZoom: number, fontSize = 13) =>
      pane.applySettings({ ...DEFAULT_SETTINGS, fontSize, guiZoom } as Settings);
    return { pane, propose, resizes, at, fontSize: () => term!.options.fontSize };
  }

  it.each([
    [0.85, 15.294],
    [0.9, 14.444],
    [1, 13],
    [1.1, 11.818],
    [1.25, 10.4],
  ])("draws the terminal at the setting divided by the zoom (%f -> %f)", (zoom, expected) => {
    const { pane, at, fontSize } = hostedPane();
    at(zoom);
    expect(fontSize()).toBe(expected);
    pane.dispose();
  });

  it("starts a new pane at the compensated size", () => {
    vi.stubGlobal("__deckHost", {});
    let term: Terminal | undefined;
    const activate = FitAddon.prototype.activate;
    vi.spyOn(FitAddon.prototype, "activate").mockImplementation(function (this: FitAddon, t) {
      term = t;
      return activate.call(this, t);
    });
    const pane = createPane(
      41,
      { ...DEFAULT_SETTINGS, fontSize: 13, guiZoom: 1.25 } as Settings,
      silentEvents,
    );
    expect(term!.options.fontSize).toBe(10.4);
    pane.dispose();
  });

  it("does not measure or resize the PTY while a zoom change is still landing", () => {
    const { pane, propose, resizes, at } = hostedPane();
    at(1.25);
    expect(propose).not.toHaveBeenCalled();
    expect(resizes).toEqual([]);
    pane.dispose();
  });

  it("fits once for a burst of zoom steps", () => {
    const { pane, propose, resizes, at } = hostedPane();
    for (const zoom of [1.1, 1.25, 1.1, 1]) {
      at(zoom);
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS / 3);
    }
    vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(resizes).toEqual([]);
    pane.dispose();
  });

  it("sends the PTY one resize when the box really changed with the zoom", () => {
    const { pane, propose, resizes, at } = hostedPane();
    at(1.25);
    propose.mockReturnValue({ cols: 70, rows: 30 });
    vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    expect(resizes).toEqual([[70, 30]]);
    pane.dispose();
  });

  it("still fits at once for a change that is not a zoom", () => {
    const { pane, propose, at } = hostedPane();
    at(1, 15);
    expect(propose).toHaveBeenCalledTimes(1);
    pane.dispose();
  });
});
