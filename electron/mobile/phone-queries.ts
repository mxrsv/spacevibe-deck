/**
 * Asks the renderers what only they know (the rail's grouping, the agent catalog, the known
 * workspaces) and collects the answers. Main pushes one `mobile:query-request` to every window and
 * resolves when each has answered through `mobile_query_report`, or after a timeout with whoever
 * did. A report counts only for a request this broker still holds, from a window it was sent to,
 * with the kind that was asked, so a window cannot answer for another or invent a query.
 */
import { randomUUID } from "node:crypto";

export const QUERY_KINDS = ["tree", "projects", "agents"] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export const QUERY_TIMEOUT_MS = 1_500;

export interface QueryAnswer {
  readonly label: string;
  /** Unchecked: the caller parses it with the protocol's parsers. */
  readonly payload: unknown;
}

export interface QueryBroker {
  query(kind: QueryKind): Promise<readonly QueryAnswer[]>;
  /** False, and nothing else happens, when no held request matches. */
  settle(fromWindow: string, requestId: string, kind: QueryKind, payload: unknown): boolean;
}

interface Held {
  readonly kind: QueryKind;
  readonly waiting: Set<string>;
  readonly answers: QueryAnswer[];
  finish(): void;
}

export function createQueryBroker(deps: {
  readonly windows: () => readonly string[];
  readonly send: (label: string, requestId: string, kind: QueryKind) => void;
  readonly timeoutMs?: number;
  readonly newId?: () => string;
}): QueryBroker {
  const held = new Map<string, Held>();
  const newId = deps.newId ?? randomUUID;
  const timeoutMs = deps.timeoutMs ?? QUERY_TIMEOUT_MS;

  return {
    query(kind) {
      const labels = [...deps.windows()];
      if (labels.length === 0) return Promise.resolve([]);
      const requestId = newId();
      return new Promise((resolve) => {
        const entry: Held = {
          kind,
          waiting: new Set(labels),
          answers: [],
          finish() {
            clearTimeout(timer);
            held.delete(requestId);
            resolve(entry.answers);
          },
        };
        const timer = setTimeout(() => entry.finish(), timeoutMs);
        timer.unref?.();
        held.set(requestId, entry);
        for (const label of labels) {
          try {
            deps.send(label, requestId, kind);
          } catch {
            entry.waiting.delete(label);
          }
        }
        if (entry.waiting.size === 0) entry.finish();
      });
    },
    settle(fromWindow, requestId, kind, payload) {
      const entry = held.get(requestId);
      if (entry === undefined || entry.kind !== kind || !entry.waiting.delete(fromWindow)) {
        return false;
      }
      entry.answers.push({ label: fromWindow, payload });
      if (entry.waiting.size === 0) entry.finish();
      return true;
    },
  };
}
