/**
 * This window's half of the iPhone companion (spec 2026-11-04-mobile-companion, F3). Everything a
 * phone sees of a pane, and everything it types into one, passes through here, in the renderer
 * that owns the pane. Main never taps a PTY and never writes one.
 *
 *  - **Streams.** On `mobile:stream-subscribe` the bridge takes the pane's raw snapshot at one
 *    instant and, from that same instant, buffers the pane's live output (`noteOutput`). It sends
 *    the snapshot, then the buffered output, then live output, in order. Output is coalesced for
 *    `FLUSH_MS` so a busy agent costs the relay a few messages a second, not one per chunk.
 *  - **Input.** A phone's keystrokes go through `writePty` of the pane's own client (`paneIo`), the
 *    wrapper that notes input first, so echo is suppressed and a keystroke never reads as work.
 *  - **Queries.** The tree, the project choices and the agent list, answered on request.
 *
 * Viewing never resizes the pane (MOB14): the size is only read. The bridge ends a stream when its
 * pane exits or leaves this window; the phone resubscribes if it wants it back.
 */
import type { MobileQueryKind, MobileStreamPiece } from "../host/mobile-host";
import { buildMobileTree, buildProjectChoices, type ProjectChoiceReport } from "./mobile-tree";
import type { RepositoryScan } from "../repositories/repository-client";
import type { TabView } from "./tabs-store";

/** Rows of scrollback in a stream's first snapshot. */
export const STREAM_SCROLLBACK_ROWS = 2_000;
/** Live output is coalesced for this long before it is sent. */
export const FLUSH_MS = 50;
/** Buffered live output is sent early past this many characters. */
export const FLUSH_CHARS = 32_768;
/** How often a stream checks that its pane is still here and still the same size. */
export const WATCH_MS = 2_000;
/** Workspaces offered as projects; the launcher keeps up to 50, a phone list needs fewer. */
const MAX_PROJECTS = 30;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function paneIdOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function idOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

const QUERY_KINDS: readonly MobileQueryKind[] = ["tree", "projects", "agents"];
/** The most a phone's `pane.input` carries is 4096 characters; leave room for a paste frame. */
const MAX_INPUT_CHARS = 8_192;

export interface MobileBridgeDeps {
  readonly tabs: () => readonly TabView[];
  readonly activeIndex: () => number;
  readonly scans: () => ReadonlyMap<string, RepositoryScan>;
  readonly workspacePaths: () => readonly string[];
  readonly scanRepository: (path: string) => Promise<RepositoryScan>;
  readonly workspaceLabel: (path: string) => string;
  /** The agents a phone may open: enabled, installed, and with an id the protocol accepts. */
  readonly agentChoices: () => Promise<readonly { id: string; label: string }[]>;
  readonly agentLabel: (agentId: string) => string | null;
  /** Plain rows of the pane's screen (ANSI stripped), "" for a pane not here. */
  readonly screenText: (paneId: number) => string;
  readonly hasPane: (paneId: number) => boolean;
  readonly paneSize: (paneId: number) => { cols: number; rows: number } | null;
  readonly snapshot: (
    paneId: number,
    lines: number,
  ) => Promise<{ data: string; cols: number; rows: number }> | null;
  /** The pane's own client write, which notes input before it writes. */
  readonly writePty: (paneId: number, data: string) => void;
  readonly reportQuery: (report: {
    requestId: string;
    kind: MobileQueryKind;
    payload: unknown;
  }) => void;
  readonly sendStream: (piece: MobileStreamPiece) => void;
  readonly now?: () => number;
}

export interface MobileBridge {
  /** Every chunk of output of every pane this window owns, as the PTY delivered it. */
  noteOutput(paneId: number, data: string): void;
  noteExit(paneId: number): void;
  /** The pane's tab or the pane itself is gone from this window (closed or moved). */
  prune(): void;
  handleQuery(payload: unknown): void;
  handleSubscribe(payload: unknown): void;
  handleUnsubscribe(payload: unknown): void;
  handleInput(payload: unknown): void;
  dispose(): void;
}

interface Stream {
  readonly subscriptionId: string;
  readonly paneId: number;
  /** Output since the snapshot instant, until the snapshot has been sent. */
  held: string[];
  /** False until the snapshot piece has gone out; output waits in `held` until then. */
  ready: boolean;
  pending: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  size: { cols: number; rows: number } | null;
}

