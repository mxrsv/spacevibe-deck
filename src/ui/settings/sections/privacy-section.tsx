import { ArrowSquareOut } from "@phosphor-icons/react";
import { useEffect } from "preact/hooks";
import { openUrl } from "../../../host/shell-host";
import { reportPersistError } from "../../../chrome/events";
import { CHROME_ICON, DeckIcon } from "../../controls/deck-icon";
import { ensureTelemetryStateLoaded, telemetryConsent } from "../../../telemetry/consent-store";
import { USAGE_PRIVACY_URL } from "../../../telemetry/usage-notice";

/**
 * The Privacy category (spec §7): the whole disclosure in plain words, over
 * MAIN-owned state read through `telemetry_state` — deliberately not a
 * settings-schema pair, because settings get copied to other machines and
 * pasted into issues, and consent must never travel with them.
 *
 * The switch is GONE (2026-09-06, `USAGE_ANALYTICS_MANDATORY`): usage stats
 * are on for every install with no way to turn them off, so a control here
 * would be a lie either way — working, it would contradict main, which refuses
 * `setEnabled(false)`; disabled, it would be a dead thing to keep pressing.
 * The account of what is sent stays, and is the reason this category still
 * exists at all: taking the choice away is not a licence to stop saying what
 * is taken. No identifier is displayed because no daily id ever crosses into
 * the renderer.
 *
 * `unreadable` is still reported, because it still means nothing is being sent
 * — fail-closed survives the mandatory policy, and a user reading a page that
 * says "always on" deserves to know when it is in fact off.
 *
 * The copy never calls the payload "anonymous" (spec §11) — the copy test
 * pins that word out — and it must never claim the collection is optional.
 */
export function PrivacySection() {
  useEffect(() => {
    void ensureTelemetryStateLoaded();
  }, []);

  const consent = telemetryConsent.value;

  return (
    <>
      <p class="settings-screen__note">
        Deck sends first-party usage stats. They are always on and cannot be turned off in this
        build. No code, file paths or prompts are ever included.
      </p>
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
        Deck sends one small daily snapshot: a fresh random id for that day, the date, Deck's
        version, platform and architecture, launch counts per built-in agent (custom agents count as
        one bucket), how often the browser, explorer and usage surfaces were opened, the day's
        highest tab and pane counts, and whether sessions were restored at launch. The daily id is
        random every day and is never derived from your machine, so days cannot be linked.
      </p>
      <p class="settings-screen__note">
        Deck never sends code, file paths, repository or branch names, prompts, terminal output,
        hostname, username, locale or timezone. Raw records expire after 35 days. The data is stored
        on Deck's own Cloudflare Worker; Cloudflare processes ordinary connection metadata at its
        edge as the infrastructure provider.
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
