// @vitest-environment jsdom
import { render } from "preact";
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
  RAIL_ICON: 16,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { SidebarActions, type SidebarActionsProps } from "../sidebar-actions";
import { byRole, waitUntil } from "../controls/preset-test-kit";
import {
  activate,
  closeMenu,
  host,
  installRailHarness,
  menuItems,
  mount,
  pinHost,
  settle,
  text,
} from "./project-rail-test-kit";

installRailHarness();

beforeEach(() => {
  pinHost(true);
});

function tools(over: Partial<SidebarActionsProps> = {}): SidebarActionsProps {
  return {
    sessionsAvailable: true,
    promptsOpen: false,
    promptsUnavailable: null,
    onOpenSessions: vi.fn(),
    onOpenUsage: vi.fn(),
    onOpenExplorer: vi.fn(),
    onOpenPrompts: vi.fn(),
    onOpenBrowser: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

const footer = () => host.querySelector<HTMLElement>(".sidebar-actions__slot");
const iconButton = (label: string) =>
  footer()?.querySelector<HTMLElement>(`button[aria-label="${label}"]`) ?? null;
const toolsButton = () =>
  [...(footer()?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (button) => text(button) === "Tools",
  ) ?? null;
const tooltip = () => document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
const entry = (label: string) => menuItems().find((candidate) => text(candidate).startsWith(label));

describe("the project rail's foot", () => {
  it("puts Settings on the left, then Session history and a Tools menu on the right", async () => {
    mount({ tools: tools() });
    await settle();

    const buttons = [...(footer()?.querySelectorAll<HTMLElement>("button") ?? [])];
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? text(button))).toEqual([
      "Settings",
      "Session history",
      "Tools",
    ]);
  });

  it("lists Explorer, Prompts, Browser and Token usage with the chords the keymap gives them", async () => {
    mount({ tools: tools() });
    await settle();

    await activate(toolsButton());
    await waitUntil(() => byRole("menu") !== null);

    expect(menuItems().map((candidate) => text(candidate))).toEqual([
      "Explorer⌘⇧B",
      "Prompts⌘⇧P",
      "Browser⌘⇧I",
      "Token usage⌘⇧U",
    ]);
  });

  it.each([
    { label: "Settings", callback: "onOpenSettings", inMenu: false },
    { label: "Session history", callback: "onOpenSessions", inMenu: false },
    { label: "Explorer", callback: "onOpenExplorer", inMenu: true },
    { label: "Prompts", callback: "onOpenPrompts", inMenu: true },
    { label: "Browser", callback: "onOpenBrowser", inMenu: true },
    { label: "Token usage", callback: "onOpenUsage", inMenu: true },
  ] as const)("$label runs the callback the shipped tools row runs", async (tool) => {
    const props = tools();
    mount({ tools: props });
    await settle();

    if (tool.inMenu) {
      await activate(toolsButton());
      await waitUntil(() => byRole("menu") !== null);
      await activate(entry(tool.label));
    } else {
      await activate(iconButton(tool.label));
    }
    expect(props[tool.callback]).toHaveBeenCalledTimes(1);

    // The shipped row, handed the same props, calls the very same function.
    const shipped = document.createElement("div");
    document.body.appendChild(shipped);
    act(() => render(<SidebarActions {...props} />, shipped));
    await activate(shipped.querySelector<HTMLElement>(`button[aria-label="${tool.label}"]`));
    expect(props[tool.callback]).toHaveBeenCalledTimes(2);
    act(() => render(null, shipped));
    shipped.remove();
  });

  it("names each icon button and its chord in a tooltip", async () => {
    mount({ tools: tools() });
    await settle();

    act(() => iconButton("Settings")?.focus());
    await waitUntil(() => tooltip() !== null);
    expect(text(tooltip())).toBe("Settings⌘,");
  });

  it("leaves Session history out on a host that cannot list sessions", async () => {
    mount({ tools: tools({ sessionsAvailable: false }) });
    await settle();

    expect(iconButton("Session history")).toBeNull();
    expect(toolsButton()).not.toBeNull();
  });

  it("says why Prompts cannot run and does not run it", async () => {
    const props = tools({ promptsUnavailable: "no pane to paste into" });
    mount({ tools: props });
    await settle();

    await activate(toolsButton());
    await waitUntil(() => byRole("menu") !== null);
    expect(text(entry("Prompts"))).toBe("Promptsno pane to paste into");
    await activate(entry("Prompts"));

    expect(props.onOpenPrompts).not.toHaveBeenCalled();
  });

  it("holds the Prompt Board popover and the usage line inside the foot, buttons first", async () => {
    mount({
      tools: tools({ promptsOpen: true, promptPopover: <div data-testid="popover" /> }),
      usageSummary: <div data-testid="usage">Claude 77% · 7d</div>,
    });
    await settle();

    const slot = footer();
    const usage = slot?.querySelector('[data-testid="usage"]');
    expect(slot?.querySelector('[data-testid="popover"]')).not.toBeNull();
    expect(usage?.textContent).toBe("Claude 77% · 7d");
    expect(
      toolsButton()?.compareDocumentPosition(usage as Node) === Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(true);
    // Beside the foot, not twice: the rail does not mount the summary again.
    expect(host.querySelectorAll('[data-testid="usage"]')).toHaveLength(1);
  });

  it("returns the keyboard to the Tools button on Escape but not after a choice", async () => {
    const props = tools();
    mount({ tools: props });
    await settle();

    await activate(toolsButton());
    await waitUntil(() => byRole("menu") !== null);
    await closeMenu();
    await waitUntil(() => document.activeElement === toolsButton());

    await activate(toolsButton());
    await waitUntil(() => byRole("menu") !== null);
    await activate(entry("Explorer"));
    await waitUntil(() => byRole("menu") === null);
    expect(document.activeElement).not.toBe(toolsButton());
  });
});
