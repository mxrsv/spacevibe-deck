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

  it("keeps every relative-time bucket inside the fixed compact track", () => {
    const now = Date.UTC(2026, 7, 25, 12);
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    recentSessionEntries.value = [
      entry({ sessionId: "minutes", lastActivityMs: now - 59 * minute - 59_000 }),
      entry({ sessionId: "hours", lastActivityMs: now - 23 * 60 * minute - 59_000 }),
      entry({ sessionId: "days", lastActivityMs: now - 29 * day - 23 * 60 * minute }),
      entry({ sessionId: "months", lastActivityMs: now - 359 * day }),
      entry({ sessionId: "years", lastActivityMs: now - 360 * day }),
    ];

    mount();

    expect(
      [...host.querySelectorAll(".recent-session-activity__time")].map((node) => node.textContent),
    ).toEqual(["59m", "23h", "29d", "11mo", "1y"]);
    nowSpy.mockRestore();
  });

  it("bounds ancient years, renders future activity as now, and omits malformed dates", () => {
    const now = Date.UTC(2026, 7, 25, 12);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    recentSessionEntries.value = [
      entry({ sessionId: "future", lastActivityMs: now + 60_000 }),
      entry({ sessionId: "ancient", lastActivityMs: -8_640_000_000_000_000 }),
      entry({ sessionId: "nan", lastActivityMs: Number.NaN }),
      entry({ sessionId: "infinite", lastActivityMs: Number.POSITIVE_INFINITY }),
      entry({ sessionId: "out-of-range", lastActivityMs: Number.MAX_VALUE }),
    ];

    mount();

    const times = [...host.querySelectorAll(".recent-session-activity__time")];
    expect(times.map((node) => node.textContent)).toEqual(["now", "99y+", "—", "—", "—"]);
    expect(times[0]?.getAttribute("datetime")).toBe(new Date(now + 60_000).toISOString());
    expect(times[1]?.getAttribute("datetime")).toBe(new Date(-8_640_000_000_000_000).toISOString());
    for (const malformed of times.slice(2)) {
      expect(malformed.hasAttribute("datetime")).toBe(false);
    }
    nowSpy.mockRestore();
  });

  it("uses a compact visible agent label without changing the full session identity", () => {
    mount();

    expect(host.querySelector(".recent-session-activity__agent")?.textContent).toBe("Claude");
    expect(host.querySelector(".recent-session-activity__resume-prefix")?.textContent).toBe(
      "Resume Build recent activity: ",
    );
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

    expect(row?.hasAttribute("aria-label")).toBe(false);
    expect(row?.textContent).toMatch(/^Resume Build recent activity:/);
    expect(row?.textContent).toContain("Claude");
    expect(row?.textContent).toContain("The latest assistant response.");
    expect(row?.textContent).toContain("1m");
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

  it("keeps a dead-directory row's identity and summary, describes it once, and never resumes", () => {
    const recent = entry({ cwd: "/gone", summary: "Verified assistant summary." });
    recentSessionEntries.value = [recent];
    recentDeadProjects.value = new Set([recent.cwd]);
    const { onResume } = mount();
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row");

    expect(row?.hasAttribute("disabled")).toBe(false);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.getAttribute("aria-describedby")).toBeTruthy();
    expect(row?.hasAttribute("aria-label")).toBe(false);
    expect(row?.querySelector(".recent-session-activity__agent")?.textContent).toBe("Claude");
    expect(row?.querySelector(".recent-session-activity__summary")?.textContent).toBe(
      "Verified assistant summary.",
    );
    const state = row?.querySelector(".recent-session-activity__gone");
    expect(state?.textContent).toBe("gone");
    expect(state?.getAttribute("aria-hidden")).toBe("true");
    const reason = host.querySelector(".recent-session-activity__unavailable-reason");
    expect(reason?.textContent).toBe("folder is gone");
    expect(reason?.id).toBe(row?.getAttribute("aria-describedby"));
    expect(row?.contains(reason ?? null)).toBe(false);
    expect(row?.textContent).not.toContain("folder is gone");
    expect(row?.textContent).toContain("Resume Build recent activity:");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResume).not.toHaveBeenCalled();
  });

  it("keeps the title fallback visible when a dead session has no tail", () => {
    const recent = entry({ cwd: "/gone", summary: "", title: "Fallback session title" });
    recentSessionEntries.value = [recent];
    recentDeadProjects.value = new Set([recent.cwd]);

    mount();

    expect(host.querySelector(".recent-session-activity__summary")?.textContent).toBe(
      "Fallback session title",
    );
    expect(host.querySelector(".recent-session-activity__gone")?.textContent).toBe("gone");
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

  it("treats initial idle with no rows as a cold reading state", () => {
    recentSessionEntries.value = [];
    recentSessionsLoadState.value = { status: "idle" };

    mount();

    expect(host.textContent).toContain("Reading recent activity…");
    expect(host.querySelector(".recent-session-activity")?.getAttribute("aria-busy")).toBe("true");
  });

  it("rerenders when the recent-session signals receive their first ready rows", () => {
    recentSessionEntries.value = [];
    recentSessionsLoadState.value = { status: "idle" };
    mount();

    act(() => {
      recentSessionEntries.value = [entry({ summary: "Loaded after mount" })];
      recentSessionsLoading.value = false;
      recentSessionsLoadState.value = { status: "ready" };
    });

    expect(host.querySelector(".recent-session-activity__summary")?.textContent).toBe(
      "Loaded after mount",
    );
    expect(host.textContent).not.toContain("Reading recent activity…");
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

  it("generates distinct heading and unavailable-reason ids per mounted block", () => {
    const recent = entry({ cwd: "/gone" });
    recentSessionEntries.value = [recent];
    recentDeadProjects.value = new Set([recent.cwd]);

    act(() => {
      render(
        <>
          <RecentSessionActivity onResume={() => {}} onViewAll={() => {}} />
          <RecentSessionActivity onResume={() => {}} onViewAll={() => {}} />
        </>,
        host,
      );
    });

    const sections = [...host.querySelectorAll<HTMLElement>(".recent-session-activity")];
    const headings = [...host.querySelectorAll<HTMLElement>(".recent-session-activity__heading")];
    const reasons = [
      ...host.querySelectorAll<HTMLElement>(".recent-session-activity__unavailable-reason"),
    ];

    expect(headings.map((heading) => heading.id)).toHaveLength(2);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(2);
    expect(sections.map((section) => section.getAttribute("aria-labelledby"))).toEqual(
      headings.map((heading) => heading.id),
    );
    expect(new Set(reasons.map((reason) => reason.id)).size).toBe(2);
  });
});
