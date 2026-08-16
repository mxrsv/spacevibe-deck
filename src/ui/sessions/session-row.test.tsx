// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRow } from "./session-row";
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

describe("SessionRow", () => {
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

  const mount = (props: {
    entry: SessionEntry;
    dead: boolean;
    homeDir: string;
    onResume: (entry: SessionEntry) => void;
  }): void => {
    act(() => {
      render(<SessionRow {...props} />, host);
    });
  };

  const resumeButton = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>("button.session-row__resume");

  it("shows the title, the agent and the project", () => {
    mount({
      entry: entry(),
      dead: false,
      homeDir: "/Users/me",
      onResume: () => {},
    });
    expect(host.querySelector(".session-row__title")?.textContent).toBe(
      "make the thing work",
    );
    expect(host.querySelector(".session-row__agent")?.textContent).toBe(
      "Claude Code",
    );
    expect(host.querySelector(".session-row__path")?.textContent).toBe(
      "~/work/repo",
    );
  });

  it("falls back to the session id when no title was found", () => {
    mount({
      entry: entry({ title: null }),
      dead: false,
      homeDir: "/Users/me",
      onResume: () => {},
    });
    expect(host.querySelector(".session-row__title")?.textContent).toBe("sid");
  });

  // DL-25.2: the mark is the agent's own brand logo, drawn by the same
  // `AgentGlyph` the rail rows and the strip chips use.
  it("leads with the agent's brand mark", () => {
    mount({
      entry: entry(),
      dead: false,
      homeDir: "/Users/me",
      onResume: () => {},
    });
    expect(host.querySelector("img.session-row__logo")).not.toBeNull();
  });

  // DL-25.1 as amended 2026-08-16.
  it("resumes from the button, and not from the row body", () => {
    const onResume = vi.fn();
    mount({ entry: entry(), dead: false, homeDir: "/Users/me", onResume });

    act(() => {
      host
        .querySelector(".session-row__body")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResume).not.toHaveBeenCalled();

    act(() => {
      resumeButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("names the session in the action's accessible name", () => {
    mount({
      entry: entry(),
      dead: false,
      homeDir: "/Users/me",
      onResume: () => {},
    });
    expect(resumeButton()?.getAttribute("aria-label")).toBe(
      "Resume make the thing work",
    );
    // WCAG 2.5.3: the accessible name still contains the visible label.
    expect(resumeButton()?.textContent).toContain("Resume");
  });

  // DL-23.6: unavailable keeps its place in the tab order and says why.
  it("keeps a focusable action but does not resume when the directory is gone", () => {
    const onResume = vi.fn();
    mount({ entry: entry(), dead: true, homeDir: "/Users/me", onResume });
    const button = resumeButton();
    expect(button?.hasAttribute("disabled")).toBe(false);
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResume).not.toHaveBeenCalled();
    expect(button?.getAttribute("aria-describedby")).toBeTruthy();
    expect(host.querySelector(".session-row__gone")?.textContent).toBe(
      "folder is gone",
    );
  });
});
