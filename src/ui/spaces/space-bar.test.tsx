// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceBar } from "./space-bar";
import type { Space, SpacePane } from "./space-model";

/**
 * The strip's marks (DL-35.3): needs-you is the one state a mark carries, in
 * the rail's two inks (owner, 2026-10-06). The paint is CSS, which jsdom does
 * not load, so the second block reads the stylesheet and pins the two rules.
 */

function pane(paneId: number, state: SpacePane["state"]): SpacePane {
  return { paneId, agent: "claude", state };
}

function space(key: number, panes: readonly SpacePane[], current = false): Space {
  return {
    tabIndex: key - 1,
    key,
    folder: `project-${key}`,
    name: null,
    index: null,
    path: `/work/project-${key}`,
    group: `plain:/work/project-${key}`,
    groupLabel: `project-${key}`,
    branch: null,
    panes,
    agentCount: panes.length,
    needsCount: panes.filter((p) => p.state === "asked" || p.state === "failed").length,
    failedCount: panes.filter((p) => p.state === "failed").length,
    session: null,
    current,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function mount(spaces: readonly Space[]): void {
  act(() => {
    render(
      <SpaceBar
        spaces={spaces}
        menuKey={null}
        onGo={vi.fn()}
        onMenu={vi.fn()}
        onRename={vi.fn()}
      />,
      host,
    );
  });
}

function marks(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".space-mark")];
}

describe("SpaceBar needs-you marks (DL-35.3, two inks 2026-10-06)", () => {
  it("tells a question from a failure on the mark itself", () => {
    mount([
      space(1, [pane(1, "asked")]),
      space(2, [pane(2, "failed")]),
      space(3, [pane(3, "working")]),
    ]);

    expect(marks().map((mark) => mark.dataset.needs)).toEqual(["asked", "failed", undefined]);
  });

  it("reads red once anything in the space failed, whatever else is asking", () => {
    mount([space(1, [pane(1, "asked"), pane(2, "failed"), pane(3, "asked")])]);

    expect(marks()[0].dataset.needs).toBe("failed");
  });

  it("marks a current space that needs you, keeping its pill", () => {
    mount([space(1, [pane(1, "asked")], true), space(2, [pane(2, "done")])]);

    const [current, other] = marks();
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(current.dataset.needs).toBe("asked");
    expect(current.querySelector(".space-mark__pill")).not.toBeNull();
    expect(other.hasAttribute("data-needs")).toBe(false);
  });

  it("says how many need you in the accessible name, not by colour alone", () => {
    mount([space(1, [pane(1, "asked"), pane(2, "failed")])]);

    expect(marks()[0].getAttribute("aria-label")).toBe("project-1 · 2 agents · 2 need you");
  });
});

describe("SpaceBar breadcrumb (DL-35.3, amended 2026-10-07)", () => {
  const crumb = (): string[] =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.space-bar__name-slot[data-current="true"] :is(.space-bar__part, .space-bar__label)',
      ),
    ].map((part) => part.textContent ?? "");

  it("prints project › branch › space › session for the current space", () => {
    mount([
      {
        ...space(1, [pane(1, "working")], true),
        groupLabel: "spacevibe-deck",
        branch: "main",
        name: "rail tree",
        session: "Claude",
      },
      space(2, [pane(2, "idle")]),
    ]);

    expect(crumb()).toEqual(["spacevibe-deck", "main", "rail tree", "Claude"]);
    // One separator between each pair, drawn as an icon, never a glyph.
    const current = host.querySelector('.space-bar__name-slot[data-current="true"]');
    expect(current?.querySelectorAll(".space-bar__sep")).toHaveLength(3);
    expect(current?.textContent).not.toContain("›");
  });

  it("skips the branch when no scan knows one, and a session that repeats the name", () => {
    mount([{ ...space(1, [pane(1, "idle")], true), name: "rail tree", session: "rail tree" }]);

    expect(crumb()).toEqual(["project-1", "rail tree"]);
    expect(host.querySelectorAll('[data-current="true"] .space-bar__sep')).toHaveLength(1);
  });

  it("prints an unnamed space's folder once when it is the project", () => {
    mount([
      {
        ...space(1, [pane(1, "idle")], true),
        groupLabel: "project-1",
        branch: "main",
        session: "Codex",
      },
    ]);

    expect(crumb()).toEqual(["project-1", "main", "Codex"]);
    expect(host.querySelectorAll('[data-current="true"] .space-bar__sep')).toHaveLength(2);
  });

  it("gives way from the project end first at narrow widths", () => {
    const css = readFileSync("src/styles/20-mission-control.css", "utf8");
    const shrink = (selector: string): number => {
      // The selector opens several blocks; the weight lives in one of them.
      const blocks = css.split(`${selector} {`).slice(1);
      const weights = blocks.flatMap((block) => {
        const match = block.split("}")[0]?.match(/flex:\s*0\s+(\d+)\s+auto/);
        return match ? [Number(match[1])] : [];
      });
      return weights[0] ?? 0;
    };

    const order = [
      shrink('.space-bar__part[data-part="project"]'),
      shrink('.space-bar__part[data-part="branch"]'),
      shrink(".space-bar__space"),
      shrink('.space-bar__part[data-part="session"]'),
    ];
    expect(order.every((weight) => weight > 0)).toBe(true);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });
});

describe("space mark paint (20-mission-control.css)", () => {
  const css = readFileSync("src/styles/20-mission-control.css", "utf8");

  /** The declaration block of the one rule whose selector is exactly `selector`. */
  function paint(selector: string): string | undefined {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const rule = rules.find(
      (match) => match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim() === selector,
    );
    return rule?.[2].match(/background:\s*([^;]+);/)?.[1].trim();
  }

  it("paints the resting dot yellow for asked and red for failed", () => {
    expect(paint('.space-mark[data-needs="asked"]::before')).toBe("var(--status-unread)");
    expect(paint(".space-mark[data-needs]::before")).toBe("var(--red)");
  });

  it("paints the current space's under-dot in the same two inks", () => {
    expect(paint('.space-mark[aria-selected="true"][data-needs="asked"]::after')).toBe(
      "var(--status-unread)",
    );
    expect(paint('.space-mark[aria-selected="true"][data-needs]::after')).toBe("var(--red)");
  });

  it("puts the yellow rule after the red one so asked wins at equal specificity", () => {
    expect(css.indexOf('.space-mark[data-needs="asked"]::before')).toBeGreaterThan(
      css.indexOf(".space-mark[data-needs]::before"),
    );
    expect(
      css.indexOf('.space-mark[aria-selected="true"][data-needs="asked"]::after'),
    ).toBeGreaterThan(css.indexOf('.space-mark[aria-selected="true"][data-needs]::after'));
  });
});
