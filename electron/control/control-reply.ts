/**
 * What a control command hands back to the router, shared by `control-routes.ts` and the pane
 * commands that need the renderer (spec 2026-11-03-agent-orchestration).
 *
 * A command answers a status code, one JSON object that always has `ok`, and the text a human
 * reads in the pane. The router sends the JSON when the call asked for `json=1` and the text
 * otherwise.
 */

export type ControlJson = { readonly ok: boolean } & Readonly<Record<string, unknown>>;

export interface Reply {
  readonly status: number;
  readonly json: ControlJson;
  readonly text: string;
}

export interface CommandContext {
  readonly paneId: number;
  readonly args: URLSearchParams;
  /** Aborts when the caller hangs up before the reply, so a held call lets go of its timers. */
  readonly signal: AbortSignal;
}

export type Command = (context: CommandContext) => Reply | Promise<Reply>;

export function usage(message: string): Reply {
  return {
    status: 400,
    json: { ok: false, error: "usage", message },
    text: `deck: ${message}`,
  };
}

export function failure(status: number, error: string, text: string): Reply {
  return { status, json: { ok: false, error }, text: `deck: ${text}` };
}
