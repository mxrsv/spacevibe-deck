// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store is replaced wholesale: real signals so the sections still render
// off them, and spies for the two lifecycle calls this screen owns. Mocking
// the module also keeps `usage-client` (and therefore `invoke`) out of the
// tree entirely, so no Tauri stub is needed here.
vi.mock("../../usage/usage-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    usageSnapshot: signal(null),
    usageStale: signal(false),
    usageLoading: signal(false),
    startUsagePolling: vi.fn(),
    stopUsagePolling: vi.fn(),
  };
});

import { UsageScreen } from "./usage-screen";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS } from "./usage-views";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";

const mockedStart = vi.mocked(startUsagePolling);
const mockedStop = vi.mocked(stopUsagePolling);

describe("UsageScreen", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeUsageView.value = "overview";
    usageSnapshot.value = null;
    usageStale.value = false;
    usageLoading.value = false;
    mockedStart.mockReset();
    mockedStop.mockReset();
  });

  // Unmount so the window keydown listener goes with it — a leaked listener
  // from a prior instance would fire on the next dispatch.
  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (open: boolean, onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<UsageScreen open={open} onClose={onClose} />, host);
    });
    return onClose;
  };

  const rerender = (open: boolean, onClose: () => void): void => {
    act(() => {
      render(<UsageScreen open={open} onClose={onClose} />, host);
    });
  };

  it("moves focus onto the close pill when it opens", () => {
    mount(true);
    expect(document.activeElement).toBe(
      host.querySelector(".usage-screen__esc"),
    );
  });

  it("Escape closes the screen when focus is not in a terminal", () => {
    const onClose = mount(true);
    act(() => {
      (document.activeElement ?? window).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close the screen when a terminal owns focus (vim/fzf)", () => {
    const onClose = mount(true);

    const term = document.createElement("div");
    term.className = "xterm";
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once closed", () => {
    const onClose = mount(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("polls only while open — the screen never unmounts, so this is prop-keyed", () => {
    const onClose = vi.fn();
    mount(false, onClose);
    expect(mockedStart).not.toHaveBeenCalled();

    rerender(true, onClose);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(mockedStop).not.toHaveBeenCalled();

    rerender(false, onClose);
    expect(mockedStop).toHaveBeenCalledTimes(1);

    // Reopening starts a fresh poll rather than relying on the first one.
    rerender(true, onClose);
    expect(mockedStart).toHaveBeenCalledTimes(2);
  });

  it("stops polling when the tree unmounts", () => {
    mount(true);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    act(() => {
      render(null, host);
    });
    expect(mockedStop).toHaveBeenCalledTimes(1);
  });

  it("mirrors the open state into the class and aria-hidden", () => {
    const onClose = vi.fn();
    mount(false, onClose);
    const screen = host.querySelector(".usage-screen") as HTMLElement;
    expect(screen.classList.contains("is-open")).toBe(false);
    expect(screen.getAttribute("aria-hidden")).toBe("true");

    rerender(true, onClose);
    expect(screen.classList.contains("is-open")).toBe(true);
    expect(screen.getAttribute("aria-hidden")).toBe("false");
  });

  it("wires the tab/panel ARIA pair so the panel is announced with its tab", () => {
    mount(true);
    const panel = host.querySelector('[role="tabpanel"]');
    const selectedTab = host.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect(panel).not.toBeNull();
    expect(selectedTab).not.toBeNull();
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      expect(tab.getAttribute("aria-controls")).toBe(panel?.id);
    }
    expect(panel?.getAttribute("aria-labelledby")).toBe(selectedTab?.id);
  });

  it("swaps the section when the rail changes, reaching all three views", () => {
    // Seeded so every view renders its real content: the overview is a
    // display figure (DL §16) rather than a table, and with no data it would
    // render its empty state and identify nothing.
    usageSnapshot.value = {
      scannedAtMs: 1_754_800_000_000,
      buckets: [
        {
          bucketStartMs: 1_754_800_000_000,
          agent: "claude",
          model: "claude-opus-4-5-20251101",
          counters: {
            inputUncached: 1_000_000,
            cacheRead: 0,
            cacheCreate5m: 0,
            cacheCreate1h: 0,
            cacheWrite: 0,
            output: 0,
          },
        },
      ],
      sources: [
        { agent: "claude", state: "ok", filesScanned: 1 },
        { agent: "codex", state: "ok", filesScanned: 0 },
      ],
      skippedLines: 0,
    };
    mount(true);
    const titles: string[] = [];
    // Scoped to the rail: the overview's range selector (DL-16.7) is also a
    // tablist, and an unscoped query would click its options too.
    for (const tab of host.querySelectorAll<HTMLButtonElement>(
      '.usage-nav [role="tab"]',
    )) {
      act(() => {
        tab.click();
      });
      // Whatever names the view: the hero's eyebrow, or a table's title.
      titles.push(
        host.querySelector(".usage-hero__eyebrow, .metric-table__title")
          ?.textContent ?? "",
      );
    }
    expect(titles).toEqual([
      "RAW TOKEN COST",
      "last 30 local days",
      // Not the plan's "agent × model": `×` is a retired glyph and
      // `scripts/icon-system.test.ts` fails any source file carrying one.
      "per agent and model",
    ]);
    expect(titles).toHaveLength(USAGE_VIEWS.length);
  });

  it("states the scope on screen and never overclaims it", () => {
    mount(true);
    expect(host.querySelector(".usage-screen__scope")?.textContent).toBe(
      "this machine, this user",
    );
    expect(host.textContent).not.toContain("machine-wide");
    expect(host.textContent).not.toContain("all-time");
  });

  it("surfaces the status strip from the store's signals", () => {
    mount(true);
    // Nothing to say yet: no snapshot, not loading, not stale.
    expect(host.querySelectorAll(".usage-status__note")).toHaveLength(0);

    act(() => {
      usageLoading.value = true;
    });
    expect(host.querySelector(".usage-status__note")?.textContent).toBe(
      "reading this machine's recorded history…",
    );

    act(() => {
      usageStale.value = true;
      usageLoading.value = false;
    });
    expect(host.querySelector(".usage-status__note")?.textContent).toBe(
      "stale — showing the last good read",
    );
  });
});
