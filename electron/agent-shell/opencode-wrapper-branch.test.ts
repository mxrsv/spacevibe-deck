import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentWrapperSource } from "./agent-wrappers";

// A directory with a space in it: the exported value has to survive quoting.
const ROOT = mkdtempSync(path.join(tmpdir(), "deck opencode wrapper-"));
const BIN = path.join(ROOT, "agent-shell", "bin");
const REAL = path.join(ROOT, "real");
const MARKER = path.join(ROOT, "agent-shell", "opencode-signals-on");
const CONFIG_DIR = path.join(ROOT, "agent-shell", "opencode");

const FAKE_OPENCODE = `#!/bin/sh
case "$*" in
  --version|--help|'run --help'|'mini --help')
    printf '%s:%s:%s:%s\\n' "$*" "\${DECK_PANE_ID-}" "\${DECK_HOOK_TOKEN-}" "\${OPENCODE_CONFIG_DIR-}" >> "$PROBE_LOG"
    [ "\${PROBE_HANG-}" != 1 ] || exec sleep 20
    [ -z "\${PROBE_SLOW-}" ] || sleep "\${PROBE_SLOW}"
    [ "\${PROBE_FAIL-}" != 1 ] || exit 1
    case "$*" in --version) printf '%s\\n' "\${PROBE_VERSION-1.18.29}" ;; *) printf '%s\\n' "\${PROBE_HELP---standalone}" ;; esac
    exit 0 ;;
esac
printf 'config=%s\\n' "\${OPENCODE_CONFIG_DIR-unset}"
printf 'credentials=%s:%s:%s\\n' "\${DECK_PANE_ID-}" "\${DECK_HOOK_TOKEN-}" "\${DECK_HOOK_PORT-}"
printf 'pid=%s\\n' "$$"
printf 'argv\\0'
printf '%s\\0' "$@"
`;

function run(options: {
  marker: boolean;
  env?: Record<string, string>;
  argv?: string[];
  real?: string;
}): Promise<{
  config: string;
  args: string[];
  credentials: string;
  pid: number;
  spawned: number | undefined;
  probes: string;
}> {
  if (options.marker) writeFileSync(MARKER, "");
  else rmSync(MARKER, { force: true });
  // Explicit env: the shell this suite runs in carries a live Deck's DECK_* variables.
  const probeLog = path.join(ROOT, "probes");
  writeFileSync(probeLog, "");
  const env = {
    PATH: `${BIN}:${options.real ?? REAL}:/usr/bin:/bin`,
    PROBE_LOG: probeLog,
    DECK_PANE_ID: "7",
    DECK_HOOK_TOKEN: "test-token",
    DECK_HOOK_PORT: "12345",
    ...options.env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(BIN, "opencode"), options.argv ?? ["run", "hi there"], {
      env,
      timeout: 10_000,
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", () => {
      const line = (name: string) => stdout.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "";
      resolve({
        config: line("config"),
        args: stdout.split("argv\0")[1]?.split("\0").slice(0, -1) ?? [],
        credentials: line("credentials"),
        pid: Number(line("pid")),
        spawned: child.pid,
        probes: readFileSync(probeLog, "utf8"),
      });
    });
  });
}

