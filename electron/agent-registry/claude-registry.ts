/**
 * The Claude session registry — `claude agents --json`, polled from the main
 * process on its own clock (agent-signal contract layer, stage 1; spec
 * `docs/internals/terminal.md`).
 *
 * Claude Code documents the command as printing "active sessions as a JSON
 * array": per session `cwd`, `kind`, `startedAt`, `sessionId`, and — while
 * the process is alive — `pid` and `status`, with `waitingFor` when the status
 * is `waiting` (trust audit §5.1). Joined on the pid `pty_info` already
 * reports for each pane's foreground process, that is an EXACT pane → session
 * pairing and a documented "needs input" for Claude, which Deck otherwise has
 * to guess from transcript mtimes and from the absence of progress bytes.
 *
 * Three decisions, each named because the alternative was considered:
 *
 * - **Demand-driven.** The loop runs only while a renderer keeps asking
 *   (`read()` is the demand signal) and stops `idleAfterMs` after the last
 *   ask, so an app with no Claude pane open spawns no child process every 5 s.
 *   The renderer asks only while a pane is classified `claude`.
 * - **Answers never wait for the command.** `read()` returns the latest
 *   snapshot at once; the command's latency (tens to hundreds of ms — live
 *   check #11 records the number) never sits on an IPC round trip.
 * - **Degrades, never throws.** A missing binary, a non-zero exit, a timeout
 *   or a shape the parser does not know answers the PREVIOUS list flagged
 *   `stale: true`, and the renderer keeps today's behaviour for that tick.
 *   No documented minimum version exists: the first successful poll is what
 *   decides whether the channel is live for this install.
 *
 * The binary is the DISCOVERED absolute path (`discoverAgents`), not a bare
 * `claude`: a packaged app's `PATH` is launchd's bare one and finds nothing.
 */
import { execFile } from "node:child_process";
import { discoverAgents } from "../agents";

/** One live interactive session, as the renderer sees it (flat, R6). */
export interface RegistryEntry {
  /** The interactive process's pid — the join key against `pty_info`. */
  readonly pid: number;
  readonly cwd: string | null;
  /** The full session UUID, usable with `claude --resume`. */
  readonly sessionId: string;
  /** `waiting` is documented; other values are carried verbatim, never acted on. */
  readonly status: string;
  /** Set when `status` is `waiting`: `permission prompt`, `input needed`, … */
  readonly waitingFor: string | null;
  readonly name: string | null;
  readonly kind: string;
}

/** What `agent_registry` answers. */
export interface RegistrySnapshot {
  /** A poll has succeeded at least once for this install. */
  readonly available: boolean;
  /** The newest poll failed; `entries` are the last good list. */
  readonly stale: boolean;
  /** Clock of the last SUCCESSFUL poll; 0 before the first. */
  readonly polledAt: number;
  readonly entries: readonly RegistryEntry[];
}

export const REGISTRY_POLL_MS = 5000;
/** No renderer asked for this long → stop spawning the command. */
export const REGISTRY_IDLE_MS = 15_000;
/** The command is expected in tens of ms; anything past this is a hung CLI. */
export const REGISTRY_COMMAND_TIMEOUT_MS = 4000;
/** A registry answer larger than this is not the shape we know. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const EMPTY_SNAPSHOT: RegistrySnapshot = Object.freeze({
  available: false,
  stale: true,
  polledAt: 0,
  entries: Object.freeze([]) as readonly RegistryEntry[],
});

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The array the command prints, reduced to the entries this program can use.
 *
 * Tolerant per ENTRY, strict per BATCH: one malformed entry — a background
 * session with no `pid`, a `state` instead of a `status`, a sessionId that is
 * not a safe token — is skipped without dropping its siblings, while output
 * that is not a JSON array at all throws, so the poller can flag the whole
 * answer stale rather than replace a good list with an empty one.
 */
export function parseClaudeAgents(output: string): RegistryEntry[] {
  if (output.length > MAX_OUTPUT_BYTES) {
    throw new Error("registry output exceeds the size cap");
  }
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new Error("registry output is not an array");
  }
  const entries: RegistryEntry[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const node = raw as Record<string, unknown>;
    const pid = node.pid;
    const sessionId = node.sessionId;
    if (
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      typeof sessionId !== "string" ||
      !SESSION_ID.test(sessionId)
    ) {
      continue;
    }
    entries.push({
      pid,
      cwd: optionalString(node.cwd),
      sessionId,
      status: optionalString(node.status) ?? "unknown",
      waitingFor: optionalString(node.waitingFor),
      name: optionalString(node.name),
      kind: optionalString(node.kind) ?? "interactive",
    });
  }
  return entries;
}

export interface CommandResult {
  readonly stdout: string;
  readonly ok: boolean;
}

export interface ClaudeRegistryDeps {
  /** The absolute path of `claude`, or null when it is not installed. */
  readonly resolveBinary?: () => Promise<string | null>;
  /** Run `<binary> agents --json`; never rejects, answers `ok: false` instead. */
  readonly run?: (binary: string) => Promise<CommandResult>;
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly idleAfterMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface ClaudeRegistry {
  /** The latest snapshot, at once — and the demand signal that keeps polling. */
  read(): RegistrySnapshot;
  /** Stop the loop; a later `read()` starts it again. */
  dispose(): void;
}

async function resolveClaudeBinary(): Promise<string | null> {
  const found = await discoverAgents(["claude"]);
  return found.find((agent) => agent.name === "claude")?.path ?? null;
}

function runClaudeAgents(binary: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ["agents", "--json"],
      {
        encoding: "utf8",
        timeout: REGISTRY_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: process.env,
      },
      (error, stdout) => {
        resolve({ stdout: String(stdout ?? ""), ok: error === null });
      },
    );
  });
}

export function createClaudeRegistry(deps: ClaudeRegistryDeps = {}): ClaudeRegistry {
  const resolveBinary = deps.resolveBinary ?? resolveClaudeBinary;
  const run = deps.run ?? runClaudeAgents;
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? REGISTRY_POLL_MS;
  const idleAfterMs = deps.idleAfterMs ?? REGISTRY_IDLE_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer));

  let snapshot: RegistrySnapshot = EMPTY_SNAPSHOT;
  let binary: string | null = null;
  let lastAskedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let disposed = false;

  function stale(): void {
    snapshot = snapshot.stale ? snapshot : { ...snapshot, stale: true };
  }

  async function poll(): Promise<void> {
    if (polling) {
      return;
    }
    polling = true;
    try {
      if (binary === null) {
        binary = await resolveBinary();
      }
      if (binary === null) {
        stale();
        return;
      }
      const result = await run(binary);
      if (!result.ok) {
        // A launch failure may mean the binary moved; look it up again next
        // tick rather than failing forever against a stale path.
        binary = null;
        stale();
        return;
      }
      const entries = parseClaudeAgents(result.stdout);
      snapshot = { available: true, stale: false, polledAt: now(), entries };
    } catch {
      stale();
    } finally {
      polling = false;
    }
  }

  function schedule(): void {
    if (timer !== null || disposed) {
      return;
    }
    timer = setTimer(() => {
      timer = null;
      if (now() - lastAskedAt > idleAfterMs) {
        return; // nobody is asking; the next read() restarts the loop
      }
      void poll().finally(schedule);
    }, intervalMs);
  }

  return {
    read() {
      const idle = now() - lastAskedAt > idleAfterMs;
      lastAskedAt = now();
      if (idle && !disposed) {
        // First ask after a quiet spell: poll now so the second ask has data,
        // then keep the loop going on its own clock.
        void poll().finally(schedule);
      }
      return snapshot;
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
