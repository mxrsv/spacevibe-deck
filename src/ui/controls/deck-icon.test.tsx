// @vitest-environment jsdom
import { Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { Folder, Gear, Plus, SidebarSimple, Trash } from "@phosphor-icons/react";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { DeckIcon, GLYPH_FEATURE, GLYPH_INLINE, GLYPH_ROW } from "./deck-icon";

describe("DeckIcon", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders the passed icon with the shared chrome contract", () => {
    act(() => render(<DeckIcon icon={Gear} />, host));

    const svg = host.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    // Phosphor draws with `fill`, not `stroke`: weight is expressed by the
    // path data the component picks, so there is no stroke attribute to
    // assert and `currentColor` has to reach the icon through `fill`.
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 256 256");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
  });

  // Phosphor expresses weight in the path data, so there is no attribute to
  // read: the only way to pin the choice is to compare what was drawn against
  // the library's own output at each weight. Without these checks, DL-14.1's
  // 2026-10-09 split between the bold default, the solid bodies and the
  // scoped exception would be unguarded.
  const pathData = (node: ParentNode): string =>
    Array.from(node.querySelectorAll("path"))
      .map((path) => path.getAttribute("d"))
      .join("|");

  const reference = (Icon: typeof Gear, weight: "regular" | "bold" | "fill"): string => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    act(() => render(<Icon size={16} weight={weight} />, node));
    return pathData(node);
  };

  it("draws the bold outline by default", () => {
    act(() => render(<DeckIcon icon={Plus} />, host));
    const drawn = pathData(host);

    expect(drawn).toBe(reference(Plus, "bold"));
    expect(drawn).not.toBe(reference(Plus, "regular"));
    expect(drawn).not.toBe(reference(Plus, "fill"));
  });

  it("draws an icon with a body solid", () => {
    act(() => render(<DeckIcon icon={Folder} />, host));
    expect(pathData(host)).toBe(reference(Folder, "fill"));
  });

  it("draws the panel toggle solid — the one documented exception", () => {
    // Both panel toggles are this icon; the dock's is the same drawing
    // mirrored. If the exception set ever stops matching, this flips to the
    // outline gear's story and the toggles silently lose their weight.
    act(() => render(<DeckIcon icon={SidebarSimple} />, host));
    const drawn = pathData(host);

    expect(drawn).toBe(reference(SidebarSimple, "fill"));
    expect(drawn).not.toBe(reference(SidebarSimple, "regular"));
  });

  it("allows a surface-scoped solid treatment without changing the default", () => {
    act(() => render(<DeckIcon icon={Plus} filled />, host));
    expect(pathData(host)).toBe(reference(Plus, "fill"));

    act(() => render(<DeckIcon icon={Plus} />, host));
    expect(pathData(host)).toBe(reference(Plus, "bold"));
  });

  it("carries the layout class the stylesheet targets", () => {
    act(() => render(<DeckIcon icon={Gear} />, host));

    // `.deck-icon` is the app's one icon rule (`display: block; flex: none`).
    // Phosphor emits no class of its own, so if this stops being
    // unconditional every icon in the app regains a descender-sized gap.
    expect(host.querySelector("svg")?.classList.contains("deck-icon")).toBe(true);
  });

  it("identifies which icon it drew through a derived modifier class", () => {
    act(() => render(<DeckIcon icon={Gear} />, host));

    expect(host.querySelector(".deck-icon--gear")).not.toBeNull();
    expect(host.querySelector(".deck-icon--trash")).toBeNull();
  });

  it("draws at each control scale the chrome uses", () => {
    for (const size of [13, 14, 15, 16] as const) {
      act(() => render(<DeckIcon icon={Trash} size={size} />, host));

      const svg = host.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe(String(size));
      expect(svg?.getAttribute("height")).toBe(String(size));
    }
  });

  it("keeps both its own classes when the caller adds one", () => {
    act(() => render(<DeckIcon icon={Trash} class="row__ico" />, host));

    const svg = host.querySelector("svg");
    expect(svg?.classList.contains("row__ico")).toBe(true);
    expect(svg?.classList.contains("deck-icon")).toBe(true);
    expect(svg?.classList.contains("deck-icon--trash")).toBe(true);
  });

  it("flips a one-sided mark only when the caller asks", () => {
    act(() => render(<DeckIcon icon={SidebarSimple} />, host));
    expect(host.querySelector("svg")?.getAttribute("transform")).toBeNull();

    act(() => render(<DeckIcon icon={SidebarSimple} mirrored />, host));
    expect(host.querySelector("svg")?.getAttribute("transform")).toBe("scale(-1, 1)");
  });

  describe("a Hugeicons glyph", () => {
    // Hugeicons glyphs carry no name, so what was drawn is pinned by comparing path data.
    const drawnPaths = (node: ParentNode): string[] =>
      Array.from(node.querySelectorAll("path")).map((path) => path.getAttribute("d") ?? "");
    const glyphPaths = (glyph: typeof Delete02Icon): string[] =>
      glyph.flatMap(([, attributes]) => (typeof attributes.d === "string" ? [attributes.d] : []));

    it("draws the glyph it was given, with the shared chrome contract", () => {
      act(() => render(<DeckIcon icon={Delete02Icon} />, host));

      const svg = host.querySelector("svg");
      expect(drawnPaths(host)).toEqual(glyphPaths(Delete02Icon));
      expect(drawnPaths(host)).not.toEqual(glyphPaths(Cancel01Icon));
      expect(svg?.getAttribute("width")).toBe("16");
      expect(svg?.getAttribute("height")).toBe("16");
      expect(svg?.getAttribute("stroke-width")).toBe("2");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("focusable")).toBe("false");
      expect(svg?.classList.contains("deck-icon")).toBe(true);
    });

    it("draws at the three standalone sizes and keeps the caller's class", () => {
      for (const size of [GLYPH_INLINE, GLYPH_ROW, GLYPH_FEATURE]) {
        act(() => render(<DeckIcon icon={Cancel01Icon} size={size} class="shrink-0" />, host));

        const svg = host.querySelector("svg");
        expect(svg?.getAttribute("width")).toBe(String(size));
        expect(svg?.getAttribute("height")).toBe(String(size));
        expect(svg?.classList.contains("shrink-0")).toBe(true);
        expect(svg?.classList.contains("deck-icon")).toBe(true);
      }
      expect([GLYPH_INLINE, GLYPH_ROW, GLYPH_FEATURE]).toEqual([12, 14, 16]);
    });
  });
});
