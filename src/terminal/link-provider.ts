import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { extractLinkCandidates, stripDiffPrefix, type LinkCandidate } from "../lib/terminal-links";
import { reportPersistError, requestPathOpen } from "../chrome/events";
import { hasPrimaryModifier } from "../lib/platform";
import { defaultLinkClient, type LinkClient } from "./link-client";
import {
  isPrimaryModifierHeld,
  onPrimaryModifierChange,
  syncPrimaryModifierHeld,
} from "./primary-modifier";
import { readLogicalLine, type LogicalLine } from "./logical-line";
import { eslintHeaderText, matchPositionRow } from "./eslint-positions";

/** Resolved lines cached per (cwd, text) — hovering must not re-hit the IPC. */
const CACHE_LIMIT = 40;

/**
 * How long a line that resolved to *nothing* stays cached.
 *
 * A hit is stable — the file exists, and the line's text cannot change once it
 * has been printed. A miss is not: an agent prints `dist/bundle.js` before the
 * build writes it, or `git status` names a file that appears a moment later.
 * Caching that miss for the life of the pane would leave the path unclickable
 * forever, so misses expire while hits stay put.
 */
const MISS_TTL_MS = 5_000;

interface CacheEntry {
  readonly links: ResolvedLink[];
  /** `Infinity` for a hit; a deadline for a miss. */
  readonly expiresAt: number;
}

/** A candidate that survived resolution, with the target we will actually open. */
interface ResolvedLink {
  readonly candidate: LinkCandidate;
  /** The URL, or the absolute path the backend resolved. */
  readonly target: string;
}

export interface LinkProviderDeps {
  /** Raw cwd of the pane, used to resolve relative paths. */
  getCwd(): string | null;
  client?: LinkClient;
}

function openCandidate(link: ResolvedLink, client: LinkClient): void {
  if (link.candidate.kind === "url") {
    client.openUrl(link.target).catch((err: unknown) => {
      reportPersistError(`Couldn't open the link: ${String(err)}`);
    });
    return;
  }
  // Where the file opens is App's decision, not this module's (design §3.2):
  // a path inside an open workspace lands in Deck's own editor, anything else
  // goes to the app selected on the toolbar. Raising an intent rather than
  // calling either one keeps the provider from importing the file layer,
  // which is the seam `file-surface-controller.ts` documents.
  requestPathOpen({
    path: link.target,
    line: link.candidate.line,
    column: link.candidate.col,
  });
}

/**
 * xterm link provider for URLs and file paths.
 *
 * Both only activate on ⌘+click, and only decorate while ⌘ is held: a plain
 * click has to stay a plain click, because an agent TUI (Claude Code, Codex)
 * turns on mouse tracking and needs those clicks itself.
 */
