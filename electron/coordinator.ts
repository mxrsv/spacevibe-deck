/**
 * Pane → window routing and the pane-transfer transaction — the port of
 * `src-tauri/src/coordinator.rs`.
 *
 * This is a load-bearing seam. Eight blockers were found and fixed in the Rust
 * original by an adversarial review, and every one of them is a rule below
 * rather than an implementation detail. The invariants worth naming:
 *
 *  - **Output is never broadcast.** A pane with no route drops its event and
 *    says so. Sending one window's terminal output to every window is a data
 *    leak, not a safety net.
 *  - **A transferring pane has no owner.** Not the source, not the
 *    destination — for the duration of the handoff nobody may write to it.
 *  - **Flush before announce.** Buffered events go out before
 *    `transfer:settled`, so a destination has every byte before it learns the
 *    pane is its own.
 *  - **Tokens make retries idempotent.** A settled token keeps answering after
 *    the fact, so a duplicate commit or abort is not an error.
 *  - **Death rules are asymmetric.** A dead DESTINATION aborts the transfer; a
 *    dead SOURCE does not, because the destination can still claim and commit.
 *  - **A pane is never handed to a dead window.** It is killed instead —
 *    losing a pane is recoverable, leaking a PTY nobody reads is not.
 *
 * The Rust version holds one mutex over all of this. The main process is
 * single-threaded, so the lock is gone; what remains is the ordering, which is
 * preserved call for call.
 */

/** A transfer that has not committed by this point is abandoned back to its
 * source. Enforced lazily on every entry point rather than by a timer, so
 * there is no wakeup to schedule and no timer to leak. */
export const TRANSFER_TIMEOUT_MS = 10_000;

/** Ceiling on what one transfer may hold back. Past it the move is abandoned
 * and everything buffered goes to the source: losing the move is recoverable,
 * losing output is not. */
export const BUFFER_MAX_BYTES = 4 * 1024 * 1024;

/** How many finished tokens stay answerable. A retry arrives within one
 * transfer window, so a small ring is enough — and it stops a long session
 * accumulating one entry per move forever. */
const SETTLED_TOKENS_MAX = 64;

export const EVENT_TRANSFER_SETTLED = "transfer:settled";

export interface AdoptionPayload {
  readonly paneId: number;
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly scrollback: string;
  readonly cols: number;
  readonly rows: number;
  readonly tabName: string | null;
  readonly dotColor: string | null;
  readonly workspacePath: string | null;
}

export type AbortReason =
  /** A window called abort — the destination refused, or the source changed
   * its mind. */
  | "requested"
  /** No commit within TRANSFER_TIMEOUT_MS. */
  | "timedOut"
  /** The held-back output passed BUFFER_MAX_BYTES. */
  | "bufferFull"
  /** A window the transfer depends on was destroyed or is closing. */
  | "windowGone";

type Settled =
  | { readonly outcome: "committed" }
  | { readonly outcome: "aborted"; readonly reason: AbortReason };

interface BufferedEvent {
  readonly event: string;
  readonly payload: unknown;
}

interface Transfer {
  readonly from: string;
  /** Null until `claim`. */
  to: string | null;
  /** Window a pending adoption was registered for, before it claims. Lets a
   * destination that dies before `claim` still abort the transfer. */
  reservedTo: string | null;
  readonly token: string;
  staged: AdoptionPayload | null;
  buffered: BufferedEvent[];
  bufferedBytes: number;
  /** The PTY exited mid-transfer. The route entry must outlive that so the
   * buffered exit event still reaches the destination. */
  exited: boolean;
  readonly started: number;
}

type PaneRoute =
  | { readonly kind: "owned"; readonly label: string }
  | { readonly kind: "transferring"; readonly transfer: Transfer };

/** Where the coordinator emits. Production sends to a window; tests record,
 * which is the only way to assert delivery ORDER. */
export type EventSink = (
  label: string,
  event: string,
  payload: unknown,
) => void;

export type PaneAccessErrorKind =
  "not-routed" | "transferring" | "owned-by-other";

export class PaneAccessError extends Error {
  constructor(
    readonly kind: PaneAccessErrorKind,
    readonly paneId: number,
    readonly owner?: string,
  ) {
    super(
      kind === "not-routed"
        ? `Pane #${paneId} is not registered`
        : kind === "transferring"
          ? `Pane #${paneId} is being moved to another window`
          : `Pane #${paneId} belongs to window ${owner}`,
    );
    this.name = "PaneAccessError";
  }
}

