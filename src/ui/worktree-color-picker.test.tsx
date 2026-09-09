// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeCard, type WorktreeCardProps } from "./worktree-card";
import { settings, settingsLoadState } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { railCardMenuOpen } from "../chrome/events";

vi.mock("./controls/deck-icon", () => ({ CHROME_ICON: 13, DeckIcon: () => <span /> }));

let host: HTMLDivElement;
const toggle = vi.fn();
const runAgent = vi.fn();
function card(path = "/repo/main", empty = false): WorktreeCardProps {
  return {
    project: "Deck",
    open: false,
    onToggle: toggle,
    onFocusPane: vi.fn(),
    onClosePane: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    actions: {
      agents: [],
      agentsResolved: true,
      onRunAgent: runAgent,
      onSplitHere: vi.fn(),
      onOpenBoard: vi.fn(),
    },
    group: {
      key: path,
      path,
      repositoryPath: "/repo",
      branch: "main",
      name: "main",
      primary: true,
      labelled: true,
      active: true,
      live: false,
      age: "now",
      panes: [],
      rows: [],
      entries: empty
        ? []
        : [{ kind: "shell", key: path, tabIndex: 0, label: "Shell", active: true }],
    },
  };
}
function mount(empty = false): void {
  act(() =>
    render(
      <>
        <WorktreeCard {...card("/repo/main", empty)} />
        <WorktreeCard {...card("/other/main")} />
      </>,
      host,
    ),
  );
}
function click(selector: string, root: ParentNode = document): void {
  const button = root.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button!.click());
}
function key(value: string): void {
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
  });
}

function openPalette(empty = false): void {
  const target = host.querySelector<HTMLElement>(empty ? ".asr-bare" : ".asr-card");
  expect(target).not.toBeNull();
  act(() => {
    target!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
    );
  });
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(document.querySelector(".asr-color-menu")).toBeNull();
  click(".asr-color-action");
}

beforeEach(() => {
  vi.useFakeTimers();
  settings.value = DEFAULT_SETTINGS;
  settingsLoadState.value = { status: "loading" };
  toggle.mockClear();
  runAgent.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
  settings.value = DEFAULT_SETTINGS;
});

describe("worktree color control", () => {
  it("keeps the dot as a head indicator and offers color in the context menu", () => {
    mount();
    const mark = host.querySelector<HTMLElement>(".asr-card__mark");
    expect(mark?.tagName).toBe("SPAN");
    act(() => mark!.click());
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    openPalette();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(document.querySelector('[role="menu"] .asr-color-menu')).not.toBeNull();
  });

  it.each([false, true])(
    "changes only its checkout without toggling/launching (empty=%s)",
    (empty) => {
      mount(empty);
      openPalette(empty);
      expect(railCardMenuOpen.value).toBe(true);
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      expect(host.querySelector("button button")).toBeNull();
      click('[aria-label="Purple"]');
      expect(settings.value.worktreeColors).toEqual({ "/repo/main": "purple" });
      expect(
        host
          .querySelector<HTMLElement>(empty ? ".asr-bare-heading" : ".asr-card")
          ?.style.getPropertyValue("--worktree-color"),
      ).toBe("var(--magenta)");
      expect(toggle).not.toHaveBeenCalled();
      expect(runAgent).not.toHaveBeenCalled();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      act(() => render(null, host));
      mount(empty);
      openPalette(empty);
      expect(document.querySelector('[aria-label="Purple"]')?.getAttribute("aria-checked")).toBe(
        "true",
      );
      click(".asr-color-menu__default");
      expect(settings.value.worktreeColors).toEqual({});
      expect(
        host
          .querySelector<HTMLElement>(empty ? ".asr-bare-heading" : ".asr-card")
          ?.style.getPropertyValue("--worktree-color"),
      ).toBe("");
    },
  );

  it("focuses the selection, supports arrows and Escape, and releases the overlay", () => {
    mount();
    openPalette();
    expect(document.activeElement?.textContent).toBe("Default");
    key("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Green");
    key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Cyan");
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(railCardMenuOpen.value).toBe(false);
    expect(settings.value.worktreeColors).toEqual({});
  });

  it("dismisses on outside press and scroll without changing color", () => {
    mount();
    for (const dismiss of [
      () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
      () => window.dispatchEvent(new Event("scroll")),
    ]) {
      openPalette();
      act(() => {
        dismiss();
      });
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
    expect(settings.value.worktreeColors).toEqual({});
  });
});
