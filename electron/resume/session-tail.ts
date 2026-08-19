/**
 * Tier 3 of the agent rail: the newest assistant sentence of the session a
 * pane is running.
 *
 * This is the twin of `resolve.ts`, not a new mechanism. Resume asks "which
 * session file is this pane's?" and answers with an id; the rail asks the same
 * question and answers with the last thing that session said. Both must pick
 * the SAME file — same candidate scan, same cwd predicate, same 30-day cutoff,
 * same recency ranking, same greedy dedup — or a pane wears another pane's
 * sentence.
 *
 * Like `resolveResume`, `resolveSessionTails` never throws and never rejects:
 * an unreadable transcript, a malformed request or an agent with no parser
 * answers `null` AT ITS OWN POSITION, so a batch of eight panes never loses
 * seven because one scan tripped.
 */
import * as claude from "./claude";
import * as codex from "./codex";
import * as opencode from "./opencode";
import { cwdMatches, type ResumeRequest } from "./resolve";
import { tailBytes, type CandidateSession } from "./head";

/**
 * How much of the end of a transcript is read. The same `IDENTITY_HEAD_BYTES`
 * budget the head scanners use, for the same reason: a Codex rollout's single
 * `session_meta` line is already ~18 KB, so an assistant turn plus the event
 * records trailing it needs comparable room.
 */
const TAIL_WINDOW_BYTES = 64 * 1024;

/** A rail row is one line of about this width; the rest is dropped. */
const TAIL_MAX_CHARS = 160;

function oneLine(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat.slice(0, TAIL_MAX_CHARS);
}

/**
 * Newest-first over a Claude transcript's tail. A turn whose content is only
 * tool use carries no sentence, so the walk continues past it rather than
 * answering with an empty string.
 */
export function claudeTailFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      if (node?.type !== "assistant") continue;
      const content = node.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          const line = oneLine(part.text);
          if (line !== null) return line;
        }
      }
    } catch {
      /* an unparseable line is just skipped */
    }
  }
  return null;
}

/**
 * Newest-first over a Codex rollout's tail. Every rollout ends with `event_msg`
 * records (`token_count`, `task_complete`), so the newest assistant message is
 * never the last line.
 */
export function codexTailFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      const payload = node?.payload ?? node;
      if (payload?.type !== "message" || payload?.role !== "assistant") continue;
      const content = payload.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part?.text === "string") {
          const line = oneLine(part.text);
          if (line !== null) return line;
        }
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Lines in, one clipped line out. */
type TailParser = (lines: readonly string[]) => string | null;

/**
 * One selected candidate in, its newest sentence out. The seam is the WHOLE
 * read, not just a parser, because not every agent keeps its conversation in a
 * file: opencode keeps a message/part tree with no transcript to take a byte
 * window of (see `opencode.sessionTailText`).
 */
type TailReader = (best: CandidateSession, home: string) => string | null;

/** The Claude/Codex shape: re-open the file the id came from, read its end. */
function fromTranscript(parse: TailParser): TailReader {
  return (best) => (best.sourcePath === undefined ? null : parse(tailLines(best.sourcePath)));
}

/**
 * The agents that answer a tail: a candidate scan paired with a reader for the
 * storage format that scan found.
 *
 * Everything else answers `null` before any scanning happens, and each absence
 * is deliberate. `gemini` has no candidate scan at all (`resolve.ts` answers it
 * directly with `{ kind: "latest" }`, which names no file to read). `agy`'s
 * `.pb` conversations are an undocumented protobuf — the resume path only ever
 * matches them by raw-byte containment, which cannot yield a sentence — and its
 * `{ kind: "latest" }` fallback likewise names no file. A declared custom agent
 * is unknown by definition. The renderer keeps its own fallback for all of them.
 *
 * `opencode` was in that list until 2026-08-17 for one reason only — its
 * storage layout was unconfirmed. It was then read off disk (message objects
 * carry the role, `part/<messageID>/*.json` carries the words), so the reason
 * expired and the agent joined the table.
 */
const TAIL_SOURCES: Record<
  string,
  {
    readonly candidates: (home: string) => CandidateSession[];
    readonly read: TailReader;
  }
> = {
  claude: {
    candidates: claude.candidates,
    read: fromTranscript(claudeTailFromLines),
  },
  codex: {
    candidates: codex.candidates,
    read: fromTranscript(codexTailFromLines),
  },
  opencode: {
    candidates: opencode.candidates,
    // The clip lives here rather than in the scanner, so every agent's sentence
    // is bounded by the same `TAIL_MAX_CHARS` the two line parsers apply.
    read: (best, home) => {
      const text = opencode.sessionTailText(home, best.id);
      return text === null ? null : oneLine(text);
    },
  },
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The tail window starts mid-file, so its first line is very likely the back
 * half of a record. Dropping it costs nothing real — a transcript's true first
 * line is identity metadata, never an assistant turn — and it removes the one
 * way a clipped fragment could parse into a wrong sentence.
 */
function tailLines(sourcePath: string): readonly string[] {
  const bytes = tailBytes(sourcePath, TAIL_WINDOW_BYTES);
  if (bytes === null) {
    return [];
  }
  return bytes.toString("utf8").split("\n").slice(1);
}

function resolveOne(
  home: string,
  request: ResumeRequest,
  candidatesFor: (agent: string) => CandidateSession[],
  takenByAgent: Map<string, Set<string>>,
): string | null {
  const source = TAIL_SOURCES[request.agent];
  if (source === undefined) {
    return null;
  }
  const taken = takenByAgent.get(request.agent) ?? new Set<string>();
  takenByAgent.set(request.agent, taken);

  const cutoffMs = request.lastSeenAt - THIRTY_DAYS_MS;
  // Filter first, sort the copy: sorting the scan result in place would
  // reorder the per-call cache every other request reads (C1).
  const eligible = candidatesFor(request.agent).filter(
    (candidate) =>
      candidate.mtimeMs >= cutoffMs && !taken.has(candidate.id) && cwdMatches(request, candidate),
  );
  eligible.sort(
    (left, right) =>
      Math.abs(left.mtimeMs - request.lastSeenAt) - Math.abs(right.mtimeMs - request.lastSeenAt),
  );
  const best = eligible[0];
  if (best === undefined) {
    return null;
  }
  // Taken at SELECTION, not at success: a session whose tail turns out to be
  // unreadable or wordless is still this pane's session, and letting the next
  // pane fall through to it would hand it a sentence from a conversation it is
  // not running.
  taken.add(best.id);
  return source.read(best, home);
}

/**
 * One answer per request, in the same order — the reply contract is positional
 * (each tail belongs to the pane at the same index), so a `null` request (one
 * `validateResumeRequests` could not make sense of) answers `null` at that
 * position rather than being dropped and shifting every later sentence onto
 * the wrong pane. Each needed agent is scanned at most once per call, cached
 * locally rather than across calls, so every invocation sees the current state
 * of disk.
 */
export function resolveSessionTails(
  home: string,
  requests: readonly (ResumeRequest | null)[],
): (string | null)[] {
  const cache = new Map<string, CandidateSession[]>();
  function candidatesFor(agent: string): CandidateSession[] {
    const cached = cache.get(agent);
    if (cached !== undefined) {
      return cached;
    }
    const source = TAIL_SOURCES[agent];
    let found: CandidateSession[];
    try {
      found = source === undefined ? [] : source.candidates(home);
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
      return resolveOne(home, request, candidatesFor, takenByAgent);
    } catch {
      return null;
    }
  });
}
