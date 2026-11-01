/**
 * How a pane's shell starts so Deck's wrappers come first on `PATH` without
 * disturbing the user's own startup files (shell bootstrap and agent wrappers,
 * slice 1 of the agent-status queue). The approach is Superset's, with
 * `DECK_*` names:
 *
 * - zsh: `-l` with `ZDOTDIR` pointing at Deck's dotfiles. Each one sources the
 *   user's file of the same name, then hands startup back to the next Deck
 *   file. `.zshrc` and `.zlogin` add the bin directory and move it back to the
 *   front of `PATH` from a `precmd` hook.
 * - bash: `--rcfile` sourcing the login files itself, so it is not a login
 *   shell any more.
 * - fish: `-l --init-command` with a list-aware prepend.
 * - anything else: no bootstrap, `$SHELL -l` as before.
 *
 * Three deliberate departures from Superset's zsh files:
 * - After the user's file runs, the `ZDOTDIR` it left behind is remembered in
 *   `DECK_ORIG_ZDOTDIR`. A `.zshenv` that relocates the dotfiles (the XDG
 *   `~/.config/zsh` layout) therefore still reaches the user's real `.zshrc`.
 * - macOS `/etc/zshrc` runs while `ZDOTDIR` is still Deck's and derives
 *   `HISTFILE` from it; the `.zshrc` stage points that value back at the user's
 *   history before their `.zshrc` runs.
 * - The shell never gets a readiness marker or a prompt; Deck reads its own.
 */
import os from "node:os";
import path from "node:path";
import { shellQuote } from "../agent-hooks/claude-hooks-file";

export const AGENT_SHELL_DIR = "agent-shell";

export interface AgentShellPaths {
  /** Directory holding the agent wrappers. */
  readonly binDir: string;
  readonly zshDir: string;
  readonly bashRcfile: string;
}

export interface BootstrapLaunch {
  readonly executable: string;
  readonly args: readonly string[];
  /** Added to the pane's environment; empty for shells that need none. */
  readonly env: Readonly<Record<string, string>>;
}

/** Exists while Codex Signals is on; the Codex wrapper reads it at exec time (CX2). */
export function codexSignalsMarkerPath(userDataDir: string): string {
  return path.join(userDataDir, AGENT_SHELL_DIR, "codex-signals-on");
}

/** Exists while opencode Signals is on; the opencode wrapper reads it at exec time (OC1). */
export function opencodeSignalsMarkerPath(userDataDir: string): string {
  return path.join(userDataDir, AGENT_SHELL_DIR, "opencode-signals-on");
}

/** What the opencode wrapper exports as `OPENCODE_CONFIG_DIR`; Deck's plugin lives in `plugin/`. */
export function opencodeConfigDir(userDataDir: string): string {
  return path.join(userDataDir, AGENT_SHELL_DIR, "opencode");
}

export function agentShellPaths(userDataDir: string): AgentShellPaths {
  const root = path.join(userDataDir, AGENT_SHELL_DIR);
  return {
    binDir: path.join(root, "bin"),
    zshDir: path.join(root, "zsh"),
    bashRcfile: path.join(root, "bash", "rcfile"),
  };
}

/** Name the user's shell by basename, `-zsh`-style dashes and all. */
function shellName(executable: string): string {
  return (executable.split("/").pop() ?? executable).replace(/^-+/, "");
}

/**
 * The variables Deck sets on a pane (`buildEnv`, `bootstrapLaunch`) or the
 * wrappers set later. A user's rc file may unset or overwrite any of them.
 */
const DECK_VARIABLES = [
  "DECK_PANE_ID",
  "DECK_HOOK_TOKEN",
  "DECK_HOOK_PORT",
  "DECK_CLAUDE_HOOK_SCRIPT",
  "DECK_CODEX_HOOK_SCRIPT",
  "DECK_AGENT_ID",
  "DECK_AGENT_NESTED",
  "DECK_AGENT_PID",
  "DECK_ORIG_ZDOTDIR",
] as const;

