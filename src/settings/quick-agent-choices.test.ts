import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import { quickAgentChoices, toggleQuickAgent } from "./quick-agent-choices";
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
  it("lists every built-in and pins them all by default", () => {
    const choices = quickAgentChoices();
    expect(choices.map((entry) => entry.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id));
    expect(choices.every((entry) => entry.pinned)).toBe(true);
  });

  it("explains why an agent cannot be pinned", () => {
    detectedAgents.value = detectedAgents.value.filter((agent) => agent.name !== "droid");
    expect(choice("droid")).toMatchObject({ blocked: "Not installed", toggleable: false });
    expect(choice(BUILTIN_AGENTS[0].id)).toMatchObject({ blocked: null, toggleable: true });
  });

  it("unpins and re-pins an agent and persists the list", () => {
    const [first, ...rest] = BUILTIN_AGENTS.map((agent) => agent.id);
    toggleQuickAgent(first);
    expect(settings.value.quickAgentIds).toEqual(rest);
    toggleQuickAgent(first);
    expect(settings.value.quickAgentIds).toEqual([...rest, first]);
  });
});
