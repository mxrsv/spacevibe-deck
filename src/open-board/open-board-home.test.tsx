// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenBoardHome } from "./open-board-home";
import type { OpenBoardHomeProps } from "./open-board-home";
import type { SessionEntry } from "../lib/session-history";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/Users/dev/deck",
    lastActivityMs: 1,
    title: "ship the feature",
    sourcePath: "/p",
    ...over,
  };
}

describe("OpenBoardHome — recent sessions", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  function mount(overrides: Partial<OpenBoardHomeProps> = {}) {
    const handlers = {
      describeCombo: () => "",
      onPickFolder: vi.fn(),
      onCreateWorktree: vi.fn(),
      onOpen: vi.fn(),
      onRemove: vi.fn(),
      onResumeSession: vi.fn(),
    };
    act(() => {
      render(
        <OpenBoardHome
          homeDir="/Users/dev"
          openFolderShortcut="⌘O"
          canCreateWorktree={false}
          alive={[]}
          missingGroup={[]}
          notice={null}
          recentSessions={[]}
          {...handlers}
          {...overrides}
        />,
        host,
      );
    });
    return handlers;
  }

  it("renders no recent-sessions block when there are none", () => {
    mount({ recentSessions: [] });
    expect(host.textContent).not.toContain("Recent sessions");
  });

  it("lists at most five recent sessions for the selected workspace", () => {
    const sessions = Array.from({ length: 6 }, (_, index) =>
      entry({ sessionId: `s${index}`, lastActivityMs: index }),
    );
    mount({ recentSessions: sessions });
    const resumeRows = [...host.querySelectorAll('[role="button"]')].filter(
      (el) => /resume/i.test(el.getAttribute("aria-label") ?? ""),
    );
    expect(resumeRows).toHaveLength(5);
  });

  it("resumes the clicked session in place", () => {
    const one = entry({ sessionId: "abc", title: "fix the flaky test" });
    const handlers = mount({ recentSessions: [one] });
    const row = host.querySelector<HTMLElement>('[role="button"]');
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(handlers.onResumeSession).toHaveBeenCalledWith(one);
  });

  it("resumes on Enter, keeping the row keyboard-operable (DL-25.1)", () => {
    const one = entry({ sessionId: "abc" });
    const handlers = mount({ recentSessions: [one] });
    const row = host.querySelector<HTMLElement>('[role="button"]');
    act(() => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(handlers.onResumeSession).toHaveBeenCalledWith(one);
  });

  it("falls back to the session id when no title was found", () => {
    mount({
      recentSessions: [entry({ title: null, sessionId: "no-title-id" })],
    });
    expect(host.textContent).toContain("no-title-id");
  });

  it("names the agent that ran the session (DL-25.2 identity mark)", () => {
    mount({
      recentSessions: [entry({ agent: "codex", title: "port the scanner" })],
    });
    expect(host.textContent).toContain("Codex");
  });
});
