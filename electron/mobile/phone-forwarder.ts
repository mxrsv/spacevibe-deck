/**
 * The phone's own `ControlForwarder` (a second instance; the CLI's router keeps its own). It
 * differs from the CLI's only in how a command finds its window: a pane command routes by the
 * pane's owner, as always, but a callerless `open` has no pane to route by. It borrows a
 * synthetic id that maps to the chosen window label for the life of the request, so the forwarder
 * itself stays unchanged (it keys everything on a pane id).
 */
import {
  createControlForwarder,
  type ControlCommandFields,
  type ControlForwarder,
  type ForwardResult,
} from "../control/control-forward";
import type { ControlReplyPayload } from "../../src/lib/control-command";

/** Above any real pane id (those count up from 1); never reaches a renderer's pane tables. */
const SYNTHETIC_BASE = 2_000_000_000;

export interface PhoneForwarder {
  readonly forwarder: ControlForwarder;
  openIn(label: string, fields: ControlCommandFields, timeoutMs: number): Promise<ForwardResult>;
  /** A reply from a window; false when this forwarder holds no such request. */
  settle(fromWindow: string, reply: ControlReplyPayload): boolean;
}

export function createPhoneForwarder(deps: {
  readonly windowOf: (paneId: number) => string | null;
  readonly deliver: (paneId: number, event: string, payload: unknown) => void;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
  readonly log: (message: string) => void;
}): PhoneForwarder {
  const synthetic = new Map<number, string>();
  let next = SYNTHETIC_BASE;

  const forwarder = createControlForwarder({
    windowOf: (paneId) => synthetic.get(paneId) ?? deps.windowOf(paneId),
    deliver: (paneId, event, payload) => {
      const label = synthetic.get(paneId);
      if (label === undefined) deps.deliver(paneId, event, payload);
      else if (!deps.emitTo(label, event, payload)) throw new Error(`window ${label} is gone`);
    },
    // Replies for the CLI's requests reach this forwarder first and are refused here; only a
    // delivery failure is worth a line.
    log: (message) => {
      if (message.includes("could not be delivered")) deps.log(message);
    },
  });

  return {
    forwarder,
    async openIn(label, fields, timeoutMs) {
      const id = next++;
      synthetic.set(id, label);
      try {
        return await forwarder.forward({
          callerPaneId: 0,
          fields: { ...fields, paneId: id },
          timeoutMs,
        });
      } finally {
        synthetic.delete(id);
      }
    },
    settle: (fromWindow, reply) => forwarder.settle(fromWindow, reply),
  };
}
