/**
 * The one tab-popover slot, wired into a component's local popover signal.
 *
 * Three surfaces can raise a tab options popover — `RepositoryRail`,
 * `TabStrip`, and the retired-but-still-in-tree `WorkspaceSidebar` — and since
 * 2026-08-14 sidebar layout mounts two of them at once. This hook is the whole
 * co-mount contract in one place, so the three cannot drift into three
 * different answers:
 *
 * 1. **Claim** the slot while this surface's popover is up, so
 *    `tabPopoverOpen` (which hides the browser panel's native view) is true
 *    for as long as anything is floating over the stage.
 * 2. **Stand down** when another surface claims it — one popover at a time,
 *    window-wide.
 * 3. **Release** on unmount, so a layout switch mid-popover cannot strand the
 *    claim and leave the native view hidden forever.
 *
 * The caller keeps owning WHICH tab its popover belongs to; this only handles
 * whether it may be open.
 */
import type { Signal } from "@preact/signals";
import { useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  closeTabPopover,
  openTabPopover,
  tabPopoverOwner,
  type TabPopoverOwner,
} from "../chrome/events";

export function useTabPopoverSlot<T>(
  owner: TabPopoverOwner,
  popover: Signal<T | null>,
): void {
  // Mirror: this surface's local state into the shared slot.
  useSignalEffect(() => {
    if (popover.value !== null) {
      openTabPopover(owner);
    } else {
      closeTabPopover(owner);
    }
  });

  // Obey: someone else took the slot, so close ours.
  //
  // The `!== null` test is load-bearing, not a null-check habit. Without it,
  // an effect ordering where this ran before the mirror above would read the
  // empty slot as "somebody else has it" and close the popover the same
  // interaction had just opened.
  useSignalEffect(() => {
    const holder = tabPopoverOwner.value;
    if (holder !== null && holder !== owner && popover.value !== null) {
      popover.value = null;
    }
  });

  // Release on unmount. Separate from the mirror so that effect re-running
  // never writes a spurious release between two claims.
  useEffect(() => () => closeTabPopover(owner), []);
}