export function createLinkProvider(term: Terminal, deps: LinkProviderDeps): ILinkProvider {
  const client = deps.client ?? defaultLinkClient;
  const cache = new Map<string, CacheEntry>();
  // Bumped by every request; a reply carrying a stale id is dropped rather than
  // handed to xterm. See the comment on the resolve below.
  let generation = 0;

  function remember(key: string, links: ResolvedLink[]): ResolvedLink[] {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(key, {
      links,
      expiresAt: links.length === 0 ? Date.now() + MISS_TTL_MS : Infinity,
    });
    return links;
  }

  function recall(key: string): ResolvedLink[] | undefined {
    const entry = cache.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.links;
  }

  function toLink(resolved: ResolvedLink, logical: LogicalLine): ILink {
    const { start, end } = resolved.candidate;
    const first = logical.spans[start];
    const last = logical.spans[end - 1];
    let unsubscribe: (() => void) | null = null;

    const link: ILink = {
      text: resolved.candidate.text,
      range: {
        // xterm ranges are 1-based; `end.x` is inclusive, so it points at the
        // last cell the final character occupies (2 for a wide character).
        start: { x: first.x + 1, y: first.y + 1 },
        end: { x: last.x + last.width, y: last.y + 1 },
      },
      decorations: {
        pointerCursor: isPrimaryModifierHeld(),
        underline: isPrimaryModifierHeld(),
      },
      activate(event) {
        if (!hasPrimaryModifier(event)) {
          return; // plain click belongs to the terminal (selection, TUI mouse)
        }
        openCandidate(resolved, client);
      },
      hover(event) {
        syncPrimaryModifierHeld(event);
        // xterm replaces `decorations` with an accessor object right *after*
        // hover() returns, and only writes through those accessors repaint —
        // so defer, and always assign the properties, never the object.
        queueMicrotask(() => {
          const apply = (held: boolean): void => {
            const decorations = link.decorations;
            if (decorations !== undefined) {
              decorations.pointerCursor = held;
              decorations.underline = held;
            }
          };
          apply(isPrimaryModifierHeld());
          unsubscribe?.();
          unsubscribe = onPrimaryModifierChange(apply);
        });
      },
      leave() {
        unsubscribe?.();
        unsubscribe = null;
      },
      dispose() {
        unsubscribe?.();
        unsubscribe = null;
      },
    };
    return link;
  }

  function toLinks(resolved: readonly ResolvedLink[], logical: LogicalLine): ILink[] | undefined {
    const links = resolved
      // The cache is keyed by line text, but the same text can sit at a
      // different row after a scroll — drop anything the spans no longer cover.
      .filter(
        ({ candidate }) =>
          logical.spans[candidate.start] !== undefined &&
          logical.spans[candidate.end - 1] !== undefined,
      )
      .map((entry) => toLink(entry, logical));
    return links.length === 0 ? undefined : links;
  }

  return {
    provideLinks(bufferLineNumber, callback) {
      const requestId = (generation += 1);
      const logical = readLogicalLine(term.buffer.active, term.cols, bufferLineNumber - 1);
      if (logical === null || logical.text.trim() === "") {
        callback(undefined);
        return;
      }
      const onLine = extractLinkCandidates(logical.text);
      // ESLint's finding rows name a position but no file — the file is the
      // header above them (design §2.3). The walk is synchronous and the
      // header's path joins THIS line's resolve batch, so a cross-line link
      // costs no extra IPC round trip.
      const position = matchPositionRow(logical.text);
      const headerText =
        position === null
          ? null
          : eslintHeaderText(term.buffer.active, term.cols, bufferLineNumber - 1);
      const headerPath =
        headerText === null
          ? null
          : (extractLinkCandidates(headerText).find((candidate) => candidate.kind === "path") ??
            null);
      const crossLine: LinkCandidate | null =
        position !== null && headerPath !== null
          ? {
              kind: "path",
              text: logical.text.slice(position.start, position.end),
              target: headerPath.target,
              line: position.line,
              col: position.col,
              start: position.start,
              end: position.end,
            }
          : null;
      const candidates = crossLine === null ? onLine : [...onLine, crossLine];
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }

      const cwd = deps.getCwd() ?? "";
      // The header's text is part of the key, not decoration. `12:5  error
      // no-unused-vars` is byte-identical under two different file headers, so
      // a cache keyed by this line's text alone would open the FIRST file's
      // document from the second file's rows — silently, and only for the user
      // whose lint run happened to repeat a finding.
      const key = `${cwd}\u0000${logical.text}\u0000${headerText ?? ""}`;
      const cached = recall(key);
      if (cached !== undefined) {
        callback(toLinks(cached, logical));
        return;
      }

      const paths = candidates.filter((candidate) => candidate.kind === "path");
      if (paths.length === 0) {
        const urls = candidates.map((candidate) => ({
          candidate,
          target: candidate.target,
        }));
        callback(toLinks(remember(key, urls), logical));
        return;
      }

      // One candidate can ask two questions. `--- a/src/foo.ts` in a git diff
      // is not a file, but `src/foo.ts` is — and in a repository that really
      // holds an `a/` directory the verbatim spelling is the right answer. So
      // both go into the SAME batch and the verbatim hit wins, which is why
      // it is pushed first (design §2.2). Worst case is 2× the per-line cap
      // of 24, still inside the resolver's own batch cap of 64.
      const requests: { candidate: LinkCandidate; raw: string }[] = [];
      for (const candidate of paths) {
        requests.push({ candidate, raw: candidate.target });
        const stripped = stripDiffPrefix(candidate.target);
        if (stripped !== null) {
          requests.push({ candidate, raw: stripped });
        }
      }

      /** Pair each candidate with what the backend made of it; drop the rest. */
      function resolveLinks(results: (string | null)[]): ResolvedLink[] {
        const absolute = new Map<LinkCandidate, string>();
        requests.forEach((request, index) => {
          const resolved = results[index];
          if (
            typeof resolved === "string" &&
            resolved !== "" &&
            // First answer wins, and the verbatim spelling was asked first.
            !absolute.has(request.candidate)
          ) {
            absolute.set(request.candidate, resolved);
          }
        });
        return candidates.flatMap<ResolvedLink>((candidate) => {
          if (candidate.kind === "url") {
            return [{ candidate, target: candidate.target }];
          }
          const target = absolute.get(candidate);
          return target === undefined ? [] : [{ candidate, target }];
        });
      }

      client
        .resolvePaths(
          cwd,
          requests.map((request) => request.raw),
        )
        .then((results) => {
          // xterm's Linkifier files every reply under the provider's index and
          // has no notion of a request that is still in flight, so a slow line's
          // late reply would overwrite the links of the line the pointer has
          // already moved to — leaving that line undecorated and dead to
          // ⌘+click until the pointer leaves and comes back. A superseded reply
          // still gets remembered (the resolution is valid for its own line),
          // it just never reaches xterm.
          remember(key, resolveLinks(results));
          if (requestId !== generation) {
            return;
          }
          callback(toLinks(recall(key) ?? [], logical));
        })
        .catch((err: unknown) => {
          // The backend is the only thing that can turn a path candidate into a
          // link, so a failure here makes every path on the line silently stop
          // being clickable while URLs keep working — which reads like a
          // detection bug. Say so instead of dropping it.
          if (requestId === generation) {
            reportPersistError(`Couldn't check the file paths on this line: ${String(err)}`);
          }
          callback(undefined);
        });
    },
  };
}
