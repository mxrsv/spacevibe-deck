import { describe, expect, it, vi } from "vitest";
import { buildPtyInfo, createPtyInfoReader } from "./info";
import { foregroundProcess, parsePsTable } from "../platform/macos";
import * as macos from "../platform/macos";
import * as windows from "../platform/windows";
import type { WindowsProcessRow } from "../platform/windows";
import { allIdle, censusFor } from "../quit-flow";
import type { PtySessionSnapshot } from "./session-store";

const rows = parsePsTable(
  [
    "  501   501   501 ttys001 -zsh",
    "  610   610   777 ttys002 /bin/zsh -l",
    "  777   777   777 ttys002 claude",
    "  800   800   850 ttys003 /bin/zsh -l",
    "  850   850   850 ttys003 /usr/bin/git push",
    "  900   900   901 ttys004 /bin/zsh -l",
    "  901   901   901 ttys004 node /opt/gemini/bin/gemini --resume",
    " 1000  1000  1001 ttys005 /bin/zsh -l",
    " 1001  1001  1001 ttys005 /opt/bin/aider --watch",
  ].join("\n"),
);

const snapshot = (
  id: number,
  pid: number,
  ttyName: string,
  cwd: string | null = null,
): PtySessionSnapshot => ({ id, pid, ttyName, cwd });

describe("buildPtyInfo", () => {
  it("reports an idle login shell", () => {
    const [info] = buildPtyInfo([snapshot(1, 501, "ttys001")], rows, new Map(), macos);

    expect(info).toEqual({
      id: 1,
      processId: 501,
      cwd: null,
      process: "zsh",
      kind: "idle-shell",
      agent: null,
    });
  });

  it.each(["bash /workspace/build.sh", "bash -c 'while :; do :; done'", "bash"])(
    "keeps a foreground child shell busy in the quit census: %s",
    (command) => {
      const scriptRows = parsePsTable(
        ["100 100 200 ttys001 /bin/zsh -l", `200 200 200 ttys001 ${command}`].join("\n"),
      );
      const infos = buildPtyInfo([snapshot(1, 100, "ttys001")], scriptRows, new Map(), macos);
      expect(infos[0].kind).toBe("busy");
      expect(allIdle(infos)).toBe(false);
      expect(censusFor(1, infos).busyPanes).toBe(1);
    },
  );

  it.each(["bash /workspace/build.sh", "bash -s", "bash -ls"])(
    "detects a script exec'd over the pane's original shell PID: %s",
    (command) => {
      const scriptRows = parsePsTable(`100 100 100 ttys001 ${command}`);
      const infos = buildPtyInfo([snapshot(1, 100, "ttys001")], scriptRows, new Map(), macos);
      expect(infos[0].kind).toBe("busy");
      expect(censusFor(1, infos).busyPanes).toBe(1);
    },
  );

  it("reports a foreground agent with its id", () => {
    const [info] = buildPtyInfo([snapshot(2, 610, "ttys002")], rows, new Map(), macos);

    expect(info).toEqual({
      id: 2,
      processId: 777,
      cwd: null,
      process: "claude",
      kind: "agent",
      agent: "claude",
    });
  });

  it("reports an ordinary foreground job as busy", () => {
    const [info] = buildPtyInfo([snapshot(3, 800, "ttys003")], rows, new Map(), macos);

    expect(info.kind).toBe("busy");
    expect(info.agent).toBe(null);
  });

  it("uses the foreground command line to recognize a Node agent", () => {
    const [info] = buildPtyInfo([snapshot(4, 900, "ttys004")], rows, new Map(), macos);

    expect(info).toMatchObject({
      process: "node",
      kind: "agent",
      agent: "gemini",
    });
  });

  it("recognizes a user-declared agent matcher", () => {
    const [info] = buildPtyInfo([snapshot(5, 1000, "ttys005")], rows, new Map(), macos, [
      { binary: "aider", agent: "Aider" },
    ]);

    expect(info).toMatchObject({
      process: "aider",
      kind: "agent",
      agent: "Aider",
    });
  });

  it("degrades a pane missing from the table to unknown, keeping its cwd", () => {
    const [info] = buildPtyInfo([snapshot(4, 999, "ttys099", "/tmp")], rows, new Map(), macos);

    expect(info).toEqual({
      id: 4,
      processId: null,
      cwd: "/tmp",
      process: null,
      kind: "unknown",
      agent: null,
    });
  });

  it("answers every snapshot from one table reading, in order", () => {
    const infos = buildPtyInfo(
      [snapshot(1, 501, "ttys001"), snapshot(2, 610, "ttys002")],
      rows,
      new Map(),
      macos,
    );

    expect(infos.map((info) => info.id)).toEqual([1, 2]);
    expect(infos.map((info) => info.kind)).toEqual(["idle-shell", "agent"]);
  });

  it("returns an empty list for no snapshots", () => {
    expect(buildPtyInfo([], rows, new Map(), macos)).toEqual([]);
  });
});

