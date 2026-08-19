/**
 * Renderer mirror of `electron/sessions/model.ts`. Kept as its own module
 * (not an import across the boundary) for the same reason
 * `src/lib/usage-snapshot.ts` is: the renderer must build and typecheck with
 * no `electron/` on its path.
 */

export type SessionAgent = "claude" | "codex";

export const SESSION_AGENTS: readonly SessionAgent[] = Object.freeze(["claude", "codex"]);

/** Display name per agent — sentence case naming a product (DL-4.3). */
export const SESSION_AGENT_LABELS: Readonly<Record<SessionAgent, string>> = Object.freeze({
  claude: "Claude Code",
  codex: "Codex",
});

export interface SessionEntry {
  readonly agent: SessionAgent;
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastActivityMs: number;
  readonly title: string | null;
  readonly sourcePath: string;
}

export interface SessionsSnapshot {
  readonly entries: readonly SessionEntry[];
  readonly totals: Readonly<Record<SessionAgent, number>>;
  readonly limit: number;
}

export const SESSIONS_DEFAULT_LIMIT = 500;

export const EMPTY_SESSIONS_SNAPSHOT: SessionsSnapshot = Object.freeze({
  entries: Object.freeze([]),
  totals: Object.freeze({ claude: 0, codex: 0 }),
  limit: SESSIONS_DEFAULT_LIMIT,
});

/** Validate an untyped IPC reply. A host that answers something else — Tauri,
 *  a stale build — is `unsupported`, never a crash. */
export function asSessionsSnapshot(raw: unknown): SessionsSnapshot | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (!Array.isArray(node.entries)) {
    return null;
  }
  const totals = node.totals;
  if (totals === null || typeof totals !== "object") {
    return null;
  }
  const entries: SessionEntry[] = [];
  for (const value of node.entries) {
    if (value === null || typeof value !== "object") {
      continue;
    }
    const entry = value as Record<string, unknown>;
    // Emptiness is checked alongside type, not after it: an entry with an
    // empty session id or cwd can never resume, and letting it through renders
    // a row that looks live and does nothing when clicked. It also defuses a
    // sharper edge downstream — `"claude".includes("")` is `true` for every
    // string, so a containment-based refusal cannot catch an empty id on its
    // own (see `resume-session.ts`'s guard, which closes the same hole from
    // the other side).
    if (
      (entry.agent !== "claude" && entry.agent !== "codex") ||
      typeof entry.sessionId !== "string" ||
      entry.sessionId === "" ||
      typeof entry.cwd !== "string" ||
      entry.cwd === "" ||
      typeof entry.lastActivityMs !== "number" ||
      typeof entry.sourcePath !== "string"
    ) {
      continue;
    }
    entries.push({
      agent: entry.agent,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      lastActivityMs: entry.lastActivityMs,
      title: typeof entry.title === "string" ? entry.title : null,
      sourcePath: entry.sourcePath,
    });
  }
  const counts = totals as Record<string, unknown>;
  return {
    entries,
    totals: {
      claude: typeof counts.claude === "number" ? counts.claude : 0,
      codex: typeof counts.codex === "number" ? counts.codex : 0,
    },
    limit: typeof node.limit === "number" ? node.limit : SESSIONS_DEFAULT_LIMIT,
  };
}
