import type { SendResult } from "@protocol/channel";
import type { ErrorCode, Method, MethodParams, Response } from "@protocol/messages";
import { parseResult, type MethodResults } from "@protocol/results";

export const RPC_TIMEOUT_MS = 15_000;

export type RpcFailure =
  ErrorCode | "timeout" | "not-connected" | "closed" | "bad-response" | "too-large";

export class RpcError extends Error {
  readonly code: RpcFailure;
  constructor(code: RpcFailure, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export interface RpcClient {
  request<M extends Method>(
    method: M,
    params: MethodParams[M],
    options?: { readonly timeoutMs?: number },
  ): Promise<MethodResults[M]>;
  /** Feed a parsed response; returns false when no request is waiting for it. */
  handleResponse(response: Response): boolean;
  /** The channel went away: every waiting request fails now, not after its timeout. */
  failAll(code: RpcFailure, message: string): void;
}

interface Pending {
  readonly method: Method;
  readonly resolve: (value: never) => void;
  readonly reject: (error: RpcError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Request/response over the sealed channel (design §6): numeric ids, one timeout per request. */
export function createRpc(send: (message: object) => SendResult): RpcClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  return {
    request(method, params, options) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const sent = send({ id, m: method, p: params });
        if (sent !== "sent") {
          reject(
            sent === "too-large"
              ? new RpcError("too-large", "That request is too large to send.")
              : new RpcError("not-connected", "Not connected to this desktop."),
          );
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new RpcError("timeout", "The desktop did not answer in time."));
        }, options?.timeoutMs ?? RPC_TIMEOUT_MS);
        pending.set(id, { method, resolve: resolve as (value: never) => void, reject, timer });
      });
    },
    handleResponse(response) {
      const entry = pending.get(response.id);
      if (entry === undefined) return false;
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (!response.ok) {
        entry.reject(new RpcError(response.e.code, response.e.message));
        return true;
      }
      // The envelope parser cannot know the method; the typed result parser can, and refuses a
      // body that is not of that shape rather than letting the UI render it.
      const result = parseResult(entry.method, response.r);
      if (result === null)
        entry.reject(new RpcError("bad-response", "The desktop sent an unreadable answer."));
      else entry.resolve(result as never);
      return true;
    },
    failAll(code, message) {
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new RpcError(code, message));
      }
    },
  };
}