describe("buildPtyInfo on Windows", () => {
  const winRow = (
    pid: number,
    ppid: number,
    executable: string,
    creationDate: number,
    args = executable,
  ): WindowsProcessRow => ({
    pid,
    pgid: ppid,
    tpgid: -1,
    tty: "",
    args,
    ppid,
    creationDate,
    executable,
  });
  const shell = winRow(
    100,
    1,
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    10,
    "pwsh.exe -NoLogo",
  );
  const claude = winRow(101, 100, "C:\\Users\\a\\.local\\bin\\claude.exe", 20, "claude");
  const codex = winRow(101, 100, "C:\\tools\\codex.exe", 20, "codex");
  const claudeWithMcp = [
    shell,
    claude,
    winRow(
      102,
      101,
      "C:\\Windows\\System32\\cmd.exe",
      30,
      'cmd.exe /d /s /c "npx -y @modelcontextprotocol/server-filesystem C:\\repo"',
    ),
    winRow(
      103,
      102,
      "C:\\Program Files\\nodejs\\node.exe",
      40,
      "node C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1f2e\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js C:\\repo",
    ),
  ];

  it.each([
    ["claude.exe → cmd.exe → node.exe (MCP)", claudeWithMcp, 101, "claude.exe", "claude"],
    [
      "codex.exe → codex-code-mode-host.exe",
      [shell, codex, winRow(102, 101, "C:\\tools\\codex-code-mode-host.exe", 30)],
      101,
      "codex.exe",
      "codex",
    ],
    [
      "claude.exe → bash.exe → codex.exe",
      [
        shell,
        claude,
        winRow(
          102,
          101,
          "C:\\Program Files\\Git\\bin\\bash.exe",
          30,
          'bash.exe -c -l "codex exec"',
        ),
        winRow(103, 102, "C:\\tools\\codex.exe", 40, "codex exec"),
      ],
      101,
      "claude.exe",
      "claude",
    ],
    [
      "node.exe → claude.exe",
      [
        shell,
        winRow(101, 100, "C:\\node.exe", 20),
        winRow(102, 101, "C:\\Users\\a\\claude.exe", 30),
      ],
      102,
      "claude.exe",
      "claude",
    ],
  ] as const)("classifies %s as the agent", (_tree, tree, processId, process, agent) => {
    const [info] = buildPtyInfo([snapshot(1, 100, "")], tree, new Map(), windows);

    expect(info).toMatchObject({ processId, process, kind: "agent", agent });
  });

  it("reports the deepest process as busy when no agent is running", () => {
    const tree = [
      shell,
      winRow(101, 100, "C:\\Windows\\System32\\cmd.exe", 20, "cmd.exe /d /s /c npm run build"),
      winRow(102, 101, "C:\\node.exe", 30, "node C:\\repo\\node_modules\\vite\\bin\\vite.js build"),
    ];

    const [info] = buildPtyInfo([snapshot(1, 100, "")], tree, new Map(), windows);

    expect(info).toMatchObject({ processId: 102, process: "node.exe", kind: "busy", agent: null });
  });

  it("prefers a user-declared agent too", () => {
    const tree = [
      shell,
      winRow(101, 100, "C:\\tools\\aider.exe", 20, "aider --watch"),
      winRow(102, 101, "C:\\Windows\\System32\\git.exe", 30, "git status"),
    ];

    const [info] = buildPtyInfo([snapshot(1, 100, "")], tree, new Map(), windows, [
      { binary: "aider", agent: "Aider" },
    ]);

    expect(info).toMatchObject({ processId: 101, kind: "agent", agent: "Aider" });
  });

  it("keys the reader's cwd lookup on the same agent pid it reports", async () => {
    // The cwd cache is keyed on the pid the reader picks; a reader that walked
    // to the MCP server would look up its cwd and never find the agent's.
    const processCwds = vi.fn(async () => new Map([[101, "C:\\repo"]]));
    const reader = createPtyInfoReader(
      () => ({
        readProcessTable: async () => claudeWithMcp,
        foregroundProcess: windows.foregroundProcess,
        processCwds,
      }),
      async () => new Map(),
    );

    const [info] = await reader.read([snapshot(1, 100, "", "C:\\stale")], [], true);

    expect(processCwds).toHaveBeenCalledWith([101]);
    expect(info).toMatchObject({ processId: 101, cwd: "C:\\repo", agent: "claude" });
  });
});

