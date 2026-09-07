// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";

const xterm = vi.hoisted(() => ({
  constructorOptions: undefined as Record<string, unknown> | undefined,
  opened: false,
}));

const webgl = vi.hoisted(() => ({
  instances: [] as Array<{
    activatedAfterOpen: boolean;
    disposed: number;
    emitContextLoss(): void;
  }>,
  throwOnActivate: false,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    unicode = { activeVersion: "" };
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = { active: { type: "normal" } };
    cols = 80;
    rows = 24;

    constructor(options: Record<string, unknown>) {
      xterm.constructorOptions = options;
      this.options = options;
    }
    open() {
      xterm.opened = true;
    }
    loadAddon(addon: { activate?(terminal: unknown): void }) {
      addon.activate?.(this);
    }
    attachCustomWheelEventHandler() {}
    registerLinkProvider() {
      return { dispose() {} };
    }
    onBell() {
      return { dispose() {} };
    }
    onData() {}
    onResize() {}
    getSelectionPosition() {
      return undefined;
    }
    paste() {}
    write() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activatedAfterOpen = false;
    disposed = 0;
    private contextLossHandler: (() => void) | undefined;

    constructor() {
      webgl.instances.push(this);
    }
    activate() {
      this.activatedAfterOpen = xterm.opened;
      if (webgl.throwOnActivate) throw new Error("WebGL2 unavailable");
    }
    onContextLoss(handler: () => void) {
      this.contextLossHandler = handler;
      return { dispose() {} };
    }
    emitContextLoss() {
      this.contextLossHandler?.();
    }
    dispose() {
      this.disposed += 1;
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    serialize() {
      return "";
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: class {},
}));
vi.mock("./webkit-ime-fix", () => ({
  applyWebkitImeFix: vi.fn(),
  isWebKitWebView: () => false,
}));
vi.mock("./shift-enter", () => ({ installShiftEnterNewline: () => vi.fn() }));
vi.mock("../settings/themes", () => ({ resolveTheme: () => ({}) }));
vi.mock("./link-provider", () => ({ createLinkProvider: () => ({}) }));
vi.mock("./osc-link-handler", () => ({ createOscLinkHandler: () => ({}) }));
vi.mock("./pane-cwd", () => ({ paneCwd: () => "" }));
vi.mock("../lib/osc-notification", () => ({
  classifyOscNotification: () => null,
}));
vi.mock("./terminal-clipboard", () => ({
  copyTerminalSelection: vi.fn(),
  pasteIntoTerminal: vi.fn(),
}));
vi.mock("../lib/platform", () => ({
  getDesktopEnvironment: () => ({ platform: "windows" }),
}));
vi.mock("./codex-wheel", () => ({ createCodexWheelHandler: () => vi.fn() }));

import { createPane } from "./pane";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  xterm.constructorOptions = undefined;
  xterm.opened = false;
  webgl.instances = [];
  webgl.throwOnActivate = false;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

const events = {
  onData: async () => true,
  onResize() {},
  onFocus() {},
};

describe("createPane OpenCode glyph rendering", () => {
  it("leaves line height alone — WebGL fills the cell, not flush rows", () => {
    createPane(1, DEFAULT_SETTINGS, events);
    expect(xterm.constructorOptions?.lineHeight).toBe(1.25);
  });

  it("loads WebGL only after the terminal is open", () => {
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    pane.mount();
    expect(webgl.instances[0].activatedAfterOpen).toBe(true);
  });

  it("loads one WebGL addon across repeated mounts", () => {
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    pane.mount();
    pane.mount();
    expect(webgl.instances).toHaveLength(1);
  });

  it("falls back to DOM and warns when WebGL cannot initialize", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    webgl.throwOnActivate = true;
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    expect(() => pane.mount()).not.toThrow();
    expect(webgl.instances[0].disposed).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "WebGL terminal renderer initialization failed; falling back to DOM:",
      expect.any(Error),
    );
  });

  it("falls back to DOM and warns on context loss", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    pane.mount();
    webgl.instances[0].emitContextLoss();
    webgl.instances[0].emitContextLoss();
    expect(webgl.instances[0].disposed).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("WebGL terminal renderer context lost; falling back to DOM.");
  });

  it("does not change the renderer when settings are applied", () => {
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    pane.mount();
    pane.applySettings({ ...DEFAULT_SETTINGS, fontSize: 14 });
    expect(webgl.instances).toHaveLength(1);
    expect(webgl.instances[0].disposed).toBe(0);
  });

  it("dispose releases the active WebGL addon", () => {
    const pane = createPane(1, DEFAULT_SETTINGS, events);
    pane.mount();
    pane.dispose();
    expect(webgl.instances[0].disposed).toBe(1);
  });
});
