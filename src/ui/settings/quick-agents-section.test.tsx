// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentInstallHost,
  resetAgentInstallForTests,
} from "../../launcher/agent-install-store";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { QuickAgentsSection } from "./quick-agents-section";

// Track B's real commands are not the subject here: `amp` has one, every other agent has none.
vi.mock("../../lib/agent-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/agent-catalog")>();
  const amp = {
    macos: { command: "amp-installer", source: "https://example.test", checked: "2026-10-10" },
    windows: null,
  };
  return {
    ...actual,
    BUILTIN_AGENTS: actual.BUILTIN_AGENTS.map((agent) => ({
      ...agent,
      install: agent.id === "amp" ? amp : { macos: null, windows: null },
    })),
  };
});

let host: HTMLDivElement;
beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = BUILTIN_AGENTS.map((agent) => ({
    name: agent.id,
    path: `/bin/${agent.id}`,
  }));
  agentsProbed.value = true;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = false;
  resetAgentInstallForTests();
  resetDesktopEnvironmentForTests();
});

function mount() {
  act(() => render(<QuickAgentsSection />, host));
}
function button(label: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)!;
}
function click(label: string) {
  act(() => button(label).click());
}

describe("QuickAgentsSection", () => {
  it("pins every available agent by default, with no cap, and lets one be dropped", () => {
    const extra = { id: "custom:aider", label: "Aider", command: "aider" };
    settings.value = { ...DEFAULT_SETTINGS, customAgents: [extra] };
    detectedAgents.value = [...detectedAgents.value, { name: "aider", path: "/bin/aider" }];
    mount();
    const total = BUILTIN_AGENTS.length + 1;
    expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(total);
    expect(button(extra.label).getAttribute("aria-disabled")).not.toBe("true");
    click(BUILTIN_AGENTS[0].label);
    expect(settings.value.quickAgentIds).toEqual([
      ...BUILTIN_AGENTS.slice(1).map((agent) => agent.id),
      extra.id,
    ]);
  });

  it("remembers an empty selection across remounts", () => {
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
    mount();
    click("Claude Code");
    act(() => render(null, host));
    mount();
    expect(settings.value.quickAgentIds).toEqual([]);
    expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
  });

  it("allows deselecting an unavailable saved agent without silently replacing it", () => {
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"], disabledAgents: ["claude"] };
    mount();
    expect(button("Claude Code").getAttribute("aria-checked")).toBe("true");
    expect(button("Claude Code").getAttribute("aria-disabled")).not.toBe("true");
    click("Claude Code");
    expect(settings.value.quickAgentIds).toEqual([]);
    expect(button("Claude Code").getAttribute("aria-disabled")).toBe("true");
  });

  it("waits for discovery before persisting automatic picks", () => {
    detectedAgents.value = [];
    agentsProbed.value = false;
    mount();
    click("Claude Code");
    expect(settings.value.quickAgentIds).toBeNull();
    act(() => {
      detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
      agentsProbed.value = true;
    });
    expect(button("Claude Code").getAttribute("aria-checked")).toBe("true");
  });

  it("allows selecting an installed custom agent", () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      quickAgentIds: [],
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    };
    detectedAgents.value = [{ name: "aider", path: "/bin/aider" }];
    mount();
    click("Aider");
    expect(settings.value.quickAgentIds).toEqual(["custom:aider"]);
  });
});

describe("QuickAgentsSection install control", () => {
  const spawned = {
    kind: "spawned",
    receipt: { tabKey: 1, paneId: 2, canFocus: () => false },
  } as const;
  const open = vi.fn();

  beforeEach(() => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    open.mockReset();
    open.mockResolvedValue(spawned);
    detectedAgents.value = detectedAgents.value.filter((agent) => agent.name !== "amp");
  });

  const ampRow = () =>
    [...host.querySelectorAll(".cfg-row")].find((row) => row.textContent?.includes("Amp"))!;

  it("replaces Not installed with Install in the key column and leaves the switch alone", () => {
    registerAgentInstallHost({ open, focus: vi.fn() });
    mount();
    const install = ampRow().querySelector<HTMLButtonElement>(".cfg-row__key button")!;
    expect(install.textContent).toBe("Install");
    expect(ampRow().textContent).not.toContain("Not installed");
    expect(button("Amp").getAttribute("aria-disabled")).toBe("true");
    act(() => install.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("amp", "amp-installer");
    expect(button("Amp").getAttribute("aria-checked")).toBe("false");
    expect(button("Amp").getAttribute("aria-disabled")).toBe("true");
    expect(settings.value.quickAgentIds).toBeNull();
    expect(ampRow().querySelectorAll('.cfg-row__value [role="switch"]')).toHaveLength(1);
  });

  it("keeps the Not installed description when the host cannot install", () => {
    mount();
    expect(ampRow().textContent).toContain("Not installed");
    expect(ampRow().querySelector(".cfg-row__note")).toBeNull();
  });
});
