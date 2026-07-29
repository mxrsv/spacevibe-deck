import { describe, expect, it } from "vitest";
import { dotColor, isAgent, paneHeaderInfo, tildify } from "./process-info";

describe("dotColor", () => {
  it("maps known agents to their theme color vars", () => {
    expect(dotColor("claude")).toBe("var(--magenta)");
    expect(dotColor("codex")).toBe("var(--green)");
    expect(dotColor("gemini")).toBe("var(--cyan)");
  });

  it("falls back to the faint tone for anything else", () => {
    expect(dotColor("zsh")).toBe("var(--text-faint)");
    expect(dotColor(null)).toBe("var(--text-faint)");
    expect(dotColor("toString")).toBe("var(--text-faint)");
  });
});

describe("isAgent", () => {
  it("only recognizes the known agent names", () => {
    expect(isAgent("claude")).toBe(true);
    expect(isAgent("zsh")).toBe(false);
    expect(isAgent(null)).toBe(false);
  });
});

describe("tildify", () => {
  it("shortens paths under home", () => {
    expect(tildify("/Users/kai/dev/app", "/Users/kai")).toBe("~/dev/app");
    expect(tildify("/Users/kai", "/Users/kai")).toBe("~");
  });

  it("tolerates a trailing slash on home", () => {
    expect(tildify("/Users/kai/dev", "/Users/kai/")).toBe("~/dev");
  });

  it("leaves foreign paths and empty home untouched", () => {
    expect(tildify("/opt/tools", "/Users/kai")).toBe("/opt/tools");
    expect(tildify("/Users/kaiser/x", "/Users/kai")).toBe("/Users/kaiser/x");
    expect(tildify("/opt/tools", "")).toBe("/opt/tools");
  });

  it("shortens Windows drive and UNC homes case-insensitively", () => {
    expect(tildify("c:\\USERS\\Kai\\Repo", "C:\\Users\\kai")).toBe(
      "~\\Repo",
    );
    expect(
      tildify("\\\\SERVER\\Share\\Kai\\Repo", "\\\\server\\share\\kai"),
    ).toBe("~\\Repo");
    expect(tildify("C:\\Users\\Kaiser", "C:\\Users\\Kai")).toBe(
      "C:\\Users\\Kaiser",
    );
  });
});

describe("paneHeaderInfo", () => {
  it("builds agent header info", () => {
    expect(
      paneHeaderInfo(
        {
          id: 1,
          cwd: "/Users/kai/dev",
          process: "node",
          kind: "agent",
          agent: "codex",
        },
        "/Users/kai",
      ),
    ).toEqual({
      dotColor: "var(--green)",
      cwd: "~/dev",
      badge: "codex",
      agent: true,
    });
  });

  it("renders unknown without fabricating a shell", () => {
    expect(
      paneHeaderInfo(
        {
          id: 1,
          cwd: null,
          process: null,
          kind: "unknown",
          agent: null,
        },
        "/Users/kai",
      ),
    ).toEqual({
      dotColor: "var(--text-faint)",
      cwd: "",
      badge: "unknown",
      agent: false,
    });
  });

  it("renders idle-shell and busy states without agent styling", () => {
    expect(
      paneHeaderInfo(
        {
          id: 1,
          cwd: "",
          process: null,
          kind: "idle-shell",
          agent: null,
        },
        "",
      ),
    ).toMatchObject({ badge: "shell", agent: false });
    expect(
      paneHeaderInfo(
        {
          id: 2,
          cwd: null,
          process: "node",
          kind: "busy",
          agent: null,
        },
        "",
      ),
    ).toMatchObject({
      dotColor: "var(--text-faint)",
      badge: "node",
      agent: false,
    });
  });
});
