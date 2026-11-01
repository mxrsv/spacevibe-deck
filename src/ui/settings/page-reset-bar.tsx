import { changedKeys, keysFor } from "../../settings/settings-changes";
import { settings } from "../../settings/settings-store";
import type { SettingsPage } from "../../settings/settings-registry";
import { confirmReset, resetPromptOpen } from "./confirm-reset";
import { Button } from "../controls/button";

/**
 * Under the page title: how many of this page's preferences differ from the
 * defaults, and a Reset page action (SET-4). Only preference-scope keys count,
 * so a page reset never touches a declared agent or a layout width.
 */
export function PageResetBar({ page, label }: { page: SettingsPage; label: string }) {
  const keys = changedKeys(settings.value, keysFor("preference", page));
  if (keys.length === 0) {
    return null;
  }
  return (
    <div class="settings-screen__changed">
      <span>{keys.length} changed</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={resetPromptOpen.value}
        title="Reset this page — asks for confirmation"
        onClick={() =>
          void confirmReset(keys, `Reset ${label}`, "other pages, layout, agents and templates")
        }
      >
        reset page
      </Button>
    </div>
  );
}
