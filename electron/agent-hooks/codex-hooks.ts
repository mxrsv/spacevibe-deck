/** Add this installation's Codex lifecycle hooks without replacing user hooks or notify. */
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeFileAtomically } from "../fs/write";
import { shellQuote } from "./claude-hooks-file";

type Document = Record<string, unknown>;
export const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "Interrupt"] as const;

function record(value: unknown): value is Document {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function codexHooksPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(homedir(), ".codex"), "hooks.json");
}

export function codexHookCommand(scriptPath: string): string {
  const script = shellQuote(scriptPath);
  return (
    `[ "$DECK_CODEX_HOOK_SCRIPT" = ${script} ] && [ -n "$DECK_PANE_ID" ] && ` +
    `[ -n "$DECK_HOOK_TOKEN" ] && [ -n "$DECK_HOOK_PORT" ] && [ -x ${script} ] && ` +
    `${script} || true`
  );
}

export function reconcileCodexHooks(
  value: unknown,
  scriptPath: string,
  enabled: boolean,
): Document {
  if (!record(value) || (value.hooks !== undefined && !record(value.hooks))) {
    throw new Error("Codex hooks must be an object with an object-valued hooks field.");
  }
  const hooks = (value.hooks ?? {}) as Document;
  const command = codexHookCommand(scriptPath);
  const entries = Object.entries(hooks).map(([event, groups]) => {
    if (!Array.isArray(groups) || groups.some((g) => !record(g) || !Array.isArray(g.hooks))) {
      throw new Error(`Invalid Codex hook groups for ${event}; hooks were not changed.`);
    }
    const kept = groups.flatMap((group: Document) => {
      const handlers = group.hooks as unknown[];
      const remaining = handlers.filter(
        (handler) =>
          !(record(handler) && handler.type === "command" && handler.command === command),
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
          CODEX_HOOK_EVENTS.map((event) => [
            event,
            [...(cleaned[event] ?? []), { hooks: [{ type: "command", command, timeout: 3 }] }],
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

async function resolveFile(file: string): Promise<string> {
  try {
    await fs.lstat(file);
  } catch (error) {
    if (missing(error)) return file;
    throw error;
  }
  return fs.realpath(file);
}

export async function syncCodexHooks(
  file: string,
  script: string,
  enabled: boolean,
): Promise<void> {
  const target = await resolveFile(file);
  if (!enabled && (await readOptional(target)) === null) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const lockPath = `${target}.deck-hooks.lock`;
  const lock = await fs.open(lockPath, "wx", 0o600);
  try {
    const before = await readOptional(target);
    const value: unknown = before === null ? {} : JSON.parse(before);
    const next = reconcileCodexHooks(value, script, enabled);
    if (JSON.stringify(value) === JSON.stringify(next)) return;
    const mode = before === null ? 0o600 : (await fs.stat(target)).mode & 0o777;
    if ((await readOptional(target)) !== before || (await resolveFile(file)) !== target) {
      throw new Error("Codex hooks changed during registration; retry from Signals.");
    }
    await writeFileAtomically(target, `${JSON.stringify(next, null, 2)}\n`, { mode });
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
