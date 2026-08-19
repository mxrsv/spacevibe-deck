// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NEWLINE_SEQUENCE, installShiftEnterNewline, isShiftEnter } from "./shift-enter";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe("isShiftEnter", () => {
  it("matches a bare Shift+Enter", () => {
    expect(isShiftEnter(keyEvent({ shiftKey: true }))).toBe(true);
  });

  it("ignores plain Enter — that one still submits", () => {
    expect(isShiftEnter(keyEvent({}))).toBe(false);
  });

  // ⌘⇧Enter is toggle-zoom-pane in action-registry.ts; swallowing it here
  // would kill the shortcut.
  it("ignores Cmd+Shift+Enter", () => {
    expect(isShiftEnter(keyEvent({ shiftKey: true, metaKey: true }))).toBe(false);
  });

  it("ignores Ctrl+Shift+Enter and Alt+Shift+Enter", () => {
    expect(isShiftEnter(keyEvent({ shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(isShiftEnter(keyEvent({ shiftKey: true, altKey: true }))).toBe(false);
  });

  it("ignores a non-Enter key held with Shift", () => {
    expect(isShiftEnter(keyEvent({ key: "a", shiftKey: true }))).toBe(false);
  });

  // A composing IME owns Enter to commit its candidate.
  it("ignores Enter while an IME is composing", () => {
    expect(isShiftEnter(keyEvent({ shiftKey: true, isComposing: true }))).toBe(false);
  });
});

describe("installShiftEnterNewline", () => {
  it("sends ESC CR and stops the event before xterm sees it", () => {
    const host = document.createElement("div");
    const inner = document.createElement("textarea");
    host.append(inner);
    document.body.append(host);
    const send = vi.fn();
    // Stands in for xterm's own keydown handler on the helper textarea.
    const downstream = vi.fn();
    inner.addEventListener("keydown", downstream);

    installShiftEnterNewline(host, send);
    const event = keyEvent({ shiftKey: true });
    inner.dispatchEvent(event);

    expect(send).toHaveBeenCalledWith(NEWLINE_SEQUENCE);
    expect(downstream).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    host.remove();
  });

  it("lets plain Enter through to xterm untouched", () => {
    const host = document.createElement("div");
    const inner = document.createElement("textarea");
    host.append(inner);
    document.body.append(host);
    const send = vi.fn();
    const downstream = vi.fn();
    inner.addEventListener("keydown", downstream);

    installShiftEnterNewline(host, send);
    const event = keyEvent({});
    inner.dispatchEvent(event);

    expect(send).not.toHaveBeenCalled();
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    host.remove();
  });

  it("stops sending once disposed", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const send = vi.fn();

    const dispose = installShiftEnterNewline(host, send);
    dispose();
    host.dispatchEvent(keyEvent({ shiftKey: true }));

    expect(send).not.toHaveBeenCalled();
    host.remove();
  });
});
