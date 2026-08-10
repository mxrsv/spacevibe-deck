import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TabDotColor } from "../lib/tab-colors";

/**
 * Everything that moves with a pane (spec §10.2), serialized across the
 * transfer transaction.
 *
 * WIRE NAMES ARE FROZEN (merge reconciliation 2026-08-10) and match the Rust
 * `AdoptionPayload` struct exactly: `agentId` not `agent`, `tabName` not
 * `nameOverride`, `scrollback` not `serialized`. This is the ONLY place they
 * are written down — never re-spell one at a call site.
 *
 * `dotColor` is typed as this repo's `TabDotColor` union rather than a free
 * string: the destination feeds it straight into a `TabOverride`.
 */
export interface AdoptionPayload {
  readonly paneId: number;
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly scrollback: string;
  readonly cols: number;
  readonly rows: number;
  readonly tabName: string | null;
  readonly dotColor: TabDotColor | null;
  readonly workspacePath: string | null;
}

export type TransferOutcome =
  | { readonly kind: "committed" }
  | { readonly kind: "aborted"; readonly reason: string };

export type BootMode =
  | { readonly kind: "normal" }
  | { readonly kind: "adopt"; readonly token: string };

const SETTLED_EVENT = "transfer:settled";
const OFFER_EVENT = "transfer:offer";
const MOVE_TO_WINDOW_EVENT = "menu:move-pane-to-window";

interface SettledPayload {
  token: string;
  outcome: "committed" | "aborted";
  reason?: string;
}

export interface TransferClient {
  prepareTransfer(paneId: number): Promise<string>;
  stageTransfer(token: string, payload: AdoptionPayload): Promise<void>;
  claimTransfer(token: string): Promise<AdoptionPayload>;
  commitTransfer(token: string): Promise<void>;
  abortTransfer(token: string): Promise<void>;
  /**
   * Resolves when the route leaves `Transferring`, over the `transfer:settled`
   * event Rust emits to BOTH labels inside the lock section that finalises
   * the route. The source needs this: spec §13 requires a failed commit to
   * leave the pane WITH THE SOURCE, which is only possible while the source
   * still holds it. `reason` is what separates "the destination refused"
   * from "the transfer timed out" on the error bar.
   */
  awaitOutcome(token: string): Promise<TransferOutcome>;
  /**
   * Boot-adopt: create a `deck-<n>` window already bound to this token.
   * `screen` is a CSS-pixel drop point — Rust converts to physical. The menu
   * path omits it and lets Rust place the window; the drag section passes
   * the point the pane was dropped at.
   */
  openPaneWindow(
    token: string,
    screen?: { readonly x: number; readonly y: number },
  ): Promise<string>;
  /** Live-adopt: hand the token to an ALREADY RUNNING window. */
  offerTransfer(token: string, targetLabel: string): Promise<void>;
  listenTransferOffer(handler: (token: string) => void): Promise<UnlistenFn>;
  /**
   * "Move Pane to Window ▸" clicked. Rust emits `menu:move-pane-to-window`
   * to the FOCUSED window with the chosen destination label; this window is
   * then the source of the transfer.
   */
  listenMoveToWindow(
    handler: (targetLabel: string) => void,
  ): Promise<UnlistenFn>;
  windowBootMode(): Promise<BootMode>;
}

/**
 * Validate the boot-mode payload rather than cast it: it crosses the IPC
 * boundary as untrusted data (C7/C8), and getting it wrong means a window
 * that renders nothing at all. Anything unrecognized boots normally, which
 * is always a usable app.
 */
export function bootModeOrNormal(raw: unknown): BootMode {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "normal" };
  }
  const value = raw as { kind?: unknown; token?: unknown };
  if (value.kind === "adopt" && typeof value.token === "string") {
    return { kind: "adopt", token: value.token };
  }
  return { kind: "normal" };
}

/**
 * The destination label from a `menu:move-pane-to-window` payload, or null
 * when there isn't a usable one.
 *
 * This event arrives on a DIFFERENT channel from `menu:action`, so
 * `isActionId` (action-registry.ts:459-471) never sees it — the submenu ids
 * carry a `window-target:` prefix in hand-written `menu.rs` precisely to
 * keep them away from that guard. So this is the whole boundary check for a
 * value that decides where a running agent's pane ends up (C7/C8).
 */
export function moveToWindowTarget(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const label = (raw as { targetLabel?: unknown }).targetLabel;
  return typeof label === "string" && label !== "" ? label : null;
}

