import { X } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { getDesktopEnvironment, hasPrimaryModifier } from "../lib/platform";
import { tildify } from "../lib/process-info";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { workspaceLabel } from "../lib/workspace-label";
import { TASK_PROMPT_STAGING_ENABLED } from "../terminal/task-prompt-send";
import { LauncherFields, type LauncherFieldsProps } from "./launcher-fields";
import type { QuickLaunchRetarget } from "./launcher-store";
import type { NewTaskDraft } from "./new-task-draft";

/**
 * The contextual launcher (design §4.2). It is deliberately an anchored,
 * non-modal tool: no scrim, no focus trap, and no outside-press dismissal, so
 * the terminal behind it remains readable and interactive while a task is
 * drafted.
 */
export interface QuickLaunchProps extends Omit<
  LauncherFieldsProps,
  "idPrefix" | "compact" | "onOpenFullComposer" | "onDraftChange"
> {
  onDraftChange(next: NewTaskDraft): void;
  /** Persist Quick Launch's one presentation preference. */
  onPromptExpandedChange(expanded: boolean): void;
  /** Transfer the shared draft to Open Board without copying or clearing it. */
  onTransferToBoard(): void;
  /** A contextual project trigger that differs from the draft's project. */
  readonly retarget: QuickLaunchRetarget | null;
  onKeepRetarget(): void;
  onMoveRetarget(): void;
  onClearRetarget(): void;
  onClose(): void;
}

export interface QuickLaunchSubviewProps {
  readonly label: string;
  readonly children: ComponentChildren;
  onBack(): void;
}

/**
 * Keeps a workspace-creation view inside Quick Launch's anchored shell. Escape
 * backs out even after focus moves to the terminal behind the non-modal tool.
 */
export function QuickLaunchSubview({ label, children, onBack }: QuickLaunchSubviewProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const backOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onBack();
    };
    document.addEventListener("keydown", backOnEscape, true);
    return () => document.removeEventListener("keydown", backOnEscape, true);
  }, [onBack]);

  return (
    <aside class="nt-quick-launch nt-quick-launch--subview" aria-label={label} ref={panelRef}>
      {children}
    </aside>
  );
}

export function QuickLaunch(props: QuickLaunchProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);

  useEffect(() => {
    const focusTarget =
      panelRef.current?.querySelector<HTMLTextAreaElement>("textarea") ??
      panelRef.current?.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]');
    focusTarget?.focus();
  }, []);

  const updateDraft = (next: NewTaskDraft): void => {
    if (next.promptExpanded !== props.draft.promptExpanded) {
      props.onPromptExpandedChange(next.promptExpanded);
    }
    props.onDraftChange(next);
  };

  // `promptExpanded` is a PERSISTED setting, so under
  // `TASK_PROMPT_STAGING_ENABLED` false it can still read true from an install
  // that had the prompt open — the chord has to ask the constant, not the
  // draft, or it would stage a task no visible textarea could have written.
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key === "Enter" &&
      hasPrimaryModifier(event) &&
      (props.promptStaging ?? TASK_PROMPT_STAGING_ENABLED) &&
      props.draft.promptExpanded &&
      props.problem === null &&
      props.pending === null
    ) {
      event.preventDefault();
      event.stopPropagation();
      props.onStartTask();
    }
  };

  const currentRetargetLabel =
    props.retarget === null
      ? null
      : workspaceLabel(props.retarget.currentPath) === workspaceLabel(props.retarget.requestedPath)
        ? tildify(props.retarget.currentPath, getDesktopEnvironment().homeDir)
        : workspaceLabel(props.retarget.currentPath);
  const requestedRetargetLabel =
    props.retarget === null
      ? null
      : workspaceLabel(props.retarget.currentPath) === workspaceLabel(props.retarget.requestedPath)
        ? tildify(props.retarget.requestedPath, getDesktopEnvironment().homeDir)
        : workspaceLabel(props.retarget.requestedPath);

  return (
    <aside
      class="nt-quick-launch"
      aria-label="Quick launch"
      ref={panelRef}
      onKeyDown={handleKeyDown}
    >
      <header class="nt-quick-launch__head">
        <div>
          <span>Quick launch</span>
          <strong>New task</strong>
        </div>
        <button type="button" class="nt-icon-action" aria-label="Close" onClick={props.onClose}>
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </header>
      {props.retarget !== null ? (
        <section class="nt-quick-launch__retarget" role="status" aria-label="Workspace choice">
          <p>
            <strong>{requestedRetargetLabel}</strong> was requested. This draft stays in{" "}
            <strong>{currentRetargetLabel}</strong> until you choose.
          </p>
          <div>
            <button
              type="button"
              aria-label={`Keep draft in ${currentRetargetLabel}`}
              disabled={props.pending !== null}
              onClick={props.onKeepRetarget}
            >
              Keep {currentRetargetLabel}
            </button>
            <button
              type="button"
              aria-label={`Move draft to ${requestedRetargetLabel}`}
              disabled={props.pending !== null}
              onClick={props.onMoveRetarget}
            >
              Move to {requestedRetargetLabel}
            </button>
            <button
              type="button"
              aria-label={`Clear draft and use ${requestedRetargetLabel}`}
              disabled={props.pending !== null}
              onClick={props.onClearRetarget}
            >
              Clear and use {requestedRetargetLabel}
            </button>
          </div>
        </section>
      ) : null}
      <LauncherFields
        {...props}
        idPrefix="quick-launch"
        compact
        onDraftChange={updateDraft}
        onOpenFullComposer={props.onTransferToBoard}
      />
      <footer class="nt-quick-launch__foot">
        <span>
          <kbd>⌘</kbd>
          <kbd>↵</kbd> start
        </span>
        <button type="button" onClick={props.onManageAgents}>
          Manage agents…
        </button>
      </footer>
    </aside>
  );
}
