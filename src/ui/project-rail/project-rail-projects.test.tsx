// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The host stubs `project-rail.test.tsx` needs, and a `DeckIcon` jsdom can draw.
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
vi.mock("../controls/deck-icon", () => ({
  CHROME_ICON: 13,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { resetDesktopEnvironmentForTests } from "../../lib/platform";
import { settings } from "../../settings/settings-store";
import { archiveItem } from "./project-rail-state";
import { byRole, waitUntil } from "../controls/preset-test-kit";
import type { CardActions } from "../worktree-card-menus";
import {
  activate,
  click,
  closeMenu,
  headers,
  host,
  installRailHarness,
  item,
  menuItems,
  menuLabels,
  mount,
  openMenuByRightClick,
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
  pinHost(true);
});

// Project keys: the repository's `.git`, and `plain:<folder>` for a folder git does not know.
const MAIN = "/r/.git";
const API = "plain:/w/api";
const NOTES = "plain:/w/notes";

const rowIds = () => rows().map((r) => r.dataset.railRow);
const names = () => headers().map((header) => header.querySelector(".truncate")?.textContent);
const header = (key: string) => item(`project:${key}`);
const headerButton = (key: string, label: string) =>
  header(key)?.querySelector<HTMLElement>(`button[aria-label^="${label}"]`) ?? null;
const sectionHead = (label: string) =>
  host.querySelector<HTMLElement>(`[data-rail-section="${label}"]`);
const entry = (label: string) => menuItems().find((candidate) => text(candidate) === label);

const launcher = (onOpenAgentLauncher: (path: string) => void): CardActions => ({
  agents: [],
  agentsResolved: true,
  onRunAgent: vi.fn(),
  onSplitHere: vi.fn(),
  onOpenAgentLauncher,
});

describe("project header", () => {
  it("lays '+' and a menu over each header, reachable once the header holds the keyboard", async () => {
    mount();
    await settle();

    for (const key of [MAIN, API, NOTES]) {
      expect(headerButton(key, "New agent in")).not.toBeNull();
      expect(header(key)?.querySelector('button[aria-label$=" menu"]')).not.toBeNull();
    }
    expect(headerButton(MAIN, "New agent in")?.tabIndex).toBe(-1);
    act(() => headers()[0].focus());
    expect(headerButton(MAIN, "New agent in")?.tabIndex).toBe(0);
    expect(headerButton(MAIN, "main menu")?.tabIndex).toBe(0);
    expect(headerButton(API, "New agent in")?.tabIndex).toBe(-1);
  });

  it("starts an agent in the project's primary checkout, as the '+' menu's New agent does", async () => {
    const calls = vi.fn();
    mount({ cardActions: launcher(calls) });
    await settle();

    click(headerButton(MAIN, "New agent in"));
    click(headerButton(API, "New agent in"));
    click(headerButton(NOTES, "New agent in"));
    // The primary checkout of a repository with two, then a plain folder, then a remembered one.
    expect(calls.mock.calls).toEqual([["/r/main"], ["/w/api"], ["/w/notes"]]);

    calls.mockClear();
    await activate(host.querySelector<HTMLElement>('button[aria-label="New"]'));
    await pick("New agent");
    expect(calls.mock.calls).toEqual([["/r/main"]]);
  });

  it("opens the board where nothing wires the launcher, and honours a disabled board", async () => {
    const onOpenWorkspace = vi.fn();
    mount({ legacy: { onOpenWorkspace, onResumeWorktree: () => {} } });
    await settle();

    click(headerButton(API, "New agent in"));
    expect(onOpenWorkspace).toHaveBeenCalledOnce();

    unmount();
    mount({ legacy: { onOpenWorkspace, openWorkspaceDisabled: true, onResumeWorktree: () => {} } });
    await settle();
    expect(headerButton(API, "New agent in")?.hasAttribute("disabled")).toBe(true);
  });

  it("offers the project menu from a right-click as from its button, with the end entries disabled", async () => {
    mount({ onCloseProject: vi.fn(), onRemoveWorkspace: vi.fn() });
    await settle();

    await openMenuByRightClick(`project:${MAIN}`);
    expect(menuLabels()).toEqual(["Move up", "Move down", "Hide", "Remove"]);
    expect(entry("Move up")?.hasAttribute("data-disabled")).toBe(true);
    expect(entry("Move down")?.hasAttribute("data-disabled")).toBe(false);
    await closeMenu();

    await openMenuByRightClick(`project:${NOTES}`);
    expect(entry("Move up")?.hasAttribute("data-disabled")).toBe(false);
    expect(entry("Move down")?.hasAttribute("data-disabled")).toBe(true);
    await closeMenu();
  });

  it("leaves Remove out where nothing wires it", async () => {
    mount();
    await settle();

    await openMenuByRightClick(`project:${API}`);
    expect(menuLabels()).toEqual(["Move up", "Move down", "Hide"]);
  });
});

describe("move up and down", () => {
  it("rewrites railOrder as a drop of that project on its neighbour would", async () => {
    mount();
    await settle();
    expect(names()).toEqual(["main", "api", "notes"]);

    await openMenuByRightClick(`project:${API}`);
    await pick("Move up");
    await waitUntil(() => byRole("menu") === null);
    expect(settings.value.railOrder).toEqual([API]);
    expect(names()).toEqual(["api", "main", "notes"]);

    await openMenuByRightClick(`project:${NOTES}`);
    await pick("Move up");
    await waitUntil(() => byRole("menu") === null);
    expect(settings.value.railOrder).toEqual([API, NOTES]);
    expect(names()).toEqual(["api", "notes", "main"]);

    await openMenuByRightClick(`project:${API}`);
    await pick("Move down");
    await waitUntil(() => byRole("menu") === null);
    expect(names()).toEqual(["notes", "api", "main"]);
  });

  it("steps over a hidden project", async () => {
    mount();
    await settle();
    await openMenuByRightClick(`project:${API}`);
    await pick("Hide");
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick(`project:${NOTES}`);
    await pick("Move up");
    await waitUntil(() => byRole("menu") === null);

    expect(names()).toEqual(["notes", "main"]);
  });

  it("is the shipped rail's order: the drag-free list reads the same setting", async () => {
    mount();
    await settle();
    await openMenuByRightClick(`project:${NOTES}`);
    await pick("Move up");
    await waitUntil(() => byRole("menu") === null);
    unmount();

    // The switch off: the shipped rail draws its clusters in the order the new one wrote.
    resetDesktopEnvironmentForTests();
    pinHost(false);
    mount();
    await settle();
    const heads = [...host.querySelectorAll(".asr-cluster__name")].map((name) => text(name));
    expect(heads.indexOf("notes")).toBeLessThan(heads.indexOf("api"));
  });
});

describe("hide and show", () => {
  it("parks a hidden project in a Hidden section and brings it back where it was", async () => {
    mount();
    await settle();

    await openMenuByRightClick(`project:${MAIN}`);
    await pick("Hide");
    await waitUntil(() => byRole("menu") === null);
    expect(names()).toEqual(["api", "notes"]);
    expect(rowIds()).not.toContain("pane:12");
    expect(text(sectionHead("Hidden"))).toBe("Hidden1");
    expect(sectionHead("Hidden")?.getAttribute("aria-expanded")).toBe("false");

    click(sectionHead("Hidden"));
    const show = host.querySelector<HTMLElement>('button[aria-label="Show main"]');
    expect(text(show?.parentElement)).toContain("main");
    click(show);

    expect(names()).toEqual(["main", "api", "notes"]);
    expect(sectionHead("Hidden")).toBeNull();
  });

  it("hands the keyboard to the neighbouring header when the one it stood on hides", async () => {
    mount();
    await settle();
    headers()[0].focus();

    await openMenuByRightClick(`project:${MAIN}`);
    await pick("Hide");
    await waitUntil(() => byRole("menu") === null);

    expect(document.activeElement).toBe(headers()[0]);
    expect(text(headers()[0])).toContain("api");
  });
});

describe("remove", () => {
  const pressedArgs = async (development: boolean, find: () => Element | null) => {
    resetDesktopEnvironmentForTests();
    pinHost(development);
    const onCloseProject = vi.fn();
    const onRemoveWorkspace = vi.fn();
    mount({ onCloseProject, onRemoveWorkspace });
    await settle();
    click(find());
    return { onCloseProject, onRemoveWorkspace };
  };

  it("closes a live project through the shipped callback with the shipped arguments, after asking", async () => {
    const shipped = await pressedArgs(false, () =>
      host.querySelector("button.asr-cluster__remove--live"),
    );
    unmount();

    const onCloseProject = vi.fn();
    resetDesktopEnvironmentForTests();
    pinHost(true);
    mount({ onCloseProject, onRemoveWorkspace: vi.fn() });
    await settle();
    await openMenuByRightClick(`project:${MAIN}`);
    await pick("Remove");
    await waitUntil(() => document.body.querySelector('[role="dialog"]') !== null);
    expect(onCloseProject).not.toHaveBeenCalled();
    expect(text(document.body.querySelector('[role="dialog"]'))).toContain("Remove main?");
    expect(text(document.body.querySelector('[role="dialog"]'))).toContain("Closes 2 tabs");
    const confirm = [...document.body.querySelectorAll('[role="dialog"] button')].find(
      (button) => text(button) === "Remove",
    );
    await activate(confirm as HTMLElement);

    expect(shipped.onCloseProject).toHaveBeenCalledOnce();
    expect(onCloseProject.mock.calls).toEqual(shipped.onCloseProject.mock.calls);
    expect(onCloseProject.mock.calls[0]).toEqual([[0, 1], ["/r/main"]]);
  });

  it("closes nothing when the confirmation is declined", async () => {
    const onCloseProject = vi.fn();
    mount({ onCloseProject });
    await settle();

    await openMenuByRightClick(`project:${MAIN}`);
    await pick("Remove");
    await waitUntil(() => document.body.querySelector('[role="dialog"]') !== null);
    const cancel = [...document.body.querySelectorAll('[role="dialog"] button')].find(
      (button) => text(button) === "Cancel",
    );
    await activate(cancel as HTMLElement);
    await waitUntil(() => document.body.querySelector('[role="dialog"]') === null);

    expect(onCloseProject).not.toHaveBeenCalled();
    expect(names()).toContain("main");
  });

  it("forgets a remembered project through the shipped callback, after saying nothing is closed", async () => {
    const shipped = await pressedArgs(false, () =>
      host.querySelector("button.asr-cluster__remove:not(.asr-cluster__remove--live)"),
    );
    unmount();

    const onRemoveWorkspace = vi.fn();
    resetDesktopEnvironmentForTests();
    pinHost(true);
    mount({ onCloseProject: vi.fn(), onRemoveWorkspace });
    await settle();
    await openMenuByRightClick(`project:${NOTES}`);
    await pick("Remove");
    await waitUntil(() => document.body.querySelector('[role="dialog"]') !== null);
    expect(onRemoveWorkspace).not.toHaveBeenCalled();
    expect(text(document.body.querySelector('[role="dialog"]'))).toContain("Nothing is open in it");
    const confirm = [...document.body.querySelectorAll('[role="dialog"] button')].find(
      (button) => text(button) === "Remove",
    );
    await activate(confirm as HTMLElement);

    expect(onRemoveWorkspace.mock.calls).toEqual(shipped.onRemoveWorkspace.mock.calls);
    expect(onRemoveWorkspace.mock.calls[0]).toEqual([["/w/notes"]]);
  });
});

describe("remembered project", () => {
  it("keeps its header, says there are no sessions and still starts an agent", async () => {
    const calls = vi.fn();
    mount({ cardActions: launcher(calls) });
    await settle();

    const notes = host.querySelector("section[aria-label=notes]");
    expect(text(notes)).toContain("No sessions");
    expect(notes?.querySelectorAll("[data-rail-row]")).toHaveLength(0);
    click(headerButton(NOTES, "New agent in"));
    expect(calls).toHaveBeenCalledExactlyOnceWith("/w/notes");
  });
});

describe("Archived section", () => {
  it("collects archived rows folded, and Show archived is its open state", async () => {
    mount();
    await settle();
    expect(sectionHead("Archived")).toBeNull();

    click(item("pane:12")?.querySelector('button[aria-label^="Archive"]'));
    expect(rowIds()).not.toContain("pane:12");
    expect(text(sectionHead("Archived"))).toBe("Archived1");
    expect(sectionHead("Archived")?.getAttribute("aria-expanded")).toBe("false");

    // The Organize menu's toggle opens the section ...
    await activate(host.querySelector<HTMLElement>('button[aria-label="Organize"]'));
    const toggle = () =>
      document.body.querySelector<HTMLElement>('[role="menuitemcheckbox"]') as HTMLElement;
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await activate(toggle());
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    await closeMenu();
    expect(rowIds()).toContain("pane:12");
    expect(sectionHead("Archived")?.getAttribute("aria-expanded")).toBe("true");

    // ... and the head closes it, which the toggle then reports.
    click(sectionHead("Archived"));
    expect(rowIds()).not.toContain("pane:12");
    await activate(host.querySelector<HTMLElement>('button[aria-label="Organize"]'));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await closeMenu();
  });

  it("offers Unarchive in place of Archive and Pin, and brings the row back", async () => {
    mount();
    await settle();
    click(item("pane:12")?.querySelector('button[aria-label^="Archive"]'));
    click(sectionHead("Archived"));

    const archived = item("pane:12");
    expect(archived?.querySelector('button[aria-label^="Archive"]')).toBeNull();
    expect(archived?.querySelector('button[aria-label^="Pin"]')).toBeNull();
    expect(text(row("pane:12"))).toContain("main");
    await openMenuByRightClick("pane:12");
    expect(menuLabels()).toEqual(["Copy path", "Copy branch", "Unarchive", "Close"]);
    await closeMenu();

    click(archived?.querySelector('button[aria-label^="Unarchive"]'));

    expect(sectionHead("Archived")).toBeNull();
    const main = host.querySelector("section[aria-label=main]");
    expect(
      [...(main?.querySelectorAll("[data-rail-row]") ?? [])].map((r) =>
        r.getAttribute("data-rail-row"),
      ),
    ).toEqual(["pane:12", "pane:21", "pane:11"]);
  });

  it("still selects an archived row, and ignores the search", async () => {
    const onFocusPane = vi.fn();
    mount({ onFocusPane });
    await settle();
    click(item("pane:12")?.querySelector('button[aria-label^="Archive"]'));
    click(sectionHead("Archived"));

    click(row("pane:12"));
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(0, 12);

    const field = host.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]');
    act(() => {
      (field as HTMLInputElement).value = "zzzz";
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowIds()).toEqual(["pane:12"]);
    expect(text(host.querySelector("section[aria-label='Open agents']"))).toContain(
      "No sessions match",
    );
  });
});

describe("keyboard", () => {
  it("walks headers, rows and section heads, opens a section on Enter and jumps with Home and End", async () => {
    mount();
    await settle();
    click(item("pane:12")?.querySelector('button[aria-label^="Archive"]'));
    const stops = () => [
      ...host.querySelectorAll<HTMLElement>(
        "[data-rail-project],[data-rail-section],[data-rail-row]",
      ),
    ];
    const last = () => stops()[stops().length - 1];
    expect(last()).toBe(sectionHead("Archived"));

    act(() => last().focus());
    expect(press(last(), "ArrowUp")).toBe(true);
    expect(document.activeElement).toBe(stops()[stops().length - 2]);
    press(document.activeElement, "End");
    expect(document.activeElement).toBe(sectionHead("Archived"));

    // Enter is the button's own press: it opens the section, whose row joins the walk.
    expect(press(sectionHead("Archived"), "Enter")).toBe(false);
    click(sectionHead("Archived"));
    expect(rowIds()).toContain("pane:12");
    press(document.activeElement, "ArrowDown");
    expect(document.activeElement).toBe(row("pane:12"));
    press(document.activeElement, "Home");
    expect(document.activeElement).toBe(headers()[0]);
  });

  it("hands the keyboard to the next row when the row it stood on archives", async () => {
    mount();
    await settle();
    const archive = item("pane:12")?.querySelector<HTMLElement>('button[aria-label^="Archive"]');
    act(() => archive?.focus());

    click(archive);

    expect(rowIds()[0]).toBe("pane:21");
    expect(document.activeElement).toBe(row("pane:21"));
  });

  it("hands the keyboard to the next stop when a project's last row goes", async () => {
    mount();
    await settle();
    act(() => row("pane:11")?.focus());

    click(item("pane:11")?.querySelector('button[aria-label^="Archive"]'));

    expect(document.activeElement).toBe(headers()[1]);
    expect(text(headers()[1])).toContain("api");
  });

  it("does not pull the keyboard back after it has gone to an element of its own", async () => {
    mount();
    await settle();
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    act(() => row("pane:12")?.focus());
    act(() => elsewhere.focus());
    act(() => elsewhere.blur());
    expect(document.activeElement).toBe(document.body);

    act(() => archiveItem("pane:12"));

    expect(rowIds()).not.toContain("pane:12");
    expect(document.activeElement).toBe(document.body);
    elsewhere.remove();
  });
});
