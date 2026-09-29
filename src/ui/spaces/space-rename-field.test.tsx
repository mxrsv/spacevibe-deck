// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TAB_NAME_LENGTH } from "../../terminal/tabs-store";
import { SpaceRenameField } from "./space-rename-field";

describe("SpaceRenameField", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
  });

  function mount(initial = "auth") {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    act(() =>
      render(
        <SpaceRenameField
          initial={initial}
          placeholder="spacevibe-deck 2"
          onCommit={onCommit}
          onCancel={onCancel}
        />,
        host,
      ),
    );
    const input = host.querySelector("input")!;
    const type = (value: string): void => {
      input.value = value;
    };
    const key = (name: string): void => {
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
      });
    };
    return { input, type, key, onCommit, onCancel };
  }

  it("focuses with the whole name selected, so typing replaces it", () => {
    const { input } = mount();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    expect(input.placeholder).toBe("spacevibe-deck 2");
    expect(input.maxLength).toBe(MAX_TAB_NAME_LENGTH);
  });

  it("commits the trimmed text on Enter", () => {
    const { type, key, onCommit, onCancel } = mount();
    type("  scroll fix ");
    key("Enter");
    expect(onCommit).toHaveBeenCalledWith("scroll fix");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing", () => {
    const { type, key, onCommit, onCancel } = mount();
    type("ignored");
    key("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits null for an empty name, which reverts to the default", () => {
    const { type, key, onCommit } = mount();
    type("   ");
    key("Enter");
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("treats an unchanged name as a cancel", () => {
    const { key, onCommit, onCancel } = mount();
    key("Enter");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ends the edit once: Enter then the blur that follows does nothing more", () => {
    const { type, key, input, onCommit } = mount();
    type("x");
    key("Enter");
    act(() => {
      input.blur();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits on blur", () => {
    const { type, input, onCommit } = mount();
    type("x");
    act(() => {
      input.blur();
    });
    expect(onCommit).toHaveBeenCalledWith("x");
  });

  it("keeps its keys and clicks to itself, so a chord or a press behind it stays quiet", () => {
    const { key, input } = mount();
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    host.addEventListener("click", seen);
    key("a");
    act(() => input.click());
    expect(seen).not.toHaveBeenCalled();
  });
});
