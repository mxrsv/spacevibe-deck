// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRailClusterDragController } from "./rail-cluster-drag";

/** Three stacked 60px clusters, so every midpoint is unambiguous. */
const HEIGHT = 60;
const CLUSTERS = ["alpha", "beta", "gamma"];

function pointer(type: string, x: number, y: number): PointerEvent {
  // jsdom has no PointerEvent constructor; MouseEvent carries every field this
  // controller reads, and `pointerId` is patched on after construction.
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
  }) as unknown as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

/** jsdom lays nothing out, so every rect this controller reads is declared. */
function stubRect(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 240,
      width: 240,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("createRailClusterDragController", () => {
  let list: HTMLDivElement;
  const onDrop = vi.fn<(from: number, to: number) => void>();
  const onDragStart = vi.fn();
  /**
   * The controller does its measuring and painting once per animation frame,
   * so every test drives the clock by hand. A synchronous `requestAnimationFrame`
   * stub would not do: a pass inside the auto-scroll band schedules the next
   * one itself, and running that inline is an infinite loop.
   */
  let frames: FrameRequestCallback[] = [];

  function flush(): void {
    const queued = frames;
    frames = [];
    for (const callback of queued) {
      callback(0);
    }
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    document.body.innerHTML = "";
    list = document.createElement("div");
    list.className = "asr-rail__list";
    // The scrollport reaches well past every pointer these tests use, so none
    // of them lands in the auto-scroll band at either edge.
    stubRect(list, -200, 1000);
    for (const [index, project] of CLUSTERS.entries()) {
      const cluster = document.createElement("div");
      cluster.className = "asr-cluster";
      cluster.dataset.orderKey = project;
      stubRect(cluster, index * HEIGHT, HEIGHT);

      const head = document.createElement("div");
      head.className = "asr-cluster__head";
      const name = document.createElement("span");
      name.className = "asr-cluster__name";
      name.textContent = project;
      const add = document.createElement("button");
      add.className = "asr-cluster__add";
      head.append(name, add);

      const row = document.createElement("div");
      row.className = "asr-row";

      cluster.append(head, row);
      list.append(cluster);
    }
    document.body.append(list);
    onDrop.mockClear();
    onDragStart.mockClear();
  });

  afterEach(async () => {
    document.body.className = "";
    vi.unstubAllGlobals();
    // The click swallow disarms itself on a `setTimeout(…, 0)`, which never
    // gets to run inside a synchronous test body. Without this yield an armed
    // swallow survives into the NEXT test and eats its click — measured: the
    // flick case below passed against a deliberately broken guard purely
    // because its predecessor's swallow was still standing.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  function install() {
    return createRailClusterDragController(list, { onDragStart, onDrop });
  }

  function headOf(index: number): HTMLElement {
    return list.querySelectorAll<HTMLElement>(".asr-cluster__head")[index];
  }

  it("stays a plain header below the drag threshold", () => {
    const controller = install();

    headOf(2).dispatchEvent(pointer("pointerdown", 20, 150));
    window.dispatchEvent(pointer("pointermove", 22, 152));
    window.dispatchEvent(pointer("pointerup", 22, 152));

    // The collapse toggle shares this surface, so nothing may be consumed
    // until a real drag begins (spec §6).
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector(".rail-drag-ghost")).toBeNull();
    controller.dispose();
  });

  it("reports the slot a completed drag landed in", () => {
    const controller = install();

    headOf(2).dispatchEvent(pointer("pointerdown", 20, 150));
    // Into the top half of the first cluster: insert before it.
    window.dispatchEvent(pointer("pointermove", 20, 20));
    flush();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".rail-drag-ghost")?.textContent).toBe("gamma");
    expect(document.querySelector(".rail-drag-line")).not.toBeNull();

    window.dispatchEvent(pointer("pointerup", 20, 20));

    expect(onDrop).toHaveBeenCalledWith(2, 0);
    // The drag's own chrome is cleaned up with the drag.
    expect(document.querySelector(".rail-drag-ghost")).toBeNull();
    expect(document.querySelector(".rail-drag-line")).toBeNull();
    controller.dispose();
  });

  it("writes nothing when a cluster is dropped where it started", () => {
    const controller = install();

    headOf(1).dispatchEvent(pointer("pointerdown", 20, 90));
    // Moved far enough to start the drag, but still inside its own slot.
    window.dispatchEvent(pointer("pointermove", 20, 80));
    flush();
    window.dispatchEvent(pointer("pointerup", 20, 80));

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("abandons the drop on Escape, and still eats the release's click", () => {
    const controller = install();
    const clicked = vi.fn();
    headOf(0).addEventListener("click", clicked);

    headOf(0).dispatchEvent(pointer("pointerdown", 20, 20));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    flush();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // The drag's chrome goes at once; the pointer is still down.
    expect(document.querySelector(".rail-drag-ghost")).toBeNull();

    window.dispatchEvent(pointer("pointerup", 20, 150));
    headOf(0).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onDrop).not.toHaveBeenCalled();
    // Otherwise abandoning a reorder would collapse the project instead.
    expect(clicked).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("resolves the dragged project by identity, not by the index it was pressed at", () => {
    const controller = install();

    headOf(2).dispatchEvent(pointer("pointerdown", 20, 150));
    window.dispatchEvent(pointer("pointermove", 20, 20));
    flush();
    // The rail re-renders mid-drag and the first project leaves — every index
    // below it shifts by one.
    list.querySelectorAll(".asr-cluster")[0].remove();
    for (const [index, cluster] of [...list.querySelectorAll(".asr-cluster")].entries()) {
      stubRect(cluster, index * HEIGHT, HEIGHT);
    }
    window.dispatchEvent(pointer("pointerup", 20, 20));

    // `gamma` is at index 1 now, and that is the coordinate the drop reports.
    expect(onDrop).toHaveBeenCalledWith(1, 0);
    controller.dispose();
  });

  it("writes nothing when the dragged project leaves the rail mid-drag", () => {
    const controller = install();

    headOf(1).dispatchEvent(pointer("pointerdown", 20, 90));
    window.dispatchEvent(pointer("pointermove", 20, 20));
    flush();
    list.querySelectorAll(".asr-cluster")[1].remove();
    window.dispatchEvent(pointer("pointerup", 20, 20));

    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("lands a flick that releases before its first frame", () => {
    const controller = install();
    const clicked = vi.fn();
    headOf(0).addEventListener("click", clicked);

    // Threshold crossed and released inside one frame — ordinary on any
    // high-poll-rate pointer. No batched pass ever ran, so the release itself
    // has to measure: a drag the user completed must not be discarded because
    // the clock did not tick, and its click must not reach the header either.
    headOf(0).dispatchEvent(pointer("pointerdown", 20, 20));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    window.dispatchEvent(pointer("pointerup", 20, 150));
    headOf(0).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clicked).not.toHaveBeenCalled();
    // Released past every midpoint: `alpha` goes to the end.
    expect(onDrop).toHaveBeenCalledWith(0, 2);
    controller.dispose();
  });

  it("eats the click when Escape lands before the first frame", () => {
    const controller = install();
    const clicked = vi.fn();
    headOf(0).addEventListener("click", clicked);

    headOf(0).dispatchEvent(pointer("pointerdown", 20, 20));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(pointer("pointerup", 20, 150));
    headOf(0).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clicked).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps the insertion line inside the scrollport when the list is scrolled", () => {
    const controller = install();
    // The first cluster is scrolled half out of view above the list, which is
    // ordinary once a project is dragged past the rows on screen.
    stubRect(list, 30, 200);
    const blocks = [...list.querySelectorAll<HTMLElement>(".asr-cluster")];
    stubRect(blocks[0], -20, HEIGHT);
    stubRect(blocks[1], 40, HEIGHT);
    stubRect(blocks[2], 100, HEIGHT);

    headOf(2).dispatchEvent(pointer("pointerdown", 20, 120));
    window.dispatchEvent(pointer("pointermove", 20, 0));
    flush();

    // The slot is the first cluster, whose own top is -20 — the line is
    // `position: fixed`, so unclamped it would paint over the stage strip.
    const line = document.querySelector<HTMLElement>(".rail-drag-line");
    expect(Number.parseFloat(line?.style.top ?? "")).toBeGreaterThanOrEqual(29);
    controller.dispose();
  });

  it("never starts a drag from the header's own launcher", () => {
    const controller = install();
    const add = list.querySelector<HTMLElement>(".asr-cluster__add");

    add?.dispatchEvent(pointer("pointerdown", 20, 20));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    window.dispatchEvent(pointer("pointerup", 20, 150));

    // A one-press action, and its click has to survive (spec §6).
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("never starts a drag from a tab row", () => {
    const controller = install();
    const row = list.querySelector<HTMLElement>(".asr-row");

    row?.dispatchEvent(pointer("pointerdown", 20, 30));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    window.dispatchEvent(pointer("pointerup", 20, 150));

    // Only the cluster drags — a tab row is excluded on the owner's
    // instruction, which is what keeps this off the tab strip (spec §2).
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("suppresses the click a drag over the header would otherwise fire", () => {
    const controller = install();
    const clicked = vi.fn();
    headOf(0).addEventListener("click", clicked);

    headOf(0).dispatchEvent(pointer("pointerdown", 20, 20));
    window.dispatchEvent(pointer("pointermove", 20, 150));
    flush();
    window.dispatchEvent(pointer("pointerup", 20, 150));
    headOf(0).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Otherwise the drag would collapse the project it just moved.
    expect(clicked).not.toHaveBeenCalled();
    controller.dispose();
  });
});
