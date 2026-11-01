import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as macos from "../platform/macos";
import { provisionAgentShell } from "./provision";
import {
  agentShellPaths,
  bootstrapLaunch,
  zshDotfiles,
  type AgentShellPaths,
} from "./shell-bootstrap";

const ROOT = mkdtempSync(path.join(tmpdir(), "deck-bootstrap-"));
const PATHS = agentShellPaths("/Users/dev/Library/Application Support/Deck");

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("bootstrapLaunch", () => {
  it("starts zsh as a login shell under Deck's ZDOTDIR, remembering the user's", () => {
    expect(bootstrapLaunch("/bin/zsh", PATHS, { HOME: "/Users/dev" })).toEqual({
      executable: "/bin/zsh",
      args: ["-l"],
      env: { ZDOTDIR: PATHS.zshDir, DECK_ORIG_ZDOTDIR: "/Users/dev" },
    });
    expect(bootstrapLaunch("/bin/zsh", PATHS, { HOME: "/h", ZDOTDIR: "/h/zd" })?.env).toEqual({
      ZDOTDIR: PATHS.zshDir,
      DECK_ORIG_ZDOTDIR: "/h/zd",
    });
  });

  it("points bash at the rcfile", () => {
    expect(bootstrapLaunch("/usr/local/bin/bash", PATHS)).toEqual({
      executable: "/usr/local/bin/bash",
      args: ["--rcfile", PATHS.bashRcfile],
      env: {},
    });
  });

  it("gives fish a quoted, list-aware init command", () => {
    const paths: AgentShellPaths = { ...PATHS, binDir: '/tmp/we"ird $dir/agent-shell/bin' };
    const launch = bootstrapLaunch("/opt/homebrew/bin/fish", paths);
    expect(launch?.args.slice(0, 2)).toEqual(["-l", "--init-command"]);
    expect(launch?.args[2]).toContain('set -l _deck_bin "/tmp/we\\"ird \\$dir/agent-shell/bin"');
    expect(launch?.args[2]).toContain(
      'if not contains -- "$_deck_bin" $PATH; set -gx PATH "$_deck_bin" $PATH; end',
    );
    expect(launch?.env).toEqual({});
  });

  it.each(["/bin/sh", "/bin/ksh", "/usr/bin/nu", "csh"])("leaves %s alone", (shell) => {
    expect(bootstrapLaunch(shell, PATHS)).toBeNull();
  });
});

describe("macos.shellLaunch", () => {
  const savedShell = process.env.SHELL;
  afterEach(() => {
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
  });

  it("stays `$SHELL -l` without a bootstrap, which is every caller but a pane spawn", () => {
    process.env.SHELL = "/bin/zsh";
    expect(macos.shellLaunch()).toEqual({ executable: "/bin/zsh", args: ["-l"] });
    expect(macos.shellLaunch(null)).toEqual({ executable: "/bin/zsh", args: ["-l"] });
  });

  it("applies the bootstrap per shell and falls back for one that gets none", () => {
    process.env.SHELL = "/bin/bash";
    expect(macos.shellLaunch(PATHS)).toMatchObject({ args: ["--rcfile", PATHS.bashRcfile] });
    process.env.SHELL = "/bin/ksh";
    expect(macos.shellLaunch(PATHS)).toEqual({ executable: "/bin/ksh", args: ["-l"] });
  });
});

// --- real shells ------------------------------------------------------------
// A scratch HOME holds startup files that behave like a real user's: they add
// PATH entries, define an alias, unset Deck's variables and (zsh) rewrite PATH
// from a `precmd`. The shells run with an explicit environment, never the live
// DECK_* variables of the Deck this suite may be running inside.

