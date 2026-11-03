/**
 * Write the agent wrappers and shell bootstrap files under
 * `<userData>/agent-shell/` at boot (shell bootstrap and agent wrappers,
 * slice 1 of the agent-status queue).
 *
 * Every file is written to a sibling temp file and renamed over its target. A
 * pane that is mid-startup, or a wrapper already running, keeps the inode it
 * opened; nobody ever reads a half-written script.
 *
 * With the `agentControl` switch on, the in-pane `deck` command is written beside the wrappers
 * (spec 2026-11-03-agent-orchestration, ORC1). With it off nothing is written, and a `deck` an
 * earlier development run left behind is removed so a release build never serves a stale one.
 *
 * A failure answers null: panes then start `$SHELL -l` as they did before, and
 * the wrappers are simply absent. It never stops Deck from booting.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WRAPPED_AGENTS, agentWrapperSource, type WrapperOptions } from "./agent-wrappers";
import { DECK_CLI_FILE, deckCliSource } from "./deck-cli";
import { OPENCODE_PLUGIN_FILE, opencodePluginSource } from "./opencode-plugin";
import {
  agentShellPaths,
  bashRcfile,
  codexSignalsMarkerPath,
  opencodeConfigDir,
  opencodeSignalsMarkerPath,
  zshDotfiles,
  type AgentShellPaths,
} from "./shell-bootstrap";

const SCRIPT_MODE = 0o755;
const DOTFILE_MODE = 0o644;

async function writeAtomic(file: string, text: string, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, text, { encoding: "utf8", mode });
    await fs.chmod(temp, mode);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Where plain opencode reads the user's global AGENTS.md: its config directory, by the
 * xdg-basedir rule opencode uses. Main's env decides, so an `XDG_CONFIG_HOME` set only in a
 * shell rc misses an app started from the Dock.
 */
export function userOpencodeInstructions(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode", "AGENTS.md");
}

/**
 * opencode takes its global AGENTS.md from the config directory, which `OPENCODE_CONFIG_DIR`
 * replaces. In Deck's directory it found none and fell back to `~/.claude/CLAUDE.md`
 * (opencode 1.19.0). This link restores the user's file; dangling, it reads as absent, which
 * is what plain opencode sees when the user has none.
 */
async function linkOpencodeInstructions(
  userDataDir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const link = path.join(opencodeConfigDir(userDataDir), "AGENTS.md");
  const temp = `${link}.${process.pid}.tmp`;
  try {
    await fs.rm(temp, { force: true });
    await fs.symlink(userOpencodeInstructions(env), temp);
    await fs.rename(temp, link);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** The options every install's wrappers are rendered with. */
export function wrapperOptions(userDataDir: string): WrapperOptions {
  return {
    codexSignalsMarker: codexSignalsMarkerPath(userDataDir),
    opencodeSignalsMarker: opencodeSignalsMarkerPath(userDataDir),
    opencodeConfigDir: opencodeConfigDir(userDataDir),
  };
}

export interface ProvisionOptions {
  /** Write the in-pane `deck` command (the `agentControl` switch, resolved by main). */
  readonly agentControl?: boolean;
}

export async function provisionAgentShell(
  userDataDir: string,
  log: (message: string, error: unknown) => void = console.warn,
  env: NodeJS.ProcessEnv = process.env,
  options: ProvisionOptions = {},
): Promise<AgentShellPaths | null> {
  const paths = agentShellPaths(userDataDir);
  const deckCli = path.join(paths.binDir, DECK_CLI_FILE);
  try {
    await Promise.all([
      ...WRAPPED_AGENTS.map((agent) =>
        writeAtomic(
          path.join(paths.binDir, agent),
          agentWrapperSource(agent, wrapperOptions(userDataDir)),
          SCRIPT_MODE,
        ),
      ),
      ...(options.agentControl === true
        ? [writeAtomic(deckCli, deckCliSource(), SCRIPT_MODE)]
        : []),
      writeAtomic(
        path.join(opencodeConfigDir(userDataDir), "plugin", OPENCODE_PLUGIN_FILE),
        opencodePluginSource(),
        DOTFILE_MODE,
      ),
      ...Object.entries(zshDotfiles(paths)).map(([name, text]) =>
        writeAtomic(path.join(paths.zshDir, name), text, DOTFILE_MODE),
      ),
      writeAtomic(paths.bashRcfile, bashRcfile(paths), DOTFILE_MODE),
    ]);
  } catch (error) {
    log("Deck: the agent wrappers could not be written; panes start a plain login shell.", error);
    return null;
  }
  if (options.agentControl !== true) {
    // Apart from the writes above, like the link below: a stale file we cannot remove must not
    // take the wrappers down with it. `force` makes a file that is already absent a success.
    await fs.rm(deckCli, { force: true }).catch((error: unknown) => {
      log("Deck: a stale deck command could not be removed from the agent-shell bin.", error);
    });
  }
  // Apart from the writes above: a failed link costs opencode its global AGENTS.md, never
  // every agent its wrapper. Windows panes get no wrappers, and a symlink needs privilege there.
  if (process.platform !== "win32") {
    await linkOpencodeInstructions(userDataDir, env).catch((error: unknown) => {
      log("Deck: opencode in Deck panes cannot read your global AGENTS.md.", error);
    });
  }
  return paths;
}
