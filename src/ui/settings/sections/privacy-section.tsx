import { ArrowSquareOut } from "@phosphor-icons/react";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { openUrl } from "../../../host/shell-host";
import { reportPersistError } from "../../../chrome/events";
import { ToggleRow } from "../../controls/config-row";
import { CHROME_ICON, DeckIcon } from "../../controls/deck-icon";
import {
  ensureTelemetryStateLoaded,
  setTelemetryEnabled,
  telemetryConsent,
} from "../../../telemetry/consent-store";
import { USAGE_PRIVACY_URL } from "../../../telemetry/usage-notice";

/**
 * The Privacy category (spec §7): one switch over MAIN-owned consent state,
 * then the whole disclosure in plain words. This is a VIEW over
 * `telemetry.json` reached through `telemetry_state` — deliberately not a
 * settings-schema pair, because settings get copied to other machines and
 * pasted into issues, and consent must never travel with them.
 *
 * Four states: loading and unreadable disable the switch; enabled and
 * declined/off are the two the user can move between. A failed write stays
 * visible through the persist-error bar — the UI never claims a change main
 * did not keep. No identifier is displayed because no daily id ever crosses
 * into the renderer.
 *
 * The copy never calls the payload "anonymous" (spec §11) — the copy test
 * pins that word out.
 */
export function PrivacySection() {
  const busy = useSignal(false);

  useEffect(() => {
    void ensureTelemetryStateLoaded();
  }, []);

  const consent = telemetryConsent.value;
  const enabled = consent === "enabled";
  const locked = consent === "loading" || consent === "unavailable" || consent === "unreadable";

  const toggle = async (): Promise<void> => {
    if (busy.value || locked) {
      return;
    }
    busy.value = true;
    try {
      await setTelemetryEnabled(!enabled);
    } catch {
      reportPersistError("Could not save your usage-stats choice.");
    } finally {
      busy.value = false;
    }
  };

  return (
    <>
      <ToggleRow
        label="Share usage stats"
        desc="On by default. Turn it off here and Deck stops counting. No code, paths or prompts."
        checked={enabled}
        disabled={busy.value || locked}
        onToggle={() => void toggle()}
      />
      {consent === "unreadable" ? (
        // Fail-closed (spec §5): the state file exists but could not be read,
        // so analytics stays off and Deck refuses to guess or overwrite it.
        // Recovering is an explicit user action on the file itself.
        <p class="settings-screen__note" role="alert">
          The analytics state file (telemetry.json in Deck's data folder) could not be read, so
          sharing stays off. Repair or remove that file, then restart Deck — reopening Settings is
          not enough, because the file is read once at launch.
        </p>
      ) : null}
      <p class="settings-screen__note">
        When sharing is on, Deck sends one small daily snapshot: a fresh random id for that day, the
        date, Deck's version, platform and architecture, launch counts per built-in agent (custom
        agents count as one bucket), how often the browser, explorer and usage surfaces were opened,
        the day's highest tab and pane counts, and whether sessions were restored at launch. The
        daily id is random every day and is never derived from your machine, so days cannot be
        linked.
      </p>
      <p class="settings-screen__note">
        Deck never sends code, file paths, repository or branch names, prompts, terminal output,
        hostname, username, locale or timezone. Raw records expire after 35 days. The data is stored
        on Deck's own Cloudflare Worker; Cloudflare processes ordinary connection metadata at its
        edge as the infrastructure provider. Turning sharing off deletes unsent data immediately;
        already-accepted records remain until their 35-day deadline.
      </p>
      <button
        type="button"
        class="usage-link"
        onClick={() => {
          void openUrl(USAGE_PRIVACY_URL).catch(() => {
            reportPersistError(`Could not open ${USAGE_PRIVACY_URL}`);
          });
        }}
      >
        <span>Read the full privacy notice</span>
        <DeckIcon icon={ArrowSquareOut} size={CHROME_ICON} />
      </button>
    </>
  );
}
