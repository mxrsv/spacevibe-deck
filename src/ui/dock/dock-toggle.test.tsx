// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockToggle } from "./dock-toggle";

describe("DockToggle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  function control(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>("button.iconbtn");
    if (button === null) {
      throw new Error("DockToggle rendered no control");
    }
    return button;
  }

  it("offers to show a closed panel", () => {
    act(() => render(<DockToggle open={false} onToggle={vi.fn()} />, host));

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Show the side panel");
    expect(button.getAttribute("title")).toBe("Show the side panel");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  // The one control says both things: open, it is the way to hide the panel,
  // and it reads pressed so the state is not carried by the label alone.
  //
  // DL-21.8: pressed is said in ARIA and NOWHERE in the paint — an open panel
  // occupies a column of the window, which is the readout. The class assertion
  // is inverted on purpose, guarding against the wash coming back.
  it("offers to hide an open panel, and reads pressed without painting it", () => {
    act(() => render(<DockToggle open onToggle={vi.fn()} />, host));

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Hide the side panel");
    expect(button.getAttribute("title")).toBe("Hide the side panel");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  it("reports a click and keeps no state of its own", () => {
    const onToggle = vi.fn();
    act(() => render(<DockToggle open={false} onToggle={onToggle} />, host));

    act(() => {
      control().click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    // Nothing repainted: the owner of the state decides what happens next.
    expect(control().getAttribute("aria-pressed")).toBe("false");
  });
});
