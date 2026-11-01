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

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  activeRow,
  badge,
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowOf,
  scrolled,
} from "./command-settings-test-kit";
import { signal } from "@preact/signals";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { activeUpdateController } from "../../updater/active-update-controller";
import type { UpdateController, UpdateView } from "../../updater/update-controller";
import { settle } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

function updater(view: Partial<UpdateView>): UpdateController {
  return {
    view: signal<UpdateView>({
      phase: "hidden",
      currentVersion: "0.11.0",
      availableVersion: "0.12.0",
      notes: "",
      ...view,
    }),
  } as unknown as UpdateController;
}

function found(...ids: readonly string[]): void {
  detectedAgents.value = ids.map((name) => ({ name, path: `/bin/${name}` }));
  agentsProbed.value = true;
}

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Needs attention rows, by their text. */
const issues = (): string[] =>
  [...document.querySelectorAll('[id^="command-row-attention:"]')].map((row) =>
    (row.querySelector(".truncate")?.textContent ?? "").trim(),
  );

describe("Needs attention: an update", () => {
  it.each([
    ["available", "A Deck update is available"],
    ["downloaded", "A Deck update is ready to install"],
    ["download-failed", "The Deck update didn't download"],
    ["install-failed", "The Deck update didn't install"],
    ["relaunch-failed", "Deck couldn't relaunch to finish the update"],
  ] as const)("reports %s", async (phase, title) => {
    activeUpdateController.value = updater({ phase });
    await open();
    expect(issues()).toEqual([title]);
  });

  it.each(["hidden", "check-failed", "downloading", "installing"] as const)(
    "does not report %s, which About has no action for",
    async (phase) => {
      activeUpdateController.value = updater({ phase });
      await open();
      expect(issues()).toEqual([]);
    },
  );

  it("does not report an installer that took over, which cannot be retried", async () => {
    activeUpdateController.value = updater({ phase: "install-failed", installRetryable: false });
    await open();
    expect(issues()).toEqual([]);
  });

  it("opens About, where the action is", async () => {
    activeUpdateController.value = updater({ phase: "downloaded" });
    await open();
    await clickIn(document.querySelector('[id^="command-row-attention:"]'));
    expect(badge()).toBe("About");
    expect(rowOf("about:update")).not.toBeNull();
  });
});

describe("Needs attention: a pinned agent that is not installed", () => {
  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude", "codex"] };
  });

  it("names the agent, and opens Agents on its row", async () => {
    found("claude");
    await open();
    expect(issues()).toEqual(["Codex is pinned but not installed"]);

    await clickIn(document.querySelector('[id^="command-row-attention:"]'));
    expect(badge()).toBe("Agents");
    expect(activeRow()).toBe(rowOf("agent:codex"));
    expect(scrolled).toContain(rowOf("agent:codex"));
  });

  it("goes away once detection finds it", async () => {
    found("claude");
    await open();
    expect(issues()).toHaveLength(1);
    found("claude", "codex");
    await settle();
    expect(issues()).toEqual([]);
  });

  it("waits for detection to answer, or every pin would read as missing at boot", async () => {
    detectedAgents.value = [];
    agentsProbed.value = false;
    await open();
    expect(issues()).toEqual([]);
  });

  it("leaves out what the user turned off, what nothing declares, and automatic pins", async () => {
    found("claude");
    settings.value = {
      ...DEFAULT_SETTINGS,
      quickAgentIds: ["claude", "codex"],
      disabledAgents: ["codex"],
    };
    await open();
    expect(issues()).toEqual([]);

    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude", "ghost"] };
    await settle();
    expect(issues()).toEqual([]);

    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: null };
    await settle();
    expect(issues()).toEqual([]);
  });

  it("reports a declared agent whose binary is gone", async () => {
    found("claude");
    settings.value = {
      ...DEFAULT_SETTINGS,
      quickAgentIds: ["custom:aider"],
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    };
    await open();
    expect(issues()).toEqual(["Aider is pinned but not installed"]);
  });
});
