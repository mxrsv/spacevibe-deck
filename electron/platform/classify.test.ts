/**
 * Translated from the `classify_process` tests in `src-tauri/src/info.rs`,
 * plus the `ps`-table cases the Node port needs because it reads the
 * foreground job from `ps` rather than from `tcgetpgrp`.
 */
import { describe, expect, it } from "vitest";
import { classifyProcess, normalizedProcessName } from "./classify";
import { argv0Name, foregroundProcess, parsePsTable } from "./macos";

describe("classifyProcess", () => {
  it("classifies a recognized agent process", () => {
    expect(classifyProcess("claude", true)).toEqual({
      kind: "agent",
      agent: "claude",
    });
  });

  it("classifies opencode from a macOS-style process path", () => {
    expect(classifyProcess("/opt/homebrew/bin/opencode", true)).toEqual({
      kind: "agent",
      agent: "opencode",
    });
  });

  it("classifies agy as an agent, not a busy process", () => {
    expect(classifyProcess("/Users/dev/.local/bin/agy", true)).toEqual({
      kind: "agent",
      agent: "agy",
    });
  });

  it("classifies idle, busy and incomplete processes", () => {
    expect(classifyProcess("zsh", true)).toEqual({
      kind: "idle-shell",
      agent: null,
    });
    expect(classifyProcess("/usr/bin/git", true)).toEqual({
      kind: "busy",
      agent: null,
    });
    expect(classifyProcess("CODEX.EXE", true)).toEqual({
      kind: "agent",
      agent: "codex",
    });
    expect(classifyProcess("claude", false)).toEqual({
      kind: "unknown",
      agent: null,
    });
    expect(classifyProcess(null, true)).toEqual({
      kind: "unknown",
      agent: null,
    });
  });
});

describe("normalizedProcessName", () => {
  it("strips a Windows executable suffix and lowercases", () => {
    expect(normalizedProcessName(String.raw`C:\bin\Claude.exe`)).toBe("claude");
  });

  it("returns null for an empty name", () => {
    expect(normalizedProcessName("   ")).toBe(null);
  });
});

describe("argv0Name", () => {
  it("takes the basename of a path argv0", () => {
    expect(argv0Name("/usr/local/bin/claude --resume")).toBe("claude");
  });

  it("strips the login-shell dash", () => {
    // Without this every idle pane would classify as Busy: a login shell
    // presents itself as `-zsh`.
    expect(argv0Name("-zsh")).toBe("zsh");
  });

  it("returns null for empty args", () => {
    expect(argv0Name("   ")).toBe(null);
  });
});

const TABLE = [
  "  501   501   501 ttys001 /bin/zsh -l",
  "  502   502   501 ttys001 sleep 60",
  "  610   610   777 ttys002 /bin/zsh -l",
  "  777   777   777 ttys002 claude",
  // A daemon with no controlling terminal: real macOS `ps` reports tpgid 0
  // here, never a dash — verified against 717 live rows.
  "  900   900     0 ??      /usr/libexec/some-daemon",
].join("\n");

describe("parsePsTable", () => {
  it("parses rows and skips unparseable lines", () => {
    const rows = parsePsTable(`${TABLE}\ngarbage line`);

    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      pid: 501,
      pgid: 501,
      tpgid: 501,
      tty: "ttys001",
      args: "/bin/zsh -l",
    });
  });
});

describe("foregroundProcess", () => {
  const rows = parsePsTable(TABLE);

  it("finds the foreground job through tpgid", () => {
    expect(foregroundProcess(rows, "ttys002", 610)).toEqual({
      pid: 777,
      name: "claude",
    });
  });

  it("reports the shell itself when it is in the foreground", () => {
    expect(foregroundProcess(rows, "ttys001", 501)).toEqual({
      pid: 501,
      name: "zsh",
    });
  });

  it("returns null when the tty is missing from the table", () => {
    // Degrades to Unknown rather than guessing — a wrong Busy blocks quit.
    expect(foregroundProcess(rows, "ttys099", 501)).toBe(null);
  });

  it("returns null when the shell pid is not on that tty", () => {
    expect(foregroundProcess(rows, "ttys001", 9999)).toBe(null);
  });
});
