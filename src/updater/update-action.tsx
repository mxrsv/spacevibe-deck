import type { UpdatePhase, UpdateView } from "./update-controller";

interface UpdateActionProps {
  readonly view: UpdateView;
  readonly onDownload: () => void;
  readonly onInstall: () => void;
  readonly onRelaunch: () => void;
}

const LABELS: Readonly<Record<Exclude<UpdatePhase, "hidden">, string>> = {
  available: "Update",
  downloading: "Downloading…",
  downloaded: "Install & Relaunch",
  "download-failed": "Retry Update",
  installing: "Installing…",
  "install-failed": "Retry Install",
  "relaunch-failed": "Relaunch",
};

const ANNOUNCEMENTS: Readonly<Record<Exclude<UpdatePhase, "hidden">, string>> =
  {
    available: "Deck update available.",
    downloading: "Downloading Deck update.",
    downloaded: "Deck update downloaded. Ready to install and relaunch.",
    "download-failed": "Update download failed. Retry available.",
    installing: "Installing Deck update.",
    "install-failed": "Update installation failed. Retry available.",
    "relaunch-failed": "Deck could not relaunch. Relaunch available.",
  };

function accessibleName(view: UpdateView): string {
  const versions = `update ${view.availableVersion} (current ${view.currentVersion})`;
  switch (view.phase) {
    case "downloaded":
      return `Install update ${view.availableVersion} and relaunch Deck (current ${view.currentVersion})`;
    case "install-failed":
      return `Retry installing ${versions}`;
    case "relaunch-failed":
      return "Relaunch Deck after installing update";
    case "downloading":
      return `Downloading ${versions}`;
    case "installing":
      return `Installing ${versions}`;
    case "download-failed":
      return `Retry downloading ${versions}`;
    case "available":
      return `Download ${versions}`;
    case "hidden":
      return "";
  }
}

function actionForPhase(props: UpdateActionProps): () => void {
  if (props.view.phase === "relaunch-failed") {
    return props.onRelaunch;
  }
  if (
    props.view.phase === "downloaded" ||
    props.view.phase === "install-failed"
  ) {
    return props.onInstall;
  }
  return props.onDownload;
}

export function UpdateAction(props: UpdateActionProps) {
  const { view } = props;
  if (view.phase === "hidden") {
    return null;
  }
  const busy = view.phase === "downloading" || view.phase === "installing";
  const failed = view.phase.endsWith("-failed");
  const label = LABELS[view.phase];
  const title = [accessibleName(view), view.notes].filter(Boolean).join(" — ");
  return (
    <span class="update-action-wrap">
      <button
        type="button"
        class={`update-action ${failed ? "update-action--failed" : ""}`}
        disabled={busy}
        aria-busy={busy ? "true" : undefined}
        aria-label={accessibleName(view)}
        title={title}
        onClick={actionForPhase(props)}
      >
        <span class="update-action__full">{label}</span>
        {view.phase === "downloaded" ? (
          <span class="update-action__compact" aria-hidden="true">
            Relaunch
          </span>
        ) : null}
      </button>
      <span class="update-action__live" aria-live="polite" aria-atomic="true">
        {ANNOUNCEMENTS[view.phase]}
      </span>
    </span>
  );
}
