import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY } from "./settings-registry";
import {
  agentChanged,
  agentEntryChanged,
  agentResetPatch,
  FONT_SIZE_STEPPER,
  SETTING_CONTROLS,
  scrollbackLabel,
  settingRow,
} from "./settings-rows";
import { DEFAULT_SETTINGS, SCROLLBACK_CHOICES, type Settings } from "./settings-schema";
import { SIGNAL_ADAPTERS_REVISION } from "./signal-adapter-choice";

describe("SETTING_CONTROLS", () => {
  it("gives a control to exactly the keys a Settings page shows", () => {
    for (const key of Object.keys(SETTINGS_REGISTRY) as (keyof Settings)[]) {
      expect(SETTING_CONTROLS[key].kind === "none", key).toBe(SETTINGS_REGISTRY[key].page === null);
    }
  });

  it("offers every scrollback size the schema allows, by its label", () => {
    const control = SETTING_CONTROLS.scrollback;
    expect(control.kind === "choice" ? control.choices : []).toEqual(
      SCROLLBACK_CHOICES.map((lines) => ({ value: lines, label: scrollbackLabel(lines) })),
    );
    expect(scrollbackLabel(10_000)).toBe("10k lines");
    expect(scrollbackLabel(500)).toBe("500 lines");
  });
});

describe("settingRow", () => {
  it("reads a preference's value, default, mark and reset target", () => {
    expect(settingRow("fontSize", { ...DEFAULT_SETTINGS, fontSize: 15 })).toEqual({
      key: "fontSize",
      label: "Font size",
      page: "appearance",
      control: FONT_SIZE_STEPPER,
      value: 15,
      fallback: 13,
      changed: true,
      resetKeys: ["fontSize"],
    });
    expect(settingRow("fontSize", DEFAULT_SETTINGS).changed).toBe(false);
  });

  it("gives data, layout and state keys no mark and no reset of their own", () => {
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
      sidebarWidth: 300,
      githubStarred: true,
    };
    for (const key of ["customAgents", "sidebarWidth", "githubStarred"] as const) {
      const row = settingRow(key, current);
      expect(row.value).not.toEqual(row.fallback);
      expect(row.changed, key).toBe(false);
      expect(row.resetKeys, key).toBeNull();
    }
  });
});

describe("agentEntryChanged", () => {
  it("marks only the agent whose own entry differs", () => {
    const current: Settings = { ...DEFAULT_SETTINGS, disabledAgents: ["codex"] };
    expect(agentEntryChanged("codex", current)).toBe(true);
    expect(agentEntryChanged("claude", current)).toBe(false);
  });

  it("marks an agent whose signal adapter or default launch profile changed", () => {
    const adapters = DEFAULT_SETTINGS.agentSignalAdapters;
    const flipped: Settings = {
      ...DEFAULT_SETTINGS,
      agentSignalAdapters: { ...adapters, claude: !adapters.claude },
    };
    expect(agentEntryChanged("claude", flipped)).toBe(true);
    expect(agentEntryChanged("codex", flipped)).toBe(false);

    const profiled: Settings = { ...DEFAULT_SETTINGS, defaultLaunchProfiles: { claude: "fast" } };
    expect(agentEntryChanged("claude", profiled)).toBe(true);
    expect(agentEntryChanged("codex", profiled)).toBe(false);
  });
});

describe("an agent's own changes", () => {
  const edited: Settings = {
    ...DEFAULT_SETTINGS,
    disabledAgents: ["claude", "codex"],
    agentSignalAdapters: { ...DEFAULT_SETTINGS.agentSignalAdapters, claude: false },
    defaultLaunchProfiles: { claude: "plan", codex: "fast" },
    launchProfiles: [{ id: "plan", command: "claude --plan" }],
    agentRuntimeDefaults: {
      claude: { model: "opus", effort: null },
      codex: { model: "x", effort: null },
    },
    agentModels: { claude: ["extra"] },
    quickAgentIds: ["claude"],
  };

  it("counts the on/off, the Signals switch, the starred command and the model default", () => {
    expect(agentChanged("claude", DEFAULT_SETTINGS)).toBe(false);
    expect(agentChanged("claude", edited)).toBe(true);
    for (const patch of [
      { disabledAgents: ["opencode"] },
      { defaultLaunchProfiles: { opencode: "x" } },
      { agentRuntimeDefaults: { opencode: { model: "m", effort: null } } },
    ] satisfies Partial<Settings>[]) {
      expect(agentChanged("opencode", { ...DEFAULT_SETTINGS, ...patch })).toBe(true);
    }
    expect(agentChanged("claude", { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] })).toBe(false);
  });

  it("is undone by its reset patch, for that agent only", () => {
    const after = { ...edited, ...agentResetPatch("claude", edited) };
    expect(agentChanged("claude", after)).toBe(false);
    // Another agent's edits, and the user's data, are not touched.
    expect(agentChanged("codex", after)).toBe(true);
    expect(after.disabledAgents).toEqual(["codex"]);
    expect(after.defaultLaunchProfiles).toEqual({ codex: "fast" });
    expect(after.agentRuntimeDefaults).toEqual({ codex: { model: "x", effort: null } });
    // The starred command goes with its star (the Reset command button's own patch); the models stay.
    expect(after.launchProfiles).toEqual([]);
    expect(after.agentModels).toEqual(edited.agentModels);
    expect(after.quickAgentIds).toEqual(["claude"]);
  });

  it("keeps another command of the agent's, and every saved command when only the switch changed", () => {
    const saved: Settings = {
      ...DEFAULT_SETTINGS,
      disabledAgents: ["claude"],
      launchProfiles: [{ id: "plan", command: "claude --plan" }],
    };
    expect(agentResetPatch("claude", saved)).not.toHaveProperty("launchProfiles");
  });

  it("puts the Signals switch back with the revision, so the next load reads it as chosen", () => {
    const patch = agentResetPatch("claude", edited);
    expect(patch.agentSignalAdapters?.claude).toBe(DEFAULT_SETTINGS.agentSignalAdapters.claude);
    expect(patch.signalAdaptersRevision).toBe(SIGNAL_ADAPTERS_REVISION);
  });

  it("leaves the adapters alone for an agent that has none", () => {
    const patch = agentResetPatch("custom:aider", {
      ...edited,
      disabledAgents: [...edited.disabledAgents, "custom:aider"],
    });
    expect(patch).not.toHaveProperty("agentSignalAdapters");
    expect(patch.disabledAgents).toEqual(["claude", "codex"]);
  });
});
