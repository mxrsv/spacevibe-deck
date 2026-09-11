import { describe, expect, it } from "vitest";
import { agentOptions, BUILTIN_AGENTS } from "../lib/agent-catalog";
import { quickAgentOptions } from "./quick-agents";
import { validateSettings } from "./settings-schema";

const detected = BUILTIN_AGENTS.map((agent) => ({ name: agent.id, path: `/bin/${agent.id}` }));

describe("quick agents", () => {
  it("uses at most five available agents for older settings", () => {
    const settings = validateSettings({});
    expect(settings.quickAgentIds).toBeNull();
    const options = agentOptions(detected, [], [BUILTIN_AGENTS[0].id]);
    expect(quickAgentOptions(options, settings.quickAgentIds).map((agent) => agent.id)).toEqual(
      BUILTIN_AGENTS.slice(1, 6).map((agent) => agent.id),
    );
  });

  it("preserves an explicit empty selection after settings serialization", () => {
    const settings = validateSettings(JSON.parse(JSON.stringify({ quickAgentIds: [] })));
    expect(quickAgentOptions(agentOptions(detected, []), settings.quickAgentIds)).toEqual([]);
  });

  it("drops invalid and duplicate entries and caps persisted picks at five", () => {
    const settings = validateSettings({
      quickAgentIds: [
        null,
        "",
        " ",
        "claude",
        "claude",
        3,
        "codex",
        "opencode",
        "agy",
        "gemini",
        "cursor-agent",
      ],
    });
    expect(settings.quickAgentIds).toEqual(["claude", "codex", "opencode", "agy", "gemini"]);
    expect(validateSettings({ quickAgentIds: "claude" }).quickAgentIds).toBeNull();
  });

  it("keeps saved order and never backfills missing, disabled or removed picks", () => {
    const options = agentOptions(
      detected.filter((agent) => agent.name !== "claude"),
      [],
      ["codex"],
    );
    expect(
      quickAgentOptions(options, ["gemini", "claude", "codex", "custom:removed", "opencode"]).map(
        (agent) => agent.id,
      ),
    ).toEqual(["gemini", "opencode"]);
  });

  it("offers installed custom agents but excludes missing custom commands", () => {
    const custom = [{ id: "custom:aider", label: "Aider", command: "aider" }];
    expect(quickAgentOptions(agentOptions(detected, custom), ["custom:aider"])).toEqual([]);
    const options = agentOptions([...detected, { name: "aider", path: "/bin/aider" }], custom);
    expect(quickAgentOptions(options, ["custom:aider"])[0]?.id).toBe("custom:aider");
  });
});
