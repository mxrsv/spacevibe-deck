/**
 * One phone on one transport (a relay socket today, a LAN socket later): the desktop end of the
 * secure channel plus the request loop on top of it. The channel owns the handshake, the version
 * gate (MOB10) and the sealing; this module answers `session.start` with the `desktop` event,
 * parses every request (the phone is untrusted), hands it to the executor and writes the response,
 * then any chunks, then the executor's `after` hook.
 */
import { randomUUID } from "node:crypto";
import type { ChunkEvent } from "../../mobile/protocol/src/chunk";
import { createDesktopChannel, type DesktopChannel } from "../../mobile/protocol/src/channel";
import type { CryptoProvider } from "../../mobile/protocol/src/crypto";
import {
  errorResponse,
  METHODS,
  parseRequest,
  type LanAddress,
  type OS_NAMES,
} from "../../mobile/protocol/src/messages";
import { PROTOCOL_VERSION } from "../../mobile/protocol/src/version";
import type { Tree } from "../../mobile/protocol/src/tree";
import type { PhoneExecutor } from "./phone-executor";
import type { StreamSink } from "./phone-streams";

export interface DesktopHello {
  readonly name: string;
  readonly os: (typeof OS_NAMES)[number];
  readonly appVersion: string;
  readonly lan: readonly LanAddress[];
}

export interface PhoneSessionDeps {
  readonly crypto: CryptoProvider;
  /** The pairKey of a pairing this desktop still honours, else null (revoked or unknown). */
  readonly lookup: (pairingId: string) => Uint8Array | null;
  readonly send: (frame: Uint8Array) => void;
  readonly executor: PhoneExecutor;
  readonly hello: () => DesktopHello;
  readonly log: (message: string) => void;
  /** The channel opened for this pairing. */
  readonly onOpen?: (pairingId: string) => void;
  /** The session ended, for any reason. */
  readonly onClosed?: (reason: string | null) => void;
  readonly newId?: () => string;
}

export interface PhoneSession {
  receive(frame: Uint8Array): void;
  close(reason: string): void;
  readonly pairingId: string | null;
  readonly channel: DesktopChannel;
}

/** Without lastLine a tree is a fraction of the size; sent when the full one does not fit a message. */
function withoutLastLines(tree: Tree): Tree {
  return {
    projects: tree.projects.map((project) => ({
      ...project,
      checkouts: project.checkouts.map((checkout) => ({
        ...checkout,
        panes: checkout.panes.map((pane) => ({ ...pane, lastLine: "" })),
      })),
    })),
  };
}

export function createPhoneSession(deps: PhoneSessionDeps): PhoneSession {
  const sessionId = (deps.newId ?? randomUUID)();
  const channel = createDesktopChannel({
    crypto: deps.crypto,
    lookup: deps.lookup,
    send: deps.send,
  });

  const sink: StreamSink = {
    snapshot: (p) => void channel.sendMessage({ ev: "term.snapshot", p }),
    data: (sub, data) => void channel.sendMessage({ ev: "term.data", p: { sub, data } }),
    resize: (sub, cols, rows) =>
      void channel.sendMessage({ ev: "term.resize", p: { sub, cols, rows } }),
    end: (sub, reason) => void channel.sendMessage({ ev: "term.end", p: { sub, reason } }),
  };
  const executorSession = {
    id: sessionId,
    sink,
    pushTree(tree: Tree) {
      if (channel.sendMessage({ ev: "tree", p: { tree } }) === "too-large") {
        channel.sendMessage({ ev: "tree", p: { tree: withoutLastLines(tree) } });
      }
    },
  };

  function sendChunks(chunks: readonly ChunkEvent[]): void {
    for (const chunk of chunks) channel.sendMessage(chunk);
  }

  async function answer(message: Readonly<Record<string, unknown>>): Promise<void> {
    const request = parseRequest(message);
    if (request === null) {
      const id = message.id;
      if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) {
        const known = METHODS.some((method) => method === message.m);
        channel.sendMessage(
          errorResponse(id, known ? "invalid" : "unknown-method", "That request is not valid"),
        );
      }
      return;
    }
    const outcome = await deps.executor.handle(executorSession, request);
    if (channel.state !== "open") return;
    if (channel.sendMessage(outcome.response) === "too-large") {
      channel.sendMessage(errorResponse(request.id, "too-large", "The answer was too large"));
      return;
    }
    sendChunks(outcome.chunks);
    outcome.after?.();
  }

  channel.onState((state, reason) => {
    if (state === "open" && channel.pairingId !== null) {
      const hello = deps.hello();
      channel.sendMessage({
        ev: "desktop",
        p: { ...hello, protocol: PROTOCOL_VERSION },
      });
      deps.onOpen?.(channel.pairingId);
    } else if (state === "closed") {
      deps.executor.closeSession(sessionId);
      deps.onClosed?.(reason);
    }
  });

  channel.onMessage((message) => {
    // Only requests are acted on; the phone's own events (`session.start`) need no answer.
    if (!("m" in message)) return;
    void answer(message).catch((error: unknown) => {
      deps.log(`Deck: a phone request could not be answered: ${String(error)}`);
    });
  });

  return {
    receive: (frame) => channel.receive(frame),
    close: (reason) => channel.close(reason),
    get pairingId() {
      return channel.pairingId;
    },
    channel,
  };
}
