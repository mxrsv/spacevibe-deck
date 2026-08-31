import { ArrowLeft, ArrowUp, Folder, X } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";

export interface CreateWorkspaceFormProps {
  readonly initialParent: string;
  onPickParent(): Promise<string | null>;
  create(parent: string, name: string): Promise<{ readonly path: string }>;
  onCreated(path: string): void;
  onBack(): void;
  /** Quick Launch supplies this; Open Board relies on Back only. */
  onClose?: () => void;
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

function FormHeader({ onBack, onClose }: Pick<CreateWorkspaceFormProps, "onBack" | "onClose">) {
  return (
    <header class="nt-quick-launch__head">
      <button type="button" class="nt-icon-action" aria-label="Back" onClick={onBack}>
        <DeckIcon icon={ArrowLeft} size={ROW_ICON} />
      </button>
      <div>
        <span>Workspace</span>
        <strong>Create workspace</strong>
      </div>
      {onClose === undefined ? null : (
        <button type="button" class="nt-icon-action" aria-label="Close" onClick={onClose}>
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      )}
    </header>
  );
}

/** Plain-folder creation shared by Open Board and Quick Launch. */
export function CreateWorkspaceForm(props: CreateWorkspaceFormProps) {
  const parent = useSignal(props.initialParent);
  const name = useSignal("");
  const pending = useSignal(false);
  const error = useSignal<string | null>(null);

  const pickParent = async (): Promise<void> => {
    try {
      const picked = await props.onPickParent();
      if (picked !== null) parent.value = picked;
    } catch (cause: unknown) {
      console.warn("Workspace parent picker failed:", cause);
      error.value = "Couldn't open the folder picker — try again";
    }
  };

  const submit = async (): Promise<void> => {
    const problem = folderNameProblem(name.value);
    if (problem !== null) {
      error.value = problem;
      return;
    }
    pending.value = true;
    error.value = null;
    try {
      const created = await props.create(parent.value, name.value);
      props.onCreated(created.path);
    } catch (cause: unknown) {
      error.value = cause instanceof Error ? cause.message : "Couldn't create the workspace";
    } finally {
      pending.value = false;
    }
  };

  return (
    <section
      class="nt-create-workspace"
      aria-busy={pending.value}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onBack();
      }}
    >
      <FormHeader onBack={props.onBack} onClose={props.onClose} />
      <div class="nt-create-workspace__body">
        <label>
          <span>Parent folder</span>
          <button
            type="button"
            class="nt-create-workspace__folder"
            data-action="pick-parent"
            onClick={() => void pickParent()}
            disabled={pending.value}
          >
            <DeckIcon icon={Folder} size={ROW_ICON} />
            <span data-parent-path>{parent.value || "Choose a parent folder"}</span>
            <span>Choose…</span>
          </button>
        </label>
        <label>
          <span>Folder name</span>
          <input
            type="text"
            aria-label="Folder name"
            value={name.value}
            disabled={pending.value}
            autoFocus
            onInput={(event) => {
              name.value = event.currentTarget.value;
              error.value = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </label>
        <p>Creates an empty folder. No Git repository or starter files are added.</p>
        {error.value === null ? null : <p role="alert">{error.value}</p>}
      </div>
      <footer class="nt-create-workspace__foot">
        <button type="button" class="nt-secondary-action" onClick={props.onBack}>
          Cancel
        </button>
        <button
          type="button"
          class="nt-primary-action"
          data-action="create-workspace"
          disabled={pending.value || parent.value.trim() === "" || name.value.trim() === ""}
          onClick={() => void submit()}
        >
          Create workspace
          <DeckIcon icon={ArrowUp} size={ROW_ICON} />
        </button>
      </footer>
    </section>
  );
}
