// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { PresetEditor } from "./preset-editor";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

describe("PresetEditor platform split gestures", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    resetDesktopEnvironmentForTests();
  });

  function mount(): HTMLDivElement {
    act(() => {
      render(<PresetEditor onCancel={() => {}} onCreate={() => {}} />, host);
    });
    return host.querySelector<HTMLDivElement>(".preset-editor")!;
  }

  function press(target: HTMLElement, init: KeyboardEventInit): void {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { ...init, bubbles: true }),
      );
    });
  }

  it("uses Cmd+ArrowRight on macOS", () => {
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    const editor = mount();

    press(editor, { key: "ArrowRight", metaKey: true });

    expect(host.querySelectorAll(".mock-pane")).toHaveLength(2);
  });

  it("uses Ctrl+ArrowDown on Windows and ignores Cmd", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const editor = mount();

    press(editor, { key: "ArrowDown", metaKey: true });
    expect(host.querySelectorAll(".mock-pane")).toHaveLength(1);

    press(editor, { key: "ArrowDown", ctrlKey: true });
    expect(host.querySelectorAll(".mock-pane")).toHaveLength(2);
  });
});
