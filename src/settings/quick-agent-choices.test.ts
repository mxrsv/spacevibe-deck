import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import { quickAgentChoices, toggleQuickAgent } from "./quick-agent-choices";
import { MAX_QUICK_AGENTS } from "./quick-agents";
import { DEFAULT_SETTINGS } from "./settings-schema";
import { settings } from "./settings-store";

const choice = (id: string) => quickAgentChoices().find((candidate) => candidate.id === id)!;

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = BUILTIN_AGENTS.map((agent) => ({
    name: agent.id,
    path: `/bin/${agent.id}`,
  }));
  agentsProbed.value = true;
});
afterEach(() => {
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = false;
});

describe("quickAgentChoices", () => {
  it("lists every built-in and pins the first five by default", () => {
    const choices = quickAgentChoices();
    expect(choices.map((entry) => entry.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id));
    expect(choices.filter((entry) => entry.pinned)).toHaveLength(MAX_QUICK_AGENTS);
    expect(choices.slice(0, MAX_QUICK_AGENTS).every((entry) => entry.pinned)).toBe(true);
  });

  it("explains why an agent cannot be pinned", () => {
    detectedAgents.value = detectedAgents.value.filter((agent) => agent.name !== "droid");
    expect(choice("droid")).toMatchObject({ blocked: "Not installed", toggleable: false });
    const unpinned = BUILTIN_AGENTS[MAX_QUICK_AGENTS].id;
    expect(choice(unpinned)).toMatchObject({
      blocked: "Deselect an agent to add this one",
      toggleable: false,
    });
    expect(choice(BUILTIN_AGENTS[0].id)).toMatchObject({ blocked: null, toggleable: true });
  });

  it("swaps one pick for another and persists the list", () => {
    const first = BUILTIN_AGENTS[0].id;
    const sixth = BUILTIN_AGENTS[MAX_QUICK_AGENTS].id;
    toggleQuickAgent(sixth);
    expect(settings.value.quickAgentIds).toBeNull();
    toggleQuickAgent(first);
    toggleQuickAgent(sixth);
    expect(settings.value.quickAgentIds).toEqual([
      ...BUILTIN_AGENTS.slice(1, MAX_QUICK_AGENTS).map((agent) => agent.id),
      sixth,
    ]);
  });
});