/** Production adapter — Tauri IPC. */
export function createTauriTransferClient(): TransferClient {
  return {
    prepareTransfer(paneId) {
      // `paneId` crosses as a STRING and is parsed to u32 in Rust. Every
      // other PTY command keeps a numeric id; this one is deliberately
      // different (frozen 2026-08-10) — do not "normalize" it back.
      return invoke<string>("prepare_transfer", { paneId: String(paneId) });
    },
    stageTransfer(token, payload) {
      return invoke("stage_transfer", { token, payload });
    },
    claimTransfer(token) {
      return invoke<AdoptionPayload>("claim_transfer", { token });
    },
    commitTransfer(token) {
      return invoke("commit_transfer", { token });
    },
    abortTransfer(token) {
      return invoke("abort_transfer", { token });
    },
    async awaitOutcome(token) {
      // The listener is per-transfer and MUST be torn down: a window runs
      // many moves in a session, and `listen` resolves asynchronously, so
      // `unlisten` may not exist yet when the event arrives. `settled`
      // covers that race — whichever side wins, the handler is removed once.
      let unlisten: UnlistenFn | null = null;
      let settled = false;
      const stop = (): void => {
        settled = true;
        unlisten?.();
        unlisten = null;
      };
      const outcome = new Promise<TransferOutcome>((resolve) => {
        void listen<SettledPayload>(SETTLED_EVENT, (event) => {
          if (event.payload.token !== token) {
            return;
          }
          stop();
          resolve(
            event.payload.outcome === "committed"
              ? { kind: "committed" }
              : { kind: "aborted", reason: event.payload.reason ?? "aborted" },
          );
        }).then((fn) => {
          if (settled) {
            fn();
            return;
          }
          unlisten = fn;
        });
      });
      return outcome;
    },
    openPaneWindow(token, screen) {
      // CSS pixels — Rust converts to physical. Omitted keys mean "you pick".
      // Returns the created window's label. This section ignores it — the
      // destination announces itself by claiming — but it must NOT be typed
      // `void`: the drag section needs the label (merged §0.2).
      return invoke<string>("open_pane_window", {
        token,
        ...(screen ? { screenX: screen.x, screenY: screen.y } : {}),
      });
    },
    offerTransfer(token, targetLabel) {
      return invoke("offer_transfer", { token, targetLabel });
    },
    listenTransferOffer(handler) {
      return listen<{ token: string }>(OFFER_EVENT, (event) => {
        handler(event.payload.token);
      });
    },
    listenMoveToWindow(handler) {
      return listen<unknown>(MOVE_TO_WINDOW_EVENT, (event) => {
        const label = moveToWindowTarget(event.payload);
        if (label === null) {
          console.warn("Ignoring malformed menu:move-pane-to-window payload");
          return;
        }
        handler(label);
      });
    },
    async windowBootMode() {
      try {
        return bootModeOrNormal(await invoke<unknown>("window_boot_mode"));
      } catch (err) {
        console.warn("window_boot_mode failed; booting normally:", err);
        return { kind: "normal" };
      }
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryTransferClient(
  options: { readonly bootMode?: BootMode } = {},
): TransferClient & {
  readonly calls: string[];
  /** Resolve a pending (or future) `awaitOutcome` for this token. */
  settle(token: string, outcome: TransferOutcome): void;
  /** Deliver a live-adopt offer to the registered handler. */
  offer(token: string): void;
  /** Deliver a "Move Pane to Window" menu click to the registered handler. */
  moveToWindow(label: string): void;
  failNext(command: keyof TransferClient, message: string): void;
} {
  const calls: string[] = [];
  const staged = new Map<string, AdoptionPayload>();
  const settled = new Map<string, TransferOutcome>();
  const waiting = new Map<string, (outcome: TransferOutcome) => void>();
  const failures = new Map<string, string>();
  const offerHandlers = new Set<(token: string) => void>();
  const moveHandlers = new Set<(label: string) => void>();
  let nextToken = 1;

  function guard(command: string): void {
    const message = failures.get(command);
    if (message !== undefined) {
      failures.delete(command);
      throw new Error(message);
    }
  }

  return {
    calls,
    failNext(command, message) {
      failures.set(command, message);
    },
    settle(token, outcome) {
      settled.set(token, outcome);
      waiting.get(token)?.(outcome);
      waiting.delete(token);
    },
    offer(token) {
      for (const handler of offerHandlers) {
        handler(token);
      }
    },
    moveToWindow(label) {
      // Runs the SAME guard the Tauri adapter does: a fake that is more
      // permissive than production proves nothing about the boundary.
      const valid = moveToWindowTarget({ targetLabel: label });
      if (valid === null) {
        return;
      }
      for (const handler of moveHandlers) {
        handler(valid);
      }
    },
    async prepareTransfer(paneId) {
      calls.push(`prepare:${paneId}`);
      guard("prepareTransfer");
      const token = `xfer-${nextToken}`;
      nextToken += 1;
      return token;
    },
    async stageTransfer(token, payload) {
      calls.push(`stage:${token}`);
      guard("stageTransfer");
      staged.set(token, payload);
    },
    async claimTransfer(token) {
      calls.push(`claim:${token}`);
      guard("claimTransfer");
      const payload = staged.get(token);
      if (payload === undefined) {
        throw new Error(`unknown token ${token}`);
      }
      return payload;
    },
    async commitTransfer(token) {
      calls.push(`commit:${token}`);
      guard("commitTransfer");
    },
    async abortTransfer(token) {
      calls.push(`abort:${token}`);
    },
    awaitOutcome(token) {
      calls.push(`await:${token}`);
      const already = settled.get(token);
      if (already !== undefined) {
        return Promise.resolve(already);
      }
      return new Promise((resolve) => waiting.set(token, resolve));
    },
    async openPaneWindow(token, screen) {
      // The coordinate suffix is what lets the drag section assert the drop
      // point survived the round trip; the menu path records no suffix.
      calls.push(
        screen === undefined
          ? `open-window:${token}`
          : `open-window:${token}:${screen.x},${screen.y}`,
      );
      guard("openPaneWindow");
      return "deck-1";
    },
    async offerTransfer(token, targetLabel) {
      calls.push(`offer:${token}:${targetLabel}`);
      guard("offerTransfer");
    },
    async listenTransferOffer(handler) {
      offerHandlers.add(handler);
      return () => {
        offerHandlers.delete(handler);
      };
    },
    async listenMoveToWindow(handler) {
      moveHandlers.add(handler);
      return () => {
        moveHandlers.delete(handler);
      };
    },
    async windowBootMode() {
      return options.bootMode ?? { kind: "normal" };
    },
  };
}

/** Shared production client — factories accept an override for tests. */
export const defaultTransferClient: TransferClient =
  createTauriTransferClient();
