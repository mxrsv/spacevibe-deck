// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentSessionEntry } from "../../sessions/sessions-store";

vi.mock("../../sessions/sessions-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sessions/sessions-store")>();
  return { ...actual, refreshRecentSessions: vi.fn() };
});

const { RecentSessionActivity } = await import("./recent-session-activity");
const {
  recentDeadProjects,
  recentSessionEntries,
  recentSessionsLoading,
  recentSessionsLoadState,
  refreshRecentSessions,
  sessionsSupported,
} = await import("../../sessions/sessions-store");

function entry(over: Partial<RecentSessionEntry> = {}): RecentSessionEntry {
  return {
    agent: "claude",
    sessionId: "session-id",
    cwd: "/Users/me/work/repo",
    lastActivityMs: Date.now() - 60_000,
    title: "Build recent activity",
    sourcePath: "/sessions/session-id.jsonl",
    summary: "The latest assistant response.",
    ...over,
  };
}

describe("RecentSessionActivity", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    recentSessionEntries.value = [entry()];
    recentDeadProjects.value = new Set();
    recentSessionsLoading.value = false;
    recentSessionsLoadState.value = { status: "ready" };
    sessionsSupported.value = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (onResume = vi.fn(), onViewAll = vi.fn()) => {
    act(() => {
      render(<RecentSessionActivity onResume={onResume} onViewAll={onViewAll} />, host);
    });
    return { onResume, onViewAll };
  };

  it("renders the store's newest-first five rows with their supplied summaries", () => {
    recentSessionEntries.value = [
      entry({ sessionId: "newest", summary: "Newest summary" }),
      entry({ sessionId: "second", agent: "codex", summary: "Second summary" }),
      entry({ sessionId: "third", summary: "Third summary" }),
      entry({ sessionId: "fourth", summary: "Fourth summary" }),
      entry({ sessionId: "fifth", summary: "Fifth summary" }),
    ];

    mount();

    expect(host.querySelector("h2")?.textContent).toBe("Recent activity");
    expect(
      [...host.querySelectorAll(".recent-session-activity__summary")].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "Newest summary",
      "Second summary",
      "Third summary",
      "Fourth summary",
      "Fifth summary",
    ]);
    expect(host.querySelectorAll(".recent-session-activity__row")).toHaveLength(5);
  });

  it("keeps the store's nonblank title or id fallback visible as the summary", () => {
    recentSessionEntries.value = [
      entry({ title: null, sessionId: "fallback-id", summary: "fallback-id" }),
    ];

    mount();

    expect(host.querySelector(".recent-session-activity__summary")?.textContent).toBe(
      "fallback-id",
    );
  });

  it("resumes the exact available session from the whole row", () => {
    const recent = entry({ sessionId: "resume-this" });
    recentSessionEntries.value = [recent];
    const { onResume } = mount();
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row");

    expect(row?.getAttribute("aria-label")).toBe("Resume Build recent activity");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResume).toHaveBeenCalledWith(recent);
  });

  it("keeps View all separate from row resume", () => {
    const { onResume, onViewAll } = mount();
    const viewAll = host.querySelector<HTMLButtonElement>(".recent-session-activity__view-all");

    act(() => {
      viewAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("keeps a dead-directory row focusable, explains it, and never resumes it", () => {
    const recent = entry({ cwd: "/gone" });
    recentSessionEntries.value = [recent];
    recentDeadProjects.value = new Set([recent.cwd]);
    const { onResume } = mount();
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row");

    expect(row?.hasAttribute("disabled")).toBe(false);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.getAttribute("aria-describedby")).toBeTruthy();
    expect(host.querySelector(".recent-session-activity__unavailable")?.textContent).toBe(
      "folder is gone",
    );
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResume).not.toHaveBeenCalled();
  });

  it("shows a quiet reading state only while a cold scan has no rows", () => {
    recentSessionEntries.value = [];
    recentSessionsLoading.value = true;
    recentSessionsLoadState.value = { status: "loading" };

    mount();

    expect(host.textContent).toContain("Reading recent activity…");
    expect(host.querySelector(".recent-session-activity")?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).not.toContain("No recent sessions.");
  });

  it("only claims activity is empty after a successful scan", () => {
    recentSessionEntries.value = [];

    mount();

    expect(host.textContent).toContain("No recent sessions.");
  });

  it("shows a recoverable error without replacing last-good rows", () => {
    recentSessionsLoadState.value = { status: "error", message: "Couldn't read recent activity." };
    const { onResume } = mount();
    const retry = host.querySelector<HTMLButtonElement>(".load-error__retry");

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't read recent activity.",
    );
    expect(host.querySelectorAll(".recent-session-activity__row")).toHaveLength(1);
    expect(host.textContent).not.toContain("No recent sessions.");
    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("omits the whole block on an unsupported host", () => {
    sessionsSupported.value = false;

    mount();

    expect(host.textContent).toBe("");
    expect(host.querySelector(".recent-session-activity")).toBeNull();
  });
});