// Saved and restored by NAME, never by eval'ing `export -p` text: a multi-line
// value of any variable could otherwise smuggle in a line that looks like one
// of ours. Each variable is remembered as set-or-unset plus its value, then put
// back exactly. Plain sh syntax, so it runs in both zsh and bash.
const SAVE_ENV = DECK_VARIABLES.map(
  (name) =>
    `if [ -n "\${${name}+x}" ]; then _deck_set_${name}=1; _deck_val_${name}=$${name}; else _deck_set_${name}=; fi`,
).join("\n");
const RESTORE_ENV = DECK_VARIABLES.map(
  (name) =>
    `if [ -n "$_deck_set_${name}" ]; then export ${name}="$_deck_val_${name}"; else unset ${name}; fi`,
).join("\n");
const FORGET_ENV = `unset ${DECK_VARIABLES.flatMap((name) => [`_deck_set_${name}`, `_deck_val_${name}`]).join(" ")}`;

/** Idempotently prepend the bin directory to PATH (sh, zsh and bash). */
function prependBinFunction(binDir: string): string {
  const dir = shellQuote(binDir);
  return [
    "_deck_prepend_bin() {",
    '  case ":$PATH:" in',
    `    *:${dir}:*) ;;`,
    `    *) export PATH=${dir}:"$PATH" ;;`,
    "  esac",
    "}",
    "_deck_prepend_bin",
  ].join("\n");
}

/**
 * A zsh `precmd` hook moving the bin directory back to the front. mise and asdf
 * rebuild PATH in their own `precmd`, and `nvm use` or `conda activate` prepend
 * at the prompt, either way ahead of the wrapper; ours stays last so it wins.
 * `emulate -L` keeps a user's `KSH_ARRAYS` or `NO_UNSET` out of the array code.
 */
function zshPrecmdHook(binDir: string): string {
  const dir = shellQuote(binDir);
  return [
    "typeset -ga precmd_functions 2>/dev/null || true",
    "_deck_ensure_path() {",
    "  emulate -L zsh",
    `  [[ $path[1] == ${dir} ]] || path=(${dir} \${path:#${dir}})`,
    "}",
    "{",
    "  precmd_functions=(${precmd_functions:#_deck_ensure_path} _deck_ensure_path)",
    "} 2>/dev/null || true",
  ].join("\n");
}

/**
 * `/etc/zshrc` (macOS) sets `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` while
 * `ZDOTDIR` is Deck's, which would move the pane's history into userData. Only
 * that exact value is repointed, to where the same line puts it without Deck.
 */
function zshHistfileRepair(zshDir: string): string {
  return [
    `if [[ "\${HISTFILE-}" == ${shellQuote(`${zshDir}/.zsh_history`)} ]]; then`,
    '  HISTFILE="${DECK_ORIG_ZDOTDIR:-$HOME}/.zsh_history"',
    "fi",
  ].join("\n");
}

/**
 * One Deck stage of zsh's startup: run the user's file of the same name with
 * their `ZDOTDIR` in place, then put Deck's `ZDOTDIR` back so zsh continues
 * into Deck's next file. `before` runs just before the user's file; `after`
 * runs once the user's variables are restored; `last` leaves the user's
 * `ZDOTDIR` in place instead (the final stage).
 */
function zshStage(
  file: string,
  zshDir: string,
  options: { before?: string; after?: string; guard?: string; last?: boolean },
) {
  const { before, after, guard, last = false } = options;
  const userFile = `"$ZDOTDIR/${file}"`;
  const source = `[[ -f ${userFile} ]] && source ${userFile}`;
  return [
    `# SpaceVibe Deck zsh startup wrapper (${file}) - Deck-written, overwritten at launch.`,
    SAVE_ENV,
    // Empty or unset means the home directory, as in zsh itself.
    'export ZDOTDIR="${DECK_ORIG_ZDOTDIR:-$HOME}"',
    ...(before === undefined ? [] : [before]),
    guard === undefined ? source : `if ${guard}; then\n  ${source}\nfi`,
    '_deck_user_zdotdir="${ZDOTDIR:-$HOME}"',
    RESTORE_ENV,
    'export DECK_ORIG_ZDOTDIR="$_deck_user_zdotdir"',
    ...(after === undefined ? [] : [after]),
    last ? 'export ZDOTDIR="$_deck_user_zdotdir"' : `export ZDOTDIR=${shellQuote(zshDir)}`,
    `${FORGET_ENV} _deck_user_zdotdir`,
    "",
  ].join("\n");
}

