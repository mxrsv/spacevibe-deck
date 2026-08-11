/**
 * The bar spec §5 raises when the agent writes a file the user is editing
 * (plan T34).
 *
 * Only the two DIRTY rows of the table are drawn. Clean+changed reloads
 * silently and clean+deleted marks the tab gone — both stay silent here on
 * purpose, because a bar for something Deck already handled is noise the user
 * has to dismiss.
 */
import type { ChangeAction } from "../external-change";
import type { ChangeResolution } from "../external-change";

export interface ExternalChangeBarProps {
  readonly prompt: ChangeAction["kind"] | null;
  readonly fileName: string;
  readonly onResolve: (resolution: ChangeResolution) => void;
}

export function ExternalChangeBar(props: ExternalChangeBarProps) {
  if (props.prompt !== "prompt-changed" && props.prompt !== "prompt-deleted") {
    return null;
  }
  const changed = props.prompt === "prompt-changed";
  return (
    <div class="filebar" role="status">
      <span class="filebar__text">
        {changed
          ? `${props.fileName} changed on disk and you have unsaved changes.`
          : `${props.fileName} was deleted on disk and you have unsaved changes.`}
      </span>
      <div class="filebar__actions">
        {changed ? (
          <>
            <button
              type="button"
              class="filebar__btn"
              onClick={() => props.onResolve("reload")}
            >
              Reload
            </button>
            <button
              type="button"
              class="filebar__btn filebar__btn--primary"
              onClick={() => props.onResolve("keep-mine")}
            >
              Keep mine
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              class="filebar__btn filebar__btn--primary"
              onClick={() => props.onResolve("save-again")}
            >
              Save again
            </button>
            <button
              type="button"
              class="filebar__btn"
              onClick={() => props.onResolve("close")}
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
