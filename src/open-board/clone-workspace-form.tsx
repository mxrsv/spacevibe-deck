import {
  ArrowLeft01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { isTerminalPhase, type ClonePhase, type CloneError } from "../lib/clone-contract";
import { parseGithubRepository } from "../lib/github-repository";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import type { CloneController, CloneControllerState } from "./clone-controller-types";

export interface CloneWorkspaceFormProps {
  readonly controller: CloneController;
  onPickParent(): Promise<string | null>;
  onBack(): void;
  /** Quick Launch supplies this; Open Board relies on Back only. */
  onClose?: () => void;
  /** The parent folder offered when no clone has succeeded yet. */
  readonly home: string;
}

/** One short, actionable sentence per closed code; the only place error copy is written. */
export const CLONE_ERROR_COPY: Readonly<Record<CloneError, string>> = {
  "invalid-input": "Deck couldn't use that repository or folder name. Check them and try again.",
  "git-not-found": "Git isn't installed, or Deck can't find it. Install Git, then try again.",
  "authentication-required":
    "GitHub needs you to sign in. Sign in through your Git credentials or SSH key, then retry.",
  "destination-exists": "That folder already exists. Choose another folder name or location.",
  "destination-busy":
    "Another clone is writing to that folder. Choose another name or wait for it.",
  "job-busy": "A clone is already running in this window. Wait for it, or cancel it first.",
  "job-unavailable": "That clone is no longer available. Start a new one.",
  "repository-unavailable":
    "Deck couldn't open that repository. Check the name, and that your account can see it.",
  network: "The connection failed. Check your network, then try again.",
  "permission-denied": "Deck can't write to that folder. Choose a different parent folder.",
  "disk-full": "The disk is full. Free some space, then try again.",
  "timed-out": "The clone took too long and was stopped. Try again.",
  "incomplete-checkout": "The download finished but the files weren't checked out. Try again.",
  unknown: "The clone failed for an unknown reason. Try again.",
};

const PHASE_LABEL: Readonly<Partial<Record<ClonePhase, string>>> = {
  connecting: "Connecting…",
  receiving: "Receiving objects…",
  resolving: "Resolving deltas…",
  checkout: "Updating files…",
  cancelling: "Cancelling…",
};

type CloneView =
  | "idle"
  | "starting"
  | "progress"
  | "cancelling"
  | "adding"
  | "ready"
  | "save-failed"
  | "failed"
  | "cancelled";

function viewOf({ job, registration, starting, rejection }: CloneControllerState): CloneView {
  if (starting) return "starting";
  if (job === null || (rejection !== null && isTerminalPhase(job.phase))) return "idle";
  switch (job.phase) {
    case "succeeded":
      if (registration === "ready") return "ready";
      return registration === "workspace-save-failed" ? "save-failed" : "adding";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "cancelling":
      return "cancelling";
    default:
      return "progress";
  }
}

function hostOf(text: string): string | null {
  const scp = text.match(/^[^@\s/]+@([^:\s/]+):/);
  if (scp !== null) return scp[1].toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function repositoryProblem(text: string): string {
  const host = hostOf(text);
  if (host !== null && host !== "github.com") {
    return "Only github.com repositories are supported";
  }
  if (host === "github.com") {
    const segments = text
      .replace(/^[a-z+]+:\/\/[^/]+\//i, "")
      .split("/")
      .filter(Boolean);
    if (segments.length > 2 || /[?#]/.test(text)) {
      return "Paste the repository link itself, not a file, branch or pull request link";
    }
  }
  return "Enter a GitHub repository as owner/repo or a github.com URL";
}

function folderNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a folder name";
  if (
    trimmed !== name ||
    trimmed.startsWith(".") ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    return "Choose a folder name without dots or path separators";
  }
  return null;
}

/** Display-only: main joins the real path, from the same parent and name. */
function joinPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function FormHeader({ onBack, onClose }: Pick<CloneWorkspaceFormProps, "onBack" | "onClose">) {
  return (
    <header class="nt-quick-launch__head">
      <button type="button" class="nt-icon-action" aria-label="Back" onClick={onBack}>
        <DeckIcon icon={ArrowLeft01Icon} size={GLYPH_ROW} />
      </button>
      <div>
        <span>Workspace</span>
        <strong>Clone repository</strong>
      </div>
      {onClose === undefined ? null : (
        <button type="button" class="nt-icon-action" aria-label="Close" onClick={onClose}>
          <DeckIcon icon={Cancel01Icon} size={GLYPH_ROW} />
        </button>
      )}
    </header>
  );
}

/** Clone a GitHub repository and add it as a workspace; renders the controller's state. */
export function CloneWorkspaceForm(props: CloneWorkspaceFormProps) {
  const { controller } = props;
  const snapshot = controller.state.value;
  const { job, rejection } = snapshot;
  const view = viewOf(snapshot);
  const root = useRef<HTMLElement>(null);

  const repository = useSignal("");
  const pickedParent = useSignal<string | null>(null);
  const typedName = useSignal("");
  const nameEdited = useSignal(false);
  const pickError = useSignal<string | null>(null);

  const parsed = parseGithubRepository(repository.value);
  const parent = pickedParent.value ?? snapshot.lastParent ?? props.home;
  const name = nameEdited.value ? typedName.value : (parsed?.folderName ?? "");
  const repositoryError =
    repository.value.trim() !== "" && parsed === null
      ? repositoryProblem(repository.value.trim())
      : null;
  const nameError = name === "" ? null : folderNameProblem(name);
  const canSubmit = parsed !== null && nameError === null && name !== "" && parent.trim() !== "";

  // Focus follows the view, not the progress ticks: the primary action of the
  // new state takes it, so a keyboard user never lands on a control that left.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, [view]);

  const clearRejection = (): void => {
    if (rejection !== null) controller.reset();
  };

  const pickParent = async (): Promise<void> => {
    try {
      const picked = await props.onPickParent();
      if (picked !== null) {
        pickedParent.value = picked;
        clearRejection();
      }
    } catch (cause: unknown) {
      console.warn("Clone parent picker failed:", cause);
      pickError.value = "Couldn't open the folder picker — try again";
    }
  };

  const submit = (): void => {
    if (!canSubmit) return;
    void controller.start({ repository: repository.value.trim(), parent, name });
  };

  const done = (): void => {
    controller.reset();
    props.onBack();
  };

  const renderIdle = () => (
    <>
      <div class="nt-create-workspace__body">
        <label>
          <span>GitHub repository</span>
          <input
            type="text"
            aria-label="GitHub repository"
            placeholder="owner/repo or https://github.com/owner/repo"
            spellcheck={false}
            value={repository.value}
            data-initial-focus
            onInput={(event) => {
              repository.value = event.currentTarget.value;
              clearRejection();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>
        {repositoryError === null ? null : (
          <p class="nt-clone__problem" role="alert">
            {repositoryError}
          </p>
        )}
        <label>
          <span>Parent folder</span>
          <button
            type="button"
            class="nt-create-workspace__folder"
            data-action="pick-parent"
            onClick={() => void pickParent()}
          >
            <DeckIcon icon={Folder01Icon} size={GLYPH_ROW} />
            <span data-parent-path>{parent || "Choose a parent folder"}</span>
            <span>Choose…</span>
          </button>
        </label>
        <label>
          <span>Folder01Icon name</span>
          <input
            type="text"
            aria-label="Folder name"
            value={name}
            onInput={(event) => {
              const value = event.currentTarget.value;
              typedName.value = value;
              // Emptying the field hands the name back to the repository.
              nameEdited.value = value !== "";
              clearRejection();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>
        {nameError === null ? null : (
          <p class="nt-clone__problem" role="alert">
            {nameError}
          </p>
        )}
        <label>
          <span>Final path</span>
          <output class="nt-clone__path" data-final-path aria-live="off">
            {name === "" ? parent : joinPath(parent, name)}
          </output>
        </label>
        {pickError.value === null ? null : (
          <p class="nt-clone__problem" role="alert">
            {pickError.value}
          </p>
        )}
        {rejection === null ? null : (
          <p class="nt-clone__problem" role="alert" data-clone-error={rejection}>
            {CLONE_ERROR_COPY[rejection]}
          </p>
        )}
      </div>
      <footer class="nt-create-workspace__foot">
        <button type="button" class="nt-secondary-action" onClick={props.onBack}>
          Cancel
        </button>
        <button
          type="button"
          class="nt-primary-action"
          data-action="start-clone"
          disabled={!canSubmit}
          onClick={submit}
        >
          Clone
          <DeckIcon icon={ArrowUp02Icon} size={GLYPH_ROW} />
        </button>
      </footer>
    </>
  );

  const renderStatus = (label: string, percent: number | null, showBar: boolean) => (
    <>
      <div class="nt-clone__status">
        <span role="status" aria-live="polite">
          {label}
        </span>
        {/* The progressbar below carries the value; reading every tick aloud would only chatter. */}
        {percent === null ? null : (
          <span class="nt-clone__percent" aria-hidden="true">
            {Math.round(percent)}%
          </span>
        )}
      </div>
      {showBar ? (
        <div
          class="nt-clone__bar"
          role="progressbar"
          aria-label="Clone progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent === null ? undefined : Math.round(percent)}
          data-indeterminate={percent === null ? "" : undefined}
        >
          <span
            class="nt-clone__fill"
            style={{ transform: `scaleX(${Math.min(100, Math.max(0, percent ?? 0)) / 100})` }}
          />
        </div>
      ) : null}
    </>
  );

  const detail = () => (
    <>
      {job === null ? null : <p data-clone-destination>{job.destination}</p>}
      {job?.leftoverPath == null ? null : (
        <p data-clone-leftover>Files were left at {job.leftoverPath}; Deck did not delete them.</p>
      )}
      {job?.warnings.includes("submodules-not-initialized") ? (
        <p data-clone-warning>
          Submodules were not initialized. Run git submodule update --init in the project if it
          needs them.
        </p>
      ) : null}
    </>
  );

  const closeButton = (initialFocus = false) => (
    <button
      type="button"
      class="nt-secondary-action"
      data-initial-focus={initialFocus ? "" : undefined}
      onClick={props.onBack}
    >
      Close
    </button>
  );

  const renderActive = () => {
    const cancelling = view === "cancelling";
    return (
      <>
        <div class="nt-create-workspace__body">
          {renderStatus(
            view === "starting" ? "Starting…" : (PHASE_LABEL[job?.phase ?? "connecting"] ?? ""),
            view === "starting" ? null : (job?.percent ?? null),
            true,
          )}
          {view === "starting" ? null : detail()}
          {rejection === null ? null : (
            <p class="nt-clone__problem" role="alert" data-clone-error={rejection}>
              {CLONE_ERROR_COPY[rejection]}
            </p>
          )}
        </div>
        <footer class="nt-create-workspace__foot">
          {closeButton(cancelling || view === "starting")}
          {view === "starting" ? null : (
            <button
              type="button"
              class="nt-primary-action"
              data-action="cancel-clone"
              data-initial-focus={cancelling ? undefined : ""}
              disabled={cancelling}
              onClick={() => void controller.cancel()}
            >
              Cancel clone
            </button>
          )}
        </footer>
      </>
    );
  };

  const renderFinished = () => {
    const error = job?.error ?? "unknown";
    if (view === "adding") {
      return (
        <>
          <div class="nt-create-workspace__body">
            {renderStatus("Adding workspace…", null, false)}
            {detail()}
          </div>
          <footer class="nt-create-workspace__foot">{closeButton(true)}</footer>
        </>
      );
    }
    if (view === "ready") {
      return (
        <>
          <div class="nt-create-workspace__body">
            {renderStatus("Added", null, false)}
            {detail()}
          </div>
          <footer class="nt-create-workspace__foot">
            <button
              type="button"
              class="nt-primary-action"
              data-action="done"
              data-initial-focus
              onClick={done}
            >
              Done
            </button>
          </footer>
        </>
      );
    }
    if (view === "save-failed") {
      return (
        <>
          <div class="nt-create-workspace__body">
            <p class="nt-clone__problem" role="alert">
              The repository was cloned, but Deck couldn't add it as a workspace.
            </p>
            {detail()}
          </div>
          <footer class="nt-create-workspace__foot">
            {closeButton()}
            <button
              type="button"
              class="nt-primary-action"
              data-action="retry-add-workspace"
              data-initial-focus
              onClick={() => void controller.retryAddWorkspace()}
            >
              Retry adding workspace
            </button>
          </footer>
        </>
      );
    }
    return (
      <>
        <div class="nt-create-workspace__body">
          {view === "failed" ? (
            <p class="nt-clone__problem" role="alert" data-clone-error={error}>
              {CLONE_ERROR_COPY[error]}
            </p>
          ) : (
            <p role="status">The clone was cancelled.</p>
          )}
          {detail()}
        </div>
        <footer class="nt-create-workspace__foot">
          {closeButton()}
          <button
            type="button"
            class="nt-primary-action"
            data-action="start-over"
            data-initial-focus
            onClick={() => controller.reset()}
          >
            {view === "failed" ? "Try again" : "Start over"}
          </button>
        </footer>
      </>
    );
  };

  return (
    <section
      ref={root}
      class="nt-create-workspace"
      aria-busy={view === "starting" || view === "progress" || view === "adding"}
      data-clone-view={view}
      onKeyDown={(event) => {
        // Escape only dismisses the form: a running clone is cancelled by its button.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onBack();
      }}
    >
      <FormHeader onBack={props.onBack} onClose={props.onClose} />
      {view === "idle"
        ? renderIdle()
        : view === "starting" || view === "progress" || view === "cancelling"
          ? renderActive()
          : renderFinished()}
    </section>
  );
}
