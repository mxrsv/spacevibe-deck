/**
 * Scanner seam — real IPC in production, fakes in tests. Mirrors
 * `src/usage/usage-client.ts`, including the reason it exists: the store must
 * be unit-testable with no host bridge at all.
 */
import { listSessions } from "../host/sessions-host";
import { sessionTails } from "../host/session-tail-host";
import { defaultPtyClient } from "../terminal/pty-client";
import type { ResumeRequest, SessionTailAnswer } from "../lib/agent-resume";
import type { SessionsSnapshot } from "../lib/session-history";

export interface SessionsClient {
  /** `null` means this host has no session history (Tauri, browser dev). */
  list(limit: number): Promise<SessionsSnapshot | null>;
  /** Liveness for the resume guard — same `dirs_exist` the boot restore uses. */
  dirsExist(paths: readonly string[]): Promise<readonly boolean[]>;
  /** Latest assistant sentence for each exact session request, positionally. */
  tails(requests: readonly ResumeRequest[]): Promise<readonly (SessionTailAnswer | null)[]>;
}

export function createHostSessionsClient(): SessionsClient {
  return {
    list: (limit) => listSessions(limit),
    dirsExist: (paths) => defaultPtyClient.dirsExist(paths),
    tails: (requests) => sessionTails(requests),
  };
}

export function createMemorySessionsClient(
  snapshot: SessionsSnapshot | null,
  options: {
    readonly fail?: boolean;
    readonly alive?: (path: string) => boolean;
    readonly tails?: readonly (SessionTailAnswer | null)[];
  } = {},
): SessionsClient {
  return {
    async list() {
      if (options.fail === true) {
        throw new Error("sessions_list failed");
      }
      return snapshot;
    },
    async dirsExist(paths) {
      return paths.map((path) => options.alive?.(path) ?? true);
    },
    async tails(requests) {
      return requests.map((_request, index) => options.tails?.[index] ?? null);
    },
  };
}

export const defaultSessionsClient: SessionsClient = createHostSessionsClient();
