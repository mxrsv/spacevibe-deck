/**
 * Sends a diff comment to the agent pane it was aimed at (spec
 * 2026-10-21-diff-line-comments, DLC8–12).
 *
 * The target is the agent process captured when the composer opened;
 * `injectIntoPane` re-checks it before the paste and again before Enter. Sends to
 * one pane run one after another: the pane's inject guard answers `busy` to an
 * overlap, and a comment must wait its turn rather than be dropped.
 */
import type { InjectOptions, InjectOutcome } from "../../prompts/inject";

/** Paste first, Enter after this long; the gate is read again at that moment. */
export const COMMENT_SUBMIT_DELAY_MS = 500;

export interface CommentTarget {
  readonly paneId: number;
  readonly agent: string;
  readonly processId: number;
}

/** `"pasted"`: the text sits unsent in the agent's composer. */
export type CommentDelivery = Exclude<InjectOutcome, "busy">;

export interface CommentSender {
  send(target: CommentTarget, payload: string): Promise<CommentDelivery>;
}

export interface CommentSenderPorts {
  injectIntoPane(paneId: number, text: string, opts: InjectOptions): Promise<InjectOutcome>;
}

export function createCommentSender(ports: CommentSenderPorts): CommentSender {
  const tails = new Map<number, Promise<unknown>>();

  const deliver = async (target: CommentTarget, payload: string): Promise<CommentDelivery> => {
    try {
      const outcome = await ports.injectIntoPane(target.paneId, payload, {
        autoSend: true,
        expectedAgent: target.agent,
        expectedProcessId: target.processId,
        submitDelayMs: COMMENT_SUBMIT_DELAY_MS,
      });
      // The chain is the only caller, so `busy` means something else (the Prompt
      // Board) holds the pane and nothing was written.
      return outcome === "busy" ? "failed" : outcome;
    } catch {
      return "failed";
    }
  };

  return {
    send(target, payload) {
      const turn = (tails.get(target.paneId) ?? Promise.resolve()).then(() =>
        deliver(target, payload),
      );
      tails.set(target.paneId, turn);
      void turn.then(() => {
        if (tails.get(target.paneId) === turn) {
          tails.delete(target.paneId);
        }
      });
      return turn;
    },
  };
}
