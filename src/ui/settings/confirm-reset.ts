import { signal } from "@preact/signals";
import { reportPersistError } from "../../chrome/events";
import { ask } from "../../host/dialog-host";
import { forgetWorkspaceAgent } from "../../open-board/workspaces-store";
import { SETTINGS_REGISTRY } from "../../settings/settings-registry";
import type { Settings } from "../../settings/settings-schema";
import { resetSettingsKeys, settings } from "../../settings/settings-store";

/**
 * True while a reset prompt is open. Every reset entry point (the Reset rows
 * and each page's Reset page) shares it, so two clicks never stack two
 * prompts, and the buttons read it to disable themselves.
 */
export const resetPromptOpen = signal(false);

/**
 * What a confirmed reset does: resets exactly these keys, and lets go of the agents it deletes.
 * Both prompts (the native one below and Command Settings' dialog) end here.
 */
export function applyReset(keys: readonly (keyof Settings)[]): void {
  // Read at confirm time, not before the prompt: the user may have edited meanwhile,
  // and after the reset the declared agents are gone.
  const declaredIds = keys.includes("customAgents")
    ? settings.value.customAgents.map((agent) => agent.id)
    : [];
  resetSettingsKeys(keys);
  // The ids are free again; a workspace still remembering one would open
  // with whatever agent is next minted under it (see removeAgent).
  declaredIds.forEach((id) => forgetWorkspaceAgent(id));
}

/**
 * Names what a reset will change and what it leaves, asks, then resets exactly
 * those keys (FBK-3). A failed prompt resets nothing and says so.
 */
export async function confirmReset(
  keys: readonly (keyof Settings)[],
  title: string,
  keeps: string,
): Promise<void> {
  if (resetPromptOpen.value) {
    return;
  }
  resetPromptOpen.value = true;
  const labels = keys.map((key) => SETTINGS_REGISTRY[key].label).join(", ");
  try {
    const confirmed = await ask(`Resets: ${labels}.\nKeeps: ${keeps}.\nThis can't be undone.`, {
      title,
      kind: "warning",
      okLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (confirmed) {
      applyReset(keys);
    }
  } catch {
    reportPersistError("Couldn't confirm the reset — nothing was changed.");
  } finally {
    resetPromptOpen.value = false;
  }
}