describe.skipIf(process.platform === "win32")("opencode wrapper — OC1 plugin directory", () => {
  beforeAll(() => {
    mkdirSync(BIN, { recursive: true });
    mkdirSync(REAL, { recursive: true });
    writeFileSync(
      path.join(BIN, "opencode"),
      agentWrapperSource("opencode", {
        opencodeSignalsMarker: MARKER,
        opencodeConfigDir: CONFIG_DIR,
      }),
    );
    chmodSync(path.join(BIN, "opencode"), 0o755);
    writeFileSync(path.join(REAL, "opencode"), FAKE_OPENCODE);
    chmodSync(path.join(REAL, "opencode"), 0o755);
  });
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  it("exports Deck's config directory while the marker exists, and adds no argument", async () => {
    expect(await run({ marker: true })).toMatchObject({
      config: CONFIG_DIR,
      args: ["run", "hi there"],
    });
  });

  it("replaces a config directory the user exported", async () => {
    const result = await run({ marker: true, env: { OPENCODE_CONFIG_DIR: "/users/own" } });
    expect(result.config).toBe(CONFIG_DIR);
  });

  it("leaves the environment alone without the marker", async () => {
    expect((await run({ marker: false })).config).toBe("unset");
    const own = await run({ marker: false, env: { OPENCODE_CONFIG_DIR: "/users/own" } });
    expect(own.config).toBe("/users/own");
  });

  it("leaves a nested run's configuration to the outer opencode", async () => {
    const nested = await run({
      marker: true,
      env: { DECK_AGENT_ID: "claude", OPENCODE_CONFIG_DIR: "/outer" },
    });
    expect(nested.config).toBe("/outer");
  });

  // Claude Code sets CLAUDECODE for its tool subprocesses: an outer claude that skipped the
  // wrapper still owns the pane, so this opencode is nested and gets no plugin.
  it("leaves the configuration alone under a Claude Code that bypassed the wrapper", async () => {
    const nested = await run({ marker: true, env: { CLAUDECODE: "1" } });
    expect(nested.config).toBe("unset");
  });

  it("adds nothing when the wrapper was rendered without the paths", () => {
    expect(agentWrapperSource("opencode")).not.toContain("OPENCODE_CONFIG_DIR");
    expect(agentWrapperSource("claude", { opencodeSignalsMarker: MARKER })).not.toContain(
      "OPENCODE_CONFIG_DIR",
    );
  });

  it.each(["1.18.29", "1.18.34", "1.19.3"])("supports V1 %s without V2 flags", async (version) => {
    const result = await run({ marker: true, env: { PROBE_VERSION: version } });
    expect(result.config).toBe(CONFIG_DIR);
    expect(result.args).toEqual(["run", "hi there"]);
    expect(result.credentials).toBe("7:test-token:12345");
    expect(result.pid).toBe(result.spawned);
    expect(result.probes).toBe("--version:::\n");
  });

  it.each(["1.18.28", "1.17.99", "0.99.0", "3.0.0", "2.0.32-beta", "garbage", "2.01.0"])(
    "falls back for version %s",
    async (version) => {
      const result = await run({ marker: true, env: { PROBE_VERSION: version } });
      expect(result.config).toBe("unset");
      expect(result.args).toEqual(["run", "hi there"]);
      expect(result.credentials).toBe("::");
    },
  );

  // A new binary's first exec, which macOS checks before it runs (2.1-2.2 s measured).
  it("waits out a slow first exec instead of dropping Signals", { timeout: 15_000 }, async () => {
    expect((await run({ marker: true, env: { PROBE_SLOW: "2.5" } })).config).toBe(CONFIG_DIR);
  });

  // The hanging probe waits out the 5-second watchdog.
  it(
    "bounds failed and hanging probes and preserves the final exec",
    { timeout: 15_000 },
    async () => {
      for (const env of [{ PROBE_FAIL: "1" }, { PROBE_HANG: "1" }]) {
        const result = await run({ marker: true, env });
        expect(result.config).toBe("unset");
        expect(result.pid).toBe(result.spawned);
        expect(result.args).toEqual(["run", "hi there"]);
      }
    },
  );

  it.each([
    [[], ["--standalone"]],
    [
      ["run", "hi there"],
      ["run", "--standalone", "hi there"],
    ],
    [
      ["mini", "--session", "ses_a"],
      ["mini", "--standalone", "--session", "ses_a"],
    ],
    [
      [ROOT, "--continue"],
      ["--standalone", ROOT, "--continue"],
    ],
    [
      ["run", "--", "--server", "two words"],
      ["run", "--standalone", "--", "--server", "two words"],
    ],
    [
      ["run", "--standalone", "hi"],
      ["run", "--standalone", "hi"],
    ],
    [
      ["--prompt", "--server"],
      ["--standalone", "--prompt", "--server"],
    ],
  ])("puts standalone in the verified position for %j", async (argv, expected) => {
    const result = await run({ marker: true, argv, env: { PROBE_VERSION: "opencode v2.0.32" } });
    expect(result.config).toBe(CONFIG_DIR);
    expect(result.args).toEqual(expected);
    expect(result.pid).toBe(result.spawned);
    expect(result.probes).not.toContain("test-token");
  });

  it.each(
    [
      ["run", "--server", "http://localhost:1234", "hi"],
      ["--server=http://localhost:1234"],
      ["attach", "http://localhost:1234"],
      ["run", "--attach=http://localhost:1234", "hi"],
      ["service", "start"],
      ["serve"],
      ["web"],
      ["api", "get", "/api/info"],
      ["acp"],
      ["reload"],
      ["run", "--unknown", "hi"],
      ["run", "--standalone=false", "hi"],
      ["--prompt"],
      ["run", "--dir", ROOT, "hi"],
    ].map((argv) => [argv]),
  )("does not inject into remote, service or unsupported form %j", async (argv) => {
    const result = await run({
      marker: true,
      argv,
      env: { PROBE_VERSION: "opencode v2.0.32", OPENCODE_CONFIG_DIR: "/user/config" },
    });
    expect(result.config).toBe("/user/config");
    expect(result.args).toEqual(argv);
    expect(result.credentials).toBe("::");
  });

  it("requires the resolved V2 command to advertise standalone", async () => {
    const result = await run({
      marker: true,
      env: { PROBE_VERSION: "2.0.32", PROBE_HELP: "no private server" },
    });
    expect(result.config).toBe("unset");
    expect(result.args).toEqual(["run", "hi there"]);
  });

  it("does not probe or inject with Signals off, informational or nested commands", async () => {
    for (const options of [
      { marker: false },
      { marker: true, argv: ["run", "--help", "hi"] },
      { marker: true, env: { DECK_AGENT_ID: "claude" } },
      { marker: true, env: { CLAUDECODE: "1" } },
    ]) {
      const result = await run(options);
      expect(result.probes).toBe("");
      expect(result.config).toBe("unset");
      expect(result.credentials).toBe("::");
    }
  });

  it("detects each resolved executable independently, including paths with spaces", async () => {
    const other = path.join(ROOT, "another real");
    mkdirSync(other);
    writeFileSync(
      path.join(other, "opencode"),
      FAKE_OPENCODE.replace("PROBE_VERSION-1.18.29", "PROBE_VERSION-opencode v2.0.32"),
      { mode: 0o755 },
    );
    expect((await run({ marker: true })).args).toEqual(["run", "hi there"]);
    expect((await run({ marker: true, real: other })).args).toEqual([
      "run",
      "--standalone",
      "hi there",
    ]);
    expect((await run({ marker: true })).args).toEqual(["run", "hi there"]);
  });
});
