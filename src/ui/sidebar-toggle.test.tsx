// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarToggle } from "./sidebar-toggle";

describe("SidebarToggle", () => {
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
      throw new Error("SidebarToggle rendered no control");
    }
    return button;
  }

  it("offers to collapse an expanded sidebar", () => {
    act(() =>
      render(<SidebarToggle collapsed={false} onToggle={vi.fn()} />, host),
    );

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Collapse the sidebar");
    expect(button.getAttribute("title")).toBe("Collapse the sidebar");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  // The one control says both things: collapsed, it is the way back out, and
  // it reads pressed so the state is not carried by the label alone.
  //
  // DL-21.8: pressed is said in ARIA and NOWHERE in the paint. A hidden
  // sidebar is a change to the whole window, so the class assertion below is
  // inverted on purpose — it guards against the wash coming back.
  it("offers to expand a collapsed sidebar, and reads pressed without painting it", () => {
    act(() => render(<SidebarToggle collapsed onToggle={vi.fn()} />, host));

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Expand the sidebar");
    expect(button.getAttribute("title")).toBe("Expand the sidebar");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  it("reports a click and keeps no state of its own", () => {
    const onToggle = vi.fn();
    act(() =>
      render(<SidebarToggle collapsed={false} onToggle={onToggle} />, host),
    );

    act(() => {
      control().click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    // Nothing repainted: the owner of the state decides what happens next.
    expect(control().getAttribute("aria-pressed")).toBe("false");
  });
});
