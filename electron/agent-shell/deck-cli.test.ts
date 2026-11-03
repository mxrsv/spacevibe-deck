import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHookServer, type HookServer } from "../agent-hooks/hook-server";
import { createControlRouter } from "../control/control-routes";
import { deckCliSource } from "./deck-cli";

/**
 * These run the real script under `sh`. Most use a stub `curl` that records its argv and answers
 * a canned status, so the argument parsing, the headers and the exit-code map are checked
 * without a listener; the last block runs the real `curl` against the real hook server.
 */
const ROOT = realpathSync(mkdtempSync(path.join(tmpdir(), "deck-cli-")));
const SHIM = path.join(ROOT, "deck");
const STUBS = path.join(ROOT, "stubs");
const PS_ONLY = path.join(ROOT, "ps-only");
// Windows panes get no `deck` (no wrappers, no hook transport), so there is no shell to run it in.
const POSIX = process.platform !== "win32";
const SHELLS = POSIX
  ? [...new Set(["/bin/sh", "/bin/dash"].filter((shell) => existsSync(shell)))]
  : [];

const STUB_CURL = `#!/bin/sh
{
  printf '%s\\0' '---'
  for a in "$@"; do printf '%s\\0' "$a"; done
} >> "$STUB_LOG"
out=
prev=
for a in "$@"; do
  case $prev in -o) out=$a ;; esac
  case $a in text@-) cat >> "$STUB_STDIN" ;; esac
  prev=$a
done
[ -n "$STUB_SLEEP" ] && sleep "$STUB_SLEEP"
if [ -n "$STUB_SEQ" ] && [ -s "$STUB_SEQ" ]; then
  code=$(head -n 1 "$STUB_SEQ")
  tail -n +2 "$STUB_SEQ" > "$STUB_SEQ.next" && mv "$STUB_SEQ.next" "$STUB_SEQ"
else
  code=\${STUB_CODE-200}
fi
[ -n "$out" ] && printf '%s' "\${STUB_BODY-}" > "$out"
printf '%s' "$code"
exit "\${STUB_CURL_EXIT-0}"
`;

// ps pads its column; the shim must trim it. The argv is recorded to prove which pid was asked.
const STUB_PS = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_PS_LOG"
printf '  %s  \\n' "\${STUB_TTY-ttys-stub}"
`;

function writeExecutable(file: string, text: string): void {
  writeFileSync(file, text, { mode: 0o755 });
  chmodSync(file, 0o755);
}

beforeAll(() => {
  mkdirSync(STUBS);
  mkdirSync(PS_ONLY);
  writeExecutable(SHIM, deckCliSource());
  writeExecutable(path.join(STUBS, "curl"), STUB_CURL);
  writeExecutable(path.join(STUBS, "ps"), STUB_PS);
  writeExecutable(path.join(PS_ONLY, "ps"), STUB_PS);
});
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const PANE_ENV = {
  DECK_PANE_ID: "12",
  DECK_HOOK_TOKEN: "tok-secret",
  DECK_HOOK_PORT: "4321",
};

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Each curl invocation's argv. */
  readonly curlCalls: string[][];
  readonly stdinSeen: string;
  readonly psCalls: string[];
  readonly tmp: string;
}

/** The environment is built from nothing: a test that runs inside a Deck pane inherits no DECK_*. */
function envFor(
  tmp: string,
  extra: Record<string, string>,
  pathDirs: readonly string[] = [STUBS],
): NodeJS.ProcessEnv {
  return {
    PATH: [...pathDirs, "/usr/bin", "/bin"].join(":"),
    HOME: tmp,
    TMPDIR: tmp,
    STUB_LOG: path.join(tmp, "curl.log"),
    STUB_STDIN: path.join(tmp, "stdin.log"),
    STUB_PS_LOG: path.join(tmp, "ps.log"),
    ...extra,
  };
}

function readCalls(tmp: string): string[][] {
  const file = path.join(tmp, "curl.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\0")
    .reduce<string[][]>((calls, item) => {
      if (item === "---") return [...calls, []];
      if (item === "") return calls;
      return [...calls.slice(0, -1), [...(calls.at(-1) ?? []), item]];
    }, []);
}

function run(
  args: readonly string[],
  extra: Record<string, string> = PANE_ENV,
  options: { shell?: string; input?: string; seq?: string } = {},
): Run {
  const tmp = mkdtempSync(path.join(ROOT, "case-"));
  const seq = options.seq === undefined ? {} : { STUB_SEQ: path.join(tmp, "seq") };
  if (options.seq !== undefined) writeFileSync(path.join(tmp, "seq"), options.seq);
  const result = spawnSync(options.shell ?? "/bin/sh", [SHIM, ...args], {
    env: envFor(tmp, { ...seq, ...extra }),
    cwd: tmp,
    input: options.input ?? "",
    encoding: "utf8",
  });
  const read = (name: string) =>
    existsSync(path.join(tmp, name)) ? readFileSync(path.join(tmp, name), "utf8") : "";
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    curlCalls: readCalls(tmp),
    stdinSeen: read("stdin.log"),
    psCalls: read("ps.log").split("\n").filter(Boolean),
    tmp,
  };
}

const URL_OF = (route: string) => `http://127.0.0.1:4321/control/v1/${route}`;