function which(shell: string): string | null {
  const found = spawnSync("which", [shell], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : null;
}

const SHELLS = { zsh: which("zsh"), bash: which("bash"), fish: which("fish") };

let paths: AgentShellPaths;
let homeCount = 0;

beforeAll(async () => {
  const provisioned = await provisionAgentShell(path.join(ROOT, "userData"));
  if (provisioned === null) throw new Error("provisioning failed");
  paths = provisioned;
});

/** Scratch HOME; `files` are paths relative to it. `$BIN` is Deck's bin dir. */
function makeHome(files: Record<string, string>): string {
  const home = path.join(ROOT, `home-${(homeCount += 1)}`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    writeFileSync(path.join(home, file), text.replaceAll("$BIN", paths.binDir));
  }
  // The user's own `claude`, which Deck's wrapper must still beat.
  mkdirSync(path.join(home, "c"), { recursive: true });
  writeFileSync(path.join(home, "c", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  return home;
}

interface Startup {
  /** Lines the probe printed with the `T:` prefix. */
  readonly lines: string[];
  readonly stderr: string;
}

const PANE_ENV = { DECK_PANE_ID: "7", DECK_HOOK_TOKEN: "tok", DECK_HOOK_PORT: "1234" };

function startup(shell: string, home: string, probe: string[], extra = {}): Startup {
  const env: Record<string, string> = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    TERM: "dumb",
    ...extra,
  };
  const launch = bootstrapLaunch(shell, paths, env);
  if (launch === null) throw new Error(`no bootstrap for ${shell}`);
  const isFish = path.basename(shell) === "fish";
  // fish takes its probe with -c; zsh and bash read it as an interactive session.
  const args = isFish ? [...launch.args, "-c", probe.join("\n")] : [...launch.args, "-i"];
  const result = spawnSync(shell, args, {
    env: { ...env, ...PANE_ENV, ...launch.env },
    input: isFish ? undefined : `${probe.join("\n")}\nexit\n`,
    encoding: "utf8",
    timeout: 20_000,
  });
  const lines = result.stdout.split("\n").filter((line) => line.startsWith("T:"));
  return { lines, stderr: result.stderr };
}

function field(run: Startup, name: string): string {
  const prefix = `T:${name}=`;
  const line = run.lines.find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`no ${name} in ${JSON.stringify(run.lines)}\n${run.stderr}`);
  }
  return line.slice(prefix.length);
}

/** The scratch entries of a PATH string, in order. */
function scratchEntries(pathValue: string, home: string): string[] {
  return pathValue.split(":").filter((entry) => entry.startsWith(home) || entry === paths.binDir);
}

// A multi-line value whose continuation line looks like one of Deck's exports.
const INJECTING = { UNRELATED: "a\nexport DECK_INJECTED=pwned; echo T:injected=1\nb" };
const INJECTION_PROBE = ['echo "T:injection=${DECK_INJECTED:-none}"'];

function expectNoInjection(result: Startup): void {
  expect(field(result, "injection")).toBe("none");
  expect(result.lines).not.toContain("T:injected=1");
}

const POSIX_PROBE = [
  'echo "T:claude=$(command -v claude)"',
  'echo "T:path=$PATH"',
  'echo "T:ids=$DECK_PANE_ID,$DECK_HOOK_TOKEN,$DECK_HOOK_PORT"',
  "greet",
];

