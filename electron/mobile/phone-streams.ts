/**
 * Main's half of the terminal stream a phone watches (mobile design §7, F3). Main never reads or
 * writes a PTY for this: it asks the window that owns the pane to start a stream, and the window
 * answers through `mobile_stream_data` with one raw snapshot followed, in order, by that pane's
 * live output, resizes and the end. Order holds because every piece comes from one renderer over
 * one channel; main only validates, labels with the subscription and forwards.
 *
 * A message counts only for a subscription this hub holds, from the window it was started in and
 * for the pane it named, so a window can neither feed another phone's stream nor invent one.
 * Viewing never resizes the desktop pane (MOB14): the snapshot carries the pane's own size.
 */
import { randomUUID } from "node:crypto";
import { splitChunks } from "../../mobile/protocol/src/chunk";
import { MAX_SUB_CHARS } from "../../mobile/protocol/src/messages";

export const STREAM_KINDS = ["snapshot", "data", "resize", "end"] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];
export type EndReason = "closed" | "unsubscribed" | "moved";

/** How long the window gets to produce the first snapshot. */
export const SNAPSHOT_TIMEOUT_MS = 5_000;
/** Streams one phone session may hold at once; a phone watches one pane, maybe two. */
export const MAX_STREAMS_PER_OWNER = 4;
/** Largest pty chunk the renderer may hand over in one message. */
export const MAX_STREAM_DATA_CHARS = 2_000_000;

export interface StreamMessage {
  readonly subscriptionId: string;
  readonly paneId: number;
  readonly kind: StreamKind;
  readonly data: string;
  readonly cols: number;
  readonly rows: number;
}

/** Where a stream's pieces go: the phone session's channel. */
export interface StreamSink {
  snapshot(piece: {
    sub: string;
    paneId: number;
    cols: number;
    rows: number;
    data: string;
    seq: number;
    last: boolean;
  }): void;
  data(sub: string, data: string): void;
  resize(sub: string, cols: number, rows: number): void;
  end(sub: string, reason: EndReason): void;
}

export type SubscribeResult =
  | {
      readonly ok: true;
      readonly sub: string;
      readonly cols: number;
      readonly rows: number;
      /** Starts the flow: call after the response to `pane.subscribe` went out. */
      begin(): void;
    }
  | { readonly ok: false; readonly code: "no-target" | "busy" | "unavailable" };

export interface StreamHub {
  subscribe(owner: string, paneId: number, sink: StreamSink): Promise<SubscribeResult>;
  /** The phone asked to stop. False for a sub this owner does not hold. */
  unsubscribe(owner: string, sub: string): boolean;
  /** The phone session is gone: stop everything it held, say nothing to the phone. */
  closeOwner(owner: string): void;
  /** The pane's PTY is gone. */
  paneGone(paneId: number): void;
  /** A renderer message; false when it matches no subscription of that window. */
  fromRenderer(fromWindow: string, message: StreamMessage): boolean;
}

export interface StreamHubDeps {
  readonly ownerOf: (paneId: number) => string | null;
  /** Pushes `mobile:stream-subscribe` to the window that owns the pane. */
  readonly startStream: (paneId: number, subscriptionId: string) => void;
  /** Pushes `mobile:stream-unsubscribe` to a window. */
  readonly stopStream: (label: string, subscriptionId: string) => void;
  readonly newId?: () => string;
  readonly snapshotTimeoutMs?: number;
}

type Queued =
  | { readonly kind: "data"; readonly data: string }
  | { readonly kind: "resize"; readonly cols: number; readonly rows: number }
  | { readonly kind: "end"; readonly reason: EndReason };

interface Sub {
  readonly sub: string;
  readonly owner: string;
  readonly paneId: number;
  readonly label: string;
  readonly sink: StreamSink;
  snapshot: { cols: number; rows: number; data: string } | null;
  begun: boolean;
  queued: Queued[];
  onSnapshot: ((value: { cols: number; rows: number } | null) => void) | null;
}

const END_REASONS: readonly EndReason[] = ["closed", "unsubscribed", "moved"];

function newSubId(): string {
  return randomUUID().replace(/-/g, "");
}

