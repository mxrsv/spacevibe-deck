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
import { CHUNK_BYTES } from "../../mobile/protocol/src/limits";
import { MAX_SUB_CHARS, type TermEndReason } from "../../mobile/protocol/src/messages";

export const STREAM_KINDS = ["snapshot", "data", "resize", "end"] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];
export type EndReason = TermEndReason;

/** How long the window gets to produce the first snapshot. */
export const SNAPSHOT_TIMEOUT_MS = 5_000;
/** Streams one phone session may hold at once; a phone watches one pane, maybe two. */
export const MAX_STREAMS_PER_OWNER = 4;
/**
 * One subscription sends at most one `term.data` group per this long. The relay allows a socket
 * 400 messages per 10 s and closes it (dropping every session and push) past that, so a busy pane
 * is coalesced here instead of forwarded chunk by chunk.
 */
export const DATA_PACE_MS = 50;
/** Output a phone has not been sent yet, past which its stream ends with `overflow`. */
export const MAX_BACKLOG_CHARS = 1_048_576;
/** After a pane's PTY is gone, how long to wait for the renderer's final flush and `end`. */
export const PANE_GONE_GRACE_MS = 1_000;
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
  | { kind: "data"; data: string }
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
  /** Everything not yet sent to the phone, in order; data items are coalesced. */
  queued: Queued[];
  /** Characters of data in `queued`. */
  backlog: number;
  /** Set between one data send and the next allowed one. */
  pace: ReturnType<typeof setTimeout> | null;
  /** The pane's PTY exited; waiting for the renderer's `end`. */
  goneTimer: ReturnType<typeof setTimeout> | null;
  onSnapshot: ((value: { cols: number; rows: number } | null) => void) | null;
}

/** The reasons a renderer may report; `overflow` is main's own. */
const END_REASONS: readonly EndReason[] = ["closed", "unsubscribed", "moved"];

function newSubId(): string {
  return randomUUID().replace(/-/g, "");
}

export function createStreamHub(deps: StreamHubDeps): StreamHub {
  const subs = new Map<string, Sub>();
  const newId = deps.newId ?? newSubId;
  const timeoutMs = deps.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS;

  /** The first CHUNK_BYTES characters of `data`, never splitting a surrogate pair. */
  function prefixOf(data: string): number {
    let end = Math.min(data.length, CHUNK_BYTES);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end += 1;
    return end;
  }

  /** Sends what is allowed now: at most one group of data per pace, and the non-data items in order. */
  function pump(entry: Sub): void {
    if (!entry.begun) return;
    while (entry.queued.length > 0) {
      const head = entry.queued[0]!;
      if (head.kind === "resize") {
        entry.queued.shift();
        entry.sink.resize(entry.sub, head.cols, head.rows);
        continue;
      }
      if (head.kind === "end") {
        entry.queued.shift();
        clearTimers(entry);
        subs.delete(entry.sub);
        entry.sink.end(entry.sub, head.reason);
        return;
      }
      // Data waits out the pace; a resize or end behind it goes out as soon as the data has.
      if (entry.pace !== null) return;
      const cut = prefixOf(head.data);
      const part = head.data.slice(0, cut);
      head.data = head.data.slice(cut);
      entry.backlog -= part.length;
      if (head.data === "") entry.queued.shift();
      // Split so one burst of output never exceeds a message.
      for (const piece of splitChunks("d", part)) entry.sink.data(entry.sub, piece.p.data);
      // The next data waits out the pace even when nothing is queued yet.
      entry.pace = setTimeout(() => {
        entry.pace = null;
        if (subs.has(entry.sub)) pump(entry);
      }, DATA_PACE_MS);
      entry.pace.unref?.();
    }
  }

  function clearTimers(entry: Sub): void {
    if (entry.pace !== null) clearTimeout(entry.pace);
    if (entry.goneTimer !== null) clearTimeout(entry.goneTimer);
    entry.pace = null;
    entry.goneTimer = null;
  }

  /** Queues in order and sends if allowed; a phone too far behind loses the stream, not the socket. */
  function enqueue(entry: Sub, item: Queued): void {
    if (item.kind === "data") {
      const tail = entry.queued.at(-1);
      if (tail?.kind === "data") tail.data += item.data;
      else entry.queued.push({ kind: "data", data: item.data });
      entry.backlog += item.data.length;
      if (entry.backlog > MAX_BACKLOG_CHARS) {
        clearTimers(entry);
        entry.queued = [];
        entry.backlog = 0;
        subs.delete(entry.sub);
        try {
          deps.stopStream(entry.label, entry.sub);
        } catch {
          // The window is gone; nothing left to stop.
        }
        entry.sink.end(entry.sub, "overflow");
        return;
      }
    } else {
      entry.queued.push(item);
    }
    pump(entry);
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
    clearTimers(entry);
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
        backlog: 0,
        pace: null,
        goneTimer: null,
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
          pump(entry);
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
        if (!entry.begun) {
          drop(entry, false);
          continue;
        }
        // The renderer's last output and its `end` are still on their way; wait for them so the
        // tail of the pane is not lost, but never leave the stream open for long.
        entry.goneTimer ??= setTimeout(() => {
          entry.goneTimer = null;
          if (subs.has(entry.sub)) enqueue(entry, { kind: "end", reason: "closed" });
        }, PANE_GONE_GRACE_MS);
        entry.goneTimer.unref?.();
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
          if (item.kind === "end" && entry.goneTimer !== null) {
            clearTimeout(entry.goneTimer);
            entry.goneTimer = null;
          }
          enqueue(entry, item);
          return true;
        }
      }
    },
  };
}
