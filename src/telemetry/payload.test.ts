/**
 * The privacy contract, executable (spec §11): this suite pins the EXACT
 * field list and the closed agent key set. If a change here is needed, the
 * spec, the current privacy page and the versioned notice archive must change
 * in the same release — that is what this red test is for.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import {
  AGENT_PAYLOAD_KEYS,
  SCHEMA_VERSION,
  SURFACE_KEYS,
  agentPayloadKey,
  type UsagePayload,
} from "./payload";

/** A payload built the only way one should be: every field, nothing else. */
const SPECIMEN: UsagePayload = {
  schemaVersion: SCHEMA_VERSION,
  dailyId: "00000000-0000-4000-8000-000000000000",
  day: "2026-08-22",
  version: "1.0.1",
  platform: "darwin",
  arch: "arm64",
  agents: { claude: 12, codex: 3 },
  surfaces: { browser: 1, explorer: 4, usage: 0 },
  maxTabs: 4,
  maxPanes: 6,
  restoredSessions: true,
};

describe("usage payload contract", () => {
  it("pins the exact top-level field list", () => {
    expect(Object.keys(SPECIMEN).sort()).toEqual(
      [
        "schemaVersion",
        "dailyId",
        "day",
        "version",
        "platform",
        "arch",
        "agents",
        "surfaces",
        "maxTabs",
        "maxPanes",
        "restoredSessions",
      ].sort(),
    );
  });

  it("pins the closed agent key set to the six built-ins plus custom", () => {
    const builtinIds = BUILTIN_AGENTS.map((agent) => agent.id);
    expect([...AGENT_PAYLOAD_KEYS].sort()).toEqual([...builtinIds, "custom"].sort());
  });

  it("pins the surface key set", () => {
    expect([...SURFACE_KEYS]).toEqual(["browser", "explorer", "usage"]);
  });

  it("folds every non-built-in agent id into the custom bucket", () => {
    expect(agentPayloadKey("claude")).toBe("claude");
    expect(agentPayloadKey("cursor-agent")).toBe("cursor-agent");
    expect(agentPayloadKey("custom:acme-internal-tool")).toBe("custom");
    expect(agentPayloadKey("acme-internal-tool")).toBe("custom");
    expect(agentPayloadKey("")).toBe("custom");
  });

  it("schema version is 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