export function createMobileBridge(deps: MobileBridgeDeps): MobileBridge {
  const now = deps.now ?? Date.now;
  const streams = new Map<string, Stream>();
  const lastOutput = new Map<number, number>();
  let watcher: ReturnType<typeof setInterval> | undefined;

  function piece(
    stream: Stream,
    kind: MobileStreamPiece["kind"],
    data: string,
    size = stream.size,
  ): void {
    deps.sendStream({
      subscriptionId: stream.subscriptionId,
      paneId: stream.paneId,
      kind,
      data,
      cols: size?.cols ?? 0,
      rows: size?.rows ?? 0,
    });
  }

  function flush(stream: Stream): void {
    clearTimeout(stream.timer);
    stream.timer = undefined;
    if (stream.pending === "") return;
    const data = stream.pending;
    stream.pending = "";
    piece(stream, "data", data);
  }

  function end(stream: Stream, reason: "closed" | "moved"): void {
    if (!streams.delete(stream.subscriptionId)) return;
    flush(stream);
    piece(stream, "end", reason);
    if (streams.size === 0) stopWatching();
  }

  function startWatching(): void {
    watcher ??= setInterval(() => watch(), WATCH_MS);
    watcher.unref?.();
  }
  function stopWatching(): void {
    clearInterval(watcher);
    watcher = undefined;
  }

  /** A stream ends when its pane left this window, and reports a resize it noticed. */
  function watch(): void {
    for (const stream of [...streams.values()]) {
      if (!deps.hasPane(stream.paneId)) {
        end(stream, "moved");
        continue;
      }
      const size = deps.paneSize(stream.paneId);
      if (
        stream.ready &&
        size !== null &&
        (stream.size === null || size.cols !== stream.size.cols || size.rows !== stream.size.rows)
      ) {
        flush(stream);
        stream.size = size;
        piece(stream, "resize", "", size);
      }
    }
  }

  return {
    noteOutput(paneId, data) {
      lastOutput.set(paneId, now());
      for (const stream of streams.values()) {
        if (stream.paneId !== paneId) continue;
        if (!stream.ready) {
          stream.held.push(data);
          continue;
        }
        stream.pending += data;
        if (stream.pending.length >= FLUSH_CHARS) flush(stream);
        else stream.timer ??= setTimeout(() => flush(stream), FLUSH_MS);
      }
    },

    noteExit(paneId) {
      lastOutput.delete(paneId);
      for (const stream of [...streams.values()]) {
        if (stream.paneId === paneId) end(stream, "closed");
      }
    },

    prune() {
      watch();
    },

    handleQuery(payload) {
      const request = record(payload);
      const requestId = idOf(request?.requestId);
      const kind = QUERY_KINDS.find((candidate) => candidate === request?.kind);
      if (requestId === null || kind === undefined) return;
      const answer = (value: unknown) => deps.reportQuery({ requestId, kind, payload: value });
      if (kind === "tree") {
        answer(
          buildMobileTree({
            tabs: deps.tabs(),
            activeIndex: deps.activeIndex(),
            scans: deps.scans(),
            screenText: deps.screenText,
            lastOutputAt: (paneId) => lastOutput.get(paneId) ?? null,
            agentLabel: deps.agentLabel,
          }),
        );
      } else if (kind === "agents") {
        void deps
          .agentChoices()
          .then(answer)
          .catch(() => answer([]));
      } else {
        const paths = deps.workspacePaths().slice(0, MAX_PROJECTS);
        void Promise.all(
          paths.map(async (path) => {
            try {
              return { path, scan: await deps.scanRepository(path) };
            } catch {
              return null;
            }
          }),
        )
          .then((found) =>
            buildProjectChoices(
              found.filter((entry) => entry !== null),
              deps.workspaceLabel,
            ),
          )
          .then((choices: ProjectChoiceReport[]) => answer(choices))
          .catch(() => answer([]));
      }
    },

    handleSubscribe(payload) {
      const request = record(payload);
      const subscriptionId = idOf(request?.subscriptionId);
      const paneId = paneIdOf(request?.paneId);
      if (subscriptionId === null || paneId === null) return;
      if (!deps.hasPane(paneId) || streams.has(subscriptionId)) return;
      // From this line, in this turn, live output is held: the snapshot below is taken at the
      // same instant, so nothing is lost between them and nothing is in both.
      const stream: Stream = {
        subscriptionId,
        paneId,
        held: [],
        ready: false,
        pending: "",
        timer: undefined,
        size: null,
      };
      streams.set(subscriptionId, stream);
      const snapshot = deps.snapshot(paneId, STREAM_SCROLLBACK_ROWS);
      if (snapshot === null) {
        streams.delete(subscriptionId);
        return;
      }
      startWatching();
      void snapshot.then(
        (taken) => {
          if (streams.get(subscriptionId) !== stream) return;
          stream.size = { cols: taken.cols, rows: taken.rows };
          piece(stream, "snapshot", taken.data);
          stream.ready = true;
          stream.pending = stream.held.join("");
          stream.held = [];
          flush(stream);
        },
        () => end(stream, "closed"),
      );
    },

    handleUnsubscribe(payload) {
      const subscriptionId = idOf(record(payload)?.subscriptionId);
      const stream = subscriptionId === null ? undefined : streams.get(subscriptionId);
      if (stream === undefined) return;
      clearTimeout(stream.timer);
      streams.delete(stream.subscriptionId);
      if (streams.size === 0) stopWatching();
    },

    handleInput(payload) {
      const request = record(payload);
      const paneId = paneIdOf(request?.paneId);
      const data = request?.data;
      if (
        paneId === null ||
        typeof data !== "string" ||
        data === "" ||
        data.length > MAX_INPUT_CHARS
      ) {
        return;
      }
      if (!deps.hasPane(paneId)) return;
      deps.writePty(paneId, data);
    },

    dispose() {
      for (const stream of streams.values()) clearTimeout(stream.timer);
      streams.clear();
      stopWatching();
    },
  };
}
