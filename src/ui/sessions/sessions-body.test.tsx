// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionsBody } from "./sessions-body";
import {
  deadProjects,
  sessionAgentFilter,
  sessionEntries,
  sessionLimit,
  sessionProjectFilter,
  sessionsLoading,
  sessionsLoadState,
  sessionTotals,
} from "../../sessions/sessions-store";
import type { SessionEntry } from "../../lib/session-history";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/Users/me/work/repo",
    lastActivityMs: Date.now() - 60_000,
    title: "make the thing work",
    sourcePath: "/p",
    ...over,
  };
}

describe("SessionsBody", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    sessionEntries.value = [entry()];
    sessionTotals.value = { claude: 1, codex: 0 };
    sessionLimit.value = 500;
    sessionsLoading.value = false;
    sessionsLoadState.value = { status: "ready" };
    deadProjects.value = new Set();
    sessionAgentFilter.value = "all";
    sessionProjectFilter.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (variant?: "screen" | "dock"): void => {
    act(() => {
      render(<SessionsBody variant={variant} onResume={() => {}} />, host);
    });
  };

  it("defaults to the screen variant, unwrapped, as SessionsScreen relied on before this extraction", () => {
    mount();
    // No new wrapper element: SessionsNav and the tabpanel section render as
    // bare siblings of `host`, so a caller's own grid still owns their
    // layout directly (DL-11.1) — the exact DOM sessions-screen.tsx had
    // inline before this file existed.
    expect(host.querySelector(".sessions-body--dock")).toBeNull();
    expect(host.querySelector(".sessions-nav")).not.toBeNull();
    expect(host.querySelector("#sessions-view-panel")).not.toBeNull();
  });

  it("wraps the same content in .sessions-body--dock for the dock variant", () => {
    mount("dock");
    const wrapper = host.querySelector(".sessions-body--dock");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector(".sessions-nav")).not.toBeNull();
    expect(wrapper?.querySelector("#sessions-view-panel")).not.toBeNull();
  });

  it("loses no row content in the dock variant — same four DL-25.2 fields as the screen variant", () => {
    mount("dock");
    expect(host.querySelector(".session-row__title")?.textContent).toBe(
      "make the thing work",
    );
    expect(host.querySelector(".session-row__agent")?.textContent).toBe(
      "Claude Code",
    );
    // No `homeDir` override in this test env — `getDesktopEnvironment()`
    // (same call `SessionsList` makes) answers "", so `SessionRow` shows the
    // raw cwd rather than a tildified one (see `session-row.test.tsx` for
    // the tildify case, which passes `homeDir` directly as a prop instead).
    expect(host.querySelector(".session-row__path")?.textContent).toBe(
      "/Users/me/work/repo",
    );
    expect(host.querySelector(".session-row__time")?.textContent).toBeTruthy();
  });

  // DL-19.8: the rail becomes a chip row inside the docked column.
  it("lays the agent filter out as a compact row in the dock variant", () => {
    mount("dock");
    const nav = host.querySelector(".sessions-nav--compact");
    expect(nav).not.toBeNull();
    expect(
      nav?.querySelector('[role="tablist"]')?.getAttribute("aria-orientation"),
    ).toBe("horizontal");

    const labels = [...host.querySelectorAll(".sessions-nav__label")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["All", "Claude", "Codex"]);

    // WCAG 2.5.3: the full name stays the accessible name, and it contains
    // the short label the chip prints.
    const claude = host.querySelector('[id="sessions-tab-claude"]');
    expect(claude?.getAttribute("aria-label")).toBe("Claude Code");
  });

  it("keeps the full-width rail and its full labels in the screen variant", () => {
    mount();
    expect(host.querySelector(".sessions-nav--compact")).toBeNull();
    expect(
      host.querySelector('[role="tablist"]')?.getAttribute("aria-orientation"),
    ).toBe("vertical");
    const labels = [...host.querySelectorAll(".sessions-nav__label")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["All sessions", "Claude Code", "Codex"]);
  });

  it("shows a scan failure instead of claiming there are no sessions", () => {
    sessionEntries.value = [];
    sessionsLoadState.value = {
      status: "error",
      message: "Couldn't read recorded sessions.",
    };

    mount("dock");

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't read recorded sessions.",
    );
    expect(host.textContent).not.toContain("No sessions found");
  });

  it("only claims the history is empty after a successful scan", () => {
    sessionEntries.value = [];
    sessionsLoadState.value = { status: "loading" };
    sessionsLoading.value = true;

    mount("dock");

    expect(host.textContent).toContain(
      "Reading this machine's recorded sessions",
    );
    expect(host.textContent).not.toContain("No sessions found");
  });
});
