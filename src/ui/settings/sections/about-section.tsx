import { useSignal } from "@preact/signals";
import { openUrl } from "../../../host/shell-host";
import { appVersion } from "../../../updater/app-version";
import { activeUpdateController } from "../../../updater/active-update-controller";
import { RELEASE_NOTES_URL } from "../../../updater/update-menu-actions";
import { feedbackUrl } from "../../../lib/feedback-url";
import { getDesktopEnvironment } from "../../../lib/platform";
import { ConfigRow } from "../../controls/config-row";
import { reportPersistError } from "../../../chrome/events";
import type { UpdateCheckResult, UpdatePhase } from "../../../updater/update-controller";
import { Button } from "../../controls/button";

/**
 * The pill's word for each phase. Same vocabulary as the chrome action, so a
 * user who has seen one recognises the other — this row is a second door onto
 * one state machine, not a second implementation of it.
 */
const PILL: Readonly<Record<UpdatePhase, string>> = {
  hidden: "check",
  "check-failed": "check failed · retry",
  available: "update",
  downloading: "downloading…",
  downloaded: "install & relaunch",
  "download-failed": "retry",
  installing: "installing…",
  "install-failed": "retry install",
  "relaunch-failed": "relaunch",
};

const CHECK_RESULT_DESC: Readonly<Record<UpdateCheckResult, string>> = {
  available: "An update is ready",
  current: "You're on the latest version",
  failed: "Couldn't reach the update server",
  // A build compiled without the updater public key: no channel to ask.
  unsupported: "This build can't update itself",
};

/**
 * The update action and the line that answers it, shared by the section below and by Command
 * Settings' About rows: both are doors onto the one state machine.
 */
export function useAboutUpdate() {
  const controller = activeUpdateController.value;
  const busy = useSignal(false);
  const lastCheck = useSignal<UpdateCheckResult | null>(null);
  const view = controller?.view.value;
  const phase = view?.phase ?? "hidden";
  const cannotRetry = phase === "install-failed" && view?.installRetryable === false;

  const handleUpdateAction = async (): Promise<void> => {
    if (controller === null || busy.value || cannotRetry) {
      return;
    }
    busy.value = true;
    try {
      switch (phase) {
        case "downloaded":
        case "install-failed":
          await controller.installAndRelaunch();
          break;
        case "relaunch-failed":
          await controller.relaunch();
          break;
        case "available":
        case "download-failed":
          await controller.download();
          break;
        default:
          // `hidden` — nothing has been found yet, which is exactly the case
          // the macOS menu item covers and Windows had no way to reach.
          lastCheck.value = await controller.checkNow();
      }
    } finally {
      busy.value = false;
    }
  };

  const working = phase === "downloading" || phase === "installing";
  const version = appVersion.value;
  // The outcome of the last check wins over the version line: pressing the
  // pill has to visibly answer, or it reads as a dead button. "currently"
  // stays lowercase after the dash — mid-sentence, not a fresh label (DL-4.4).
  const desc = cannotRetry
    ? "The installer did not take over. Quit and reopen Deck, or open Release Notes below for a manual download."
    : phase === "hidden" && lastCheck.value !== null
      ? `${CHECK_RESULT_DESC[lastCheck.value]}${version === "" ? "" : ` — currently ${version}`}`
      : version === ""
        ? ""
        : `Currently ${version}`;
  return {
    desc,
    label: cannotRetry
      ? "install failed"
      : busy.value && (phase === "hidden" || phase === "check-failed")
        ? "checking…"
        : PILL[phase],
    disabled: controller === null || busy.value || working || cannotRetry,
    press: () => void handleUpdateAction(),
  };
}

export async function openReleaseNotes(): Promise<void> {
  try {
    await openUrl(RELEASE_NOTES_URL);
  } catch {
    reportPersistError("Couldn't open Release Notes in your browser.");
  }
}

export async function openFeedback(): Promise<void> {
  try {
    await openUrl(feedbackUrl(appVersion.value, getDesktopEnvironment().platform));
  } catch {
    reportPersistError("Couldn't open the feedback page in your browser.");
  }
}

/**
 * Where Deck says which version it is and offers the two update actions.
 *
 * It exists because the macOS menu bar is the only place `Check for Updates…`
 * and `Release Notes…` live, and `src-tauri/src/menu.rs` builds no menu off
 * macOS — so on Windows both were unreachable, and the chrome button only
 * appears once an update has already been found.
 */
export function AboutSection() {
  const update = useAboutUpdate();
  return (
    <>
      <ConfigRow label="Check for updates" desc={update.desc}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={update.disabled}
          onClick={update.press}
        >
          {update.label}
        </Button>
      </ConfigRow>
      <ConfigRow label="Release notes" desc="What changed in each version">
        <Button type="button" variant="outline" size="sm" onClick={() => void openReleaseNotes()}>
          open …
        </Button>
      </ConfigRow>
      <ConfigRow label="Feedback" desc="Report a bug or suggest an idea">
        <Button type="button" variant="outline" size="sm" onClick={() => void openFeedback()}>
          open …
        </Button>
      </ConfigRow>
    </>
  );
}
