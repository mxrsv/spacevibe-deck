// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pingPane } from "./pane-ping";

/** The slot shape `layout-engine.ts` builds: `.pane-slot[data-pane-id]`. */
function grid(...paneIds: readonly number[]): HTMLElement {
  const container = document.createElement("div");
  for (const id of paneIds) {
    const slot = document.createElement("div");
    slot.className = "pane-slot";
    slot.dataset.paneId = String(id);
    container.appendChild(slot);
  }
  return container;
}

function slot(root: ParentNode, paneId: number): HTMLElement {
  const found = root.querySelector<HTMLElement>(
    `.pane-slot[data-pane-id="${paneId}"]`,
  );
  if (found === null) {
    throw new Error(`no slot for pane ${paneId}`);
  }
  return found;
}

function pings(root: ParentNode): readonly Element[] {
  return [...root.querySelectorAll(".pane-ping")];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("pingPane", () => {
  it("appends one inert ping inside the named slot", () => {
    const root = grid(1, 2);

    pingPane(2, root);

    expect(pings(slot(root, 1))).toHaveLength(0);
    const ping = pings(slot(root, 2))[0];
    expect(ping.tagName).toBe("SPAN");
    // Hidden from assistive tech: the ring is a locator for the eye, and the
    // pane's own accessible name already says what arrived (DL-27.7).
    expect(ping.getAttribute("aria-hidden")).toBe("true");
  });

  it("replaces its own ping rather than stacking, so the animation replays", () => {
    const root = grid(1);

    pingPane(1, root);
    const first = pings(slot(root, 1))[0];
    pingPane(1, root);

    const after = pings(slot(root, 1));
    expect(after).toHaveLength(1);
    // A CSS animation only restarts when its element is new — the same node
    // surviving would mean the second request rang nothing.
    expect(after[0]).not.toBe(first);
  });

  it("clears a ping burning in another slot", () => {
    const root = grid(1, 2);

    pingPane(1, root);
    pingPane(2, root);

    expect(pings(slot(root, 1))).toHaveLength(0);
    expect(pings(slot(root, 2))).toHaveLength(1);
  });

  it("is a complete no-op when the slot is gone", () => {
    // The layout is rebuilt imperatively, so a pane can close between the
    // rail click and this call. A miss must not put out the live ring either.
    const root = grid(1);
    pingPane(1, root);
    const live = pings(slot(root, 1))[0];

    expect(() => pingPane(99, root)).not.toThrow();

    expect(pings(root)).toHaveLength(1);
    expect(pings(slot(root, 1))[0]).toBe(live);
  });

  it("falls back to the document when no root is given", () => {
    document.body.appendChild(grid(3));

    pingPane(3);

    expect(pings(slot(document, 3))).toHaveLength(1);
  });
});
