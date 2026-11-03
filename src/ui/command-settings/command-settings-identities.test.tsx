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
import { forgetWorkspaceAgent } from "../../open-board/workspaces-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { press } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

const ASIDE = { id: "custom:aider", label: "Aider", command: "aider --model sonnet" };

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = "agents";
  detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
  agentsProbed.value = true;
  vi.mocked(forgetWorkspaceAgent).mockClear();
});

afterEach(() => {
  detectedAgents.value = [];
  agentsProbed.value = false;
  vi.restoreAllMocks();
});

const nameField = (): HTMLInputElement =>
  document.querySelector('input[aria-label="New agent name"]') as HTMLInputElement;
const commandField = (): HTMLInputElement =>
  document.querySelector('input[aria-label="New agent command"]') as HTMLInputElement;
const addButton = (): HTMLButtonElement =>
  document.querySelector('button[aria-label="Add agent"]') as HTMLButtonElement;
const status = (): string | undefined =>
  document.querySelector('[role="status"].text-destructive')?.textContent ?? undefined;

async function declare(name: string, command: string): Promise<void> {
  await typeInto(nameField(), name);
  await typeInto(commandField(), command);
  await clickIn(addButton());
}

describe("the Add agent row", () => {
  it("declares an agent with an id of its own, trimmed, and empties both fields", async () => {
    await open();
    expect(addButton().disabled).toBe(true);
    await declare("  Aider  ", "  aider --model sonnet ");
    expect(settings.value.customAgents).toEqual([ASIDE]);
    expect(nameField().value).toBe("");
    expect(commandField().value).toBe("");
    expect(rowOf("agent:custom:aider")).not.toBeNull();
  });

  it("adds on Enter in the command field", async () => {
    await open();
    await typeInto(nameField(), "Aider");
    await typeInto(commandField(), "aider");
    await press(commandField(), { key: "Enter" });
    expect(settings.value.customAgents).toHaveLength(1);
  });

  it.each(["Enter", "Escape"])(
    "leaves composing %s in Add agent without declaring or clearing",
    async (key) => {
      const { onClose } = await open();
      await typeInto(nameField(), "Aider");
      await typeInto(commandField(), "aider");
      await press(key === "Escape" ? nameField() : commandField(), { key, isComposing: true });
      expect(nameField().value).toBe("Aider");
      expect(commandField().value).toBe("aider");
      expect(settings.value.customAgents).toEqual([]);
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["", "aider", "a name is required"],
    ["x".repeat(33), "aider", "names stay under 32 characters"],
    ["claude", "aider", "is a built-in agent's id"],
    ["Claude Code", "aider", "that name is already used"],
    ["Aider", "", "a command is required"],
    ["Aider", "aid;er", "the command name may only use"],
  ])("refuses %j with %j and says why", async (name, command, reason) => {
    await open();
    await declare(name, command);
    expect(status()).toContain(reason);
    expect(settings.value.customAgents).toEqual([]);
  });

  it("refuses a name another declared agent already has", async () => {
    settings.value = { ...DEFAULT_SETTINGS, customAgents: [ASIDE] };
    await open();
    await declare("Aider", "other");
    expect(status()).toContain("that name is already used");
    expect(settings.value.customAgents).toEqual([ASIDE]);
  });

  it("keeps Escape for a typed draft: one press clears both fields, the surface stays", async () => {
    const { onClose } = await open();
    await typeInto(nameField(), "Aider");
    await press(nameField(), { key: "Escape" });
    expect(nameField().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a declared agent's identity under its row", () => {
  const input = (label: string): HTMLInputElement =>
    document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

  async function openAider(): Promise<void> {
    await clickIn(rowOf("agent:custom:aider")?.querySelector('[aria-label="Configure Aider"]'));
  }

  beforeEach(() => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      customAgents: [ASIDE],
      quickAgentIds: ["custom:aider"],
    };
  });

  it("renames and retargets in place, and refuses a taken name with the reason", async () => {
    await open();
    await openAider();
    await typeInto(input("Name for Aider"), "Aider 2");
    await press(input("Name for Aider"), { key: "Enter" });
    expect(settings.value.customAgents[0]?.label).toBe("Aider 2");

    await typeInto(input("Command for Aider 2"), "aider --yes");
    await press(input("Command for Aider 2"), { key: "Enter" });
    expect(settings.value.customAgents[0]?.command).toBe("aider --yes");

    await typeInto(input("Name for Aider 2"), "Claude Code");
    await press(input("Name for Aider 2"), { key: "Enter" });
    expect(status()).toContain("that name is already used");
    expect(settings.value.customAgents[0]?.label).toBe("Aider 2");

    await typeInto(input("Command for Aider 2"), "a;b");
    await press(input("Command for Aider 2"), { key: "Enter" });
    expect(status()).toContain("the command name may only use");
    expect(settings.value.customAgents[0]?.command).toBe("aider --yes");
  });

  it("removes the agent, unpins it and makes every workspace forget it", async () => {
    await open();
    await openAider();
    await clickIn(document.querySelector('button[aria-label="Remove Aider"]'));
    expect(settings.value.customAgents).toEqual([]);
    expect(settings.value.quickAgentIds ?? []).not.toContain("custom:aider");
    expect(forgetWorkspaceAgent).toHaveBeenCalledWith("custom:aider");
    expect(rowOf("agent:custom:aider")).toBeNull();
  });
});
