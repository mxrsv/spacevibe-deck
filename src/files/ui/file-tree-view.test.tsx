// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeRow } from "../file-tree";
import { FileTreeView, INDENT, ROW_HEIGHT, visibleRange } from "./file-tree-view";

function row(
  name: string,
  options: { depth?: number; directory?: boolean; expanded?: boolean } = {},
): TreeRow {
  return {
    path: `/r/${name}`,
    name,
    directory: options.directory ?? false,
    depth: options.depth ?? 0,
    expanded: options.expanded ?? false,
    outOfRoot: false,
  };
}

let host: HTMLDivElement | null = null;

function mount(rows: readonly TreeRow[], overrides: Partial<Parameters<typeof FileTreeView>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <FileTreeView
      rows={rows}
      activePath={null}
      scrollTop={0}
      onScroll={() => {}}
      onActivate={() => {}}
      onKeep={() => {}}
      {...overrides}
    />,
    host,
  );
  return host;
}

afterEach(() => {
  if (host !== null) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("visibleRange", () => {
  it("renders a screenful plus overscan, not the whole tree", () => {
    // A 10k-entry directory is normal in the repos Deck is pointed at, and
    // rendering it as DOM is the difference between a panel and a freeze.
    const { start, end } = visibleRange(10_000, 0, 600);
    expect(start).toBe(0);
    expect(end).toBeLessThan(50);
  });

  it("follows the scroll position", () => {
    const { start, end } = visibleRange(10_000, 22 * 100, 600);
    expect(start).toBeLessThan(100);
    expect(start).toBeGreaterThan(80);
    expect(end).toBeGreaterThan(120);
  });

  it("never runs past either end", () => {
    expect(visibleRange(5, 0, 600)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(0, 0, 600)).toEqual({ start: 0, end: 0 });
    // Scrolled to the last row of a short tree: the end clamps to the row
    // count rather than running past it.
    expect(visibleRange(10, 22 * 9, 600).end).toBe(10);
  });
});

describe("FileTreeView", () => {
  it("renders only a window of a huge tree", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      row(`file-${index}.ts`),
    );
    const node = mount(rows);
    // jsdom reports clientHeight 0, so the component falls back to its default
    // viewport — the point is that it is a WINDOW, not 10,000 nodes.
    expect(node.querySelectorAll(".explorer__row").length).toBeLessThan(200);
    expect(node.querySelector(".explorer__spacer")).not.toBeNull();
  });

  it("indents by one fixed token per depth (DL-16.3)", () => {
    const node = mount([row("src", { directory: true }), row("index.ts", { depth: 1 })]);
    const rendered = node.querySelectorAll<HTMLElement>(".explorer__row");
    expect(rendered[0].style.paddingLeft).toBe("6px");
    expect(rendered[1].style.paddingLeft).toBe(`${6 + INDENT}px`);
  });

  it("keeps a file name's real casing (DL-16.4)", () => {
    const node = mount([row("README.md"), row("Makefile")]);
    const names = [...node.querySelectorAll(".explorer__name")].map(
      (element) => element.textContent,
    );
    expect(names).toEqual(["README.md", "Makefile"]);
  });

  it("marks the active row selected", () => {
    const node = mount([row("a.ts"), row("b.ts")], { activePath: "/r/b.ts" });
    const active = node.querySelectorAll(".explorer__row.is-active");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("aria-selected")).toBe("true");
  });

  it("shows an expander for a directory and none for a file", () => {
    const node = mount([row("src", { directory: true }), row("a.ts")]);
    const rendered = node.querySelectorAll(".explorer__row");
    expect(rendered[0].getAttribute("aria-expanded")).toBe("false");
    expect(rendered[1].hasAttribute("aria-expanded")).toBe(false);
  });

  it("routes single click to activate and double click to keep", () => {
    const onActivate = vi.fn();
    const onKeep = vi.fn();
    const node = mount([row("a.ts")], { onActivate, onKeep });
    const rendered = node.querySelector<HTMLElement>(".explorer__row")!;

    rendered.click();
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ name: "a.ts" }));

    rendered.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ name: "a.ts" }));
  });

  it("sizes its spacer to the whole tree so the scrollbar tells the truth", () => {
    const node = mount(Array.from({ length: 500 }, (_, i) => row(`f${i}.ts`)));
    const spacer = node.querySelector<HTMLElement>(".explorer__spacer")!;
    expect(spacer.style.height).toBe(`${500 * ROW_HEIGHT}px`);
  });
});
