// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { QuickAgentsSection } from "./quick-agents-section";

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
});

function mount() {
  act(() => render(<QuickAgentsSection />, host));
}
function button(label: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
}
function click(label: string) {
  act(() => button(label).click());
}

describe("QuickAgentsSection", () => {
  it("limits the automatic selection to five and allows swapping the sixth in", () => {
    // Five built-ins ship, so an installed declared agent is the sixth.
    const sixth = { id: "custom:aider", label: "Aider", command: "aider" };
    settings.value = { ...DEFAULT_SETTINGS, customAgents: [sixth] };
    detectedAgents.value = [...detectedAgents.value, { name: "aider", path: "/bin/aider" }];
    mount();
    expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(5);
    expect(button(sixth.label).disabled).toBe(true);
    click(BUILTIN_AGENTS[0].label);
    expect(button(sixth.label).disabled).toBe(false);
    click(sixth.label);
    expect(settings.value.quickAgentIds).toEqual([
      ...BUILTIN_AGENTS.slice(1, 5).map((agent) => agent.id),
      sixth.id,
    ]);
    expect(button(BUILTIN_AGENTS[0].label).disabled).toBe(true);
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
    expect(button("Claude Code").disabled).toBe(false);
    click("Claude Code");
    expect(settings.value.quickAgentIds).toEqual([]);
    expect(button("Claude Code").disabled).toBe(true);
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