/** Deck's four zsh dotfiles, keyed by file name. */
export function zshDotfiles(paths: AgentShellPaths): Record<string, string> {
  const dir = paths.zshDir;
  const repair = [
    zshPrecmdHook(paths.binDir),
    prependBinFunction(paths.binDir),
    "rehash 2>/dev/null || true",
  ].join("\n");
  return {
    ".zshenv": zshStage(".zshenv", dir, {}),
    ".zprofile": zshStage(".zprofile", dir, {}),
    ".zshrc": zshStage(".zshrc", dir, { before: zshHistfileRepair(dir), after: repair }),
    ".zlogin": zshStage(".zlogin", dir, {
      after: repair,
      guard: "[[ -o interactive ]]",
      last: true,
    }),
  };
}

/** The bash `--rcfile`: what a login shell would read, then Deck's PATH. */
export function bashRcfile(paths: AgentShellPaths): string {
  return [
    "# SpaceVibe Deck bash rcfile - Deck-written, overwritten at launch.",
    SAVE_ENV,
    "[[ -f /etc/profile ]] && source /etc/profile",
    'if [[ -f "$HOME/.bash_profile" ]]; then',
    '  source "$HOME/.bash_profile"',
    'elif [[ -f "$HOME/.bash_login" ]]; then',
    '  source "$HOME/.bash_login"',
    'elif [[ -f "$HOME/.profile" ]]; then',
    '  source "$HOME/.profile"',
    "fi",
    '[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"',
    RESTORE_ENV,
    prependBinFunction(paths.binDir),
    "hash -r 2>/dev/null || true",
    FORGET_ENV,
    "",
  ].join("\n");
}

function escapeFishDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$");
}

const FISH_BIN_PREFIX = 'set -l _deck_bin "';

/**
 * An `if` block, not `contains …; or set …`: fish's `set` passes the previous
 * status through, so that form left `$status` at 1 and the first prompt of
 * every pane showed a failed command.
 */
const FISH_PREPEND = [
  'if not contains -- "$_deck_bin" $PATH',
  'set -gx PATH "$_deck_bin" $PATH',
  "end",
].join("; ");

function fishInitCommand(binDir: string): string {
  return `${FISH_BIN_PREFIX}${escapeFishDoubleQuoted(binDir)}"; ${FISH_PREPEND}`;
}

const BASH_RCFILE_TAIL = `/${AGENT_SHELL_DIR}/bash/rcfile`;

/**
 * Whether `commandLine`, as `ps` prints it, is a pane shell exactly as
 * `bootstrapLaunch` started it and nothing more. `ps` drops the quoting, so a
 * generic argument parse reads the spaces in `Application Support`, or the
 * fish init text, as a command, and an idle pane looks busy. Anything after
 * Deck's own arguments (`-c`, a script) is not this launch, and falls back to
 * that parse.
 */
export function isBootstrapCommandLine(shell: string, commandLine: string): boolean {
  const onlyExecutableBefore = (at: number) => at > 0 && !/\s[-+]/.test(commandLine.slice(0, at));
  switch (shellName(shell)) {
    case "bash": {
      const at = commandLine.indexOf(" --rcfile ");
      return onlyExecutableBefore(at) && commandLine.endsWith(BASH_RCFILE_TAIL);
    }
    case "fish": {
      const at = commandLine.indexOf(` -l --init-command ${FISH_BIN_PREFIX}`);
      return onlyExecutableBefore(at) && commandLine.endsWith(`"; ${FISH_PREPEND}`);
    }
    default:
      return false;
  }
}

/**
 * Launch description for `shell` with Deck's bootstrap, or null when this
 * shell gets none and the caller should start `$SHELL -l` as before.
 * `baseEnv` is only read for `ZDOTDIR` and `HOME`.
 */
export function bootstrapLaunch(
  shell: string,
  paths: AgentShellPaths,
  baseEnv: NodeJS.ProcessEnv = process.env,
): BootstrapLaunch | null {
  switch (shellName(shell)) {
    case "zsh":
      return {
        executable: shell,
        args: ["-l"],
        env: {
          ZDOTDIR: paths.zshDir,
          DECK_ORIG_ZDOTDIR: baseEnv.ZDOTDIR || baseEnv.HOME || os.homedir(),
        },
      };
    case "bash":
      return { executable: shell, args: ["--rcfile", paths.bashRcfile], env: {} };
    case "fish":
      return {
        executable: shell,
        args: ["-l", "--init-command", fishInitCommand(paths.binDir)],
        env: {},
      };
    default:
      return null;
  }
}
