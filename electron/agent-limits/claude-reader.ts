import fs from "node:fs/promises";
import path from "node:path";
import {
  claudeUserSettingsPath,
  updateClaudeUserSettings,
} from "../agent-hooks/claude-user-settings";
import { shellQuote } from "../agent-hooks/claude-hooks-file";
import { writeFileAtomically } from "../fs/write";
import {
  absentLimits,
  claudeLimits,
  limitRecord,
  type AgentLimitReading,
} from "../../src/lib/agent-limits";
import { claudeStatuslineSource } from "./claude-statusline";

const MAX_CAPTURE_BYTES = 16384;
const MAX_CAPTURES = 64;
const MANIFEST = "statusline-owner.json";
const SCRIPT = "claude-statusline.cjs";

export interface ClaudeLimitOptions {
  readonly directory: string;
  readonly executable: string;
  readonly settingsPath?: string;
}

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// The tail every wrapper below has carried since the first release: the user's
// own command, shell-quoted, or `:` when there was none.
const WRAPPER_FALLBACK = /; else sh -c ((?:'[^']*'|\\')+); fi$/;

/**
 * The command a Deck wrapper stands in front of: `null` when the user had no
 * status line, `undefined` when `command` is not a Deck wrapper. Read from
 * the wrapper itself rather than a manifest because the wrapper may belong to
 * another Deck install (a dev build, an older release keyed to its own
 * userData) whose manifest this one cannot find. Every Deck layer is peeled:
 * each one repeats its inner command twice, so a stacked wrapper doubles in
 * size per layer and would eventually exceed the OS argument limit.
 */
function wrappedCommand(command: unknown): string | null | undefined {
  let result: string | null | undefined;
  for (let current = command; typeof current === "string";) {
    const inner = unwrapOnce(current);
    if (inner === undefined) break;
    result = current = inner;
  }
  return result;
}

function unwrapOnce(command: string): string | null | undefined {
  if (!command.startsWith("if [ -x ") || !command.includes(SCRIPT)) return undefined;
  const quoted = WRAPPER_FALLBACK.exec(command)?.[1];
  if (quoted === undefined) return undefined;
  const unquoted = quoted.replace(/'([^']*)'|\\'/g, (_match, inner?: string) => inner ?? "'");
  return unquoted === ":" ? null : unquoted;
}

/**
 * Wrap the user's command and retain all other status-line options/settings.
 * The last Deck install to start owns the wrapper: it re-wraps any Deck
 * wrapper with its own executable, and every install reads the same captures.
 */
export async function installClaudeLimitCollector(options: ClaudeLimitOptions): Promise<void> {
  const script = path.join(options.directory, SCRIPT);
  const manifestFile = path.join(options.directory, MANIFEST);
  await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
  await updateClaudeUserSettings(
    options.settingsPath ?? claudeUserSettingsPath(),
    async (document) => {
      const current = limitRecord(document.statusLine);
      const wrapped = wrappedCommand(current?.command);
      const original =
        wrapped === undefined
          ? (document.statusLine ?? null)
          : wrapped === null
            ? null
            : { ...current, command: wrapped };
      const status = limitRecord(original);
      if (
        original !== null &&
        (!status || status.type !== "command" || typeof status.command !== "string")
      ) {
        throw new Error("Unsupported Claude status line; settings were not changed.");
      }
      const executable = shellQuote(options.executable);
      const run = `ELECTRON_RUN_AS_NODE=1 ${executable} ${shellQuote(script)} ${shellQuote(String(status?.command ?? ""))}`;
      const fallback = `sh -c ${shellQuote(String(status?.command ?? ":"))}`;
      const installedCommand = `if [ -x ${executable} ] && [ -f ${shellQuote(script)} ]; then ${run}; else ${fallback}; fi`;
      await writeFileAtomically(script, claudeStatuslineSource(), { mode: 0o600 });
      await writeFileAtomically(manifestFile, JSON.stringify({ original, installedCommand }), {
        mode: 0o600,
      });
      return {
        ...document,
        statusLine: {
          ...(current ?? {}),
          type: "command",
          command: installedCommand,
        },
      };
    },
  );
}

/** Restore only our exact command; a newer user edit always wins. */
export async function restoreClaudeLimitCollector(options: ClaudeLimitOptions): Promise<void> {
  const saved = limitRecord(await optionalJson(path.join(options.directory, MANIFEST)));
  if (!saved) return;
  await updateClaudeUserSettings(options.settingsPath ?? claudeUserSettingsPath(), (document) => {
    if (limitRecord(document.statusLine)?.command !== saved.installedCommand) return document;
    const original = limitRecord(saved.original);
    if (original)
      return {
        ...document,
        statusLine: { ...limitRecord(document.statusLine), command: original.command },
      };
    const { statusLine: _statusLine, ...rest } = document;
    return rest;
  });
}

export async function readClaudeLimits(directory: string): Promise<AgentLimitReading> {
  const captures = path.join(directory, "captures");
  let files: string[];
  try {
    files = await fs.readdir(captures);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return absentLimits("claude");
    throw error;
  }
  const candidates = await Promise.all(
    files
      .filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      .map(async (name) => ({ name, stat: await fs.lstat(path.join(captures, name)) })),
  );
  const selected = candidates
    .filter(({ stat }) => stat.isFile() && stat.size <= MAX_CAPTURE_BYTES)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, MAX_CAPTURES);
  const readings = await Promise.all(
    selected.map(async (entry) => {
      const value = limitRecord(await optionalJson(path.join(captures, entry.name)));
      if (
        !value ||
        typeof value.observedAtMs !== "number" ||
        !Number.isFinite(value.observedAtMs) ||
        value.observedAtMs < 0 ||
        value.observedAtMs > Date.now()
      )
        return null;
      return claudeLimits(value.rateLimits, value.observedAtMs);
    }),
  );
  // A session without quota data must not hide another session's reported limits.
  const newest = readings
    .filter(
      (reading): reading is AgentLimitReading => reading !== null && reading.state === "ready",
    )
    .sort((a, b) => b.observedAtMs - a.observedAtMs)[0];
  if (newest) return newest;
  return absentLimits("claude");
}