describe.skipIf(process.platform === "win32")("zsh startup", () => {
  const zsh = SHELLS.zsh;

  const userFiles = (dir: string) => ({
    [`${dir}.zshenv`]: 'path=("$HOME/a" $path)\nexport T_ENV=1\n',
    [`${dir}.zprofile`]: 'path=("$HOME/b" $path)\n',
    [`${dir}.zshrc`]: [
      'path=("$HOME/c" $path)',
      "alias greet='echo T:greet=alias-works'",
      // A tool like mise that rebuilds PATH, here dropping Deck's directory.
      '_user_precmd() { path=(${path:#"$BIN"}) }',
      "precmd_functions+=(_user_precmd)",
      "unset DECK_PANE_ID DECK_HOOK_TOKEN",
      "export T_RC=1\n",
    ].join("\n"),
    [`${dir}.zlogin`]: "export T_LOGIN=1\n",
  });

  const zshProbe = [
    ...POSIX_PROBE,
    'echo "T:zdotdir=$ZDOTDIR"',
    'echo "T:ran=$T_ENV$T_RC$T_LOGIN"',
    // The prompt would run these; do it by hand, then look again.
    "for f in $precmd_functions; do $f; done",
    'echo "T:claudeAfterPrecmd=$(command -v claude)"',
  ];

  it.skipIf(zsh === null)(
    "keeps the user's PATH order, alias and variables, with Deck's wrapper first",
    () => {
      const home = makeHome(userFiles(""));
      const result = startup(zsh!, home, zshProbe);
      const wrapper = path.join(paths.binDir, "claude");
      expect(field(result, "claude")).toBe(wrapper);
      expect(scratchEntries(field(result, "path"), home)).toEqual([
        paths.binDir,
        path.join(home, "c"),
        path.join(home, "b"),
        path.join(home, "a"),
      ]);
      expect(field(result, "greet")).toBe("alias-works");
      expect(field(result, "ran")).toBe("111");
      expect(field(result, "zdotdir")).toBe(home);
      expect(field(result, "claudeAfterPrecmd")).toBe(wrapper);
    },
  );

  it.skipIf(zsh === null)("survives an rc file that unsets the DECK_* variables", () => {
    const home = makeHome(userFiles(""));
    expect(field(startup(zsh!, home, zshProbe), "ids")).toBe("7,tok,1234");
  });

  it.skipIf(zsh === null)("does not run text smuggled in another variable's value", () => {
    const home = makeHome(userFiles(""));
    expectNoInjection(startup(zsh!, home, [...zshProbe, ...INJECTION_PROBE], INJECTING));
  });

  it.skipIf(zsh === null)("follows an inherited ZDOTDIR and leaves it in place", () => {
    const home = makeHome({});
    const zdotdir = path.join(home, "zd");
    for (const [file, text] of Object.entries(userFiles("zd/"))) {
      mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
      writeFileSync(path.join(home, file), text.replaceAll("$BIN", paths.binDir));
    }
    const result = startup(zsh!, home, zshProbe, { ZDOTDIR: zdotdir });
    expect(field(result, "ran")).toBe("111");
    expect(field(result, "zdotdir")).toBe(zdotdir);
    expect(field(result, "claude")).toBe(path.join(paths.binDir, "claude"));
  });

  it.skipIf(zsh === null)("reaches a .zshrc that a .zshenv relocates (XDG layout)", () => {
    const home = makeHome({
      ".zshenv": 'export ZDOTDIR="$HOME/.config/zsh"\n',
      ".config/zsh/.zshrc": "alias greet='echo T:greet=xdg-zshrc-ran'\nexport T_RC=1\n",
    });
    const result = startup(zsh!, home, zshProbe);
    expect(field(result, "greet")).toBe("xdg-zshrc-ran");
    expect(field(result, "zdotdir")).toBe(path.join(home, ".config", "zsh"));
    expect(field(result, "claude")).toBe(path.join(paths.binDir, "claude"));
  });

  // What `nvm use` or `conda activate` does at the prompt, and mise in a `precmd`: the
  // user's own `claude` lands ahead of a wrapper that is still on PATH.
  it.skipIf(zsh === null)("moves the wrapper back in front of a directory prepended later", () => {
    const home = makeHome({
      ".zshrc": [
        "setopt no_unset",
        '_mise_like() { path=("$HOME/c" ${path:#"$HOME/c"}) }',
        "precmd_functions+=(_mise_like)",
        "",
      ].join("\n"),
    });
    const result = startup(zsh!, home, [
      "for f in $precmd_functions; do $f; done",
      'echo "T:afterPrecmd=$(command -v claude)"',
      'PATH="$HOME/c:$PATH"',
      "for f in $precmd_functions; do $f; done",
      'echo "T:afterPrompt=$(command -v claude)"',
      'echo "T:path=$PATH"',
    ]);
    const wrapper = path.join(paths.binDir, "claude");
    expect(field(result, "afterPrecmd")).toBe(wrapper);
    expect(field(result, "afterPrompt")).toBe(wrapper);
    expect(scratchEntries(field(result, "path"), home)).toEqual([
      paths.binDir,
      path.join(home, "c"),
    ]);
  });

  // macOS /etc/zshrc sets HISTFILE from ZDOTDIR while it is still Deck's. The inherited
  // value stands in for that line where the system file does not set it (Linux).
  const deckHistory = () => ({ HISTFILE: `${paths.zshDir}/.zsh_history` });
  const historyProbe = ['echo "T:histfile=$HISTFILE"'];

  it.skipIf(zsh === null)("keeps the user's history file out of Deck's ZDOTDIR", () => {
    // Oh My Zsh's lib/history.zsh keeps a HISTFILE that is already set.
    const home = makeHome({ ".zshrc": '[ -z "$HISTFILE" ] && HISTFILE="$HOME/.zsh_history"\n' });
    const result = startup(zsh!, home, historyProbe, deckHistory());
    expect(field(result, "histfile")).toBe(path.join(home, ".zsh_history"));
  });

  it.skipIf(zsh === null)("puts the history file in a ZDOTDIR a .zshenv relocates", () => {
    const home = makeHome({ ".zshenv": 'export ZDOTDIR="$HOME/.config/zsh"\n' });
    const result = startup(zsh!, home, historyProbe, deckHistory());
    expect(field(result, "histfile")).toBe(path.join(home, ".config", "zsh", ".zsh_history"));
  });

  it.skipIf(zsh === null)("leaves a history file the user's .zshrc names", () => {
    const home = makeHome({ ".zshrc": 'HISTFILE="$HOME/elsewhere"\n' });
    const result = startup(zsh!, home, historyProbe, deckHistory());
    expect(field(result, "histfile")).toBe(path.join(home, "elsewhere"));
  });

  it("renders four dotfiles that each end by handing startup on", () => {
    const files = zshDotfiles(PATHS);
    expect(Object.keys(files).sort()).toEqual([".zlogin", ".zprofile", ".zshenv", ".zshrc"]);
    expect(files[".zlogin"]).toContain('export ZDOTDIR="$_deck_user_zdotdir"');
    expect(files[".zshenv"]).toContain(`export ZDOTDIR='${PATHS.zshDir}'`);
  });

  it("repoints only Deck's own history path, in .zshrc before the user's file runs", () => {
    const files = zshDotfiles(PATHS);
    const repair = `if [[ "\${HISTFILE-}" == '${PATHS.zshDir}/.zsh_history' ]]; then\n  HISTFILE="\${DECK_ORIG_ZDOTDIR:-$HOME}/.zsh_history"\nfi`;
    const zshrc = files[".zshrc"];
    expect(zshrc).toContain(repair);
    expect(zshrc.indexOf(repair)).toBeLessThan(zshrc.indexOf('source "$ZDOTDIR/.zshrc"'));
    for (const other of [".zshenv", ".zprofile", ".zlogin"]) {
      expect(files[other]).not.toContain("HISTFILE");
    }
  });
});

