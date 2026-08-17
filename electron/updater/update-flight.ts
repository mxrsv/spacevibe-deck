/**
 * One update check at a time across peer windows — the port of
 * `src-tauri/src/update_flight.rs` (spec §9.5).
 *
 * Not "the first window is primary": with peers the first window can be the
 * first to die. Any window may hold the flight, and the window going away
 * releases it.
 *
 * The Electron host carried a bare boolean instead, with no holder and no
 * cleanup. While the check was a stub that cost nothing; now that the check is
 * real, a window that crashes between `begin_update_check` and
 * `end_update_check` leaves the flight held forever, and every other window is
 * told "someone else is checking" for the life of the process. The automatic
 * update check then stops happening, silently — the exact failure the
 * fail-open reasoning in `update-controller.ts` exists to avoid.
 */
export class UpdateFlight {
  private holder: string | null = null;

  /**
   * True when this window won the check. False means another window is
   * already checking and this one must do nothing.
   */
  tryBegin(label: string): boolean {
    if (this.holder !== null) {
      return false;
    }
    this.holder = label;
    return true;
  }

  /**
   * Release the flight. False when `label` is not the holder, so a stale end
   * from a previous check cannot free a live one.
   */
  finish(label: string): boolean {
    if (this.holder !== label) {
      return false;
    }
    this.holder = null;
    return true;
  }

  /** The window is gone; it cannot release the flight itself any more. */
  forget(label: string): void {
    this.finish(label);
  }
}
