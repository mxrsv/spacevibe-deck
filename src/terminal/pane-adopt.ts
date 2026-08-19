import type { Pane } from "./pane";
import type { AdoptionPayload, TransferClient } from "./transfer-client";

/** Written into the pane when history did not survive (spec §13). */
const NO_SCROLLBACK_NOTICE = "\x1b[2m[Scrollback could not be restored for this move]\x1b[0m";

export type AdoptResult =
  | {
      readonly kind: "adopted";
      readonly paneId: number;
      readonly payload: AdoptionPayload;
    }
  | { readonly kind: "failed"; readonly reason: string };

export interface AdoptDeps {
  readonly transfer: TransferClient;
  /** Park PTY writes until the transaction commits (spec §8). */
  holdWrites(id: number): () => void;
  /** Build a pane bound to the payload's existing PTY — never a spawn. */
  adopt(payload: AdoptionPayload): Pane;
  /** Put the pane into this window's layout and mount it. */
  place(pane: Pane, payload: AdoptionPayload): void;
  /** Drop a half-built pane when the transaction fails after `adopt`. */
  discard(id: number): void;
  report(message: string): void;
}

/**
 * Take ownership of a pane another window prepared (spec §10.1). Shared by
 * both adoption paths: boot-adopt (a fresh window building its first tab) and
 * live-adopt (a running window inserting the pane into its active tab). The
 * two differ only in what `place` does.
 *
 * Ordering matters twice over. The pane is built at the payload's capture
 * geometry and only `fit()`s AFTER the commit, because `resize_pty` is
 * rejected while the route is `Transferring` and `paneEvents.onResize`
 * swallows that rejection — an early fit strands the PTY at stale
 * dimensions. And the scrollback is replayed BEFORE the pane is placed,
 * which is what the serialize addon's own documentation asks for.
 *
 * Never throws: every failure resolves as `failed` and leaves nothing
 * half-built behind.
 */
export async function adoptTransfer(token: string, deps: AdoptDeps): Promise<AdoptResult> {
  let payload: AdoptionPayload;
  try {
    payload = await deps.transfer.claimTransfer(token);
  } catch (err) {
    // Deliberately no `abort_transfer` here: the claim failed, so either the
    // token was never valid or another window already holds it — aborting a
    // token this window does not own could cancel someone else's move. Rust's
    // 10 s bound (spec §7.5) returns the pane to the source on its own. Spec
    // §13's "closes that window and aborts" is satisfied by the caller: the
    // boot path closes the window (Task C9) and Rust's timeout does the abort.
    console.warn("claim_transfer failed:", err);
    return { kind: "failed", reason: "claim-failed" };
  }

  const abort = async (reason: string, err: unknown): Promise<AdoptResult> => {
    console.warn(`Pane adoption ${reason}:`, err);
    await deps.transfer.abortTransfer(token).catch(() => {
      // Rust aborts on its own bounds anyway — a failed abort is noise.
    });
    return { kind: "failed", reason };
  };

  let releaseHold: (() => void) | null = null;
  let pane: Pane;
  try {
    releaseHold = deps.holdWrites(payload.paneId);
    pane = deps.adopt(payload);
  } catch (err) {
    releaseHold?.();
    return abort("adopt-failed", err);
  }

  try {
    if (payload.scrollback === "") {
      pane.writeln(NO_SCROLLBACK_NOTICE);
    } else {
      pane.write(payload.scrollback);
    }
    await pane.flush();
  } catch (err) {
    // Spec §13 again, mirrored: an unreplayable buffer costs history, never
    // the session.
    console.warn("Scrollback replay failed; continuing:", err);
  }

  deps.place(pane, payload);

  try {
    await deps.transfer.commitTransfer(token);
  } catch (err) {
    releaseHold();
    deps.discard(payload.paneId);
    deps.report("The pane did not arrive — it stayed in its original window.");
    return abort("commit-failed", err);
  }

  releaseHold();
  // Only now is `resize_pty` accepted again: the route is `Owned` by this
  // window, so the pane can leave the source's capture geometry behind.
  pane.fit();
  return { kind: "adopted", paneId: payload.paneId, payload };
}