export class WindowCoordinator {
  private readonly routes = new Map<number, PaneRoute>();
  private readonly settled = new Map<string, Settled>();
  private readonly settledOrder: string[] = [];
  /** Labels of destroyed windows. Never reused within a process run, so this
   * cannot outgrow the number of windows opened. */
  private readonly dead = new Set<string>();
  /** Panes a settle handed back to a window that no longer exists; the caller
   * drains and kills them. */
  private pendingOrphans: number[] = [];
  private nextToken = 0;

  constructor(private readonly sink: EventSink) {}

  register(paneId: number, windowLabel: string): void {
    this.routes.set(paneId, { kind: "owned", label: windowLabel });
  }

  unregister(paneId: number): void {
    const route = this.routes.get(paneId);
    if (route?.kind === "transferring") {
      // Mid-transfer the entry must outlive the PTY: it holds the exit event
      // the destination is owed on commit. `settle` drops the route instead of
      // re-owning it.
      route.transfer.exited = true;
      return;
    }
    this.routes.delete(paneId);
  }

  /** The owning window, or null while a transfer is open — a transferring pane
   * has no owner, and saying otherwise would let a caller act on it. */
  owner(paneId: number): string | null {
    const route = this.routes.get(paneId);
    return route?.kind === "owned" ? route.label : null;
  }