export function createStreamHub(deps: StreamHubDeps): StreamHub {
  const subs = new Map<string, Sub>();
  const newId = deps.newId ?? newSubId;
  const timeoutMs = deps.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS;

  function deliver(entry: Sub, item: Queued): void {
    switch (item.kind) {
      case "data":
        // Split so one burst of output never exceeds a message.
        for (const piece of splitChunks("d", item.data)) entry.sink.data(entry.sub, piece.p.data);
        return;
      case "resize":
        entry.sink.resize(entry.sub, item.cols, item.rows);
        return;
      case "end":
        subs.delete(entry.sub);
        entry.sink.end(entry.sub, item.reason);
        return;
    }
  }

  function flushSnapshot(entry: Sub): void {
    const snapshot = entry.snapshot;
    if (snapshot === null) return;
    for (const piece of splitChunks("s", snapshot.data)) {
      entry.sink.snapshot({
        sub: entry.sub,
        paneId: entry.paneId,
        cols: snapshot.cols,
        rows: snapshot.rows,
        data: piece.p.data,
        seq: piece.p.seq,
        last: piece.p.last,
      });
    }
  }

  function drop(entry: Sub, notifyWindow: boolean): void {
    subs.delete(entry.sub);
    entry.onSnapshot?.(null);
    if (notifyWindow) {
      try {
        deps.stopStream(entry.label, entry.sub);
      } catch {
        // The window is gone; nothing left to stop.
      }
    }
  }

  return {
    async subscribe(owner, paneId, sink) {
      const label = deps.ownerOf(paneId);
      if (label === null) return { ok: false, code: "no-target" };
      let held = 0;
      for (const entry of subs.values()) if (entry.owner === owner) held += 1;
      if (held >= MAX_STREAMS_PER_OWNER) return { ok: false, code: "busy" };

      const sub = newId();
      if (sub.length > MAX_SUB_CHARS) return { ok: false, code: "unavailable" };
      const entry: Sub = {
        sub,
        owner,
        paneId,
        label,
        sink,
        snapshot: null,
        begun: false,
        queued: [],
        onSnapshot: null,
      };
      subs.set(sub, entry);
      const first = new Promise<{ cols: number; rows: number } | null>((resolve) => {
        entry.onSnapshot = resolve;
        const timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref?.();
      });
      try {
        deps.startStream(paneId, sub);
      } catch {
        drop(entry, false);
        return { ok: false, code: "no-target" };
      }
      const size = await first;
      if (size === null || !subs.has(sub)) {
        drop(entry, true);
        return { ok: false, code: "unavailable" };
      }
      return {
        ok: true,
        sub,
        cols: size.cols,
        rows: size.rows,
        begin() {
          if (entry.begun || !subs.has(sub)) return;
          entry.begun = true;
          flushSnapshot(entry);
          const queued = entry.queued;
          entry.queued = [];
          for (const item of queued) deliver(entry, item);
        },
      };
    },

    unsubscribe(owner, sub) {
      const entry = subs.get(sub);
      if (entry === undefined || entry.owner !== owner) return false;
      drop(entry, true);
      entry.sink.end(sub, "unsubscribed");
      return true;
    },

    closeOwner(owner) {
      for (const entry of [...subs.values()]) {
        if (entry.owner === owner) drop(entry, true);
      }
    },

    paneGone(paneId) {
      for (const entry of [...subs.values()]) {
        if (entry.paneId !== paneId) continue;
        if (entry.begun) deliver(entry, { kind: "end", reason: "closed" });
        else drop(entry, false);
      }
    },

    fromRenderer(fromWindow, message) {
      const entry = subs.get(message.subscriptionId);
      if (entry === undefined || entry.label !== fromWindow || entry.paneId !== message.paneId) {
        return false;
      }
      switch (message.kind) {
        case "snapshot":
          // Only the first snapshot starts a stream; a second would rewind it.
          if (entry.snapshot !== null) return false;
          entry.snapshot = { cols: message.cols, rows: message.rows, data: message.data };
          entry.onSnapshot?.({ cols: message.cols, rows: message.rows });
          entry.onSnapshot = null;
          return true;
        case "data":
        case "resize":
        case "end": {
          if (entry.snapshot === null) return false;
          const item: Queued =
            message.kind === "data"
              ? { kind: "data", data: message.data }
              : message.kind === "resize"
                ? { kind: "resize", cols: message.cols, rows: message.rows }
                : {
                    kind: "end",
                    reason: END_REASONS.find((reason) => reason === message.data) ?? "closed",
                  };
          if (entry.begun) deliver(entry, item);
          else entry.queued.push(item);
          return true;
        }
      }
    },
  };
}
