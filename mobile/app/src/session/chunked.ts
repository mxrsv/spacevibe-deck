import { createChunkAssembler } from "@protocol/chunk";
import type { DesktopConnection } from "./connection";
import { RpcError } from "./rpc";

/** How long the chunks of an answer may take to arrive once the answer named them. */
export const CHUNK_TIMEOUT_MS = 15_000;

type Settled = { readonly ok: true; readonly text: string } | { readonly ok: false };

/**
 * Runs a request whose answer is either the body itself or `{ chunked: id }` followed by `chunk`
 * events (the desktop sends the response first, then the chunks). The collector listens before the
 * request is sent and keeps every finished body by id, so it does not matter whether the chunks
 * are handled before or after the answer's continuation runs.
 */
export async function requestBody<R>(
  connection: Pick<DesktopConnection, "onEvent">,
  send: () => Promise<R>,
  pick: (answer: R) => { readonly text: string } | { readonly chunked: string },
  timeoutMs = CHUNK_TIMEOUT_MS,
): Promise<{ readonly answer: R; readonly text: string }> {
  const assembler = createChunkAssembler();
  const finished = new Map<string, Settled>();
  const waiting = new Map<string, (result: Settled) => void>();
  const settle = (id: string, result: Settled): void => {
    const waiter = waiting.get(id);
    if (waiter === undefined) finished.set(id, result);
    else waiter(result);
  };
  const off = connection.onEvent((event) => {
    if (event.ev !== "chunk") return;
    const result = assembler.push(event.p);
    if (result.status === "done") settle(result.id, { ok: true, text: result.text });
    else if (result.status === "error") settle(result.id, { ok: false });
  });
  try {
    const answer = await send();
    const body = pick(answer);
    if ("text" in body) return { answer, text: body.text };
    const early = finished.get(body.chunked);
    const result =
      early ??
      (await new Promise<Settled>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(body.chunked);
          resolve({ ok: false });
        }, timeoutMs);
        waiting.set(body.chunked, (value) => {
          clearTimeout(timer);
          waiting.delete(body.chunked);
          resolve(value);
        });
      }));
    if (!result.ok) throw new RpcError("bad-response", "The desktop's answer was incomplete.");
    return { answer, text: result.text };
  } finally {
    off();
  }
}
