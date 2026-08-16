// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { PresetEditor } from "./preset-editor";

vi.mock("../host/dialog-host", () => ({
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

// DL-29.3. The other two modals close on a scrim click; this one must not,
// because its draft — the split tree, the per-pane cwds, the name — exists
// nowhere but this component until "Create tab" is pressed.
describe("PresetEditor scrim", () => {
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

  it("ignores a click on the scrim so a slipped click cannot drop the draft", () => {
    const onCancel = vi.fn();
    act(() => {
      render(<PresetEditor onCancel={onCancel} onCreate={() => {}} />, host);
    });
    const scrim = host.querySelector<HTMLDivElement>(".modal-scrim")!;

    act(() => {
      scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("still closes on Escape", () => {
    const onCancel = vi.fn();
    act(() => {
      render(<PresetEditor onCancel={onCancel} onCreate={() => {}} />, host);
    });
    const editor = host.querySelector<HTMLDivElement>(".preset-editor")!;

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
