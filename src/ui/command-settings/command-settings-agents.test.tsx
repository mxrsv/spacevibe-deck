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
// The host's answer is the signal each test sets; a real call would put the default back.
vi.mock("../../settings/agent-hooks-support-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/agent-hooks-support-store")>()),
  ensureAgentHooksSupportLoaded: vi.fn(async () => {}),
}));
const probe = vi.hoisted(() => ({ probeAgentsNow: vi.fn(async () => []) }));
vi.mock("../../launcher/agent-install-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../launcher/agent-install-store")>()),
  probeAgentsNow: probe.probeAgentsNow,
}));

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  activeRow,
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowLabels,
  rowOf,
  search,
  typeInto,
} from "./command-settings-test-kit";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { agentLaunchCommand } from "../../lib/launch-command";
import { agentHooksSupported } from "../../settings/agent-hooks-support-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { SIGNAL_ADAPTERS_REVISION } from "../../settings/signal-adapter-choice";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { press, settle } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

const ASIDE = { id: "custom:aider", label: "Aider", command: "aider --model sonnet" };

/** The agents the detection probe found, and whether it has answered at all. */
function found(...ids: readonly string[]): void {
  detectedAgents.value = ids.map((name) => ({ name, path: `/bin/${name}` }));
  agentsProbed.value = true;
}

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = "agents";
  found("claude", "codex");
  agentHooksSupported.value = true;
  probe.probeAgentsNow.mockClear();
});

afterEach(() => {
  detectedAgents.value = [];
  agentsProbed.value = false;
  agentHooksSupported.value = true;
  vi.restoreAllMocks();
});

const row = (id: string): HTMLElement => rowOf(`agent:${id}`) as HTMLElement;
const control = (id: string, label: string): HTMLElement =>
  row(id).querySelector(`[aria-label="${label}"]`) as HTMLElement;

async function configure(id: string, label: string): Promise<void> {
  await clickIn(control(id, `Configure ${label}`));
}