  /** Pane ids still owned by this window, for close-window dispose. */
  panesForWindow(windowLabel: string): number[] {
    const ids: number[] = [];
    for (const [id, route] of this.routes) {
      if (route.kind === "owned" && route.label === windowLabel) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Every live pane, transferring ones included.
   *
   * Deliberately disagrees with `panesForWindow`: that answers "what do I kill
   * when this window closes", where a mid-transfer pane must be left alone;
   * this answers "is anything busy", where missing a mid-transfer pane kills a
   * running agent without a prompt.
   */
  allPanes(): number[] {
    return [...this.routes.keys()];
  }

  /** Route one PTY event. Emission is synchronous and in-order, so a chunk
   * read during a commit cannot overtake the flush that commit performs. */
  deliver(
    paneId: number,
    event: string,
    payload: unknown,
    now: number = Date.now(),
  ): void {
    this.sweep(now);
    const route = this.routes.get(paneId);
    if (route === undefined) {
      // No broadcast fallback — see the header.
      console.warn(`Deck: no route for pane ${paneId}, dropping ${event}`);
      return;
    }
    if (route.kind === "owned") {
      this.sink(route.label, event, payload);
      return;
    }
    const { transfer } = route;
    transfer.bufferedBytes += estimateBytes(payload);
    transfer.buffered.push({ event, payload });
    if (transfer.bufferedBytes > BUFFER_MAX_BYTES) {
      console.warn(
        `Deck: transfer buffer for pane ${paneId} passed ${BUFFER_MAX_BYTES} bytes, returning it to window ${transfer.from}`,
      );
      // The overflowing chunk was already pushed, so the flush carries it too.
      this.settle(paneId, transfer.from, {
        outcome: "aborted",
        reason: "bufferFull",
      });
    }
  }

  /**
   * Abandon every transfer that outlived the timeout, returning each pane to
   * its source. Called by the PTY commands as well as the transfer commands:
   * mid-transfer writes are rejected, so a pane whose destination died produces
   * no output and would otherwise never be swept.
   */
  sweep(now: number = Date.now()): void {
    const expired: Array<[number, string]> = [];
    for (const [id, route] of this.routes) {
      if (
        route.kind === "transferring" &&
        now - route.transfer.started >= TRANSFER_TIMEOUT_MS
      ) {
        expired.push([id, route.transfer.from]);
      }
    }
    for (const [paneId, source] of expired) {
      console.warn(
        `Deck: transfer for pane ${paneId} timed out, returning it to window ${source}`,
      );
      this.settle(paneId, source, { outcome: "aborted", reason: "timedOut" });
    }
  }

  /** Open a transfer for a pane this window owns. Output starts buffering the
   * moment this returns. */
  beginTransfer(
    from: string,
    paneId: number,
    now: number = Date.now(),
  ): string {
    // Before the route check, so a pane whose previous transfer expired can
    // start a new one.
    this.sweep(now);
    const route = this.routes.get(paneId);
    if (route === undefined) {
      throw new Error(`Pane #${paneId} is not registered`);
    }
    if (route.kind === "transferring") {
      throw new Error(`Pane #${paneId} is already being transferred`);
    }
    if (route.label !== from) {
      throw new Error(`Pane #${paneId} is owned by window ${route.label}`);
    }
    this.nextToken += 1;
    const token = `xfer-${this.nextToken}`;
    this.routes.set(paneId, {
      kind: "transferring",
      transfer: {
        from,
        to: null,
        reservedTo: null,
        token,
        staged: null,
        buffered: [],
        bufferedBytes: 0,
        exited: false,
        started: now,
      },
    });
    return token;
  }

  /**
   * The source puts up the adoption payload it serialized after `prepare`
   * quiesced the stream. Separate from `prepare` because the payload does not
   * exist yet when `prepare` returns — without this the source has no route to
   * hand its serialized buffer to `claim`.
   */
  stagePayload(
    token: string,
    caller: string,
    payload: AdoptionPayload,
    now: number = Date.now(),
  ): void {
    this.sweep(now);
    const found = this.findTransfer(token);
    if (found === null) {
      throw new Error(`Transfer ${token} is not open`);
    }
    const { transfer } = found;
    if (transfer.from !== caller) {
      throw new Error(
        `Transfer ${token} can only be staged by window ${transfer.from}`,
      );
    }
    if (transfer.staged !== null) {
      throw new Error(`Transfer ${token} already carries a payload`);
    }
    transfer.staged = payload;
  }

  /** The destination takes the payload and records itself as the receiver. */
  claim(
    token: string,
    caller: string,
    now: number = Date.now(),
  ): AdoptionPayload {
    this.sweep(now);
    const found = this.findTransfer(token);
    if (found === null) {
      throw new Error(`Transfer ${token} is not open`);
    }
    const { transfer } = found;
    if (transfer.to !== null) {
      throw new Error(`Transfer ${token} was already claimed`);
    }
    if (transfer.staged === null) {
      throw new Error(`Transfer ${token} has no staged payload`);
    }
    transfer.to = caller;
    return transfer.staged;
  }

  /** Name the window a pending adoption was opened for, before it claims, so a
   * destination dying before `claim` still aborts the transfer. */
  reserveDestination(token: string, label: string): void {
    const found = this.findTransfer(token);
    if (found === null) {
      throw new Error(`Transfer ${token} is not open`);
    }
    found.transfer.reservedTo = label;
  }

  /** Hand the pane to the window that claimed it, flushing what buffered. */
  commit(token: string, caller: string, now: number = Date.now()): void {
    this.sweep(now);
    const settled = this.settled.get(token);
    if (settled !== undefined) {
      // Idempotent by token: a retry after the fact still gets an answer.
      if (settled.outcome === "committed") {
        return;
      }
      throw new Error(`Transfer ${token} was aborted`);
    }
    const found = this.findTransfer(token);
    if (found === null) {
      throw new Error(`Transfer ${token} is not open`);
    }
    if (found.transfer.to !== caller) {
      throw new Error(
        `Transfer ${token} can only be committed by the window that claimed it`,
      );
    }
    this.settle(found.paneId, caller, { outcome: "committed" });
  }

  /**
   * Return the pane to its source, flushing what buffered.
   *
   * Any caller may abort: abort never moves a pane anywhere it was not
   * already, so there is nothing to guard, and a destination that failed
   * before it claimed still needs to release the pane.
   */
  abort(token: string, now: number = Date.now()): void {
    this.sweep(now);
    const settled = this.settled.get(token);
    if (settled !== undefined) {
      if (settled.outcome === "aborted") {
        return;
      }
      throw new Error(`Transfer ${token} was already committed`);
    }
    const found = this.findTransfer(token);
    if (found === null) {
      throw new Error(`Transfer ${token} is not open`);
    }
    this.settle(found.paneId, found.transfer.from, {
      outcome: "aborted",
      reason: "requested",
    });
  }

  /**
   * Abort every transfer this window takes part in, in either role. Called on
   * close BEFORE the busy guard: a transfer left open across a close would
   * hold the pane frozen until the timeout, and the guard would then run
   * against a route nobody owns.
   */
  abortInvolving(label: string, now: number = Date.now()): void {
    this.sweep(now);
    const involved: Array<[number, string]> = [];
    for (const [id, route] of this.routes) {
      if (route.kind !== "transferring") {
        continue;
      }
      const { transfer } = route;
      if (
        transfer.from === label ||
        transfer.to === label ||
        transfer.reservedTo === label
      ) {
        involved.push([id, transfer.from]);
      }
    }
    for (const [paneId, source] of involved) {
      this.settle(paneId, source, {
        outcome: "aborted",
        reason: "windowGone",
      });
    }
  }

  /** May `caller` act on this pane? Mid-transfer the answer is no for
   * everyone, including the source. */
  assertAccess(paneId: number, caller: string): void {
    const route = this.routes.get(paneId);
    if (route === undefined) {
      throw new PaneAccessError("not-routed", paneId);
    }
    if (route.kind === "transferring") {
      throw new PaneAccessError("transferring", paneId);
    }
    if (route.label !== caller) {
      throw new PaneAccessError("owned-by-other", paneId, route.label);
    }
  }

  /** Take the panes that settled onto a dead window; the caller kills them.
   * `sweep` and `abort` can strand a pane this way and, unlike
   * `handleWindowDestroyed`, they have no orphan pass of their own. */
  takePendingOrphans(): number[] {
    const orphans = this.pendingOrphans;
    this.pendingOrphans = [];
    return orphans;
  }

  /**
   * Apply the window-death transition table and return the panes nothing will
   * otherwise kill.
   *
   * The rules are NOT symmetric: a dead destination aborts the transfer, a
   * dead source does not — the destination can still claim and commit.
   */
  handleWindowDestroyed(label: string, now: number = Date.now()): number[] {
    this.sweep(now);
    this.dead.add(label);

    // Transfers this window was going to receive — claimed, or merely reserved
    // by a window that died before it could claim.
    const aborting: Array<[number, string]> = [];
    for (const [id, route] of this.routes) {
      if (route.kind !== "transferring") {
        continue;
      }
      const { transfer } = route;
      if (transfer.to === label || transfer.reservedTo === label) {
        aborting.push([id, transfer.from]);
      }
    }
    for (const [paneId, source] of aborting) {
      this.settle(paneId, source, {
        outcome: "aborted",
        reason: "windowGone",
      });
    }

    // Orphans: panes owned by a window that no longer exists. This is the
    // crash path — no close request fired and no busy guard ran, so nothing
    // else will ever kill them.
    const orphans: number[] = [];
    for (const [id, route] of this.routes) {
      if (route.kind === "owned" && this.dead.has(route.label)) {
        orphans.push(id);
      }
    }
    for (const id of orphans) {
      this.routes.delete(id);
    }
    // Anything an earlier sweep or abort stranded on a dead window, plus what
    // the aborts above just stranded — they never entered `routes`, so the
    // pass above cannot see them.
    orphans.push(...this.takePendingOrphans());
    return orphans;
  }

  private findTransfer(
    token: string,
  ): { paneId: number; transfer: Transfer } | null {
    for (const [paneId, route] of this.routes) {
      if (route.kind === "transferring" && route.transfer.token === token) {
        return { paneId, transfer: route.transfer };
      }
    }
    return null;
  }

  /**
   * Close a transfer: flush every buffered event to `label` in append order,
   * then hand the route over.
   */
  private settle(paneId: number, label: string, outcome: Settled): void {
    const route = this.routes.get(paneId);
    if (route === undefined || route.kind !== "transferring") {
      return;
    }
    const { transfer } = route;
    this.routes.delete(paneId);

    for (const buffered of transfer.buffered) {
      this.sink(label, buffered.event, buffered.payload);
    }
    this.announceSettled(transfer, outcome);

    if (transfer.exited) {
      // The PTY already exited and deferred its unregister so the buffered
      // exit above could still be delivered. Honour it now rather than writing
      // an owned route for a pane that no longer exists.
    } else if (this.dead.has(label)) {
      // A pane may only be handed to a window that still exists. Otherwise the
      // route would name a dead label and every later chunk would be dropped
      // for the rest of the process run — queue it for the kill instead.
      this.pendingOrphans.push(paneId);
    } else {
      this.routes.set(paneId, { kind: "owned", label });
    }
    this.rememberSettled(transfer.token, outcome);
  }

  /**
   * Tell both ends how the transfer ended — AFTER the flush, so a destination
   * has every buffered byte before it learns the pane is its own.
   *
   * A label whose window is already gone still gets the emit; the sink throws
   * it away, exactly as for any other event aimed at a dead window.
   */
  private announceSettled(transfer: Transfer, outcome: Settled): void {
    const payload = { token: transfer.token, ...outcome };
    this.sink(transfer.from, EVENT_TRANSFER_SETTLED, payload);
    // Whoever claimed, or — when nobody did — whoever a window was opened for.
    // A boot-adopt window that died before claiming must learn the transfer is
    // over rather than wait out the timeout.
    const other = transfer.to ?? transfer.reservedTo;
    if (other !== null && other !== transfer.from) {
      this.sink(other, EVENT_TRANSFER_SETTLED, payload);
    }
  }

  private rememberSettled(token: string, outcome: Settled): void {
    if (!this.settled.has(token)) {
      this.settledOrder.push(token);
    }
    this.settled.set(token, outcome);
    while (this.settledOrder.length > SETTLED_TOKENS_MAX) {
      const oldest = this.settledOrder.shift();
      if (oldest !== undefined) {
        this.settled.delete(oldest);
      }
    }
  }
}

/** Serialized size of one buffered event. Only called while a transfer is
 * open, i.e. for tens of milliseconds per move. */
function estimateBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload) ?? "");
  } catch {
    return 0;
  }
}
