import { computed, effect } from "@preact/signals";
import { setAttentionBadge } from "../../host/shell-host";
import { currentAttentionList } from "./attention-strip-chip";

/** Each renderer owns only its count; main sums the live windows. */
export function installAttentionBadgeSync(): () => void {
  const count = computed(() => currentAttentionList().entries.length);
  return effect(() => {
    // A computed primitive prevents unrelated rail changes from sending IPC.
    const next = count.value;
    void Promise.resolve()
      .then(() => setAttentionBadge(next))
      .catch((error: unknown) => console.warn("Could not update attention badge:", error));
  });
}
