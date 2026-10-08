// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addWorktree, remember } = vi.hoisted(() => ({
  addWorktree: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("../host/worktree-host", () => ({ addWorktree, available: true }));
vi.mock("../host/dialog-host", () => ({ open: vi.fn() }));
vi.mock("./rail-add-folder", () => ({ rememberOnRail: remember, addFolderToRail: vi.fn() }));

import { railCardMenuOpen } from "../chrome/events";
import { RailWorktreeForm } from "./rail-worktree-form";

const REPOS = [
  { path: "/r/main", label: "main" },
  { path: "/r/other", label: "other" },
];

let host: HTMLDivElement;
let anchor: HTMLButtonElement;
const onClose = vi.fn();

function mount(initialRepo: string | null = "/r/main"): void {
  act(() => {
    render(
      <RailWorktreeForm
        anchor={anchor}
        side="below"
        repositories={REPOS}
        initialRepo={initialRepo}
        onClose={onClose}
      />,
      host,
    );
  });
}

function type(selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  act(() => {
    if (input !== null) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function press(target: Element | null, key: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  anchor = document.createElement("button");
  document.body.append(anchor);
  addWorktree.mockReset();
  remember.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  anchor.remove();
});

describe("RailWorktreeForm (DL-27.14, amended 2026-10-08)", () => {
  it("opens with the given repository selected and the branch focused", async () => {
    mount();
    await settle();

    expect(host.querySelector<HTMLSelectElement>("#rail-wt-repo")?.value).toBe("/r/main");
    expect(document.activeElement).toBe(host.querySelector("#rail-wt-branch"));
  });

  it("prefills the location from the repository and branch", async () => {
    mount();
    await settle();
    type("#rail-wt-branch", "feat/x");

    expect(host.querySelector<HTMLInputElement>("#rail-wt-dest")?.value).toContain("feat/x");
  });

  it("creates on Enter, records the path and starts nothing", async () => {
    addWorktree.mockResolvedValue({ ok: true, path: "/r/main-worktrees/feat-x" });
    mount();
    await settle();
    type("#rail-wt-branch", "feat/x");

    press(host.querySelector("#rail-wt-branch"), "Enter");
    await settle();

    expect(addWorktree).toHaveBeenCalledExactlyOnceWith({
      repoPath: "/r/main",
      branch: "feat/x",
      destPath: expect.stringContaining("feat/x"),
    });
    expect(remember).toHaveBeenCalledExactlyOnceWith("/r/main-worktrees/feat-x");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Nothing was started");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows an error code's message and stays open", async () => {
    addWorktree.mockResolvedValue({ ok: false, error: "branch-exists" });
    mount();
    await settle();
    type("#rail-wt-branch", "feat/x");

    press(host.querySelector("#rail-wt-branch"), "Enter");
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("already exists");
    expect(remember).not.toHaveBeenCalled();
  });

  it("does not create without a branch", async () => {
    mount();
    await settle();

    press(host.querySelector("#rail-wt-branch"), "Enter");
    await settle();

    expect(addWorktree).not.toHaveBeenCalled();
  });

  it("closes on Escape without creating anything", async () => {
    mount();
    await settle();
    type("#rail-wt-branch", "feat/x");

    press(document.body, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(addWorktree).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("returns focus to the Worktree button when it unmounts (DL-13.2)", async () => {
    mount();
    await settle();
    expect(document.activeElement).toBe(host.querySelector("#rail-wt-branch"));

    act(() => render(null, host));

    expect(document.activeElement).toBe(anchor);
  });

  it("closes on Cancel", async () => {
    mount();
    await settle();

    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(addWorktree).not.toHaveBeenCalled();
  });

  it("raises the stage overlay flag while open and clears it after", async () => {
    mount();
    await settle();
    expect(railCardMenuOpen.value).toBe(true);

    act(() => render(null, host));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(railCardMenuOpen.value).toBe(false);
  });
});
