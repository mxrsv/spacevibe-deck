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
vi.mock("../../open-board/workspaces-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../open-board/workspaces-store")>()),
  forgetWorkspaceAgent: vi.fn(),
}));
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
  rowOf,
  typeInto,
} from "./command-settings-test-kit";
import { agentLaunchCommand } from "../../lib/launch-command";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { press, waitUntil } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

beforeEach(async () => {
  resetCommandSettings();
  commandScope.value = "agents";
  detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
  agentsProbed.value = true;
  await open();
  await clickIn(rowOf("agent:claude")?.querySelector('[aria-label="Configure Claude Code"]'));
});

afterEach(() => {
  detectedAgents.value = [];
  agentsProbed.value = false;
  vi.restoreAllMocks();
});

const command = (): HTMLInputElement =>
  document.querySelector('input[aria-label="Command for Claude Code"]') as HTMLInputElement;
const models = (): HTMLInputElement =>
  document.querySelector(
    'input[aria-label="Additional models for Claude Code"]',
  ) as HTMLInputElement;
const launched = (): string | null =>
  agentLaunchCommand(
    "claude",
    settings.value.launchProfiles,
    settings.value.defaultLaunchProfiles,
    settings.value.customAgents,
  );

describe("an agent's launch command and flags", () => {
  it("rewrites the one saved command from a flag, keeping tokens no control claims", async () => {
    await typeInto(command(), "claude --dangerously-skip-permissions --my-flag");
    await press(command(), { key: "Enter" });
    expect(launched()).toBe("claude --dangerously-skip-permissions --my-flag");

    await clickIn(document.querySelector('[aria-label="Verbose for Claude Code"]'));
    expect(launched()).toContain("--verbose");
    expect(launched()).toContain("--my-flag");
    expect(launched()).toContain("--dangerously-skip-permissions");
    // The field shows the command it now types.
    expect(command().value).toBe(launched());

    await clickIn(document.querySelector('[aria-label="Verbose for Claude Code"]'));
    expect(launched()).not.toContain("--verbose");
    expect(launched()).toContain("--my-flag");
  });

  it("says why a command is refused, keeps the draft, and Escape puts the saved one back", async () => {
    const saved = command().value;
    await typeInto(command(), "claude; rm -rf /");
    await press(command(), { key: "Enter" });
    expect(document.querySelector('[role="alert"]')?.textContent).not.toBe("");
    expect(command().getAttribute("aria-invalid")).toBe("true");
    expect(command().value).toBe("claude; rm -rf /");
    expect(launched()).toBe(saved);

    await press(command(), { key: "Escape" });
    expect(command().value).toBe(saved);
  });

  it("clearing the command drops the preset and the reset button restores the recommendation", async () => {
    await typeInto(command(), "claude --verbose");
    await press(command(), { key: "Enter" });
    expect(launched()).toBe("claude --verbose");
    await clickIn(document.querySelector('[aria-label="Reset command for Claude Code"]'));
    expect(launched()).toBe(agentLaunchCommand("claude", [], {}));
    expect(settings.value.launchProfiles).toEqual(DEFAULT_SETTINGS.launchProfiles);
    expect(document.querySelector('[aria-label="Reset command for Claude Code"]')).toBeNull();
  });
});

describe("an installed agent's model list", () => {
  it("saves a comma list, trims and de-duplicates it, and an empty field clears it", async () => {
    await typeInto(models(), " opus-x ,, provider/m , opus-x ");
    await press(models(), { key: "Enter" });
    expect(settings.value.agentModels.claude).toEqual(["opus-x", "provider/m"]);

    await typeInto(models(), "");
    await press(models(), { key: "Enter" });
    expect(settings.value.agentModels.claude).toBeUndefined();
  });

  it("refuses a value a shell would split, keeps the draft and says so", async () => {
    await typeInto(models(), "good, bad value");
    await press(models(), { key: "Enter" });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("shell-safe");
    expect(models().value).toBe("good, bad value");
    expect(settings.value.agentModels.claude).toBeUndefined();
  });

  it("stores a picked default effort, and CLI default takes it back out", async () => {
    // Every closed menu keeps its popup hidden in the document, so look for the open one.
    const openList = (): HTMLElement | undefined =>
      [...document.querySelectorAll<HTMLElement>('[role="listbox"]')].find(
        (list) => list.closest("[hidden]") === null,
      );
    const pick = async (menu: string, label: string): Promise<void> => {
      await clickIn(document.querySelector(`[aria-label="${menu}"]`));
      await waitUntil(() => openList() !== undefined);
      const option = [...(openList()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
        (item) => item.textContent === label,
      );
      expect(option, `option ${label}`).toBeDefined();
      await clickIn(option);
      await waitUntil(() => openList() === undefined);
    };
    await pick("Default effort for Claude Code", "high");
    expect(settings.value.agentRuntimeDefaults.claude).toEqual({ model: null, effort: "high" });
    await pick("Default model for Claude Code", "opus");
    expect(settings.value.agentRuntimeDefaults.claude).toEqual({ model: "opus", effort: "high" });

    await pick("Default effort for Claude Code", "CLI default");
    await pick("Default model for Claude Code", "CLI default");
    expect(settings.value.agentRuntimeDefaults.claude).toBeUndefined();
  });
});
