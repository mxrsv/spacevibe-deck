/**
 * Tier 3 of the agent rail: the newest assistant sentence of the session a
 * pane is running.
 *
 * This is the twin of `resolve.ts`, not a new mechanism. Resume asks "which
 * session file is this pane's?" and answers with an id; the rail asks the same
 * question and answers with the last thing that session said. Both share one
 * candidate scan, one cwd predicate and one ranking function
 * (`selectCandidate`) so the two answers cannot drift apart.
 *
 * They stopped being identical on 2026-08-22. Restore asks the question ONCE,
 * at boot; the rail asks it every few seconds, and a question re-answered from
 * scratch every few seconds gave a different answer every time — the pairing
 * permuted, and because a null tail keeps the renderer's previous sentence, one
 * sentence ended up printed on three rows at once. So the rail's request may
 * carry a `preferredId` — the session this pane was paired with last time — and
 * `resolveSessionTails` honours every pin BEFORE ranking anything, in a first
 * pass over the whole batch. Restore sends no pin and is unaffected.
 *
 * Like `resolveResume`, `resolveSessionTails` never throws and never rejects:
 * an unreadable transcript, a malformed request or an agent with no parser
 * answers `null` AT ITS OWN POSITION, so a batch of eight panes never loses
 * seven because one scan tripped.
 */
import * as claude from "./claude";
import * as codex from "./codex";
import * as opencode from "./opencode";
import { findCandidateById, selectCandidate, type ResumeRequest } from "./resolve";
import { tailBytes, type CandidateSession } from "./head";

/**
 * How much of the end of a transcript is read. The same `IDENTITY_HEAD_BYTES`
 * budget the head scanners use, for the same reason: a Codex rollout's single
 * `session_meta` line is already ~18 KB, so an assistant turn plus the event
 * records trailing it needs comparable room.
 */
const TAIL_WINDOW_BYTES = 64 * 1024;

/**
 * How far back the reader is willing to go when the first window holds no
 * sentence, largest last.
 *
 * 64 KiB was assumed to cover "the newest assistant turn plus the records
 * trailing it". On a WORKING pane it does not: an agent's own tool traffic
 * pushes its last spoken words out of the window within a turn or two —
 * measured 2026-08-22 on this machine's corpus, where 486 of the 616 records
 * sitting past the window were `user:tool_result` — so a busy pane answered
 * `null` far more often than it answered a sentence, which is what let stale
 * text survive on a row.
 *
 * Each step is a fresh read from the END of the file rather than a chunk
 * stitched onto the last one: a JSONL record split across a chunk boundary has
 * to be re-joined, and a re-join done wrong invents sentences that were never
 * said. Re-reading costs ~1.3 MiB per miss and only on a miss.
 */
const TAIL_WINDOW_STEPS: readonly number[] = [TAIL_WINDOW_BYTES, 256 * 1024, 1024 * 1024];

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
  return (best) => (best.sourcePath === undefined ? null : readGrowingTail(best.sourcePath, parse));
}

/**
 * The end of a transcript, at the first `TAIL_WINDOW_STEPS` size that yields a
 * sentence.
 *
 * Every step is tried, with no early exit on a short read. A read shorter than
 * the cap LOOKS like "the whole file is in hand, stop", but `tailBytes` makes a
 * single `readSync`, which is allowed to return fewer bytes than asked for —
 * treating that as end-of-file would abandon a transcript whose sentence is
 * still there. Re-reading a small file two more times costs nothing measurable;
 * silently answering `null` for a session that HAS spoken is exactly the bug
 * class this function was widened to remove.
 */
function readGrowingTail(sourcePath: string, parse: TailParser): string | null {
  for (const window of TAIL_WINDOW_STEPS) {
    const bytes = tailBytes(sourcePath, window);
    if (bytes === null) {
      return null;
    }
    const found = parse(dropPartialFirstLine(bytes));
    if (found !== null) {
      return found;
    }
  }
  return null;
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

/**
 * The tail window starts mid-file, so its first line is very likely the back
 * half of a record. Dropping it costs nothing real — a transcript's true first
 * line is identity metadata, never an assistant turn — and it removes the one
 * way a clipped fragment could parse into a wrong sentence.
 */
function dropPartialFirstLine(bytes: Buffer): readonly string[] {
  return bytes.toString("utf8").split("\n").slice(1);
}

/**
 * What one pane is told: the session it is paired with, and what that session
 * last said. `null` means no session could be paired at all.
 *
 * The id travels with the sentence because the CALLER is the one that has to
 * notice a re-pairing. A renderer holding only text cannot tell "same
 * conversation, nothing new to quote" (keep what is on screen) from "different
 * conversation now" (drop it) — and reading those two as one is exactly how a
 * sentence ends up on a row that never said it.
 */
export interface SessionTailAnswer {
  readonly id: string;
  readonly tail: string | null;
}

/**
 * One answer per request, in the same order — the reply contract is positional
 * (each tail belongs to the pane at the same index), so a `null` request (one
 * `validateResumeRequests` could not make sense of) answers `null` at that
 * position rather than being dropped and shifting every later sentence onto
 * the wrong pane. Each needed agent is scanned at most once per call, cached
 * locally rather than across calls, so every invocation sees the current state
 * of disk.
 *
 * Allocation is TWO passes over the batch, and the order matters more than it
 * looks. Pass 1 honours every `preferredId`; pass 2 ranks whatever is left for
 * the requests that had no pin or whose pin could not be honoured. Folding the
 * two into one pass in request order re-opens the bug: an unpinned pane sitting
 * earlier in the batch takes the closest-by-mtime candidate — which may be
 * precisely the session a LATER pane is pinned to — the pin then fails, that
 * pane is re-paired, and the sentences resume walking from row to row.
 */
export function resolveSessionTails(
  home: string,
  requests: readonly (ResumeRequest | null)[],
): (SessionTailAnswer | null)[] {
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
  function takenFor(agent: string): Set<string> {
    const existing = takenByAgent.get(agent);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = new Set<string>();
    takenByAgent.set(agent, fresh);
    return fresh;
  }

  /** An agent with no tail source is answered before any scan happens. */
  function scannable(request: ResumeRequest | null): request is ResumeRequest {
    return request !== null && TAIL_SOURCES[request.agent] !== undefined;
  }

  const paired: (CandidateSession | null)[] = requests.map(() => null);

  // Pass 1 — the pins.
  requests.forEach((request, index) => {
    if (!scannable(request)) {
      return;
    }
    try {
      paired[index] = findCandidateById(
        request,
        candidatesFor(request.agent),
        takenFor(request.agent),
      );
    } catch {
      paired[index] = null;
    }
  });

  // Pass 2 — rank what pass 1 left. Only agents in `TAIL_SOURCES` reach here,
  // and none of them is `agy`, so the default `cwdMatches` predicate is right.
  requests.forEach((request, index) => {
    if (paired[index] !== null || !scannable(request)) {
      return;
    }
    try {
      paired[index] = selectCandidate(
        request,
        candidatesFor(request.agent),
        takenFor(request.agent),
      );
    } catch {
      paired[index] = null;
    }
  });

  return requests.map((request, index) => {
    const best = paired[index];
    if (request === null || best === null) {
      return null;
    }
    const source = TAIL_SOURCES[request.agent];
    if (source === undefined) {
      return null;
    }
    // The pairing stands even when the read fails or the session has said
    // nothing yet: this IS the pane's conversation, and reporting the id with a
    // null tail is what lets the caller keep the pairing while it waits.
    try {
      return { id: best.id, tail: source.read(best, home) };
    } catch {
      return { id: best.id, tail: null };
    }
  });
}
