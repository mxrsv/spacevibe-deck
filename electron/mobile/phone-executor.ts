/**
 * Every §6 method of the phone protocol, executed on the desktop. The phone is hostile input:
 * the protocol's `parseRequest` has already shaped each request, and everything below checks the
 * meaning (known roots, live panes, size caps) before touching anything.
 *
 * An outcome carries the response, any `chunk` events that complete it (a body too large for one
 * message goes out as chunks, response first so the phone knows which id to join), and an optional
 * `after` hook the session runs once the response is on the wire (a pane stream starts only then,
 * so the snapshot never overtakes the answer that names it).
 */
import { randomUUID } from "node:crypto";
import { splitChunks, type ChunkEvent } from "../../mobile/protocol/src/chunk";
import {
  errorResponse,
  okResponse,
  type Request,
  type Response,
} from "../../mobile/protocol/src/messages";
import type { Tree } from "../../mobile/protocol/src/tree";
import type { UsageSnapshot } from "../../src/lib/usage-snapshot";
import { PhoneError } from "./phone-error";
import type { PhoneFiles } from "./phone-files";
import type { PhonePanes } from "./phone-panes";
import type { StreamHub, StreamSink } from "./phone-streams";
import type { TreeHub } from "./phone-tree";
import { summarizeUsage } from "./phone-usage";

/** A body longer than this is chunked instead of inlined; leaves room for the envelope. */
export const INLINE_BODY_CHARS = 40_000;

export interface ExecutorSession {
  /** Identifies the session in the stream hub; unique per transport. */
  readonly id: string;
  readonly sink: StreamSink;
  /** Called with each changed tree after `tree.subscribe`. */
  readonly pushTree: (tree: Tree) => void;
}

export interface Outcome {
  readonly response: Response;
  readonly chunks: readonly ChunkEvent[];
  readonly after?: () => void;
}

export interface PhoneExecutorDeps {
  readonly panes: PhonePanes;
  readonly files: PhoneFiles;
  readonly tree: TreeHub;
  readonly streams: StreamHub;
  readonly usage: () => Promise<UsageSnapshot>;
  readonly now?: () => number;
  readonly log: (message: string) => void;
  readonly newId?: () => string;
  /** Counters for telemetry (T11); counts only, never content. */
  readonly onUsage?: (kind: "send" | "open") => void;
}

export interface PhoneExecutor {
  handle(session: ExecutorSession, request: Request): Promise<Outcome>;
  /** The session ended: drop its tree subscription and its streams. */
  closeSession(sessionId: string): void;
}

export function createPhoneExecutor(deps: PhoneExecutorDeps): PhoneExecutor {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, ""));
  const treeSubscriptions = new Map<string, () => void>();

  /** `text` inline when small, else a `{ chunked }` result plus the chunks that follow. */
  function bodyOf(
    key: "text" | "diff",
    text: string,
    extra: Record<string, boolean> = {},
  ): { r: Record<string, unknown>; chunks: ChunkEvent[] } {
    if (text.length <= INLINE_BODY_CHARS) return { r: { [key]: text, ...extra }, chunks: [] };
    const id = newId();
    return { r: { chunked: id, ...extra }, chunks: splitChunks(id, text) };
  }

  function dropTreeSubscription(sessionId: string): void {
    treeSubscriptions.get(sessionId)?.();
    treeSubscriptions.delete(sessionId);
  }

  async function run(
    session: ExecutorSession,
    request: Request,
  ): Promise<{ r: Record<string, unknown>; chunks?: ChunkEvent[]; after?: () => void }> {
    switch (request.m) {
      case "tree.subscribe": {
        dropTreeSubscription(session.id);
        const tree = await deps.tree.snapshot();
        treeSubscriptions.set(session.id, deps.tree.subscribe(session.pushTree, tree));
        return { r: { tree } };
      }
      case "tree.unsubscribe":
        dropTreeSubscription(session.id);
        return { r: {} };
      case "pane.subscribe": {
        const result = await deps.streams.subscribe(session.id, request.p.paneId, session.sink);
        if (!result.ok) {
          throw new PhoneError(
            result.code,
            result.code === "no-target" ? "That pane is gone" : "The terminal could not be shown",
          );
        }
        return {
          r: { sub: result.sub, cols: result.cols, rows: result.rows },
          after: result.begin,
        };
      }
      case "pane.unsubscribe":
        if (!deps.streams.unsubscribe(session.id, request.p.sub)) {
          throw new PhoneError("not-found", "No such subscription");
        }
        return { r: {} };
      case "pane.input":
        deps.panes.input(request.p.paneId, request.p.data);
        return { r: {} };
      case "pane.send": {
        const outcome = await deps.panes.send(request.p.paneId, request.p.text, request.p.submit);
        deps.onUsage?.("send");
        return { r: outcome };
      }
      case "pane.read":
        return bodyOf("text", await deps.panes.read(request.p.paneId, request.p.lines));
      case "pane.open": {
        const opened = await deps.panes.open(request.p);
        deps.onUsage?.("open");
        return { r: opened };
      }
      case "projects.list":
        return { r: { projects: await deps.tree.projects() } };
      case "agents.list":
        return { r: { agents: await deps.tree.agents() } };
      case "files.list":
        return { r: { entries: await deps.files.list(request.p.root, request.p.path) } };
      case "files.read": {
        const file = await deps.files.read(request.p.root, request.p.path);
        return bodyOf("text", file.text, { truncated: file.truncated, binary: file.binary });
      }
      case "changes.list":
        return { r: { changes: await deps.files.changes(request.p.root) } };
      case "changes.diff":
        return bodyOf("diff", (await deps.files.diff(request.p.root, request.p.path)).diff);
      case "usage.get":
        return { r: { usage: summarizeUsage(await deps.usage(), now()) } };
    }
  }

  return {
    async handle(session, request) {
      try {
        const { r, chunks = [], after } = await run(session, request);
        return {
          response: okResponse(request.id, r as Record<string, unknown>),
          chunks,
          ...(after === undefined ? {} : { after }),
        };
      } catch (error) {
        if (error instanceof PhoneError) {
          return { response: errorResponse(request.id, error.code, error.message), chunks: [] };
        }
        // The detail stays in the log; a phone is told only that it failed.
        deps.log(`Deck: a phone request (${request.m}) failed: ${String(error)}`);
        return {
          response: errorResponse(request.id, "internal", "Deck could not do that"),
          chunks: [],
        };
      }
    },
    closeSession(sessionId) {
      dropTreeSubscription(sessionId);
      deps.streams.closeOwner(sessionId);
    },
  };
}