describe("createPtyInfoReader", () => {
  it("shares one process-table snapshot across concurrent callers", async () => {
    let resolveRows!: (value: typeof rows) => void;
    const readProcessTable = vi.fn(
      () =>
        new Promise<typeof rows>((resolve) => {
          resolveRows = resolve;
        }),
    );
    const reader = createPtyInfoReader(() => ({
      readProcessTable,
      foregroundProcess,
      processCwds: async () => new Map(),
    }));

    const first = reader.read([snapshot(1, 501, "ttys001")]);
    const second = reader.read([snapshot(2, 610, "ttys002")]);

    expect(readProcessTable).toHaveBeenCalledTimes(1);
    resolveRows(rows);
    await Promise.all([first, second]);
  });

  it("returns process state before a slow cwd refresh and uses its cache later", async () => {
    let resolveCwds!: (cwds: Map<number, string>) => void;
    const processCwds = vi.fn(
      () =>
        new Promise<Map<number, string>>((resolve) => {
          resolveCwds = resolve;
        }),
    );
    const reader = createPtyInfoReader(() => ({
      readProcessTable: async () => rows,
      foregroundProcess,
      processCwds,
    }));

    const first = await reader.read([snapshot(2, 610, "ttys002")]);

    expect(first[0]).toMatchObject({
      process: "claude",
      kind: "agent",
      cwd: null,
    });
    expect(processCwds).toHaveBeenCalledWith([777]);

    resolveCwds(new Map([[777, "/repo"]]));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const second = await reader.read([snapshot(2, 610, "ttys002")]);
    expect(second[0]?.cwd).toBe("/repo");
  });

  it("can wait for a live cwd at decision points", async () => {
    const reader = createPtyInfoReader(() => ({
      readProcessTable: async () => rows,
      foregroundProcess,
      processCwds: async () => new Map([[777, "/fresh"]]),
    }));

    const infos = await reader.read([snapshot(2, 610, "ttys002", "/stale")], [], true);

    expect(infos[0]?.cwd).toBe("/fresh");
  });
});

describe("Codex session facts", () => {
  const codexRows = (pid = 777) =>
    parsePsTable(`610 610 ${pid} ttys002 zsh\n${pid} ${pid} ${pid} ttys002 codex`);
  const panes = [snapshot(2, 610, "ttys002")];
  it("does not block classification on lsof and surfaces a fact on the next poll", async () => {
    let finish!: (value: Map<number, string>) => void;
    const sessions = vi.fn(
      () =>
        new Promise<Map<number, string>>((resolve) => {
          finish = resolve;
        }),
    );
    const reader = createPtyInfoReader(
      () => ({
        readProcessTable: async () => codexRows(),
        foregroundProcess,
        processCwds: async () => new Map(),
      }),
      sessions,
    );
    expect((await reader.read(panes))[0].codexSessionId).toBeNull();
    expect(sessions).toHaveBeenCalledWith(new Map([[777, []]]));
    finish(new Map([[777, "own"]]));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await reader.read(panes))[0].codexSessionId).toBe("own");
  });
  it("asks about the npm launcher's native codex child too, and no other group member", async () => {
    const sessions = vi.fn().mockResolvedValue(new Map([[777, "own"]]));
    const reader = createPtyInfoReader(
      () => ({
        readProcessTable: async () =>
          parsePsTable(
            [
              "610 610 777 ttys002 zsh",
              "777 777 777 ttys002 node /u/.nvm/versions/node/v24/bin/codex",
              "778 777 777 ttys002 /u/.nvm/versions/node/v24/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/bin/codex",
              "779 777 777 ttys002 /bin/bash -c make",
            ].join("\n"),
          ),
        foregroundProcess,
        processCwds: async () => new Map(),
      }),
      sessions,
    );
    expect((await reader.read(panes))[0]).toMatchObject({ agent: "codex", processId: 777 });
    expect(sessions).toHaveBeenCalledWith(new Map([[777, [778]]]));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await reader.read(panes))[0].codexSessionId).toBe("own");
  });
  it("withdraws a previously verified identity when the same pid has no reliable lock reading", async () => {
    const sessions = vi
      .fn()
      .mockResolvedValueOnce(new Map([[777, "own"]]))
      .mockResolvedValue(new Map());
    const reader = createPtyInfoReader(
      () => ({
        readProcessTable: async () => codexRows(),
        foregroundProcess,
        processCwds: async () => new Map(),
      }),
      sessions,
    );
    await reader.read(panes);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await reader.read(panes))[0].codexSessionId).toBe("own");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await reader.read(panes))[0].codexSessionId).toBeNull();
  });

  it("never applies an old pid's late lock reading to a new foreground process", async () => {
    let pid = 777;
    let finish!: (value: Map<number, string>) => void;
    const sessions = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Map<number, string>>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(new Map());
    const reader = createPtyInfoReader(
      () => ({
        readProcessTable: async () => codexRows(pid),
        foregroundProcess,
        processCwds: async () => new Map(),
      }),
      sessions,
    );
    await reader.read(panes);
    pid = 888;
    expect((await reader.read(panes))[0].codexSessionId).toBeNull();
    finish(new Map([[777, "stranger"]]));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await reader.read(panes))[0].codexSessionId).toBeNull();
  });
});
