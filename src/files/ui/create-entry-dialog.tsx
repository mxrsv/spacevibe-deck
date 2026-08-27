/**
 * Naming a new file or folder (design §5.2).
 *
 * The shared `Modal` shell (DL §29) — one text field, a confirm and a cancel,
 * focus on mount, Escape and the scrim both close it. It follows
 * `SavePresetDialog`'s shape and adds no genre. Raising it is what DL-19.5's
 * 2026-08-25 amendment permits: a panel does not raise a dialog to report its
 * own STATE, and this is a dialog the user pressed a control to open.
 *
 * The field validates as the user types and the confirm stays disabled while
 * the name is invalid, with the reason printed under it. That validation is a
 * CONVENIENCE, never the boundary — main validates the same name again
 * (design §6.3), through the very same module.
 */
import { useSignal } from "@preact/signals";
import { Modal } from "../../ui/modal";
import { checkEntryName } from "../entry-name";
import { baseName } from "../../lib/path-name";
import type { EntryKind } from "../../host/file-create-host";

export interface CreateEntryDialogProps {
  readonly workspacePath: string;
  readonly parent: string;
  readonly kind: EntryKind;
  onCancel(): void;
  /** Resolves once the create has been attempted; the dialog closes either
   * way, because a modal that survives its own failure has to own an error
   * state and the panel's status line already exists (design §5.4). */
  onCreate(workspacePath: string, parent: string, name: string, kind: EntryKind): Promise<boolean>;
}

export function CreateEntryDialog(props: CreateEntryDialogProps) {
  const name = useSignal("");
  const busy = useSignal(false);
  const check = checkEntryName(name.value);
  const heading = props.kind === "file" ? "New file" : "New folder";
  // Design §5.1: the destination is stated so the answer is never guessed.
  // That matters more with the controls on the ROOT's row than it would in a
  // header — the button the user pressed may well create somewhere else. Shown
  // workspace-relative, because the absolute path is the tree's own root row.
  const destination =
    props.parent === props.workspacePath
      ? baseName(props.workspacePath)
      : `${baseName(props.workspacePath)}/${props.parent.slice(props.workspacePath.length + 1)}`;

  async function confirm(): Promise<void> {
    if (!check.ok || busy.value) {
      return;
    }
    busy.value = true;
    await props.onCreate(props.workspacePath, props.parent, name.value, props.kind);
    props.onCancel();
  }

  return (
    <Modal
      panelClass="create-entry"
      label={heading}
      onDismiss={props.onCancel}
      initialFocus="input"
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        void confirm();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <h1>{heading}</h1>
      <p class="create-entry__destination">in {destination}</p>
      <input
        value={name.value}
        placeholder={props.kind === "file" ? "File name" : "Folder name"}
        onInput={(event) => {
          name.value = (event.target as HTMLInputElement).value;
        }}
      />
      {name.value !== "" && !check.ok && <p class="create-entry__reason">{check.reason}</p>}
      <div class="create-entry__actions">
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="is-primary"
          disabled={!check.ok || busy.value}
          onClick={() => void confirm()}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}
