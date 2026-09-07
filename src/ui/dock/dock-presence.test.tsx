// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCK_SLIDE_MS, useDockPresence } from "./dock-presence";

/**
 * The hook is exercised through a component because that is the only way a
 * hook exists — this repo has no hook-testing harness and does not need one
 * for a probe that prints its own two booleans.
 */
function Probe({ visible, hold = false }: { readonly visible: boolean; readonly hold?: boolean }) {
  const presence = useDockPresence(visible, hold);
  return (
    <div
      data-mounted={presence.mounted ? "yes" : "no"}
      data-entered={presence.entered ? "yes" : "no"}
    />
  );
}

let host: HTMLDivElement;

const read = (): { mounted: string; entered: string } => {
  const probe = host.querySelector<HTMLElement>("div")!;
  return {
    mounted: probe.dataset.mounted!,
    entered: probe.dataset.entered!,
  };
};

/** Preact schedules its own work off rAF, so the stub has to actually run. */
const flushFrame = async (): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(16);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
});

describe("useDockPresence", () => {
  it("mounts a column that starts open at rest, with no entrance to play", () => {
    act(() => render(<Probe visible />, host));
    expect(read()).toEqual({ mounted: "yes", entered: "yes" });
  });

  it("mounts one frame before it enters, so the slide has a start value", async () => {
    act(() => render(<Probe visible={false} />, host));
    expect(read()).toEqual({ mounted: "no", entered: "no" });

    act(() => render(<Probe visible />, host));
    expect(read().mounted).toBe("yes");

    await flushFrame();
    expect(read()).toEqual({ mounted: "yes", entered: "yes" });
  });

  it("keeps the column mounted for the length of the slide after it closes", async () => {
    act(() => render(<Probe visible />, host));

    act(() => render(<Probe visible={false} />, host));
    // Still in the DOM, already painted at the closed transform: this is the
    // frame range the exit animation plays over.
    expect(read()).toEqual({ mounted: "yes", entered: "no" });

    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS - 1);
    });
    expect(read().mounted).toBe("yes");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(read().mounted).toBe("no");
  });

  // The load-bearing half of the drag-past-the-floor gesture: the grip lives
  // INSIDE the panel and the pointer is captured on it, so the panel may be
  // pushed off-stage but must not leave the DOM until the drag ends.
  it("never starts the unmount timer while a drag holds the mount", async () => {
    act(() => render(<Probe visible hold={false} />, host));

    act(() => render(<Probe visible={false} hold />, host));
    expect(read()).toEqual({ mounted: "yes", entered: "no" });

    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS * 4);
    });
    expect(read()).toEqual({ mounted: "yes", entered: "no" });

    // Dragging back out of the floor re-enters without ever having unmounted.
    act(() => render(<Probe visible hold />, host));
    await flushFrame();
    expect(read()).toEqual({ mounted: "yes", entered: "yes" });
  });

  it("unmounts once the drag releases on the closed side", async () => {
    act(() => render(<Probe visible hold />, host));
    act(() => render(<Probe visible={false} hold />, host));
    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS * 2);
    });
    expect(read().mounted).toBe("yes");

    // Release: the drag no longer holds it, and the setting says closed.
    act(() => render(<Probe visible={false} hold={false} />, host));
    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS);
    });
    expect(read().mounted).toBe("no");
  });

  it("cancels the unmount when the column is reopened mid-slide", async () => {
    act(() => render(<Probe visible />, host));
    act(() => render(<Probe visible={false} />, host));
    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS / 2);
    });

    act(() => render(<Probe visible />, host));
    await flushFrame();
    expect(read()).toEqual({ mounted: "yes", entered: "yes" });

    // The timer from the abandoned close must not fire behind the reopen.
    await act(async () => {
      vi.advanceTimersByTime(DOCK_SLIDE_MS * 2);
    });
    expect(read()).toEqual({ mounted: "yes", entered: "yes" });
  });
});
