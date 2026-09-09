// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentSessionEntry } from "../../sessions/sessions-store";
import type { PaneView, TabView } from "../../terminal/tabs-store";

vi.mock("../../sessions/sessions-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sessions/sessions-store")>();
  return { ...actual, refreshRecentSessions: vi.fn() };
});

const { RecentSessionActivity } = await import("./recent-session-activity");
const { paneSessionIds } = await import("../../terminal/session-tail-store");
const { tabViews } = await import("../../terminal/tabs-store");
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

/** One agent pane, in the state the rail would read off it (DL-27.3). */
function pane(
  paneId: number,
  attention: PaneView["attention"],
  phase: PaneView["phase"],
  hasRun = true,
): PaneView {
  return { paneId, agent: "claude", attention, phase, hasRun, changedAt: 1 };
}

function tabWith(panes: readonly PaneView[]): TabView {
  return {
    key: 1,
    process: "claude",
    name: null,
    dotColor: null,
    workspacePath: "/Users/me/work/repo",
    agents: ["claude"],
    agentBusy: true,
    unread: false,
    panes,
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
    paneSessionIds.value = new Map();
    tabViews.value = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (onResume = vi.fn(), onViewAll = vi.fn(), onFocusPane = vi.fn()) => {
    act(() => {
      render(
        <RecentSessionActivity
          onResume={onResume}
          onViewAll={onViewAll}
          onFocusPane={onFocusPane}
        />,
        host,
      );
    });
    return { onResume, onViewAll, onFocusPane };
  };

  const mountUnread = (onFocusPane = vi.fn()) => {
    act(() => {
      render(
        <RecentSessionActivity
          filter="unread"
          onResume={vi.fn()}
          onFocusPane={onFocusPane}
          onViewAll={vi.fn()}
        />,
        host,
      );
    });
  };

  it.each(["all", "unread"] as const)(
    "does not borrow another conversation's attention or focus in %s",
    async (filter) => {
      const selected = entry({ agent: "codex", sessionId: "other-B" });
      recentSessionEntries.value = [selected];
      // The pane runs A, but transcript ranking guessed B in the same cwd.
      // Codex has no contract ID here; a pairing cannot prove its identity.
      tabViews.value = [tabWith([{ ...pane(1, "requested", "idle"), agent: "codex" }])];
      paneSessionIds.value = new Map([[1, selected.sessionId]]);
      const onResume = vi.fn();
      const onFocusPane = vi.fn();
      act(() =>
        render(
          <RecentSessionActivity
            filter={filter}
            onResume={onResume}
            onFocusPane={onFocusPane}
            onViewAll={vi.fn()}
          />,
          host,
        ),
      );
      const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row");
      if (filter === "unread") {
        expect(row).toBeNull();
      } else {
        await act(async () => row!.click());
        expect(onFocusPane).not.toHaveBeenCalled();
        expect(onResume).toHaveBeenCalledWith(selected);
        expect(row!.querySelector(".asr-row__mark")).toBeNull();
      }
      expect(tabViews.value[0]?.panes?.[0]?.attention).toBe("requested");
    },
  );

  it.each(["same pane", "another pane"])(
    "keeps the launch receipt when transcript ranking misidentifies %s",
    async (conflict) => {
      const selected = entry({ agent: "codex" });
      recentSessionEntries.value = [selected];
      const launched = { ...pane(9, "none", "idle", false), agent: "codex" };
      const onResume = vi.fn(async () => {
        tabViews.value = [tabWith([launched])];
        return { paneId: 9, canFocus: () => true };
      });
      const { onFocusPane } = mount(onResume);
      const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
      await act(async () => row.click());
      act(() => {
        tabViews.value = [tabWith([launched, { ...pane(1, "requested", "idle"), agent: "codex" }])];
        paneSessionIds.value = new Map([
          [9, "other-session"],
          [1, conflict === "another pane" ? selected.sessionId : "unrelated"],
        ]);
      });
      await act(async () => row.click());
      expect(onResume).toHaveBeenCalledOnce();
      expect(onFocusPane).toHaveBeenCalledWith(0, 9);
    },
  );

  it("filters Recent to the unread signal without reordering its entries", () => {
    recentSessionEntries.value = [
      entry({ sessionId: "working" }),
      entry({ sessionId: "question", summary: "Question summary" }),
      entry({ sessionId: "read" }),
      entry({ sessionId: "completed", summary: "Completed summary" }),
      entry({ sessionId: "unpaired" }),
    ];
    tabViews.value = [
      tabWith([
        { ...pane(1, "none", "working"), sessionId: "working" },
        { ...pane(2, "requested", "idle"), sessionId: "question" },
        { ...pane(3, "none", "idle"), sessionId: "read" },
        { ...pane(4, "completed", "idle"), sessionId: "completed" },
      ]),
    ];
    mountUnread();
    expect(host.querySelector("h2")?.textContent).toBe("Unread");
    expect(
      [...host.querySelectorAll(".recent-session-activity__summary")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Question summary", "Completed summary"]);
    expect(
      [...host.querySelectorAll(".asr-row__mark")].every(
        (mark) => mark.getAttribute("data-state") === "asked",
      ),
    ).toBe(true);
    expect(host.querySelector('[aria-label="Unread recent sessions"]')).not.toBeNull();
  });

  it("removes a session from the unread filter as soon as focus acknowledges it", () => {
    tabViews.value = [tabWith([{ ...pane(1, "completed", "idle"), sessionId: "session-id" }])];
    const focus = vi.fn(() => {
      tabViews.value = [tabWith([{ ...pane(1, "none", "idle"), sessionId: "session-id" }])];
    });
    mountUnread(focus);
    act(() => host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!.click());
    expect(focus).toHaveBeenCalledWith(0, 1);
    expect(host.querySelector(".recent-session-activity__row")).toBeNull();
    expect(host.textContent).toContain("No unread recent sessions.");
  });

  it("shows an empty unread result during a warm refresh instead of a cold loading message", () => {
    recentSessionsLoadState.value = { status: "loading" };
    mountUnread();
    expect(host.textContent).toContain("No unread recent sessions.");
    expect(host.textContent).not.toContain("Reading recent activity…");
  });

  it("includes warnings but excludes failed, ended and unpaired sessions from unread", () => {
    recentSessionEntries.value = [
      entry({ sessionId: "warning" }),
      entry({ sessionId: "failure" }),
      entry({ sessionId: "ended" }),
      entry({ sessionId: "unpaired" }),
    ];
    tabViews.value = [
      tabWith([
        { ...pane(1, "warning", "idle"), sessionId: "warning" },
        { ...pane(2, "error", "idle"), sessionId: "failure" },
        { ...pane(3, "none", "exited"), sessionId: "ended" },
      ]),
    ];
    mountUnread();
    expect(host.querySelectorAll(".recent-session-activity__row")).toHaveLength(1);
    expect(host.querySelector(".asr-row__mark")?.getAttribute("data-state")).toBe("asked");
  });

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

  it("draws no agent label and keeps the agent in the accessible name", () => {
    mount();

    // The glyph is the identity on screen (2026-08-26); the word survives only
    // where a screen reader can still reach it.
    expect(host.querySelector(".recent-session-activity__agent")).toBeNull();
    expect(host.querySelector(".recent-session-activity__glyph")).not.toBeNull();
    expect(host.querySelector(".recent-session-activity__resume-prefix")?.textContent?.trim()).toBe(
      "Resume Claude — Build recent activity:",
    );
    expect(host.querySelector(".recent-session-activity__row")?.textContent).not.toContain(
      "Claude Code",
    );
  });

  it("leaves the state slot empty when no pane holds the session", () => {
    mount();

    const mark = host.querySelector(".recent-session-activity__row .asr-row__mark");
    expect(mark).toBeNull();
    expect(host.querySelector(".recent-session-activity__state-word")).toBeNull();
  });

  it("takes the state of the pane running that exact session, and says a loud one once", () => {
    recentSessionEntries.value = [
      entry({ sessionId: "running", summary: "Still going" }),
      entry({ sessionId: "answered", summary: "Needs a decision" }),
      entry({ sessionId: "crashed", summary: "Could not reach the daemon" }),
      entry({ sessionId: "unheld", summary: "Nothing is running this" }),
    ];
    tabViews.value = [
      tabWith([
        { ...pane(1, "none", "working"), sessionId: "running" },
        { ...pane(2, "requested", "idle"), sessionId: "answered" },
        { ...pane(3, "error", "idle"), sessionId: "crashed" },
        pane(4, "none", "idle", false),
      ]),
    ];

    mount();

    const marks = [...host.querySelectorAll(".recent-session-activity__row .asr-row__mark")];
    expect(marks.map((node) => node.getAttribute("data-state"))).toEqual([
      "working",
      "asked",
      "failed",
    ]);
    // `working` is the one state drawn as the ring rather than a dot.
    expect(marks[0]?.classList.contains("asr-row__mark--spinner")).toBe(true);
    expect(
      [...host.querySelectorAll(".recent-session-activity__state-word")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["running. ", "needs you. ", "failed. "]);
  });

  it("never pairs a row with a session id it does not hold", () => {
    recentSessionEntries.value = [entry({ sessionId: "listed" })];
    tabViews.value = [
      tabWith([{ ...pane(1, "none", "working"), sessionId: "a-different-session" }]),
    ];

    mount();

    expect(host.querySelector(".recent-session-activity__row .asr-row__mark")).toBeNull();
  });

  it("does not invent a live state for a missing folder", () => {
    const recent = entry({ cwd: "/gone" });
    recentSessionEntries.value = [recent];
    recentDeadProjects.value = new Set([recent.cwd]);

    mount();

    expect(host.querySelector(".recent-session-activity__row .asr-row__mark")).toBeNull();
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
    expect(row?.textContent).toMatch(/^\s*Resume Claude — Build recent activity:/);
    expect(row?.textContent).toContain("The latest assistant response.");
    expect(row?.textContent).toContain("1m");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResume).toHaveBeenCalledWith(recent);
  });

  it("focuses the exact open pane instead of resuming a duplicate", () => {
    tabViews.value = [
      tabWith([
        { ...pane(1, "none", "working"), sessionId: "other" },
        { ...pane(2, "requested", "idle"), sessionId: "session-id" },
      ]),
    ];
    paneSessionIds.value = new Map([
      [1, "session-id"],
      [2, "other"],
    ]);
    const { onResume, onFocusPane } = mount();
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    expect(row.textContent).toContain("Open Claude — Build recent activity:");
    act(() => row.click());
    expect(onFocusPane).toHaveBeenCalledWith(0, 2);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("resumes after the paired agent exits instead of focusing its shell", async () => {
    tabViews.value = [tabWith([{ ...pane(1, "error", "exited"), sessionId: "session-id" }])];
    const { onResume, onFocusPane } = mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!.click(),
    );
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("rechecks the pane at click time and refuses another agent with the same id", async () => {
    tabViews.value = [
      tabWith([{ ...pane(1, "none", "working"), agent: "codex", sessionId: "session-id" }]),
    ];
    const { onResume, onFocusPane } = mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!.click(),
    );
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("locks repeated clicks while opening, then shows failure and allows retry", async () => {
    let finish!: (opened: boolean) => void;
    const onResume = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    act(() => {
      row.click();
      row.click();
    });
    expect(onResume).toHaveBeenCalledOnce();
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.querySelector(".recent-session-activity__opening")).not.toBeNull();
    expect(row.textContent).toContain("Opening…");
    expect(row.querySelector('[data-state="working"]')).toBeNull();
    await act(async () => finish(false));
    expect(row.hasAttribute("aria-busy")).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open this session",
    );
    act(() => row.click());
    expect(onResume).toHaveBeenCalledTimes(2);
    await act(async () => finish(true));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("clears a row's failure when the next press focuses an open pane", async () => {
    // The clear used to live only on the resume path, so a row that had failed
    // once and then became focusable kept printing "Couldn't open this
    // session" underneath the pane the press had just brought into view.
    const onResume = vi.fn(async () => false);
    const { onFocusPane } = mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => row.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open this session",
    );

    // A pane holding this exact session appears, so the next press takes the
    // focus branch and never reaches the resume path at all.
    tabViews.value = [tabWith([{ ...pane(2, "none", "idle"), sessionId: "session-id" }])];
    await act(async () => row.click());

    expect(onFocusPane).toHaveBeenCalledWith(0, 2);
    expect(onResume).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("reuses the created pane before pairing arrives and resumes again after it closes", async () => {
    const onResume = vi.fn(async () => {
      tabViews.value = [tabWith([{ ...pane(9, "none", "idle", false), agent: null }])];
      return { paneId: 9, canFocus: () => true };
    });
    const { onFocusPane } = mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => row.click());
    expect(paneSessionIds.value.size).toBe(0);
    act(() => row.click());
    expect(onResume).toHaveBeenCalledOnce();
    expect(onFocusPane).toHaveBeenCalledWith(0, 9);
    act(() => {
      tabViews.value = [];
    });
    await act(async () => row.click());
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it.each<Partial<PaneView>>([
    { phase: "exited" },
    { agent: "codex" },
    { sessionId: "another-session" },
  ])("does not reuse a launch receipt after its pane changes to %j", async (change) => {
    const onResume = vi.fn(async () => {
      tabViews.value = [tabWith([pane(9, "none", "idle", false)])];
      return { paneId: 9, canFocus: () => true };
    });
    const { onFocusPane } = mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => row.click());
    act(() => {
      tabViews.value = [tabWith([{ ...pane(9, "none", "idle"), ...change }])];
    });
    await act(async () => row.click());
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("allows retry when a created pane's launch is later cancelled", async () => {
    let available = true;
    const onResume = vi.fn(async () => {
      tabViews.value = [tabWith([{ ...pane(9, "none", "idle", false), agent: null }])];
      return { paneId: 9, canFocus: () => available };
    });
    const { onFocusPane } = mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => row.click());
    available = false;
    await act(async () => row.click());
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("shows rejected opens as retryable errors and releases the click lock", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onResume = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host disconnected"))
      .mockResolvedValue(true);
    mount(onResume);
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => row.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open this session",
    );
    expect(row.hasAttribute("aria-busy")).toBe(false);
    await act(async () => row.click());
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    warn.mockRestore();
  });

  it("uses the contract id ahead of an outdated tail pairing", async () => {
    tabViews.value = [tabWith([{ ...pane(1, "none", "working"), sessionId: "another-session" }])];
    paneSessionIds.value = new Map([[1, "session-id"]]);
    const { onFocusPane, onResume } = mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!.click(),
    );
    expect(onResume).toHaveBeenCalledOnce();
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("rechecks a rendered row whose pane closes before click", async () => {
    tabViews.value = [tabWith([{ ...pane(1, "none", "working"), sessionId: "session-id" }])];
    const { onFocusPane, onResume } = mount();
    const row = host.querySelector<HTMLButtonElement>(".recent-session-activity__row")!;
    await act(async () => {
      tabViews.value = [];
      row.click();
    });
    expect(onResume).toHaveBeenCalledOnce();
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("places time before the trailing status and keeps the quiet slot", () => {
    mount();
    const time = host.querySelector("time")!;
    expect(time.nextElementSibling?.classList.contains("recent-session-activity__state")).toBe(
      true,
    );
    expect(time.nextElementSibling?.textContent).toBe("");
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
    expect(row?.querySelector(".recent-session-activity__agent")).toBeNull();
    expect(row?.querySelector(".recent-session-activity__summary")?.textContent).toBe(
      "Verified assistant summary.",
    );
    const state = row?.querySelector(".recent-session-activity__gone");
    expect(state?.textContent).toBe("gone");
    expect(state?.getAttribute("aria-hidden")).toBe("true");
    const copy = row?.querySelector(".recent-session-activity__copy");
    expect(state?.parentElement).toBe(copy);
    expect(state?.previousElementSibling).toBe(
      row?.querySelector(".recent-session-activity__summary"),
    );
    expect(row?.querySelector(".recent-session-activity__time")?.textContent).toBe("1m");
    const reason = host.querySelector(".recent-session-activity__unavailable-reason");
    expect(reason?.textContent).toBe("folder is gone");
    expect(reason?.id).toBe(row?.getAttribute("aria-describedby"));
    expect(row?.contains(reason ?? null)).toBe(false);
    expect(row?.textContent).not.toContain("folder is gone");
    expect(row?.textContent).toContain("Resume Claude — Build recent activity:");
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
          <RecentSessionActivity onResume={() => {}} onViewAll={() => {}} onFocusPane={() => {}} />
          <RecentSessionActivity onResume={() => {}} onViewAll={() => {}} onFocusPane={() => {}} />
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