describe.skipIf(process.platform === "win32")("bash startup", () => {
  const bash = SHELLS.bash;

  const bashFiles = {
    ".bash_profile": 'export PATH="$HOME/a:$PATH"\n[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
    ".bashrc": [
      'export PATH="$HOME/c:$PATH"',
      "alias greet='echo T:greet=alias-works'",
      "unset DECK_PANE_ID DECK_HOOK_TOKEN",
      "",
    ].join("\n"),
  };

  it.skipIf(bash === null)(
    "keeps the user's PATH order and alias, with Deck's wrapper first",
    () => {
      const home = makeHome(bashFiles);
      const result = startup(bash!, home, POSIX_PROBE);
      expect(field(result, "claude")).toBe(path.join(paths.binDir, "claude"));
      // .bashrc is sourced twice (once by the profile), so entries may repeat.
      const entries = [...new Set(scratchEntries(field(result, "path"), home))];
      expect(entries).toEqual([paths.binDir, path.join(home, "c"), path.join(home, "a")]);
      expect(field(result, "greet")).toBe("alias-works");
    },
  );

  it.skipIf(bash === null)("does not run text smuggled in another variable's value", () => {
    const home = makeHome(bashFiles);
    expectNoInjection(startup(bash!, home, [...POSIX_PROBE, ...INJECTION_PROBE], INJECTING));
  });

  it.skipIf(bash === null)("survives an rc file that unsets the DECK_* variables", () => {
    const home = makeHome(bashFiles);
    expect(field(startup(bash!, home, POSIX_PROBE), "ids")).toBe("7,tok,1234");
  });
});

describe.skipIf(process.platform === "win32")("fish startup", () => {
  const fish = SHELLS.fish;

  it.skipIf(fish === null)(
    "puts Deck's wrapper first, keeps the user's PATH entry and alias, and leaves no failed status",
    () => {
      const home = makeHome({
        ".config/fish/config.fish": [
          "set -gx PATH $HOME/c $PATH",
          "alias greet 'echo T:greet=alias-works'",
          "",
        ].join("\n"),
      });
      const result = startup(
        fish!,
        home,
        [
          // First, while `$status` is still the init command's: a 1 here is the
          // `[1]` a status-aware prompt prints on every new pane.
          'echo "T:status=$status"',
          'echo "T:claude="(type -p claude)',
          'echo "T:path="(string join : $PATH)',
          "greet",
        ],
        { XDG_CONFIG_HOME: path.join(home, ".config") },
      );
      expect(field(result, "claude")).toBe(path.join(paths.binDir, "claude"));
      expect(scratchEntries(field(result, "path"), home)).toEqual([
        paths.binDir,
        path.join(home, "c"),
      ]);
      expect(field(result, "greet")).toBe("alias-works");
      expect(field(result, "status")).toBe("0");
    },
  );
});
