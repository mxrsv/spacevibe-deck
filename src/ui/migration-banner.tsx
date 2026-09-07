import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { openUrl } from "../host/shell-host";
import { reportChromeMessage } from "../chrome/events";
import { MIGRATION_NOTICE_URL } from "../updater/migration-notice";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";

interface MigrationBannerProps {
  onDismiss(): void;
}

/**
 * The one notice the app raises about itself (DL §30).
 *
 * Rendered only where `shouldShowNotice` says so — `App` owns that call, so
 * this component is state-free and a gallery specimen can mount it directly.
 *
 * Copy is spec §9, with the version named since `SpaceVibe Deck 1.0.0` shipped
 * on 2026-08-20: the notice now points at a build that exists, and "1.0" is a
 * milestone rather than a patch number so a later stable does not date it.
 * The settings sentence is deliberate — it is the single fact most likely to
 * make someone delay the move, and finding it out afterwards is worse.
 */
export function MigrationBanner({ onDismiss }: MigrationBannerProps) {
  return (
    // DL-30.3: `role="status"`, not `alert` — it is true whenever the window
    // is open rather than an event, and an assertive live region would
    // interrupt whatever a screen-reader user was doing at launch.
    <div class="migration-banner" role="status">
      <p class="migration-banner__message">
        <strong>SpaceVibe Deck 1.0 is out.</strong> This build no longer updates itself — the new
        Deck must be downloaded by hand, and settings do not carry over.
      </p>
      {/* DL-8: a control says what happens, and what happens is that a browser
          tab opens. The download is a decision made on the page. */}
      <button
        type="button"
        class="migration-banner__action"
        onClick={() => {
          void openUrl(MIGRATION_NOTICE_URL).catch(() => {
            // The one failure a user can act on: the URL is in the notice's
            // own module, so saying it is better than a dead button.
            reportChromeMessage(`Could not open ${MIGRATION_NOTICE_URL}`);
          });
        }}
      >
        <span>Open the download page</span>
        <DeckIcon icon={ArrowSquareOut} size={CHROME_ICON} />
      </button>
      {/* The label has to say the dismissal is TEMPORARY: an unlabelled ✕
          otherwise reads as "never show me this again", which is a promise
          this surface deliberately does not make (spec §5). */}
      <button
        type="button"
        class="iconbtn migration-banner__close"
        aria-label="Hide this notice until Deck restarts"
        title="Hide this notice until Deck restarts"
        onClick={onDismiss}
      >
        <DeckIcon icon={X} size={CHROME_ICON} />
      </button>
    </div>
  );
}
