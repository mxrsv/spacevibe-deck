import { describe, expect, it } from "vitest";
import {
  createLaunchProfileId,
  findLaunchProfile,
  hasLaunchProfiles,
  isLaunchOptionToken,
  profileNameProblem,
  profilesForAgent,
  validateDefaultLaunchProfiles,
  validateLaunchProfiles,
  type LaunchProfile,
} from "./launch-profile";

const claudePlan: LaunchProfile = {
  id: "lp:plan",
  name: "Plan",
  options: { kind: "claude", model: null, permissionMode: "plan" },
};

const codexReadOnly: LaunchProfile = {
  id: "lp:read-only",
  name: "Read only",
  options: {
    kind: "codex",
    model: null,
    sandbox: "read-only",
    approval: "on-request",
    bypass: false,
  },
};

describe("hasLaunchProfiles", () => {
  it("accepts the four modelled agents and refuses the rest", () => {
    expect(hasLaunchProfiles("claude")).toBe(true);
    expect(hasLaunchProfiles("codex")).toBe(true);
    expect(hasLaunchProfiles("opencode")).toBe(true);
    expect(hasLaunchProfiles("cursor-agent")).toBe(true);
    // Neither has public flags this repo models; both still launch bare.
    expect(hasLaunchProfiles("gemini")).toBe(false);
    expect(hasLaunchProfiles("agy")).toBe(false);
    expect(hasLaunchProfiles("custom:review")).toBe(false);
  });
});

describe("cursor-agent options", () => {
  it("validates a full cursor profile", () => {
    const profile = {
      id: "lp:cursor",
      name: "Cursor plan",
      options: {
        kind: "cursor-agent",
        model: "gpt-5",
        mode: "plan",
        force: false,
      },
    };
    expect(validateLaunchProfiles([profile])).toEqual([profile]);
  });

  it("drops an unknown mode and a non-boolean force", () => {
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: {
            kind: "cursor-agent",
            model: null,
            mode: "yolo",
            force: false,
          },
        },
      ]),
    ).toEqual([]);
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: {
            kind: "cursor-agent",
            model: null,
            mode: null,
            force: "yes",
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe("codex bypass", () => {
  it("validates the boolean and refuses a non-boolean", () => {
    const options = {
      kind: "codex",
      model: null,
      sandbox: null,
      approval: null,
      bypass: true,
    };
    expect(
      validateLaunchProfiles([{ id: "lp:b", name: "B", options }]),
    ).toEqual([{ id: "lp:b", name: "B", options }]);
    expect(
      validateLaunchProfiles([
        { id: "lp:b", name: "B", options: { ...options, bypass: "yes" } },
      ]),
    ).toEqual([]);
  });

  // A file written before the field existed must keep working: absent reads as
  // off, which is the behaviour every stored codex profile already had.
  it("reads an older codex profile as bypass off", () => {
    expect(
      validateLaunchProfiles([
        {
          id: "lp:old",
          name: "Old",
          options: {
            kind: "codex",
            model: null,
            sandbox: "read-only",
            approval: null,
          },
        },
      ]),
    ).toEqual([
      {
        id: "lp:old",
        name: "Old",
        options: {
          kind: "codex",
          model: null,
          sandbox: "read-only",
          approval: null,
          bypass: false,
        },
      },
    ]);
  });
});

describe("isLaunchOptionToken", () => {
  it("accepts a model alias and a provider-qualified model", () => {
    expect(isLaunchOptionToken("opus")).toBe(true);
    expect(isLaunchOptionToken("anthropic/claude-opus-5")).toBe(true);
  });

  it("refuses anything a shell would act on", () => {
    expect(isLaunchOptionToken("opus; rm -rf /")).toBe(false);
    expect(isLaunchOptionToken("$(whoami)")).toBe(false);
    expect(isLaunchOptionToken("a b")).toBe(false);
    expect(isLaunchOptionToken("")).toBe(false);
    expect(isLaunchOptionToken("x".repeat(65))).toBe(false);
    expect(isLaunchOptionToken(7)).toBe(false);
  });
});

describe("createLaunchProfileId", () => {
  it("mints a prefixed slug and never collides", () => {
    expect(createLaunchProfileId("Plan mode", [])).toBe("lp:plan-mode");
    expect(
      createLaunchProfileId("Plan mode", [
        { ...claudePlan, id: "lp:plan-mode" },
      ]),
    ).toBe("lp:plan-mode-2");
  });
});

describe("profileNameProblem", () => {
  it("refuses an empty, over-long or duplicate name", () => {
    expect(profileNameProblem("", [])).not.toBeNull();
    expect(profileNameProblem("x".repeat(33), [])).not.toBeNull();
    expect(profileNameProblem("Plan", [claudePlan])).not.toBeNull();
    expect(profileNameProblem("Plan", [])).toBeNull();
  });
});

describe("profilesForAgent", () => {
  it("selects by the options' kind", () => {
    const all = [claudePlan, codexReadOnly];
    expect(profilesForAgent("claude", all)).toEqual([claudePlan]);
    expect(profilesForAgent("gemini", all)).toEqual([]);
  });
});

describe("findLaunchProfile", () => {
  it("answers null for a null id and for an unknown id", () => {
    expect(findLaunchProfile(null, [claudePlan])).toBeNull();
    expect(findLaunchProfile("lp:gone", [claudePlan])).toBeNull();
    expect(findLaunchProfile("lp:plan", [claudePlan])).toEqual(claudePlan);
  });
});

describe("validateLaunchProfiles", () => {
  it("keeps a well-formed profile", () => {
    expect(validateLaunchProfiles([claudePlan])).toEqual([claudePlan]);
  });

  it("drops a profile rather than repairing it", () => {
    expect(validateLaunchProfiles("nope")).toEqual([]);
    expect(validateLaunchProfiles([{ id: "lp:x", name: "X" }])).toEqual([]);
    expect(
      validateLaunchProfiles([
        { id: "lp:x", name: "X", options: { kind: "gemini" } },
      ]),
    ).toEqual([]);
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: { kind: "claude", model: null, permissionMode: "nonsense" },
        },
      ]),
    ).toEqual([]);
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: { kind: "claude", model: "a b", permissionMode: null },
        },
      ]),
    ).toEqual([]);
  });

  it("drops a duplicate id, first wins", () => {
    const second: LaunchProfile = { ...claudePlan, name: "Other" };
    expect(validateLaunchProfiles([claudePlan, second])).toEqual([claudePlan]);
  });
});

describe("validateDefaultLaunchProfiles", () => {
  it("keeps a mapping that points at a profile of that agent", () => {
    expect(
      validateDefaultLaunchProfiles({ claude: "lp:plan" }, [claudePlan]),
    ).toEqual({ claude: "lp:plan" });
  });

  it("drops a dangling id and a cross-agent mapping", () => {
    expect(
      validateDefaultLaunchProfiles({ claude: "lp:gone" }, [claudePlan]),
    ).toEqual({});
    expect(
      validateDefaultLaunchProfiles({ codex: "lp:plan" }, [claudePlan]),
    ).toEqual({});
    expect(validateDefaultLaunchProfiles(null, [claudePlan])).toEqual({});
  });
});
