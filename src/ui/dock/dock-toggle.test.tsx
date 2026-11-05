// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockToggle } from "./dock-toggle";
import { GLYPH_ROW } from "../controls/deck-icon";
import { shortcutLabel } from "../../lib/shortcut-label";

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
    // No native `title` since 2026-08-19 — the §23 tooltip says the name and
    // the chord, and two tooltips for one control is one too many.
    expect(button.getAttribute("title")).toBeNull();
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
    expect(button.getAttribute("title")).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  // DL-23.1: the control is icon-only, so the tooltip is the only place its
  // name and chord are printed. Both mounts draw it — this is one control in
  // two places, and the closed one on the stage strip is the mount a user
  // most needs told about, since nothing else on screen says the panel exists.
  it("says its name and the toggle-dock chord on hover", () => {
    act(() => render(<DockToggle open={false} onToggle={vi.fn()} />, host));

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      control().dispatchEvent(new Event("pointerenter", { bubbles: true }));
    });

    const tip = document.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toContain("Show the side panel");
    expect(tip?.querySelector("kbd")?.textContent).toBe(shortcutLabel("toggle-dock", "macos"));
    expect(control().getAttribute("aria-describedby")).toBe(tip?.id);
  });

  // RCP-4: the glyph follows its box, 16 in the 28 icon box by default. The size is a PROP,
  // not a read of `open`.
  it("draws the 28 box's 16 glyph by default and a smaller step when a mount asks", () => {
    act(() => render(<DockToggle open={false} onToggle={vi.fn()} />, host));
    expect(control().querySelector("svg.deck-icon")?.getAttribute("width")).toBe("16");

    act(() => render(<DockToggle open={false} size={GLYPH_ROW} onToggle={vi.fn()} />, host));
    expect(control().querySelector("svg.deck-icon")?.getAttribute("width")).toBe("14");
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
