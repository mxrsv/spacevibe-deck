// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sections and pieces an area mounts pull in host-backed stores; stub them for jsdom.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      loadState: { state: "ready", fresh: false },
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return { ...actual, reportPersistError: vi.fn() };
});
vi.mock("../../open-board/workspaces-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../open-board/workspaces-store")>()),
  forgetWorkspaceAgent: vi.fn(),
}));

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowOf,
  search,
} from "./command-settings-test-kit";
import { forgetWorkspaceAgent } from "../../open-board/workspaces-store";
import { DEFAULT_SETTINGS, type Settings } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { mount, press, settle, waitUntil } from "../controls/preset-test-kit";
import { CommandSettings } from "./command-settings";
import { resetPromptOpen } from "../settings/confirm-reset";
import { commandScope } from "./command-settings-state";

const ASIDE = { id: "custom:aider", label: "Aider", command: "aider --model sonnet" };

/** One edited key in every scope, and three `state` keys no reset may touch. */
const EDITED: Settings = {
  ...DEFAULT_SETTINGS,
  fontSize: 20,
  sidebarWidth: 300,
  promptTemplates: [{ id: "t", name: "t", body: "b" }] as never,
  customAgents: [ASIDE],
  githubStarred: true,
  browserLastUrl: "http://localhost:9999",
  signalAdaptersRevision: DEFAULT_SETTINGS.signalAdaptersRevision + 7,
};

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = "reset";
  settings.value = EDITED;
  resetPromptOpen.value = false;
  vi.mocked(forgetWorkspaceAgent).mockClear();
});

afterEach(() => {
  resetPromptOpen.value = false;
  vi.restoreAllMocks();
});

const resetButton = (label: string): HTMLButtonElement =>
  document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const dialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
const dialogButton = (text: string): HTMLElement | undefined =>
  [...(dialog()?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (button) => button.textContent === text,
  );

/** What a reset must leave alone, whatever the scope. */
function expectStateKept(): void {
  expect(settings.value.githubStarred).toBe(true);
  expect(settings.value.browserLastUrl).toBe("http://localhost:9999");
  expect(settings.value.signalAdaptersRevision).toBe(EDITED.signalAdaptersRevision);
}

describe("the Reset area", () => {
  it("offers a row per scope, each disabled while nothing in its scope differs", async () => {
    settings.value = { ...DEFAULT_SETTINGS, fontSize: 20 };
    await open();
    expect(resetButton("Reset preferences").disabled).toBe(false);
    expect(resetButton("Reset layout").disabled).toBe(true);
    expect(resetButton("Reset agents and templates").disabled).toBe(true);
  });

  it("asks first, names what goes and what stays, and resets only preferences", async () => {
    await open();
    await clickIn(resetButton("Reset preferences"));
    expect(settings.value.fontSize).toBe(20);
    expect(dialog()?.textContent).toContain("Font size");
    expect(dialog()?.textContent).not.toContain("Sidebar width");
    expect(dialog()?.textContent).toContain("Keeps layout, declared agents and prompt templates");

    await clickIn(dialogButton("Reset preferences"));
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settings.value.sidebarWidth).toBe(300);
    expect(settings.value.customAgents).toEqual([ASIDE]);
    expectStateKept();
  });

  it("resets only the layout from its row", async () => {
    await open();
    await clickIn(resetButton("Reset layout"));
    await clickIn(dialogButton("Reset layout"));
    expect(settings.value.sidebarWidth).toBe(DEFAULT_SETTINGS.sidebarWidth);
    expect(settings.value.fontSize).toBe(20);
    expectStateKept();
  });

  it("resets declared agents and templates, and lets go of the agents it deletes", async () => {
    await open();
    await clickIn(resetButton("Reset agents and templates"));
    await clickIn(dialogButton("Reset agents and templates"));
    expect(settings.value.customAgents).toEqual([]);
    expect(settings.value.promptTemplates).toEqual([]);
    expect(forgetWorkspaceAgent).toHaveBeenCalledWith(ASIDE.id);
    expect(settings.value.fontSize).toBe(20);
    expectStateKept();
  });

  it("changes nothing on Cancel, and frees the other resets", async () => {
    await open();
    await clickIn(resetButton("Reset preferences"));
    expect(resetPromptOpen.value).toBe(true);
    await clickIn(dialogButton("Cancel"));
    await waitUntil(() => dialog() === null);
    expect(settings.value).toEqual(EDITED);
    expect(resetPromptOpen.value).toBe(false);
  });

  it("closes on Escape without closing Settings, and hands focus back to its row", async () => {
    const { onClose } = await open();
    const trigger = resetButton("Reset preferences");
    trigger.focus();
    await clickIn(trigger);
    expect(dialog()).not.toBeNull();

    await press(dialog() as HTMLElement, { key: "Escape" });
    await waitUntil(() => dialog() === null);
    expect(onClose).not.toHaveBeenCalled();
    expect(commandScope.value).toBe("reset");
    expect(settings.value).toEqual(EDITED);
    expect(resetPromptOpen.value).toBe(false);
    await waitUntil(() => document.activeElement === trigger);
  });

  it("closes on a press at its own backdrop without closing Settings", async () => {
    const { onClose } = await open();
    await clickIn(resetButton("Reset preferences"));
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    // Portalled out of the scrim, so the scrim's close-on-press never sees this press.
    expect(document.querySelector('[aria-label="Settings"]')?.contains(backdrop ?? null)).toBe(
      false,
    );
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitUntil(() => dialog() === null);
    expect(onClose).not.toHaveBeenCalled();
    expect(settings.value).toEqual(EDITED);
  });

  it("leaves Tab to the dialog instead of wrapping it into the surface", async () => {
    await open();
    await clickIn(resetButton("Reset preferences"));
    const confirm = dialogButton("Reset preferences") as HTMLElement;
    confirm.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    confirm.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus in the surface when the reset leaves nothing to reset", async () => {
    settings.value = { ...DEFAULT_SETTINGS, fontSize: 20 };
    await open();
    const trigger = resetButton("Reset preferences");
    trigger.focus();
    await clickIn(trigger);
    await clickIn(dialogButton("Reset preferences"));
    await waitUntil(() => dialog() === null);
    await settle();
    expect(trigger.disabled).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it("lets go of the prompt flag when the surface closes under an open dialog", async () => {
    const view = await mount(<CommandSettings open onClose={vi.fn()} />);
    await clickIn(resetButton("Reset preferences"));
    expect(resetPromptOpen.value).toBe(true);
    await view.update(<CommandSettings open={false} onClose={vi.fn()} />);
    expect(resetPromptOpen.value).toBe(false);
  });

  it("stays inert while a page reset's native prompt is up", async () => {
    await open();
    resetPromptOpen.value = true;
    await settle();
    expect(resetButton("Reset preferences").disabled).toBe(true);
    expect(rowOf("reset:preference")).not.toBeNull();
  });
});
