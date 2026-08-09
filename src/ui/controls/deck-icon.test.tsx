// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { Settings, Trash2 } from "lucide-preact";
import { beforeEach, describe, expect, it } from "vitest";
import { DeckIcon } from "./deck-icon";

describe("DeckIcon", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders the passed icon with the shared chrome contract", () => {
    act(() => render(<DeckIcon icon={Settings} />, host));

    const svg = host.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
  });

  it("identifies which icon it drew through Lucide's class marker", () => {
    act(() => render(<DeckIcon icon={Settings} />, host));

    expect(host.querySelector(".lucide-settings")).not.toBeNull();
    expect(host.querySelector(".lucide-trash-2")).toBeNull();
  });

  it("draws at each control scale the chrome uses", () => {
    for (const size of [13, 14, 15, 16] as const) {
      act(() => render(<DeckIcon icon={Trash2} size={size} />, host));

      const svg = host.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe(String(size));
      expect(svg?.getAttribute("height")).toBe(String(size));
      // Stroke weight is a constant across sizes: every icon is drawn in the
      // same 24-unit box, so 1.8 means the same thing at 13px as at 16px.
      expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    }
  });

  it("keeps the Lucide marker when the caller adds a class", () => {
    act(() => render(<DeckIcon icon={Trash2} class="row__ico" />, host));

    const svg = host.querySelector("svg");
    expect(svg?.classList.contains("row__ico")).toBe(true);
    expect(svg?.classList.contains("lucide-trash-2")).toBe(true);
  });
});
