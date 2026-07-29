// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { createTerminalClipboardHandler } from "./terminal-clipboard";

interface ClipboardHarness {
  readonly handler: (event: KeyboardEvent) => boolean;
  readonly readText: ReturnType<typeof vi.fn<() => Promise<string>>>;
  readonly writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  readonly send: ReturnType<typeof vi.fn<(text: string) => void>>;
  readonly reportError: ReturnType<typeof vi.fn<(message: string) => void>>;
}

function createHarness(selection = ""): ClipboardHarness {
  const readText = vi.fn(async () => "pasted text");
  const writeText = vi.fn(async () => {});
  const send = vi.fn();
  const reportError = vi.fn();
  const handler = createTerminalClipboardHandler(
    {
      getSelection: () => selection,
      hasSelection: () => selection !== "",
    },
    send,
    { readText, writeText, reportError },
  );
  return { handler, readText, writeText, send, reportError };
}

function key(
  value: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, ...init });
}

afterEach(() => {
  resetDesktopEnvironmentForTests();
});

describe("createTerminalClipboardHandler", () => {
  it("copies a non-empty Windows selection and owns Ctrl+Shift+C", async () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const harness = createHarness("selected text");

    expect(
      harness.handler(key("c", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    await vi.waitFor(() => {
      expect(harness.writeText).toHaveBeenCalledWith("selected text");
    });
  });

  it("owns Windows copy without writing an empty selection", async () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const harness = createHarness();

    expect(
      harness.handler(key("C", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    await Promise.resolve();
    expect(harness.writeText).not.toHaveBeenCalled();
  });

  it("pastes Windows clipboard text through pane input", async () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const harness = createHarness();

    expect(
      harness.handler(key("v", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    await vi.waitFor(() => {
      expect(harness.send).toHaveBeenCalledWith("pasted text");
    });
  });

  it("reports clipboard failures without rejecting the key handler", async () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const harness = createHarness("selected text");
    harness.writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));

    expect(
      harness.handler(key("c", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    await vi.waitFor(() => {
      expect(harness.reportError).toHaveBeenCalledWith(
        "Couldn't copy the terminal selection",
      );
    });
  });

  it("leaves macOS copy and paste to the native terminal behavior", () => {
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    const harness = createHarness("selected text");

    expect(
      harness.handler(key("c", { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      harness.handler(key("v", { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it.each(["c", "d", "w", "k", "f"])(
    "leaves bare Ctrl+%s available to the PTY",
    (value) => {
      initializeDesktopEnvironment({
        platform: "windows",
        homeDir: String.raw`C:\Users\dev`,
      });
      const harness = createHarness("selected text");

      expect(harness.handler(key(value, { ctrlKey: true }))).toBe(true);
      expect(harness.readText).not.toHaveBeenCalled();
      expect(harness.writeText).not.toHaveBeenCalled();
    },
  );

  it("does not own extra-modifier or non-keydown events", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const harness = createHarness("selected text");

    expect(
      harness.handler(
        key("c", { ctrlKey: true, shiftKey: true, altKey: true }),
      ),
    ).toBe(true);
    expect(
      harness.handler(
        new KeyboardEvent("keyup", {
          key: "v",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
  });
});
