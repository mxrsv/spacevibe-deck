import { describe, expect, it } from "vitest";
import { runtimeFor } from "../../launcher/runtime-catalog";
import { AGENT_PAYLOAD_KEYS } from "../../telemetry/payload";
import { BUILTIN_AGENTS } from "../agent-catalog";
import { AGENT_LOGOS } from "../agent-logos";
import { buildResumeCommand } from "../agent-resume";
import { launchFlagsFor } from "../launch-flags";
import { dotColor } from "../process-info";
import { ACTIVE_AGENT_IDS, AGENT_DEFINITIONS } from "./agent-registry";

const KNOWN_IDS = AGENT_DEFINITIONS.map((agent) => agent.id);

describe("agent registry", () => {
  it("keeps every id unique and equal to the binary it launches", () => {
    expect(new Set(KNOWN_IDS).size).toBe(KNOWN_IDS.length);
    for (const agent of AGENT_DEFINITIONS) {
      expect((agent.defaultCommand ?? agent.id).split(" ")[0]).toBe(agent.id);
      expect(agent.resume.bare).toBe(agent.id);
    }
  });

  it("keeps the active order, which is the digit-key contract", () => {
    expect(ACTIVE_AGENT_IDS).toEqual(["claude", "codex", "opencode", "agy", "gemini"]);
    expect(BUILTIN_AGENTS.map((agent) => agent.id)).toEqual(ACTIVE_AGENT_IDS);
  });

  it("reaches every derived table for an active agent", () => {
    for (const agent of AGENT_DEFINITIONS.filter((entry) => entry.withdrawn !== true)) {
      expect(runtimeFor(agent.id)?.modelFlag).toBe(agent.runtime.modelFlag);
      expect(launchFlagsFor(agent.id)).toBe(agent.launchFlags);
      expect(buildResumeCommand(agent.id, null, [])).toBe(agent.resume.bare);
      if (agent.dotColor !== undefined) {
        expect(dotColor(agent.id)).toBe(agent.dotColor);
      }
    }
  });

  it("switches a withdrawn agent off in every derived table", () => {
    const withdrawn = AGENT_DEFINITIONS.filter((agent) => agent.withdrawn === true);
    expect(withdrawn.map((agent) => agent.id)).toEqual(["cursor-agent"]);
    for (const agent of withdrawn) {
      expect(ACTIVE_AGENT_IDS).not.toContain(agent.id);
      expect(runtimeFor(agent.id)).toBeNull();
      expect(launchFlagsFor(agent.id)).toEqual([]);
      expect(buildResumeCommand(agent.id, { kind: "latest" }, [])).toBeNull();
    }
  });

  it("answers nothing for an id that only names an inherited property", () => {
    expect(launchFlagsFor("constructor")).toEqual([]);
    expect(buildResumeCommand("constructor", null, [])).toBeNull();
  });

  it("lets logos and telemetry keys name only agents the registry knows", () => {
    for (const id of Object.keys(AGENT_LOGOS)) {
      expect(KNOWN_IDS).toContain(id);
    }
    for (const key of AGENT_PAYLOAD_KEYS) {
      if (key !== "custom") {
        expect(KNOWN_IDS).toContain(key);
      }
    }
  });
});