describe("the Agents area", () => {
  it("lists every built-in as a live row, then the pinned count, then the forms no row can draw", async () => {
    await open();
    for (const agent of BUILTIN_AGENTS) {
      expect(row(agent.id), agent.id).not.toBeNull();
      expect(control(agent.id, `${agent.label} availability`).getAttribute("role")).toBe("switch");
    }
    expect(rowOf("setting:quickAgentIds")?.textContent).toContain("pinned");
    // The legacy pieces stay reachable: add a command, add an agent, token usage.
    expect(document.querySelector('input[aria-label="Add command"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Add agent");
    expect(document.body.textContent).toContain("Token usage");
  });

  it("reads honestly before detection answers, and for an agent that is not on this machine", async () => {
    agentsProbed.value = false;
    detectedAgents.value = [];
    await open();
    expect(row("claude").textContent).toContain("Looking…");

    agentsProbed.value = true;
    await settle();
    expect(row("claude").textContent).toContain("Not installed");

    found("claude");
    await settle();
    expect(row("claude").textContent).not.toContain("Not installed");
    expect(row("codex").textContent).toContain("Not installed");
  });

  it("draws a declared agent as a row of its own, with a pin but no built-in-only controls", async () => {
    settings.value = { ...DEFAULT_SETTINGS, customAgents: [ASIDE] };
    await open();
    expect(row("custom:aider").textContent).toContain("Aider");
    expect(row("custom:aider").textContent).toContain("Not installed");

    await clickIn(control("custom:aider", "Aider availability"));
    expect(settings.value.disabledAgents).toEqual(["custom:aider"]);

    await configure("custom:aider", "Aider");
    expect(control("custom:aider", "Aider pinned")).not.toBeNull();
    expect(control("custom:aider", "Aider signals")).toBeNull();
    expect(document.querySelector('input[aria-label="Command for Aider"]')).toBeNull();
  });

  it("forces a full probe on Refresh", async () => {
    await open();
    await clickIn(document.querySelector('button[aria-label="Refresh installed agents"]'));
    expect(probe.probeAgentsNow).toHaveBeenCalledTimes(1);
  });
});

describe("an agent row", () => {
  it("turns an agent off and on, marks the change, and resets only that agent", async () => {
    settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["codex"] };
    await open();
    await clickIn(control("claude", "Claude Code availability"));
    expect(settings.value.disabledAgents).toEqual(["codex", "claude"]);
    expect(row("claude").textContent).toContain("Changed");
    expect(row("claude").textContent).toContain("Off");

    await clickIn(row("claude").querySelector("button[aria-label^='Reset']"));
    expect(settings.value.disabledAgents).toEqual(["codex"]);
    expect(row("claude").textContent).not.toContain("Changed");
    // codex was off before and is still off: another agent's edit is not this row's to undo.
    expect(row("codex").textContent).toContain("Changed");
  });

  it("puts the shipped launch command back, not just the mark", async () => {
    const plan = { id: "lp:plan", command: "claude --permission-mode plan" };
    settings.value = {
      ...DEFAULT_SETTINGS,
      launchProfiles: [plan],
      defaultLaunchProfiles: { claude: plan.id },
    };
    await open();
    expect(row("claude").textContent).toContain("--permission-mode plan");

    await clickIn(row("claude").querySelector("button[aria-label^='Reset']"));
    expect(row("claude").textContent).not.toContain("--permission-mode plan");
    expect(row("claude").textContent).not.toContain("Changed");
    expect(
      agentLaunchCommand(
        "claude",
        settings.value.launchProfiles,
        settings.value.defaultLaunchProfiles,
      ),
    ).toBe(agentLaunchCommand("claude", [], {}));
  });

  it("keeps the details out of the document until the row is opened", async () => {
    await open();
    expect(document.querySelector('input[aria-label="Command for Claude Code"]')).toBeNull();
    await configure("claude", "Claude Code");
    expect(control("claude", "Configure Claude Code").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('input[aria-label="Command for Claude Code"]')).not.toBeNull();
    await configure("claude", "Claude Code");
    expect(document.querySelector('input[aria-label="Command for Claude Code"]')).toBeNull();
  });

  it("sets the Signals switch with the revision, and the reset puts it back the same way", async () => {
    // A file saved under an older revision: a bare write of the switch would be read as unchosen.
    settings.value = { ...DEFAULT_SETTINGS, signalAdaptersRevision: 2 };
    await open();
    await configure("claude", "Claude Code");
    expect(control("claude", "Claude Code signals").getAttribute("aria-checked")).toBe("true");

    await clickIn(control("claude", "Claude Code signals"));
    expect(settings.value.agentSignalAdapters.claude).toBe(false);
    expect(settings.value.signalAdaptersRevision).toBe(SIGNAL_ADAPTERS_REVISION);

    settings.value = { ...settings.value, signalAdaptersRevision: 2 };
    await settle();
    await clickIn(row("claude").querySelector("button[aria-label^='Reset']"));
    expect(settings.value.agentSignalAdapters.claude).toBe(true);
    expect(settings.value.signalAdaptersRevision).toBe(SIGNAL_ADAPTERS_REVISION);
    expect(row("claude").textContent).not.toContain("Changed");
  });

  it("shows Signals unavailable where the host registers no hooks, and drops the press", async () => {
    agentHooksSupported.value = false;
    settings.value = { ...DEFAULT_SETTINGS };
    await open();
    await configure("claude", "Claude Code");
    const signals = control("claude", "Claude Code signals");
    expect(signals.getAttribute("aria-checked")).toBe("false");
    expect(signals.getAttribute("aria-disabled")).toBe("true");

    await clickIn(signals);
    expect(settings.value.agentSignalAdapters.claude).toBe(
      DEFAULT_SETTINGS.agentSignalAdapters.claude,
    );
    expect(settings.value.signalAdaptersRevision).toBe(DEFAULT_SETTINGS.signalAdaptersRevision);
  });

  it("offers no Signals switch to an agent no adapter exists for", async () => {
    await open();
    await configure("amp", "Amp");
    expect(control("amp", "Amp signals")).toBeNull();
  });

  it("pins and unpins through the quick-agent list, not by writing the ids itself", async () => {
    await open();
    await configure("codex", "Codex");
    expect(control("codex", "Codex pinned").getAttribute("aria-checked")).toBe("true");

    await clickIn(control("codex", "Codex pinned"));
    // Automatic (null) is materialized from the installed agents, minus the one dropped.
    expect(settings.value.quickAgentIds).toEqual(["claude"]);
    await clickIn(control("codex", "Codex pinned"));
    expect(settings.value.quickAgentIds).toEqual(["claude", "codex"]);
  });

  it("refuses to pin an agent that is not installed, and says why", async () => {
    await open();
    await configure("amp", "Amp");
    const pin = control("amp", "Amp pinned") as HTMLButtonElement;
    expect(pin.hasAttribute("disabled") || pin.getAttribute("data-disabled") !== null).toBe(true);
    expect(row("amp").textContent).toContain("Quick launch");
  });

  it("mounts the launch command editor in the open row", async () => {
    await open();
    await configure("claude", "Claude Code");
    expect(
      (document.querySelector('input[aria-label="Command for Claude Code"]') as HTMLInputElement)
        .value,
    ).toContain("claude");
  });
});

describe("the pinned count", () => {
  it("counts the pinned agents and resets to automatic", async () => {
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
    await open();
    expect(rowOf("setting:quickAgentIds")?.textContent).toContain("1 pinned");
    await clickIn(rowOf("setting:quickAgentIds")?.querySelector("button[aria-label^='Reset']"));
    expect(settings.value.quickAgentIds).toBeNull();
  });
});

describe("agents found from the search and the Changed list", () => {
  it("finds an agent by name as a live row", async () => {
    commandScope.value = null;
    await open();
    await typeInto(search(), "codex");
    expect(rowOf("agent:codex")).not.toBeNull();
    expect(activeRow()).toBe(rowOf("agent:codex"));
    expect(control("codex", "Codex availability")).not.toBeNull();

    await press(search(), { key: "Enter" });
    expect(document.activeElement).toBe(control("codex", "Codex availability"));
    expect(settings.value.disabledAgents).toEqual([]);
  });

  it("lists an edited agent in the Changed list, and the reset takes it out with focus kept", async () => {
    settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["claude"] };
    commandScope.value = null;
    await open();
    expect(rowLabels()).toEqual(["Claude Code"]);
    expect(rowOf("changed:agent:claude")?.textContent).toContain("Off");
    expect(rowOf("changed:agent:claude")?.textContent).toContain("Agents");

    const reset = rowOf("changed:agent:claude")?.querySelector<HTMLElement>(
      "button[aria-label^='Reset']",
    );
    reset?.focus();
    await clickIn(reset);
    expect(rowLabels()).toEqual([]);
    expect(document.activeElement).toBe(search());
  });
});
