import type { Pane } from './pane';
import type { TabDotColor } from '../lib/tab-colors';
import type { AdoptionPayload, TransferClient } from './transfer-client';

/** Serialized scrollback bound (spec §7.5) — never fail a move over history. */
export const SERIALIZE_SCROLLBACK_LINES = 10_000;
export const SERIALIZE_MAX_BYTES = 8 * 1024 * 1024;

/** The tab-level identity a pane carries with it (spec §10.2). */
export interface PaneIdentity {
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly tabName: string | null;
  readonly dotColor: TabDotColor | null;
  readonly workspacePath: string | null;
}

export type DetachTarget =
  { readonly kind: 'new-window' } | { readonly kind: 'window'; readonly label: string };

export type DetachResult =
  { readonly kind: 'moved' } | { readonly kind: 'kept'; readonly reason: string };

export interface DetachDeps {
  readonly transfer: TransferClient;
  /** Await everything already queued for this pane's PTY. */
  drainWrites(id: number): Promise<void>;
  /** Park further PTY writes; the returned function releases them. */
  holdWrites(id: number): () => void;
  pane(id: number): Pane | undefined;
  geometry(id: number): { readonly cols: number; readonly rows: number };
  identity(id: number): PaneIdentity;
  /** Remove the pane locally — WITHOUT `kill_pty` (spec §10.3). */
  release(id: number): void;
  report(message: string): void;
}

/** Newest bytes win: the top is what gets dropped (spec §7.5). */
function withinByteBound(serialized: string): string {
  if (serialized.length <= SERIALIZE_MAX_BYTES) {
    return serialized;
  }
  return serialized.slice(serialized.length - SERIALIZE_MAX_BYTES);
}

/**
 * Move one pane out of this window (spec §7, §10.3).
 *
 * Ordering is the contract, and it is asymmetric on purpose:
 * `drain → hold → flush → prepare → serialize → stage → open/offer → await`.
 * Drain runs BEFORE the hold because the hold is awaited inside the write
 * chain — holding first and then draining that chain would deadlock.
 * Serialization runs AFTER `prepare_transfer`, which quiesces the output
 * stream, so the snapshot is taken over a buffer that has stopped moving
 * (spec §7.4).
 *
 * Never throws: every failure resolves as `kept`, and the pane is still
 * usable in this window afterwards.
 */
export async function detachPane(
  id: number,
  target: DetachTarget,
  deps: DetachDeps,
): Promise<DetachResult> {
  const pane = deps.pane(id);
  if (pane === undefined) {
    return { kind: 'kept', reason: 'unknown-pane' };
  }

  await deps.drainWrites(id);
  const releaseHold = deps.holdWrites(id);

  try {
    await pane.flush();
  } catch (err) {
    // A stalled parser is not a reason to strand the pane where it is: the
    // worst case is a scrollback snapshot missing the last few bytes, which
    // the destination shows anyway once the PTY writes again.
    console.warn('Pane flush failed before transfer; continuing:', err);
  }

  let token: string;
  try {
    token = await deps.transfer.prepareTransfer(id);
  } catch (err) {
    releaseHold();
    console.warn('prepare_transfer failed:', err);
    deps.report("Couldn't move the pane — it stayed here.");
    return { kind: 'kept', reason: 'prepare-failed' };
  }

  // Flushed AGAIN, after `prepare` quiesced the stream. The first flush only
  // drained what was queued before it; output that arrived between that flush
  // resolving and `prepare` taking effect went to THIS window's xterm (the
  // route was still `Owned`) and may still be sitting unparsed in the parser
  // queue. Rust never buffered it, so without this drain it is in neither the
  // snapshot nor the flush — silently lost. Nothing new can arrive now: the
  // route is `Transferring` and every later chunk is buffered by Rust.
  try {
    await pane.flush();
  } catch (err) {
    console.warn('Pane flush after prepare failed; continuing:', err);
  }

  let scrollback = '';
  try {
    scrollback = withinByteBound(pane.serializeScrollback(SERIALIZE_SCROLLBACK_LINES));
  } catch (err) {
    // Spec §13: losing history is not worth losing the session.
    console.warn('Scrollback serialization failed; moving without it:', err);
  }

  const identity = deps.identity(id);
  const geometry = deps.geometry(id);
  const payload: AdoptionPayload = {
    paneId: id,
    cwd: identity.cwd,
    agentId: identity.agentId,
    scrollback,
    cols: geometry.cols,
    rows: geometry.rows,
    tabName: identity.tabName,
    dotColor: identity.dotColor,
    workspacePath: identity.workspacePath,
  };

  const failed = async (reason: string, err: unknown): Promise<DetachResult> => {
    console.warn(`Pane transfer ${reason}:`, err);
    await deps.transfer.abortTransfer(token).catch(() => {
      // Rust aborts on its own bounds (spec §7.5) — a failed abort is noise.
    });
    releaseHold();
    deps.report("Couldn't move the pane — it stayed here.");
    return { kind: 'kept', reason };
  };

  try {
    await deps.transfer.stageTransfer(token, payload);
  } catch (err) {
    return failed('stage-failed', err);
  }

  // Subscribed BEFORE the token is handed over, and deliberately not awaited
  // yet. `transfer:settled` is a fire-and-forget event: the destination can
  // claim, replay and commit while `openPaneWindow`/`offerTransfer` is still
  // resolving, and a listener registered after that lands too late to ever
  // hear it. The source would then hold a pane Rust has already given away,
  // with its write gate shut, forever.
  const settled = deps.transfer.awaitOutcome(token);

  try {
    if (target.kind === 'new-window') {
      await deps.transfer.openPaneWindow(token);
    } else {
      await deps.transfer.offerTransfer(token, target.label);
    }
  } catch (err) {
    return failed(target.kind === 'new-window' ? 'open-window-failed' : 'offer-failed', err);
  }

  // The DESTINATION commits (spec §7.3: `caller == to`), so the source waits
  // for the outcome instead of committing. It has to wait rather than release
  // optimistically: spec §13 requires a failed commit to leave the pane here.
  const outcome = await settled;
  if (outcome.kind === 'aborted') {
    releaseHold();
    deps.report("The pane couldn't be moved — it stayed here.");
    return { kind: 'kept', reason: outcome.reason };
  }

  deps.release(id);
  releaseHold();
  return { kind: 'moved' };
}
