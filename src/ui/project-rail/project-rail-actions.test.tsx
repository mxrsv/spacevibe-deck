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

import { invoke } from "../../host/bridge";
import type { CardActions } from "../worktree-card-menus";
import { byRole, waitUntil } from "../controls/preset-test-kit";
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
} from "./project-rail-test-kit";

installRailHarness();

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

const rowIds = () => rows().map((r) => r.dataset.railRow);
const button = (id: string, label: string) =>
  item(id)?.querySelector<HTMLElement>(`button[aria-label^="${label}"]`) ?? null;
const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Session name"]');
const actionsWithFinder = (onOpenFolder: (path: string) => void): CardActions => ({
  agents: [],
  agentsResolved: true,
  onRunAgent: vi.fn(),
  onSplitHere: vi.fn(),
  onOpenFolder,
  filesAppLabel: "Finder",
});

describe("row buttons", () => {
  beforeEach(() => {
    pinHost(true);
  });

  it("lays pin, archive and more beside every row, named for it", async () => {
    mount();
    await settle();

    for (const id of rowIds()) {
      const wrapper = item(id as string);
      expect(wrapper?.querySelectorAll("button")).toHaveLength(4);
    }
    expect(button("pane:21", "Pin")?.getAttribute("aria-label")).toBe("Pin token refresh");
    expect(button("pane:21", "Archive")?.getAttribute("aria-label")).toBe("Archive token refresh");
    expect(button("pane:21", "More")?.getAttribute("aria-label")).toBe(
      "More actions for token refresh",
    );
  });

  it("keeps the buttons of the row the keyboard stands on in the Tab order", async () => {
    mount();
    await settle();
    const tabbable = () =>
      [
        ...host.querySelectorAll<HTMLElement>(
          '[data-rail-item^="pane:"] button, [data-rail-item^="shell:"] button',
        ),
      ]
        .filter((entry) => entry.tabIndex === 0)
        .map((entry) => entry.closest("[data-rail-item]")?.getAttribute("data-rail-item"));

    // Tab reaches one row and its three buttons; the rest wait behind the arrow keys.
    expect(tabbable()).toEqual(["pane:12", "pane:12", "pane:12", "pane:12"]);

    act(() => row("pane:21")?.focus());
    expect(tabbable()).toEqual(["pane:21", "pane:21", "pane:21", "pane:21"]);
    expect(button("pane:21", "Pin")?.tabIndex).toBe(0);
  });

  it("pins a row to the top of its project and unpins it again", async () => {
    mount();
    await settle();
    expect(rowIds().slice(0, 3)).toEqual(["pane:12", "pane:21", "pane:11"]);

    click(button("pane:11", "Pin"));
    expect(rowIds().slice(0, 3)).toEqual(["pane:11", "pane:12", "pane:21"]);
    expect(text(row("pane:11"))).toContain("pinned");
    expect(button("pane:11", "Unpin")).not.toBeNull();

    click(button("pane:11", "Unpin"));
    expect(rowIds().slice(0, 3)).toEqual(["pane:12", "pane:21", "pane:11"]);
    expect(text(row("pane:11"))).not.toContain("pinned");
  });

  it("archives a row out of the list and out of its project's count", async () => {
    mount();
    await settle();
    expect(text(headers()[0])).toContain("3 sessions");

    click(button("pane:12", "Archive"));

    expect(rowIds()).not.toContain("pane:12");
    expect(rowIds().slice(0, 2)).toEqual(["pane:21", "pane:11"]);
    expect(text(headers()[0])).toContain("2 sessions");
  });

  it("never selects the row from its own buttons, and still selects it from the row", async () => {
    const onFocusPane = vi.fn();
    const onSelectTab = vi.fn();
    mount({ onFocusPane, onSelectTab });
    await settle();

    click(button("pane:21", "Pin"));
    click(button("pane:11", "Archive"));
    await activate(button("pane:12", "More"));
    await pick("Pin");
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onSelectTab).not.toHaveBeenCalled();

    click(row("pane:21"));
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(1, 21);
  });
});

describe("row buttons with the switch off", () => {
  it("draws none of it", async () => {
    pinHost(false);
    mount();
    await settle();

    expect(host.querySelector("[data-rail-item]")).toBeNull();
    expect(host.querySelector('button[aria-label^="Pin"]')).toBeNull();
  });
});

