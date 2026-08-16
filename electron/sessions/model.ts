/**
 * Wire shape of the session-history list. Mirrored verbatim by the renderer in
 * `src/lib/session-history.ts` — the two files are a pair; changing one without
 * the other is the exact drift `scripts/electron-ipc-contract.test.ts` cannot
 * see (it checks argument keys, not reply shapes).
 */

export type SessionAgent = "claude" | "codex";

export const SESSION_AGENTS: readonly SessionAgent[] = Object.freeze([
  "claude",
  "codex",
]);

/** One resumable past session. `cwd` is non-null by construction: an entry
 *  with no recorded directory cannot be resumed in the right place, so it is
 *  dropped rather than shown (spec §1.4). */
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
  /** Candidate FILES per agent before the cap — what "showing latest N" reads. */
  readonly totals: Readonly<Record<SessionAgent, number>>;
  readonly limit: number;
}

/** Spec §1.4: newest 500 per agent get a head read. */
export const SESSIONS_DEFAULT_LIMIT = 500;

/** Hard ceiling on a renderer-supplied limit — the renderer is not the trust
 *  boundary, and an unbounded limit is an unbounded read. */
export const SESSIONS_MAX_LIMIT = 2000;

export const EMPTY_SESSIONS_SNAPSHOT: SessionsSnapshot = Object.freeze({
  entries: Object.freeze([]),
  totals: Object.freeze({ claude: 0, codex: 0 }),
  limit: SESSIONS_DEFAULT_LIMIT,
});
