// @vitest-environment jsdom
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
vi.mock("../../settings/agent-hooks-support-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/agent-hooks-support-store")>()),
  ensureAgentHooksSupportLoaded: vi.fn(async () => {}),
}));

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  clickIn,
  openSurface as open,
  resetCommandSettings,
  typeInto,
} from "./command-settings-test-kit";
import { settingsOpen } from "../../chrome/events";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { press } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = "agents";
});

afterEach(() => {
  settingsOpen.value = false;
  vi.restoreAllMocks();
});

const field = (): HTMLInputElement =>
  document.querySelector('input[aria-label="Add command"]') as HTMLInputElement;
const addButton = (): HTMLButtonElement =>
  document.querySelector('button[aria-label="Add"]') as HTMLButtonElement;

describe("the Add command row", () => {
  it("saves a command, makes it the agent's default when it has none, and empties the field", async () => {
    await open();
    expect(addButton().disabled).toBe(true);
    await typeInto(field(), "claude --plan");
    expect(addButton().disabled).toBe(false);
    await clickIn(addButton());

    expect(settings.value.launchProfiles.map((profile) => profile.command)).toEqual([
      ...DEFAULT_SETTINGS.launchProfiles.map((profile) => profile.command),
      "claude --plan",
    ]);
    const added = settings.value.launchProfiles.at(-1);
    expect(settings.value.defaultLaunchProfiles.claude).toBe(added?.id);
    expect(field().value).toBe("");
  });

  it("adds on Enter, and keeps an existing default", async () => {
    await open();
    await typeInto(field(), "claude --plan");
    await press(field(), { key: "Enter" });
    const first = settings.value.defaultLaunchProfiles.claude;
    await typeInto(field(), "claude --verbose");
    await press(field(), { key: "Enter" });
    expect(settings.value.launchProfiles).toHaveLength(DEFAULT_SETTINGS.launchProfiles.length + 2);
    expect(settings.value.defaultLaunchProfiles.claude).toBe(first);
  });

  it("says why a command is refused and writes nothing", async () => {
    await open();
    await typeInto(field(), "claude; rm -rf /");
    await clickIn(addButton());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("may only use");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(settings.value.launchProfiles).toEqual(DEFAULT_SETTINGS.launchProfiles);

    await typeInto(field(), "claude --plan");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await clickIn(addButton());
    await typeInto(field(), "claude --plan");
    await clickIn(addButton());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("already in the list");
  });

  it("keeps Escape for its draft: the first press clears it, the surface stays open", async () => {
    const { onClose } = await open();
    await typeInto(field(), "claude --plan");
    await press(field(), { key: "Escape" });
    expect(field().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is inert while the snapshot loads", async () => {
    const { settingsLoadState } = await import("../../settings/settings-store");
    settingsLoadState.value = { status: "loading" };
    await open();
    expect(field().disabled).toBe(true);
  });
});

describe("the Token usage row", () => {
  it("closes Settings and opens the dock on Usage, and never closes a dock already there", async () => {
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "usage" };
    settingsOpen.value = true;
    await open();
    await clickIn(document.querySelector('button[aria-label="Open token usage"]'));
    expect(settingsOpen.value).toBe(false);
    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("usage");
  });

  it("opens a closed dock on the Usage tab", async () => {
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: false };
    await open();
    await clickIn(document.querySelector('button[aria-label="Open token usage"]'));
    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("usage");
  });
});
