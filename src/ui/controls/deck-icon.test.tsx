// @vitest-environment jsdom
import { Gear, SidebarSimple, Trash } from "@phosphor-icons/react";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { DeckIcon } from "./deck-icon";

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
  // the library's own output at each weight. Without these two, DL-14.1's
  // 2026-08-19 split between the outline default and the solid exceptions
  // would live in one unguarded conditional.
  const pathData = (node: ParentNode): string =>
    Array.from(node.querySelectorAll("path"))
      .map((path) => path.getAttribute("d"))
      .join("|");

  const reference = (Icon: typeof Gear, weight: "regular" | "fill"): string => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    act(() => render(<Icon size={16} weight={weight} />, node));
    return pathData(node);
  };

  it("draws the outline weight by default", () => {
    act(() => render(<DeckIcon icon={Gear} />, host));
    const drawn = pathData(host);

    expect(drawn).toBe(reference(Gear, "regular"));
    expect(drawn).not.toBe(reference(Gear, "fill"));
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

  it("carries the layout class the stylesheet targets", () => {
    act(() => render(<DeckIcon icon={Gear} />, host));

    // `.deck-icon` is the app's one icon rule (`display: block; flex: none`).
    // Phosphor emits no class of its own, so if this stops being
    // unconditional every icon in the app regains a descender-sized gap.
    expect(host.querySelector("svg")?.classList.contains("deck-icon")).toBe(
      true,
    );
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
    expect(host.querySelector("svg")?.getAttribute("transform")).toBe(
      "scale(-1, 1)",
    );
  });
});
