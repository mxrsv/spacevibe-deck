import { describe, expect, it, vi } from "vitest";
import { resumeFromRef, resumeRememberedPane, resumeSession } from "./resume-session";
import { restoreSession, type RestoreDeps } from "../terminal/session-restore";
import type { ResumeRef, ResumeRequest } from "../lib/agent-resume";
import type { RememberedPane, WindowRecord } from "../lib/session-schema";
import type { SessionEntry } from "../lib/session-history";
import type { MaterializeIntent } from "../terminal/tab-materialize";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "8f0f0e2c-1111-2222-3333-444455556666",
    cwd: "/work/repo",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

function deps(over: Partial<Parameters<typeof resumeSession>[1]> = {}) {
  return {
    materialize: vi.fn<(intent: MaterializeIntent) => Promise<boolean>>().mockResolvedValue(true),
    customAgents: [],
    isDead: () => false,
    ...over,
  };
}

describe("resumeSession", () => {
  it("materializes one pane in the session's own cwd with its resume command", async () => {
    const d = deps();
    await expect(resumeSession(entry(), d)).resolves.toBe(true);
    const intent = vi.mocked(d.materialize).mock.calls[0][0];
    expect(intent.cwds).toEqual(["/work/repo"]);
    expect(intent.paneCommands).toEqual(["claude --resume 8f0f0e2c-1111-2222-3333-444455556666"]);
    expect(intent.workspacePath).toBe("/work/repo");
    expect(intent.agent).toBeUndefined();
  });

  it("uses codex's own resume form", async () => {
    const d = deps();
    await resumeSession(entry({ agent: "codex", sessionId: "abc123" }), d);
    expect(vi.mocked(d.materialize).mock.calls[0][0].paneCommands).toEqual([
      "codex resume abc123 -c tui.animations=false",
    ]);
  });

  // A dead cwd landing in $HOME is worse than not resuming (spec §4).
  it("refuses to spawn when the recorded directory is gone", async () => {
    const d = deps({ isDead: () => true });
    await expect(resumeSession(entry(), d)).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("refuses a session id that fails the PTY-safe pattern", async () => {
    const d = deps();
    await expect(resumeSession(entry({ sessionId: "a; rm -rf /" }), d)).resolves.toBe(false);
    // An empty id degrades the same way, and every string `.includes("")`, so
    // the "did the id survive into the command" guard cannot catch it alone.
    await expect(resumeSession(entry({ sessionId: "" }), d)).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });
});

function remembered(over: Partial<RememberedPane> = {}): RememberedPane {
  return {
    id: "claude:/work/repo",
    workspacePath: "/work",
    cwd: "/work/repo",
    agent: "claude",
    launchCommand: null,
    title: null,
    branch: null,
    sessionId: null,
    savedAt: 500,
    ...over,
  };
}

function rememberedDeps(
  answer: ResumeRef,
  over: Partial<Parameters<typeof resumeRememberedPane>[1]> = {},
) {
  return {
    ...deps(),
    lookup: vi.fn(async (requests: readonly ResumeRequest[]) => requests.map(() => answer)),
    ...over,
  };
}

describe("resumeFromRef", () => {
  it("types an agent's latest form for a latest answer", async () => {
    const d = deps();
    const ok = await resumeFromRef(
      { agent: "gemini", cwd: "/work/repo", workspacePath: "/work", ref: { kind: "latest" } },
      d,
    );
    expect(ok).toBe(true);
    const intent = vi.mocked(d.materialize).mock.calls[0][0];
    expect(intent.paneCommands).toEqual(["gemini --resume latest"]);
    expect(intent.cwds).toEqual(["/work/repo"]);
    expect(intent.workspacePath).toBe("/work");
  });

  it("refuses without an answer and never spawns", async () => {
    const d = deps();
    await expect(
      resumeFromRef({ agent: "claude", cwd: "/w", workspacePath: "/w", ref: null }, d),
    ).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("refuses an unsafe id from the resolver", async () => {
    const d = deps();
    await expect(
      resumeFromRef(
        { agent: "claude", cwd: "/w", workspacePath: "/w", ref: { kind: "id", id: "a b; ls" } },
        d,
      ),
    ).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("puts a claude pane's recorded flags back on the resume command", async () => {
    const d = deps();
    await resumeFromRef(
      {
        agent: "claude",
        cwd: "/w",
        workspacePath: "/w",
        ref: { kind: "id", id: "abc" },
        launchCommand: "claude --model opus",
      },
      d,
    );
    expect(vi.mocked(d.materialize).mock.calls[0][0].paneCommands).toEqual([
      "claude --resume abc --model opus",
    ]);
  });
});

describe("resumeRememberedPane", () => {
  it("resumes with an exact id and types what the last-session restore types for that pane", async () => {
    const id = "8f0f0e2c-1111-2222-3333-444455556666";
    const row = remembered({ launchCommand: "claude --model opus", sessionId: id });
    const d = rememberedDeps({ kind: "id", id });
    await expect(resumeRememberedPane(row, d)).resolves.toEqual({ status: "resumed" });
    const typed = vi.mocked(d.materialize).mock.calls[0][0].paneCommands;

    // Same pane, same resolver answer, through the restore path.
    const record: WindowRecord = {
      savedAt: row.savedAt,
      activeTabIndex: 0,
      tabs: [
        {
          workspacePath: row.workspacePath,
          layout: { type: "leaf" },
          panes: [
            {
              cwd: row.cwd,
              agent: row.agent,
              launchCommand: row.launchCommand,
              taskPrompt: null,
              sessionId: id,
            },
          ],
          name: null,
          dotColor: null,
        },
      ],
      files: [],
      activeFileTab: null,
      agentBoardOpen: false,
      agentBoardSurfaceActive: false,
    };
    const restoreMaterialize = vi.fn(async (_intent: MaterializeIntent) => true);
    const restoreLookup = vi.fn(async (requests: readonly ResumeRequest[]) =>
      requests.map((): ResumeRef => ({ kind: "id", id })),
    );
    const restoreDeps: RestoreDeps = {
      manager: {
        materialize: restoreMaterialize,
        selectTab: vi.fn(),
        notifySurfacesChanged: vi.fn(),
      },
      files: { openFile: vi.fn(), activateFile: vi.fn() },
      dirsExist: async (paths) => paths.map(() => true),
      statFiles: async () => [],
      lookup: restoreLookup,
      customAgents: () => [],
      journal: {
        readWindowRecords: async () => new Map([["main", record]]),
        clearWindowRecord: vi.fn(),
      },
      marker: { take: async () => false, set: async () => {}, clear: async () => {} },
    };
    await restoreSession(restoreDeps, "main");

    expect(typed).toEqual(["claude --resume " + id + " --model opus"]);
    expect(restoreMaterialize.mock.calls[0][0].paneCommands).toEqual(typed);
    // And it asked the resolver the same question, once.
    expect(d.lookup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.lookup).mock.calls[0][0]).toEqual(restoreLookup.mock.calls[0][0]);
  });

  it("resumes gemini with latest", async () => {
    const row = remembered({ agent: "gemini", id: "gemini:/work/repo" });
    const d = rememberedDeps({ kind: "latest" });
    await expect(resumeRememberedPane(row, d)).resolves.toEqual({ status: "resumed" });
    expect(vi.mocked(d.materialize).mock.calls[0][0].paneCommands).toEqual([
      "gemini --resume latest",
    ]);
    expect(vi.mocked(d.materialize).mock.calls[0][0].workspacePath).toBe("/work");
  });

  it("sends one lookup request pinned to the saved conversation", async () => {
    const d = rememberedDeps({ kind: "id", id: "abc" });
    await resumeRememberedPane(remembered({ sessionId: "abc" }), d);
    expect(d.lookup).toHaveBeenCalledWith([
      { agent: "claude", cwd: "/work/repo", lastSeenAt: 500, preferredId: "abc" },
    ]);
  });

  it("with no resolution opens nothing and returns the recorded launch command", async () => {
    const d = rememberedDeps(null);
    await expect(
      resumeRememberedPane(remembered({ launchCommand: "claude --model opus" }), d),
    ).resolves.toEqual({ status: "fresh", command: "claude --model opus" });
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("with no resolution and no recorded command falls back to the agent's default", async () => {
    const d = rememberedDeps(null);
    const result = await resumeRememberedPane(remembered({ agent: "codex" }), d);
    expect(result).toEqual({
      status: "fresh",
      command: expect.stringContaining("codex"),
    });
  });

  it("a custom agent skips the lookup and falls back to its declared command", async () => {
    const custom = { id: "mine", label: "My Agent", command: "my-agent --go" };
    const d = rememberedDeps(null, { customAgents: [custom] });
    await expect(resumeRememberedPane(remembered({ agent: "My Agent" }), d)).resolves.toEqual({
      status: "fresh",
      command: "my-agent --go",
    });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("refuses a gone directory before any lookup", async () => {
    const d = rememberedDeps({ kind: "latest" }, { isDead: () => true });
    await expect(resumeRememberedPane(remembered(), d)).resolves.toEqual({
      status: "failed",
      reason: "cwd-missing",
    });
    expect(d.lookup).not.toHaveBeenCalled();
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it("fails rather than starting fresh when the resolver's id is unsafe", async () => {
    const d = rememberedDeps({ kind: "id", id: "a; rm -rf /" });
    await expect(resumeRememberedPane(remembered(), d)).resolves.toEqual({
      status: "failed",
      reason: "not-resumed",
    });
    expect(d.materialize).not.toHaveBeenCalled();
  });
});
