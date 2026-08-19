import { useSignal } from "@preact/signals";
import { openUrl } from "../../../host/shell-host";
import { appVersion } from "../../../updater/app-version";
import { activeUpdateController } from "../../../updater/active-update-controller";
import { RELEASE_NOTES_URL } from "../../../updater/update-menu-actions";
import { ConfigRow } from "../../controls/config-row";
import { reportPersistError } from "../../../chrome/events";
import type { UpdateCheckResult, UpdatePhase } from "../../../updater/update-controller";

/**
 * The pill's word for each phase. Same vocabulary as the chrome action, so a
 * user who has seen one recognises the other — this row is a second door onto
 * one state machine, not a second implementation of it.
 */
const PILL: Readonly<Record<UpdatePhase, string>> = {
  hidden: "check",
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
 * Where Deck says which version it is and offers the two update actions.
 *
 * It exists because the macOS menu bar is the only place `Check for Updates…`
 * and `Release Notes…` live, and `src-tauri/src/menu.rs` builds no menu off
 * macOS — so on Windows both were unreachable, and the chrome button only
 * appears once an update has already been found.
 */
export function AboutSection() {
  const controller = activeUpdateController.value;
  const busy = useSignal(false);
  const lastCheck = useSignal<UpdateCheckResult | null>(null);
  const view = controller?.view.value;
  const phase = view?.phase ?? "hidden";

  const handleUpdateAction = async (): Promise<void> => {
    if (controller === null || busy.value) {
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

  const handleReleaseNotes = async (): Promise<void> => {
    try {
      await openUrl(RELEASE_NOTES_URL);
    } catch {
      reportPersistError("Couldn't open Release Notes in your browser.");
    }
  };

  const working = phase === "downloading" || phase === "installing";
  const version = appVersion.value;
  // The outcome of the last check wins over the version line: pressing the
  // pill has to visibly answer, or it reads as a dead button. "currently"
  // stays lowercase after the dash — mid-sentence, not a fresh label (DL-4.4).
  const desc =
    phase === "hidden" && lastCheck.value !== null
      ? `${CHECK_RESULT_DESC[lastCheck.value]}${version === "" ? "" : ` — currently ${version}`}`
      : version === ""
        ? ""
        : `Currently ${version}`;

  return (
    <>
      <ConfigRow label="Check for updates" desc={desc}>
        <button
          type="button"
          class={`cfg-btn ${busy.value || working ? "cfg-btn--disabled" : ""}`}
          disabled={controller === null || busy.value || working}
          onClick={() => void handleUpdateAction()}
        >
          {busy.value && phase === "hidden" ? "checking…" : PILL[phase]}
        </button>
      </ConfigRow>
      <ConfigRow label="Release notes" desc="What changed in each version">
        <button type="button" class="cfg-btn" onClick={() => void handleReleaseNotes()}>
          open …
        </button>
      </ConfigRow>
    </>
  );
}
