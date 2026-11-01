// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The host stubs `project-rail.test.tsx` needs, a `DeckIcon` jsdom can draw, and the two seams
// the "+" menu's verbs end in: the worktree host and the folder picker.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));
vi.mock("../../host/worktree-host", () => ({ addWorktree: vi.fn(), available: true }));
vi.mock("../rail-add-folder", () => ({ addFolderToRail: vi.fn(), rememberOnRail: vi.fn() }));
vi.mock("../controls/deck-icon", () => ({
  CHROME_ICON: 13,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { railCardMenuOpen } from "../../chrome/events";
import { addWorktree } from "../../host/worktree-host";
import { agentLaunchPage } from "../../launcher/agent-launch-page-store";
import { resetDesktopEnvironmentForTests } from "../../lib/platform";
import { addFolderToRail, rememberOnRail } from "../rail-add-folder";
import type { CardActions } from "../worktree-card-menus";
import { byRole, waitUntil } from "../controls/preset-test-kit";
import {
  activate,
  click,
  closeMenu,
  headers,
  host,
  installRailHarness,
  menuItems,
  menuLabels,
  mount,
  pick,
  pinHost,
  press,
  row,
  rows,
  settle,
  text,
  unmount,
} from "./project-rail-test-kit";

installRailHarness();

beforeEach(() => {
  vi.mocked(addWorktree).mockReset();
  vi.mocked(addFolderToRail).mockReset();
  vi.mocked(rememberOnRail).mockReset();
  pinHost(true);
});

const search = () => host.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]');
const rowIds = () => rows().map((r) => r.dataset.railRow);
const trigger = (label: string) => host.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
const heads = () => [...host.querySelectorAll("h3")].map((h) => text(h));

/** Type into the search field the way the user does: set the value, then raise `input`. */
function type(value: string): void {
  act(() => {
    const field = search() as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const launcher = (onOpenAgentLauncher: (path: string) => void): CardActions => ({
  agents: [],
  agentsResolved: true,
  onRunAgent: vi.fn(),
  onSplitHere: vi.fn(),
  onOpenAgentLauncher,
});

describe("search", () => {
  it("filters rows fuzzily by title, branch and project", async () => {
    mount();
    await settle();

    type("tkrf");
    expect(rowIds()).toEqual(["pane:21"]);
    type("side");
    expect(rowIds()).toEqual(["pane:21"]);
    type("api");
    expect(rowIds()).toEqual(["pane:31", "shell:4"]);
    type("");
    expect(rowIds()).toHaveLength(5);
  });

  it("shows a matching project unfolded and brings the user's folds back when cleared", async () => {
    mount();
    await settle();
    click(headers()[0]);
    expect(rowIds()).toEqual(["pane:31", "shell:4"]);

    type("token");
    expect(rowIds()).toEqual(["pane:21"]);
    expect(headers()[0].getAttribute("aria-expanded")).toBe("true");

    type("");
    expect(headers()[0].getAttribute("aria-expanded")).toBe("false");
    expect(rowIds()).toEqual(["pane:31", "shell:4"]);
  });

  it("says so when nothing matches, and clears from there", async () => {
    mount();
    await settle();

    type("zzzz");
    expect(rowIds()).toEqual([]);
    expect(text(host.querySelector("section[aria-label='Open agents']"))).toContain(
      "No sessions match",
    );
    const clear = [...host.querySelectorAll("button")].find((b) => text(b) === "Clear search");
    click(clear);
    expect(search()?.value).toBe("");
    expect(rowIds()).toHaveLength(5);
  });

  it("takes focus on / from anywhere in the rail, and from nowhere else", async () => {
    mount();
    await settle();
    const target = row("pane:12");
    target?.focus();

    expect(press(target, "/")).toBe(true);
    expect(document.activeElement).toBe(search());
    // Typed into the field it is a character, not the shortcut.
    expect(press(search(), "/")).toBe(false);
    // A chord is the keymap's, and the page outside the rail has no listener at all.
    target?.focus();
    expect(press(target, "/", { metaKey: true })).toBe(false);
    expect(document.activeElement).toBe(target);
    press(document.body, "/");
    expect(document.activeElement).toBe(target);
  });

  it("clears on Esc, keeps the key from the terminal, and hands focus to the list", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    mount();
    await settle();
    search()?.focus();
    type("token");
    seen.mockClear();

    press(search(), "Escape");
    await act(async () => {
      await Promise.resolve();
    });
    document.removeEventListener("keydown", seen);

    expect(seen).not.toHaveBeenCalled();
    expect(search()?.value).toBe("");
    expect(rowIds()).toHaveLength(5);
    expect(document.activeElement).toBe(row("pane:12"));
  });

  it("moves into the list on ArrowDown", async () => {
    mount();
    await settle();
    search()?.focus();

    expect(press(search(), "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(row("pane:12"));
  });
});

describe("Organize", () => {
  it("offers group, sort and show archived with the current choice marked", async () => {
    mount();
    await settle();

    await activate(trigger("Organize"));
    const entries = [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(entries.map((entry) => text(entry))).toEqual([
      "By project",
      "By status",
      "By time",
      "Last updated",
      "Priority",
      "Show archived",
    ]);
    expect(entries.map((entry) => entry.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    await closeMenu();
  });

  async function organize(label: string): Promise<void> {
    await activate(trigger("Organize"));
    await activate(
      [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
        (entry) => text(entry) === label,
      ),
    );
    // A radio entry keeps its menu open, so the choice can be changed again.
    await closeMenu();
  }

  it("groups by status into flat sections whose rows name their project", async () => {
    mount();
    await settle();

    await organize("By status");

    expect(heads()).toEqual(["Needs you2", "Unread1", "Working1", "Quiet1"]);
    expect(headers()).toHaveLength(0);
    expect(rowIds()).toEqual(["pane:11", "pane:31", "pane:21", "pane:12", "shell:4"]);
    expect(text(row("pane:31"))).toContain("api");
    expect(text(row("pane:12"))).toContain("main");
  });

  it("groups by time, newest bucket first", async () => {
    mount();
    await settle();

    await organize("By time");

    expect(heads()).toEqual(["Last 5 minutes2", "Last 15 minutes1", "Earlier2"]);
    expect(rowIds()).toEqual(["pane:12", "pane:21", "pane:11", "pane:31", "shell:4"]);
  });

  it("sorts a project's rows loudest first under Priority", async () => {
    mount();
    await settle();
    const first = () =>
      [...host.querySelector("section[aria-label=main]")!.querySelectorAll("[data-rail-row]")].map(
        (r) => r.getAttribute("data-rail-row"),
      );
    expect(first()).toEqual(["pane:12", "pane:21", "pane:11"]);

    await organize("Priority");

    expect(first()).toEqual(["pane:11", "pane:12", "pane:21"]);
  });
});

describe('the "+" menu', () => {
  it("offers New agent, New worktree and Open folder", async () => {
    mount();
    await settle();

    await activate(trigger("New"));
    expect(menuLabels()).toEqual(["New agent", "New worktree", "Open folder"]);
    await closeMenu();
  });

  it("walks its entries with the arrow keys", async () => {
    mount();
    await settle();
    await activate(trigger("New"));
    const highlighted = () =>
      menuItems().findIndex((entry) => entry.hasAttribute("data-highlighted"));

    press(byRole("menu"), "ArrowDown");
    await settle();
    const first = highlighted();
    press(byRole("menu"), "ArrowDown");
    await settle();
    expect(highlighted()).toBe(first + 1);
    press(byRole("menu"), "ArrowUp");
    await settle();
    expect(highlighted()).toBe(first);
    await closeMenu();
  });

  it("opens the launch page on the focused checkout, as the shipped Agent button does", async () => {
    const shipped = vi.fn();
    resetDesktopEnvironmentForTests();
    pinHost(false);
    mount({ cardActions: launcher(shipped) });
    await settle();
    click(host.querySelector('.rail-create__button[data-verb="agent"]'));
    unmount();

    const calls = vi.fn();
    const onOpenWorkspace = vi.fn();
    resetDesktopEnvironmentForTests();
    pinHost(true);
    mount({
      cardActions: launcher(calls),
      legacy: { onOpenWorkspace, onResumeWorktree: () => {} },
    });
    await settle();
    await activate(trigger("New"));
    await pick("New agent");

    expect(shipped).toHaveBeenCalledExactlyOnceWith("/r/main");
    expect(calls.mock.calls).toEqual(shipped.mock.calls);
    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });

  it("falls back to the board where nothing wires the launch page, and honours a disabled board", async () => {
    const onOpenWorkspace = vi.fn();
    mount({ legacy: { onOpenWorkspace, onResumeWorktree: () => {} } });
    await settle();

    await activate(trigger("New"));
    await pick("New agent");
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    await waitUntil(() => byRole("menu") === null);

    unmount();
    mount({
      legacy: { onOpenWorkspace, openWorkspaceDisabled: true, onResumeWorktree: () => {} },
    });
    await settle();
    await activate(trigger("New"));
    const entry = menuItems().find((candidate) => text(candidate) === "New agent");
    expect(entry?.hasAttribute("data-disabled")).toBe(true);
    await pick("New agent");
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
  });

  it("picks a folder through the shipped path and prints what it refused", async () => {
    vi.mocked(addFolderToRail).mockResolvedValueOnce("gone is missing — pick another folder");
    mount();
    await settle();

    await activate(trigger("New"));
    await pick("Open folder");
    await act(async () => {
      await Promise.resolve();
    });

    expect(addFolderToRail).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "gone is missing — pick another folder",
    );

    vi.mocked(addFolderToRail).mockResolvedValueOnce(null);
    await waitUntil(() => byRole("menu") === null);
    await activate(trigger("New"));
    await pick("Open folder");
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  const form = () =>
    document.body.querySelector<HTMLFormElement>('form[aria-label="New worktree"]');
  const branch = () => document.body.querySelector<HTMLInputElement>('input[aria-label="Branch"]');
  const submit = () =>
    [...(form()?.querySelectorAll("button") ?? [])].find(
      (b) => b.getAttribute("type") === "submit",
    );

  async function openForm(): Promise<void> {
    await activate(trigger("New"));
    await pick("New worktree");
    await waitUntil(() => form() !== null);
  }

  function typeBranch(value: string): void {
    act(() => {
      const field = branch() as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("creates a worktree through the shipped flow and starts nothing", async () => {
    vi.mocked(addWorktree).mockResolvedValue({ ok: true, path: "/r/main-worktrees/feat-x" });
    mount();
    await settle();

    await openForm();
    // The focused checkout's repository is preselected; the branch field has the keyboard.
    await waitUntil(() => document.activeElement === branch());
    expect(submit()?.hasAttribute("disabled")).toBe(true);
    typeBranch("feat/x");
    await settle();
    expect(submit()?.hasAttribute("disabled")).toBe(false);
    await activate(submit());
    await settle();

    expect(addWorktree).toHaveBeenCalledExactlyOnceWith({
      repoPath: "/r/main",
      branch: "feat/x",
      destPath: expect.stringContaining("feat"),
    });
    expect(rememberOnRail).toHaveBeenCalledExactlyOnceWith("/r/main-worktrees/feat-x");
    expect(text(document.body.querySelector('[role="status"]'))).toBe(
      "Created feat/x. Nothing was started.",
    );
  });

  it("shows the flow's own error and creates nothing more", async () => {
    vi.mocked(addWorktree).mockResolvedValue({ ok: false, error: "branch-exists" });
    mount();
    await settle();

    await openForm();
    typeBranch("main");
    await settle();
    await activate(submit());
    await settle();

    expect(document.body.querySelector('[role="alert"]')?.textContent).not.toBe("");
    expect(rememberOnRail).not.toHaveBeenCalled();
    expect(form()).not.toBeNull();
  });
});

describe("the strip beside the rest of the shell", () => {
  it("keeps the worktree form's anchor out of the Tab order", async () => {
    mount();
    await settle();

    const anchor = host.querySelector<HTMLElement>('[data-slot="popover-trigger"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.tabIndex).toBe(-1);
    expect(anchor?.getAttribute("aria-hidden")).toBe("true");
  });

  it("holds the launch page open under an open popup, so Esc closes the popup first", async () => {
    mount();
    await settle();
    expect(railCardMenuOpen.value).toBe(false);

    // With no launch page up the popup leaves the flag, and the native browser, alone.
    await activate(trigger("Organize"));
    expect(railCardMenuOpen.value).toBe(false);
    await closeMenu();

    agentLaunchPage.request.value = {} as never;
    try {
      await activate(trigger("Organize"));
      expect(railCardMenuOpen.value).toBe(true);
      await closeMenu();
      await waitUntil(() => !railCardMenuOpen.value, 2000);
    } finally {
      agentLaunchPage.request.value = null;
    }
  });
});
