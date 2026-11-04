import { effect } from "@preact/signals";
import { boardOpen } from "../chrome/events";
import { tabViews } from "../terminal/tabs-store";
import { boardRaisedByLastClose } from "../ui/app-policy";
import { stageLauncherEnabled } from "./stage-launcher-enabled";

/**
 * Plan F1: `disposeTab` raises the Open board when the last tab closes (tab-manager.ts writes
 * `boardOpen` and then `syncViews()`). With `stageLauncher` on, only the surface shown afterwards
 * changes, so this takes that board down again. It is a plain `effect`, not `useSignalEffect`: that
 * one waits an animation frame, long enough for the board to mount and scan sessions first, while
 * this runs when `tabViews` drops to zero, before any render. Returns the dispose.
 */
export function installStageLauncherCloseGuard(): () => void {
  let previousTabCount = tabViews.peek().length;
  return effect(() => {
    const liveTabCount = tabViews.value.length;
    if (
      boardRaisedByLastClose({
        stageLauncher: stageLauncherEnabled(),
        previousTabCount,
        liveTabCount,
        boardOpen: boardOpen.value,
      })
    ) {
      boardOpen.value = false;
    }
    previousTabCount = liveTabCount;
  });
}