describe("row menu", () => {
  beforeEach(() => {
    pinHost(true);
  });

  it("opens on right-click and on the more button with the same items", async () => {
    mount({ onRenameTab: vi.fn(), cardActions: actionsWithFinder(vi.fn()) });
    await settle();
    const expected = [
      "Rename",
      "Pin",
      "Copy path",
      "Copy branch",
      "Open in Finder",
      "Archive",
      "Close",
    ];

    expect(await openMenuByRightClick("pane:21")).toBe(true);
    expect(menuLabels()).toEqual(expected);
    await closeMenu();

    await activate(button("pane:21", "More"));
    expect(menuLabels()).toEqual(expected);
    await closeMenu();
  });

  it("leaves out what nothing wires, and says Unpin for a pinned row", async () => {
    mount();
    await settle();

    await openMenuByRightClick("pane:21");
    expect(menuLabels()).toEqual(["Pin", "Copy path", "Copy branch", "Archive", "Close"]);
    await pick("Pin");
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick("pane:21");
    expect(menuLabels()).toContain("Unpin");
    expect(menuLabels()).not.toContain("Pin");
    await closeMenu();
  });

  it("copies the checkout's path and branch, and offers no branch for a plain folder", async () => {
    mount();
    await settle();

    await openMenuByRightClick("pane:21");
    await pick("Copy path");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("clipboard_write_text", { text: "/r/side" });
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick("pane:21");
    await pick("Copy branch");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("clipboard_write_text", { text: "side" });
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick("pane:31");
    const branch = menuItems().find((entry) => text(entry) === "Copy branch");
    expect(branch?.hasAttribute("data-disabled")).toBe(true);
    await pick("Copy branch");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
    await closeMenu();
  });

  it("opens the checkout in the file manager through the host's callback", async () => {
    const onOpenFolder = vi.fn();
    mount({ cardActions: actionsWithFinder(onOpenFolder) });
    await settle();

    await openMenuByRightClick("pane:21");
    await pick("Open in Finder");

    expect(onOpenFolder).toHaveBeenCalledExactlyOnceWith("/r/side");
  });

  it("pins and archives from the menu like the buttons do", async () => {
    mount();
    await settle();

    await openMenuByRightClick("pane:11");
    await pick("Pin");
    expect(rowIds()[0]).toBe("pane:11");
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick("pane:21");
    await pick("Archive");
    expect(rowIds()).not.toContain("pane:21");
  });

  it("closes an agent row's pane and a shell row's tab with the shipped row's arguments", async () => {
    const onClosePane = vi.fn();
    const onCloseTab = vi.fn();
    mount({ onClosePane, onCloseTab });
    await settle();

    await openMenuByRightClick("pane:21");
    await pick("Close");
    expect(onClosePane).toHaveBeenCalledExactlyOnceWith(1, 21);
    expect(onCloseTab).not.toHaveBeenCalled();
    await waitUntil(() => byRole("menu") === null);

    await openMenuByRightClick("shell:4");
    await pick("Close");
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith(3);
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });
});

describe("rename", () => {
  beforeEach(() => {
    pinHost(true);
  });

  const type = (value: string) => {
    act(() => {
      (input() as HTMLInputElement).value = value;
    });
  };

  it("opens on F2 and on a double-click, filled with the tab's own name", async () => {
    mount({ onRenameTab: vi.fn() });
    await settle();

    press(row("pane:21"), "F2");
    expect(input()?.value).toBe("token refresh");
    expect(row("pane:21")).toBeNull();
    press(input(), "Escape");

    act(() => {
      row("pane:12")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    // Unnamed: the field starts empty, with the row's default title behind it.
    expect(input()?.value).toBe("");
    expect(input()?.placeholder).not.toBe("");
  });

  it("commits a name on Enter through the shipped callback, once, and gives the row focus back", async () => {
    const onRenameTab = vi.fn();
    mount({ onRenameTab });
    await settle();

    press(row("pane:21"), "F2");
    type("auth handoff");
    press(input(), "Enter");

    expect(onRenameTab).toHaveBeenCalledExactlyOnceWith(1, "auth handoff");
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(row("pane:21"));
  });

  it("cancels on Esc without the key reaching anything above the field", async () => {
    const onRenameTab = vi.fn();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    mount({ onRenameTab });
    await settle();

    press(row("pane:21"), "F2");
    seen.mockClear();
    type("never saved");
    press(input(), "Escape");
    document.removeEventListener("keydown", seen);

    expect(seen).not.toHaveBeenCalled();
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(text(row("pane:21"))).toContain("token refresh");
  });

  it("restores the default title when the name is emptied, and ignores an unchanged one", async () => {
    const onRenameTab = vi.fn();
    mount({ onRenameTab });
    await settle();

    press(row("pane:21"), "F2");
    press(input(), "Enter");
    expect(onRenameTab).not.toHaveBeenCalled();

    press(row("pane:21"), "F2");
    type("   ");
    press(input(), "Enter");
    expect(onRenameTab).toHaveBeenCalledExactlyOnceWith(1, null);
  });

  it("commits when focus leaves the field", async () => {
    const onRenameTab = vi.fn();
    mount({ onRenameTab });
    await settle();

    press(row("pane:21"), "F2");
    type("moved on");
    act(() => input()?.blur());

    expect(onRenameTab).toHaveBeenCalledExactlyOnceWith(1, "moved on");
  });

  it("starts from the menu's Rename once the menu has closed", async () => {
    const onRenameTab = vi.fn();
    mount({ onRenameTab });
    await settle();

    await openMenuByRightClick("pane:21");
    await pick("Rename");
    await waitUntil(() => input() !== null);
    expect(document.activeElement).toBe(input());
    type("from the menu");
    press(input(), "Enter");

    expect(onRenameTab).toHaveBeenCalledExactlyOnceWith(1, "from the menu");
  });

  it("is not offered where nothing owns tab names, nor on a shell-only row", async () => {
    mount();
    await settle();
    press(row("pane:21"), "F2");
    expect(input()).toBeNull();
    await openMenuByRightClick("pane:21");
    expect(menuLabels()).not.toContain("Rename");
    await closeMenu();

    mount({ onRenameTab: vi.fn() });
    await settle();
    press(row("shell:4"), "F2");
    expect(input()).toBeNull();
    await openMenuByRightClick("shell:4");
    expect(menuLabels()).not.toContain("Rename");
    await closeMenu();
  });
});
