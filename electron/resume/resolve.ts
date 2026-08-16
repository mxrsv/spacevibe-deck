/**
 * Request → resumable-session dispatch, ranking and greedy dedup.
 *
 * `resolveResume` is the one function `electron/main.ts`'s `resume_lookup`
 * handler calls. It never rejects and never throws: an unscannable state dir,
 * a malformed request, or an agent it doesn't recognize all answer `null`
 * rather than aborting the whole batch — a boot-time lookup for eight panes
 * must not lose the other seven because one scanner tripped.
 */
import * as claude from "./claude";
import * as codex from "./codex";
import * as opencode from "./opencode";
import * as agy from "./agy";
import type { CandidateSession } from "./head";

export interface ResumeRequest {
  readonly agent: string;
  readonly cwd: string | null;
  readonly lastSeenAt: number;
}

export type ResumeRef =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "latest" }
  | null;

/** Agents this module can scan for identity-precise resume. `gemini` is
 * deliberately absent: it is answered directly in `resolveOne`, with no
 * candidate scan at all. */
const SCANNERS: Record<string, (home: string) => CandidateSession[]> = {
  claude: claude.candidates,
  codex: codex.candidates,
  opencode: opencode.candidates,
  agy: agy.candidates,
};

/** Agents whose "no match found" answer is still resumable, just without an
 * exact id — the CLI's own `--continue`/latest-session flag. Every other
 * scanned agent answers `null` (a bare, non-resuming launch) instead. */
const FALLBACK_LATEST = new Set<string>(["agy"]);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `agy` never extracts a single `cwd` string (see `agy.ts`) — its candidates
 * carry a `headHaystack` instead, and matching is containment: the request's
 * cwd has to occur somewhere in the raw head bytes. A request with no cwd of
 * its own can't be compared at all, so it falls back to time-only ranking
 * against every `agy` candidate; a candidate with no `headHaystack` (head was
 * unreadable) can never satisfy a non-null request cwd.
 */
function agyCwdMatches(
  request: ResumeRequest,
  candidate: CandidateSession,
): boolean {
  if (request.cwd === null) {
    return true;
  }
  return (
    candidate.headHaystack !== undefined &&
    candidate.headHaystack.includes(request.cwd)
  );
}

/**
 * A request's cwd matches a candidate's when either side doesn't know its
 * cwd — a null cwd (request or candidate) never disqualifies a match, it
 * just drops out of the comparison and leaves ranking to recency alone.
 * Claude/codex/opencode candidates can genuinely carry a null cwd (the
 * transcript never wrote one), so the wildcard stays for them; `agy` never
 * reaches this function — `resolveOne` routes it to `agyCwdMatches` instead,
 * since a null `cwd` there just means "not extracted", not "absent".
 */
function cwdMatches(
  request: ResumeRequest,
  candidate: CandidateSession,
): boolean {
  if (request.cwd === null || candidate.cwd === null) {
    return true;
  }
  return request.cwd === candidate.cwd;
}

function resolveOne(
  request: ResumeRequest,
  candidatesFor: (agent: string) => CandidateSession[],
  takenByAgent: Map<string, Set<string>>,
): ResumeRef {
  if (request.agent === "gemini") {
    return { kind: "latest" };
  }
  const scanner = SCANNERS[request.agent];
  if (scanner === undefined) {
    return null;
  }
  const taken = takenByAgent.get(request.agent) ?? new Set<string>();
  takenByAgent.set(request.agent, taken);

  const matchesCwd = request.agent === "agy" ? agyCwdMatches : cwdMatches;
  const cutoffMs = request.lastSeenAt - THIRTY_DAYS_MS;
  const eligible = candidatesFor(request.agent).filter(
    (candidate) =>
      candidate.mtimeMs >= cutoffMs &&
      !taken.has(candidate.id) &&
      matchesCwd(request, candidate),
  );
  eligible.sort(
    (left, right) =>
      Math.abs(left.mtimeMs - request.lastSeenAt) -
      Math.abs(right.mtimeMs - request.lastSeenAt),
  );
  const best = eligible[0];
  if (best === undefined) {
    return FALLBACK_LATEST.has(request.agent) ? { kind: "latest" } : null;
  }
  taken.add(best.id);
  return { kind: "id", id: best.id };
}

/**
 * One answer per request, in the same order — the reply contract is
 * positional (each `ResumeRef` targets the pane at the same index in the
 * request array), so a `null` entry (a request `validateResumeRequests`
 * couldn't make sense of) answers `null` at that position without being
 * scanned, rather than being skipped and shifting every later answer onto
 * the wrong pane. Each needed agent is scanned at most once per call — the
 * scan result is cached in a local map, not shared across calls, so every
 * `resolveResume` invocation sees the current state of disk.
 */
export function resolveResume(
  home: string,
  requests: readonly (ResumeRequest | null)[],
): ResumeRef[] {
  const cache = new Map<string, CandidateSession[]>();
  function candidatesFor(agent: string): CandidateSession[] {
    const cached = cache.get(agent);
    if (cached !== undefined) {
      return cached;
    }
    const scanner = SCANNERS[agent];
    let found: CandidateSession[];
    try {
      found = scanner === undefined ? [] : scanner(home);
    } catch {
      found = [];
    }
    cache.set(agent, found);
    return found;
  }

  const takenByAgent = new Map<string, Set<string>>();
  return requests.map((request) => {
    if (request === null) {
      return null;
    }
    try {
      return resolveOne(request, candidatesFor, takenByAgent);
    } catch {
      return null;
    }
  });
}

function isValidRequest(entry: unknown): entry is ResumeRequest {
  if (entry === null || typeof entry !== "object") {
    return false;
  }
  const node = entry as Record<string, unknown>;
  if (typeof node.agent !== "string" || node.agent === "") {
    return false;
  }
  if (node.cwd !== null && typeof node.cwd !== "string") {
    return false;
  }
  if (
    typeof node.lastSeenAt !== "number" ||
    !Number.isFinite(node.lastSeenAt)
  ) {
    return false;
  }
  return true;
}

/**
 * Same length as `raw`, one slot per entry — a malformed entry becomes a
 * positional `null` sentinel rather than being dropped. `resolveResume`'s
 * reply is positional (each `ResumeRef` answers the pane at the same index
 * in the request array); dropping a bad entry instead would shift every
 * later request onto the wrong pane's answer. A non-array `raw` still
 * answers an empty list — there is no positional contract to preserve
 * without an array to index into.
 */
export function validateResumeRequests(raw: unknown): (ResumeRequest | null)[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) =>
    isValidRequest(entry)
      ? { agent: entry.agent, cwd: entry.cwd, lastSeenAt: entry.lastSeenAt }
      : null,
  );
}
