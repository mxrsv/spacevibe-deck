/** Install only this Deck installation's guarded hooks in Claude's user settings. */
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeFileAtomically } from "../fs/write";
import { CLAUDE_HOOK_EVENTS, NOTIFICATION_MATCHER, shellQuote } from "./claude-hooks-file";

type Document = Record<string, unknown>;

function record(value: unknown): value is Document {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function claudeUserSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "settings.json");
}

export function managedHookCommand(scriptPath: string, event: string): string {
  const script = shellQuote(scriptPath);
  return (
    `[ "$DECK_CLAUDE_HOOK_SCRIPT" = ${script} ] && [ -n "$DECK_PANE_ID" ] && ` +
    `[ -n "$DECK_HOOK_TOKEN" ] && [ -n "$DECK_HOOK_PORT" ] && [ -x ${script} ] && ` +
    `${script} ${event} || true`
  );
}

/** Preserve other settings, hook groups and sibling Deck installations verbatim as values. */
export function reconcileClaudeHooks(
  value: unknown,
  scriptPath: string,
  enabled: boolean,
): Document {
  if (!record(value) || (value.hooks !== undefined && !record(value.hooks))) {
    throw new Error("Claude settings must be an object with an object-valued hooks field.");
  }
  const hooks = (value.hooks ?? {}) as Document;
  const owned = new Set(CLAUDE_HOOK_EVENTS.map((event) => managedHookCommand(scriptPath, event)));
  const entries = Object.entries(hooks).map(([event, groups]) => {
    if (
      !Array.isArray(groups) ||
      groups.some((group) => !record(group) || !Array.isArray(group.hooks))
    ) {
      throw new Error(`Invalid Claude hook groups for ${event}; settings were not changed.`);
    }
    const kept = groups.flatMap((group: Document) => {
      const handlers = group.hooks as unknown[];
      const remaining = handlers.filter(
        (handler) =>
          !(
            record(handler) &&
            handler.type === "command" &&
            typeof handler.command === "string" &&
            owned.has(handler.command)
          ),
      );
      if (remaining.length === handlers.length) return [group];
      return remaining.length === 0 ? [] : [{ ...group, hooks: remaining }];
    });
    return [event, kept] as const;
  });
  const cleaned = Object.fromEntries(
    entries.filter(
      ([event, groups]) => groups.length > 0 || (hooks[event] as unknown[]).length === 0,
    ),
  );
  const next = enabled
    ? {
        ...cleaned,
        ...Object.fromEntries(
          CLAUDE_HOOK_EVENTS.map((event) => [
            event,
            [
              ...(cleaned[event] ?? []),
              {
                ...(event === "Notification" ? { matcher: NOTIFICATION_MATCHER } : {}),
                hooks: [{ type: "command", command: managedHookCommand(scriptPath, event) }],
              },
            ],
          ]),
        ),
      }
    : cleaned;
  if (
    Object.keys(next).length > 0 ||
    (record(value.hooks) && Object.keys(value.hooks).length === 0)
  ) {
    return { ...value, hooks: next };
  }
  const { hooks: _hooks, ...rest } = value;
  return rest;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/** Resolve links without replacing them; a dangling link is an error, never an empty config. */
async function resolveSettings(file: string): Promise<string> {
  try {
    await fs.lstat(file);
  } catch (error) {
    if (missing(error)) return file;
    throw error;
  }
  return fs.realpath(file);
}

export async function syncClaudeUserSettings(
  file: string,
  scriptPath: string,
  enabled: boolean,
): Promise<void> {
  const target = await resolveSettings(file);
  if (!enabled && (await readOptional(target)) === null) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Cooperating Deck processes serialize merges; never steal a stale/unknown lock.
  const lockPath = `${target}.deck-hooks.lock`;
  const lock = await fs.open(lockPath, "wx", 0o600);
  try {
    const before = await readOptional(target);
    const document: unknown = before === null ? {} : JSON.parse(before);
    const next = reconcileClaudeHooks(document, scriptPath, enabled);
    if (JSON.stringify(document) === JSON.stringify(next)) return;
    const mode = before === null ? 0o600 : (await fs.stat(target)).mode & 0o777;
    if ((await readOptional(target)) !== before || (await resolveSettings(file)) !== target) {
      throw new Error("Claude settings changed during hook registration; retry from Signals.");
    }
    await writeFileAtomically(target, `${JSON.stringify(next, null, 2)}\n`, { mode });
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
