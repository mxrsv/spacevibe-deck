import type { AppEvent } from "@protocol/messages";

/** App → page. The page is xterm.js in a WebView (`scripts/terminal-page.js`). */
export type PageCommand =
  | {
      readonly t: "init";
      readonly cols: number;
      readonly rows: number;
      readonly fontSize: number;
      readonly background: string;
      readonly foreground: string;
    }
  | { readonly t: "write"; readonly d: string }
  | { readonly t: "resize"; readonly cols: number; readonly rows: number }
  | { readonly t: "font"; readonly size: number }
  | { readonly t: "reset" }
  | { readonly t: "focus" }
  | { readonly t: "blur" };

/** Page → app. */
export type PageMessage =
  | { readonly t: "ready" }
  | { readonly t: "inited" }
  | { readonly t: "input"; readonly d: string }
  | { readonly t: "pinch"; readonly scale: number }
  | { readonly t: "error"; readonly message: string };

/** Commands held while the page loads; past this the page is too far behind to catch up from the queue. */
export const MAX_QUEUED_COMMANDS = 2_000;

export interface TerminalBridge {
  /** Delivered when the page is ready and xterm is initialised, in the order sent. */
  send(command: Exclude<PageCommand, { t: "init" }>): void;
  /** A message from the page; unknown shapes are ignored. */
  receive(message: PageMessage): void;
  readonly initialised: boolean;
}

/**
 * Gates traffic to the WebView. The page reports `ready` (its script ran), the app answers with
 * `init` (xterm needs the desktop's cols and rows to be created), the page reports `inited`; only
 * then is the queue flushed. Anything sent earlier waits, so a snapshot that arrives before xterm
 * exists is not lost. A second `ready` means the page reloaded: start over and ask for a replay.
 */
export function createTerminalBridge(options: {
  readonly post: (command: PageCommand) => void;
  readonly init: () => Extract<PageCommand, { t: "init" }>;
  readonly onInput: (data: string) => void;
  readonly onPinch: (scale: number) => void;
  /** The page lost its state (reload) or the queue overflowed: the owner should subscribe again. */
  readonly onNeedsReplay: () => void;
}): TerminalBridge {
  let ready = false;
  let initialised = false;
  let queue: Exclude<PageCommand, { t: "init" }>[] = [];

  return {
    get initialised() {
      return initialised;
    },
    send(command) {
      if (initialised) {
        options.post(command);
        return;
      }
      queue.push(command);
      if (queue.length > MAX_QUEUED_COMMANDS) {
        queue = [];
        options.onNeedsReplay();
      }
    },
    receive(message) {
      switch (message.t) {
        case "ready":
          if (ready) {
            // The page reloaded: everything it had is gone.
            initialised = false;
            queue = [];
            options.onNeedsReplay();
          }
          ready = true;
          options.post(options.init());
          break;
        case "inited": {
          initialised = true;
          const waiting = queue;
          queue = [];
          for (const command of waiting) options.post(command);
          break;
        }
        case "input":
          options.onInput(message.d);
          break;
        case "pinch":
          options.onPinch(message.scale);
          break;
        case "error":
          break;
      }
    },
  };
}

type TermEvent = Extract<AppEvent, { ev: `term.${string}` }>;

export interface TerminalFeed {
  /** Start holding term events: call just before `pane.subscribe`, whose answer names the sub. */
  expect(): void;
  /** The subscribe answered: clear the page, size it to the desktop pane, replay held events. */
  begin(sub: string, cols: number, rows: number): void;
  handle(event: AppEvent): void;
  stop(): void;
}

/**
 * Turns a pane subscription's events into page commands, in the order that keeps the screen right:
 * the snapshot chunks first, joined by `seq`, then live data. Output that arrives between the
 * snapshot's chunks is held until the last one, and events that arrive before the subscribe
 * answer are held until it does.
 */
export function createTerminalFeed(options: {
  readonly bridge: Pick<TerminalBridge, "send">;
  readonly onSize: (cols: number, rows: number) => void;
  readonly onEnd: (reason: "closed" | "unsubscribed" | "moved") => void;
  /** A chunk went missing: the screen cannot be trusted, subscribe again. */
  readonly onGap: () => void;
}): TerminalFeed {
  let sub: string | null = null;
  let expecting = false;
  let pending: TermEvent[] = [];
  let nextSeq = 0;
  let snapshotDone = false;
  let held: string[] = [];

  function apply(event: TermEvent): void {
    if (event.p.sub !== sub) return;
    switch (event.ev) {
      case "term.snapshot":
        if (event.p.seq !== nextSeq) {
          options.onGap();
          return;
        }
        if (event.p.seq === 0) {
          options.bridge.send({ t: "resize", cols: event.p.cols, rows: event.p.rows });
          options.onSize(event.p.cols, event.p.rows);
        }
        nextSeq++;
        options.bridge.send({ t: "write", d: event.p.data });
        if (event.p.last) {
          snapshotDone = true;
          for (const data of held) options.bridge.send({ t: "write", d: data });
          held = [];
        }
        break;
      case "term.data":
        if (snapshotDone) options.bridge.send({ t: "write", d: event.p.data });
        else held.push(event.p.data);
        break;
      case "term.resize":
        options.bridge.send({ t: "resize", cols: event.p.cols, rows: event.p.rows });
        options.onSize(event.p.cols, event.p.rows);
        break;
      case "term.end":
        options.onEnd(event.p.reason);
        break;
    }
  }

  return {
    expect() {
      sub = null;
      expecting = true;
      pending = [];
    },
    begin(next, cols, rows) {
      sub = next;
      expecting = false;
      nextSeq = 0;
      snapshotDone = false;
      held = [];
      options.bridge.send({ t: "reset" });
      options.bridge.send({ t: "resize", cols, rows });
      options.onSize(cols, rows);
      const early = pending;
      pending = [];
      for (const event of early) apply(event);
    },
    handle(event) {
      if (
        event.ev !== "term.snapshot" &&
        event.ev !== "term.data" &&
        event.ev !== "term.resize" &&
        event.ev !== "term.end"
      ) {
        return;
      }
      if (sub === null) {
        if (expecting) pending.push(event);
        return;
      }
      apply(event);
    },
    stop() {
      sub = null;
      expecting = false;
      pending = [];
      held = [];
    },
  };
}

/** The WebView's message text → a typed message, or null. The page is ours, but a WebView is still a boundary. */
export function parsePageMessage(text: string): PageMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.t) {
    case "ready":
    case "inited":
      return { t: m.t };
    case "input":
      return typeof m.d === "string" ? { t: "input", d: m.d } : null;
    case "pinch":
      return typeof m.scale === "number" && Number.isFinite(m.scale) && m.scale > 0
        ? { t: "pinch", scale: m.scale }
        : null;
    case "error":
      return { t: "error", message: typeof m.message === "string" ? m.message.slice(0, 200) : "" };
    default:
      return null;
  }
}
