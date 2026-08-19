// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenBoardWorktreeForm, worktreeErrorCopy } from "./open-board-worktree-form";
import type { RecentWorkspace } from "../lib/workspace-recents";
import type { WorktreeAddErrorCode } from "../host/worktree-host";

const RECENTS: RecentWorkspace[] = [
  { path: "/Users/dev/deck", lastOpenedAt: 1 },
  { path: "/Users/dev/hub", lastOpenedAt: 2 },
];

describe("worktreeErrorCopy", () => {
  it("gives every error code its own friendly sentence", () => {
    const codes: WorktreeAddErrorCode[] = [
      "not-a-repository",
      "branch-exists",
      "destination-exists",
      "git-not-found",
      "unknown",
    ];
    const seen = new Set<string>();
    for (const code of codes) {
      const text = worktreeErrorCopy(code);
      expect(text.length).toBeGreaterThan(0);
      expect(seen.has(text)).toBe(false); // each code reads as its own case
      seen.add(text);
    }
  });
});

describe("OpenBoardWorktreeForm", () => {
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

  function mount(overrides: Partial<Parameters<typeof OpenBoardWorktreeForm>[0]> = {}) {
    const handlers = {
      onRepoChange: vi.fn(),
      onBrowseRepo: vi.fn(),
      onBranchChange: vi.fn(),
      onDestChange: vi.fn(),
      onBack: vi.fn(),
      onSubmit: vi.fn(),
    };
    act(() => {
      render(
        <OpenBoardWorktreeForm
          recents={RECENTS}
          homeDir="/Users/dev"
          repoPath=""
          branch=""
          destPath=""
          error={null}
          creating={false}
          {...handlers}
          {...overrides}
        />,
        host,
      );
    });
    return handlers;
  }

  it("lists recents in the repository dropdown", () => {
    mount();
    const options = [...host.querySelectorAll("#wtf-repo option")].map(
      (option) => option.textContent,
    );
    expect(options.some((text) => text?.startsWith("deck"))).toBe(true);
    expect(options.some((text) => text?.startsWith("hub"))).toBe(true);
  });

  it("calls onBrowseRepo from the Browse button", () => {
    const handlers = mount();
    const browse = host.querySelector<HTMLButtonElement>(".wtf__browse");
    act(() => {
      browse?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(handlers.onBrowseRepo).toHaveBeenCalled();
  });

  it("shows the friendly copy for the given error code, never raw git text", () => {
    mount({ error: "not-a-repository" });
    const notice = host.querySelector(".wtf__error");
    expect(notice?.textContent).toBe(worktreeErrorCopy("not-a-repository"));
    expect(notice?.textContent).not.toContain("fatal:");
  });

  it("renders no error element when there is no error", () => {
    mount();
    expect(host.querySelector(".wtf__error")).toBeNull();
  });

  it("disables Create worktree until repo, branch and destination are all filled", () => {
    mount({ repoPath: "", branch: "", destPath: "" });
    const submit = host.querySelector<HTMLButtonElement>(".btn--primary");
    expect(submit?.disabled).toBe(true);
  });

  it("enables Create worktree once every field is filled", () => {
    mount({ repoPath: "/Users/dev/deck", branch: "feature/x", destPath: "/x" });
    const submit = host.querySelector<HTMLButtonElement>(".btn--primary");
    expect(submit?.disabled).toBe(false);
  });

  it("Enter in the branch field submits when the form is complete", () => {
    const handlers = mount({
      repoPath: "/Users/dev/deck",
      branch: "feature/x",
      destPath: "/x",
    });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    act(() => {
      branchInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(handlers.onSubmit).toHaveBeenCalled();
  });

  it("Enter does not submit an incomplete form", () => {
    const handlers = mount({ repoPath: "", branch: "", destPath: "" });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    act(() => {
      branchInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("Escape in the destination field calls onBack", () => {
    const handlers = mount();
    const destInput = host.querySelector<HTMLInputElement>("#wtf-dest");
    act(() => {
      destInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it("shows Creating… and disables submit while creating", () => {
    mount({
      repoPath: "/Users/dev/deck",
      branch: "feature/x",
      destPath: "/x",
      creating: true,
    });
    const submit = host.querySelector<HTMLButtonElement>(".btn--primary");
    expect(submit?.textContent).toBe("Creating…");
    expect(submit?.disabled).toBe(true);
  });
});