describe.each(SHELLS)("deck shim under %s", (shell) => {
  describe("outside a pane (ORC2)", () => {
    it.each([["DECK_PANE_ID"], ["DECK_HOOK_TOKEN"], ["DECK_HOOK_PORT"]])(
      "exits 3 with one explanatory line when %s is missing",
      (missing) => {
        const env = Object.fromEntries(
          Object.entries(PANE_ENV).filter(([name]) => name !== missing),
        );
        const result = run(["status"], env, { shell });
        expect(result.status).toBe(3);
        expect(result.stdout).toBe("");
        expect(result.stderr.trim().split("\n")).toHaveLength(1);
        expect(result.stderr).toContain("run this inside a SpaceVibe Deck pane");
        expect(result.stderr).toContain("Codex daemon subcommand");
        expect(result.stderr).toContain("opencode with Signals off");
        expect(result.curlCalls).toEqual([]);
      },
    );

    it("treats a port that is not a number as a stripped identity, not as part of a URL", () => {
      const result = run(["status"], { ...PANE_ENV, DECK_HOOK_PORT: "80@evil.example" }, { shell });
      expect(result.status).toBe(3);
      expect(result.curlCalls).toEqual([]);
    });

    it("still prints help, and checks the pane before it judges the arguments", () => {
      expect(run(["--help"], {}, { shell }).status).toBe(0);
      expect(run(["pane", "bogus"], {}, { shell }).status).toBe(3);
    });
  });

  describe("help (ORC3)", () => {
    it("lists every command and flag, on stdout, exiting 0", () => {
      const result = run(["--help"], {}, { shell });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      for (const line of [
        "deck status",
        "deck worktree create --repo <path> --branch <name> [--dest <path>]",
        "deck pane list",
        "deck pane open --cwd <path> --agent <id> [--prompt <text>] [--name <label>]",
        "deck pane send <id> [--no-submit] (<text> | --stdin)",
        "deck pane read <id> [--lines <n>] [--envelope]",
        "deck pane wait <id> --for idle|needs-you|exited|turn [--timeout <s>]",
        "deck pane close <id> [--force]",
        "deck skill orchestrate",
        "--json",
      ]) {
        expect(result.stdout).toContain(line);
      }
    });

    it("describes one command when asked, wherever --help sits", () => {
      for (const args of [
        ["pane", "send", "--help"],
        ["--help", "pane", "send"],
        ["pane", "send", "12", "-h"],
      ]) {
        const result = run(args, {}, { shell });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("usage: deck pane send <id> [--no-submit]");
        expect(result.stdout).not.toContain("deck pane wait");
      }
      expect(run(["pane", "--help"], {}, { shell }).stdout).toContain("deck pane close");
      expect(run(["worktree", "--help"], {}, { shell }).stdout).toContain("--branch");
      expect(run(["skill", "orchestrate", "--help"], {}, { shell }).status).toBe(0);
    });

    it("treats --help after a bare -- as text to send", () => {
      const result = run(["pane", "send", "12", "--", "--help"], PANE_ENV, { shell });
      expect(result.status).toBe(0);
      expect(result.curlCalls[0]).toContain("text=--help");
    });
  });

  describe("usage errors (ORC3)", () => {
    it.each([
      [[], "a command is required"],
      [["frobnicate"], "unknown command 'frobnicate'"],
      [["pane"], "unknown command 'pane '"],
      [["pane", "frobnicate"], "unknown command 'pane frobnicate'"],
      [["status", "extra"], "unexpected argument extra"],
      [["worktree", "create", "--repo", "/r"], "--branch is required"],
      [["worktree", "create", "--branch", "b"], "--repo is required"],
      [["worktree", "create", "--repo"], "--repo needs a value"],
      [["pane", "open", "--cwd", "/r"], "--agent is required"],
      [["pane", "send"], "<id> must be a pane number"],
      [["pane", "send", "12"], "the text is required"],
      [["pane", "send", "12", "x", "y"], "unexpected argument y"],
      [["pane", "send", "12", "x", "--stdin"], "not both"],
      [["pane", "send", "012", "x"], "<id> must be a pane number"],
      [["pane", "send", "12", "-x"], "unknown option -x"],
      [["pane", "read", "abc"], "<id> must be a pane number"],
      [["pane", "read", "12", "--lines", "ten"], "--lines must be a positive number"],
      [["pane", "wait", "12"], "--for must be idle, needs-you, exited or turn"],
      [["pane", "wait", "12", "--for", "bored"], "--for must be idle, needs-you, exited or turn"],
      [["pane", "wait", "12", "--for", "idle", "--timeout", "0"], "--timeout must be"],
      [["pane", "wait", "12", "--for", "idle", "--timeout", "3601"], "--timeout must be"],
      [["pane", "wait", "12", "--for", "idle", "--timeout", "5m"], "--timeout must be"],
      [["pane", "close"], "<id> must be a pane number"],
    ] as const)("exits 2 without calling Deck: deck %j", (args, message) => {
      const result = run(args, PANE_ENV, { shell });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(result.stderr).toContain("usage:");
      expect(result.curlCalls).toEqual([]);
    });
  });

  describe("transport (ORC4-5)", () => {
    it("posts status with the pane identity and asks for JSON on --json", () => {
      const result = run(
        ["status", "--json"],
        { ...PANE_ENV, STUB_BODY: '{"ok":true}\n' },
        { shell },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('{"ok":true}\n');
      expect(result.curlCalls).toHaveLength(1);
      const argv = result.curlCalls[0]!;
      // -q first, or a user's curlrc can add options before it is read.
      expect(argv[0]).toBe("-q");
      expect(argv).toEqual(
        expect.arrayContaining([
          "--noproxy",
          "*",
          "-X",
          "POST",
          "X-Deck-Pane: 12",
          "X-Deck-Token: tok-secret",
          "--data-urlencode",
          "json=1",
        ]),
      );
      expect(argv[argv.indexOf("-m") + 1]).toBe("95");
      expect(argv.at(-1)).toBe(URL_OF("status"));
      expect(argv.filter((a) => a.startsWith("--data-urlencode"))).toHaveLength(1);
    });

    it("sends plain text mode without json=1, and a global --json before the command works too", () => {
      const text = run(["status"], PANE_ENV, { shell });
      expect(text.curlCalls[0]).not.toContain("json=1");
      const global = run(["--json", "pane", "list"], PANE_ENV, { shell });
      expect(global.curlCalls[0]).toContain("json=1");
      expect(global.curlCalls[0]!.at(-1)).toBe(URL_OF("pane/list"));
    });

    it("reports the trimmed tty of DECK_AGENT_PID, else of its own parent", () => {
      const agent = run(["status"], { ...PANE_ENV, DECK_AGENT_PID: "4242" }, { shell });
      expect(agent.curlCalls[0]).toContain("X-Deck-Tty: ttys-stub");
      expect(agent.psCalls).toEqual(["-o tty= -p 4242"]);
      const plain = run(["status"], PANE_ENV, { shell });
      expect(plain.curlCalls[0]).toContain("X-Deck-Tty: ttys-stub");
      expect(plain.psCalls).toEqual([`-o tty= -p ${process.pid}`]);
    });

    it("leaves no temporary file behind, on success or on a failed call", () => {
      for (const extra of [{ STUB_BODY: "x" }, { STUB_CODE: "403" }]) {
        const result = run(["status"], { ...PANE_ENV, ...extra }, { shell });
        expect(readdirSync(result.tmp).filter((name) => name.startsWith("deck-cli."))).toEqual([]);
      }
    });

    it("makes relative paths absolute from the caller's directory", () => {
      const result = run(
        ["worktree", "create", "--repo", ".", "--branch", "feat/x", "--dest", "../wt"],
        PANE_ENV,
        { shell },
      );
      const argv = result.curlCalls[0]!;
      expect(argv).toContain(`repo=${result.tmp}/.`);
      expect(argv).toContain("branch=feat/x");
      expect(argv).toContain(`dest=${result.tmp}/../wt`);
      expect(argv.at(-1)).toBe(URL_OF("worktree/create"));
      const absolute = run(
        ["worktree", "create", "--repo", "/work/app", "--branch", "b"],
        PANE_ENV,
        { shell },
      );
      expect(absolute.curlCalls[0]).toContain("repo=/work/app");
      expect(absolute.curlCalls[0]!.some((a) => a.startsWith("dest="))).toBe(false);
    });

    it("sends pane open's optional fields only when they were given, empty prompt included", () => {
      const bare = run(["pane", "open", "--cwd", "/w", "--agent", "codex"], PANE_ENV, { shell });
      expect(bare.curlCalls[0]!.filter((a) => /^(prompt|name)=/.test(a))).toEqual([]);
      const full = run(
        ["pane", "open", "--cwd", "/w", "--agent", "codex", "--prompt", "do it", "--name", "w 1"],
        PANE_ENV,
        { shell },
      );
      expect(full.curlCalls[0]).toEqual(
        expect.arrayContaining(["cwd=/w", "agent=codex", "prompt=do it", "name=w 1"]),
      );
      expect(full.curlCalls[0]!.at(-1)).toBe(URL_OF("pane/open"));
    });

    it("sends read and close options under the names the routes read", () => {
      const read = run(["pane", "read", "12", "--lines", "50", "--envelope"], PANE_ENV, { shell });
      expect(read.curlCalls[0]).toEqual(
        expect.arrayContaining(["id=12", "lines=50", "envelope=1"]),
      );
      expect(read.curlCalls[0]!.at(-1)).toBe(URL_OF("pane/read"));
      const close = run(["pane", "close", "12", "--force"], PANE_ENV, { shell });
      expect(close.curlCalls[0]).toEqual(expect.arrayContaining(["id=12", "force=1"]));
      expect(run(["skill", "orchestrate"], PANE_ENV, { shell }).curlCalls[0]!.at(-1)).toBe(
        URL_OF("skill/orchestrate"),
      );
    });
  });

  describe("pane send", () => {
    it("posts the id and the stdin marker, and forwards standard input untouched", () => {
      const input = "line one\nline two with 'quotes' and $dollar\n";
      const result = run(["pane", "send", "12", "--stdin"], PANE_ENV, { shell, input });
      expect(result.status).toBe(0);
      expect(result.curlCalls[0]).toEqual(expect.arrayContaining(["id=12", "text@-"]));
      expect(result.curlCalls[0]!.some((a) => a.startsWith("text="))).toBe(false);
      expect(result.stdinSeen).toBe(input);
    });

    it("sends text that starts with @ as data, never as a file to read", () => {
      const result = run(["pane", "send", "12", "@/etc/passwd"], PANE_ENV, { shell });
      expect(result.curlCalls[0]).toContain("text=@/etc/passwd");
      expect(result.curlCalls[0]).not.toContain("text@/etc/passwd");
    });

    it("keeps spaces, newlines and a leading dash (after --) in one argument", () => {
      const result = run(["pane", "send", "12", "--no-submit", "--", "-a  b\nc"], PANE_ENV, {
        shell,
      });
      expect(result.curlCalls[0]).toEqual(
        expect.arrayContaining(["id=12", "no_submit=1", "text=-a  b\nc"]),
      );
      expect(result.curlCalls[0]!.at(-1)).toBe(URL_OF("pane/send"));
    });
  });

  describe("pane wait (ORC14)", () => {
    it.each(["idle", "needs-you", "exited", "turn"])("accepts --for %s and posts it", (target) => {
      const result = run(["pane", "wait", "12", "--for", target, "--timeout", "30"], PANE_ENV, {
        shell,
      });
      expect(result.status).toBe(0);
      expect(result.curlCalls[0]).toEqual(expect.arrayContaining(["id=12", `for=${target}`]));
    });

    it("asks again on 202 until the pane answers 200, then prints the state", () => {
      const result = run(
        ["pane", "wait", "12", "--for", "idle"],
        { ...PANE_ENV, STUB_BODY: "idle\n" },
        { shell, seq: "202\n202\n200\n" },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("idle\n");
      expect(result.curlCalls).toHaveLength(3);
      for (const argv of result.curlCalls) {
        expect(argv).toEqual(expect.arrayContaining(["id=12", "for=idle", "timeout=600"]));
        expect(argv.at(-1)).toBe(URL_OF("pane/wait"));
      }
    });

    it("exits 124 once its own deadline passes while Deck keeps answering 202", () => {
      const result = run(
        ["pane", "wait", "12", "--for", "needs-you", "--timeout", "2"],
        { ...PANE_ENV, STUB_CODE: "202", STUB_SLEEP: "0.2" },
        { shell },
      );
      expect(result.status).toBe(124);
      expect(result.stderr).toContain("timed out after 2 seconds waiting for pane 12");
      // Whole-second clock: the deadline can come early, but the first ask is always made.
      expect(result.curlCalls.length).toBeGreaterThanOrEqual(1);
      // The remaining time shrinks, so Deck never holds a call past the shim's deadline.
      const remaining = result.curlCalls.map((argv) =>
        Number(argv.find((a) => a.startsWith("timeout="))?.slice("timeout=".length)),
      );
      expect(remaining[0]).toBe(2);
      expect(
        remaining.every((seconds, i) => seconds >= 1 && (i === 0 || seconds <= remaining[i - 1]!)),
      ).toBe(true);
    });
  });

  describe("exit codes (ORC3)", () => {
    it.each([
      ["200", 0],
      ["400", 2],
      ["403", 1],
      ["404", 1],
      ["405", 1],
      ["413", 1],
      ["422", 1],
      ["500", 1],
      ["408", 124],
      ["504", 124],
    ])("maps HTTP %s to exit %i and puts a failure's body on stderr", (code, exit) => {
      const result = run(
        ["status"],
        { ...PANE_ENV, STUB_CODE: code, STUB_BODY: "body\n" },
        { shell },
      );
      expect(result.status).toBe(exit);
      if (code === "200") {
        expect(result.stdout).toBe("body\n");
        expect(result.stderr).toBe("");
      } else {
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("body\n");
      }
    });

    it("keeps a failure's body on stdout under --json, where a caller parses it", () => {
      const result = run(
        ["status", "--json"],
        { ...PANE_ENV, STUB_CODE: "422", STUB_BODY: '{"ok":false}\n' },
        { shell },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('{"ok":false}\n');
    });

    it("says Deck is not answering when nothing listens, and 124 when curl times out", () => {
      const refused = run(["status"], { ...PANE_ENV, STUB_CURL_EXIT: "7" }, { shell });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("Deck is not answering on port 4321");
      const timedOut = run(["status"], { ...PANE_ENV, STUB_CURL_EXIT: "28" }, { shell });
      expect(timedOut.status).toBe(124);
    });

    it("refuses a 202 for a command that cannot wait instead of exiting 0", () => {
      const result = run(["status"], { ...PANE_ENV, STUB_CODE: "202" }, { shell });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot wait");
    });
  });
});

describe.skipIf(!POSIX)("deck shim against the real hook server and the real curl", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const TTY = "ttys-stub";
  let server: HookServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function start(addWorktree?: Parameters<typeof createControlRouter>[0]["addWorktree"]) {
    const router = createControlRouter({
      tokenFor: (paneId) => (paneId === 12 ? TOKEN : null),
      ttyFor: (paneId) => (paneId === 12 ? TTY : null),
      version: () => "9.9.9",
      windowOf: () => "main",
      addWorktree: addWorktree ?? (async (params) => ({ ok: true, path: params.destPath })),
      log: () => {},
    });
    server = createHookServer({
      tokenFor: (paneId) => (paneId === 12 ? TOKEN : null),
      ttyFor: (paneId) => (paneId === 12 ? TTY : null),
      emitToOwner: () => {},
      control: router,
      log: () => {},
    });
    const port = await server.listen();
    const shim = (args: readonly string[], extra: Record<string, string> = {}, input = "") =>
      new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
        const tmp = mkdtempSync(path.join(ROOT, "live-"));
        const child = execFile(
          "/bin/sh",
          [SHIM, ...args],
          {
            env: envFor(
              tmp,
              {
                DECK_PANE_ID: "12",
                DECK_HOOK_TOKEN: TOKEN,
                DECK_HOOK_PORT: String(port),
                ...extra,
              },
              [PS_ONLY],
            ),
            cwd: tmp,
          },
          (error, stdout, stderr) =>
            resolve({
              status: error === null ? 0 : typeof error.code === "number" ? error.code : -1,
              stdout,
              stderr,
            }),
        );
        child.stdin?.end(input);
      });
    return { shim };
  }

  it("answers status as text and as JSON", async () => {
    const { shim } = await start();
    const text = await shim(["status"]);
    expect(text).toEqual({
      status: 0,
      stdout: "Deck 9.9.9\npane 12 in window main\nagent control: on\n",
      stderr: "",
    });
    const json = await shim(["status", "--json"]);
    expect(JSON.parse(json.stdout)).toEqual({
      ok: true,
      version: "9.9.9",
      paneId: 12,
      window: "main",
      switch: "on",
    });
  });

  it("creates a worktree, with the destination defaulted from the branch", async () => {
    const calls: Array<{ repoPath: string; branch: string; destPath: string }> = [];
    const { shim } = await start(async (params) => {
      calls.push(params);
      return { ok: true, path: params.destPath };
    });
    const result = await shim(["worktree", "create", "--repo", "/work/app", "--branch", "feat/x"]);
    expect(result).toEqual({ status: 0, stdout: "/work/feat-x\n", stderr: "" });
    expect(calls).toEqual([{ repoPath: "/work/app", branch: "feat/x", destPath: "/work/feat-x" }]);
  });

  it("round-trips + % & = quotes and non-ASCII letters through curl and the form parser exactly", async () => {
    const calls: Array<{ repoPath: string; branch: string; destPath: string }> = [];
    const { shim } = await start(async (params) => {
      calls.push(params);
      return { ok: true, path: params.destPath };
    });
    const repo = path.resolve("/work/a b+c%d");
    const branch = "feat/x&y=z 'q' đ";
    const result = await shim(["worktree", "create", "--repo", repo, "--branch", branch, "--json"]);
    expect(result.status).toBe(0);
    const destPath = path.join(path.dirname(repo), "feat-x&y=z 'q' đ");
    expect(calls).toEqual([{ repoPath: repo, branch, destPath }]);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, path: destPath });
    // A value that starts with @ is data for curl, not a file to read.
    const dest = path.resolve("/work/@wt");
    await shim(["worktree", "create", "--repo", repo, "--branch", "b", "--dest", dest]);
    expect(calls.at(-1)?.destPath).toBe(dest);
  });

  it("exits 1 with the closed error code when git refuses", async () => {
    const { shim } = await start(async () => ({ ok: false, error: "branch-exists" }));
    const result = await shim(["worktree", "create", "--repo", "/work/app", "--branch", "main"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("branch-exists");
  });

  it("exits 1 when the token, or the tty, is not the pane's", async () => {
    const { shim } = await start();
    const token = await shim(["status"], { DECK_HOOK_TOKEN: "wrong" });
    expect(token.status).toBe(1);
    expect(token.stderr).toContain("forbidden");
    const tty = await shim(["status"], { STUB_TTY: "ttys-other" });
    expect(tty.status).toBe(1);
    expect(tty.stderr).toContain("forbidden");
  });

  it("says a command is not implemented yet until its slice lands", async () => {
    const { shim } = await start();
    const result = await shim(["pane", "list"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not implemented yet");
  });

  it("reaches the command table with a --stdin body of awkward characters", async () => {
    const { shim } = await start();
    const result = await shim(
      ["pane", "send", "12", "--stdin", "--json"],
      {},
      "a 'b' \"c\"\nđ=1&x=2",
    );
    // The send route is not built yet, so only the framing is checked here: a malformed form body
    // would have been refused before the command table, not answered not-implemented.
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, error: "not-implemented" });
  });
});
