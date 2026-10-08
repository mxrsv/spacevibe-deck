import { CaretDown, Check, Folder, FolderPlus } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { tildify } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";

interface WorkspacePickerProps {
  /** The selected folder; null prints the empty prompt. */
  readonly value: string | null;
  /** Recent folders, newest first. */
  readonly paths: readonly string[];
  readonly homeDir: string;
  /** Row names that differ from the folder's own (a project row names its project). */
  readonly labels?: ReadonlyMap<string, string>;
  readonly disabled: boolean;
  /** Fills the Workspace field. NEVER launches. */
  readonly onSelect: (path: string) => void | Promise<void>;
  readonly onPickFolder: () => void;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** Recents in order, one row per full path; a selection outside them leads. */
function pickerPaths(value: string | null, paths: readonly string[]): readonly string[] {
  const recents = Array.from(new Set(paths));
  return value === null || recents.includes(value) ? recents : [value, ...recents];
}

/**
 * DL-13.1 / DL-13.3: the board's folder choice as a popover of rows. It owns
 * only whether it is open and where focus sits; selection, the native dialog
 * and every launch stay with the board.
 */
export function WorkspacePicker(props: WorkspacePickerProps) {
  const open = useSignal(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const paths = pickerPaths(props.value, props.paths);
  const labelOf = (path: string): string => props.labels?.get(path) ?? workspaceLabel(path);
  const labels = paths.map(labelOf);
  const current = props.value === null ? "Choose a folder" : labelOf(props.value);
  const menuRows = (): HTMLButtonElement[] =>
    Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);

  // Focus moves in only when the menu opens, never when a selection resolves.
  useLayoutEffect(() => {
    if (!open.value) return;
    const selected = root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected ?? menuRows()[0])?.focus();
  }, [open.value]);

  useEffect(() => {
    if (!open.value) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        open.value = false;
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open.value, open]);

  // A busy board unmounts the menu under the focused row; hand focus back to
  // the trigger so the board's Escape and ⌘O keep answering.
  /* oxlint-disable react-hooks/exhaustive-deps -- `close` only touches the stable signal and ref */
  useEffect(() => {
    if (props.disabled && open.peek()) close();
  }, [props.disabled, open]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  function close(): void {
    open.value = false;
    trigger.current?.focus();
  }

  function activate(action: () => void): void {
    if (props.disabled) return;
    close();
    action();
  }

  function navigate(event: KeyboardEvent): void {
    if (!open.value) return;
    if (event.key === "Escape") {
      // The board cancels itself on a bare Escape; the menu answers it first.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!NAV_KEYS.has(event.key)) return;
    event.preventDefault();
    const rows = menuRows();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  }

  return (
    <div
      class="nt-workspace-picker"
      ref={root}
      onKeyDown={navigate}
      onFocusOut={(event) => {
        if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) {
          open.value = false;
        }
      }}
    >
      <button
        type="button"
        class="nt-workspace-picker__trigger"
        ref={trigger}
        aria-label={`Workspace: ${current}`}
        aria-haspopup="menu"
        aria-expanded={open.value}
        title={props.value ?? undefined}
        // Not native `disabled`: a selection turns the board busy while the
        // trigger holds focus, and a disabled button drops it to <body>.
        aria-disabled={props.disabled}
        onClick={() => {
          if (!props.disabled) open.value = !open.value;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open.value && !props.disabled) {
            event.preventDefault();
            event.stopPropagation();
            open.value = true;
          }
        }}
      >
        <DeckIcon icon={Folder} size={ROW_ICON} />
        <span>{current}</span>
        <DeckIcon icon={CaretDown} size={ROW_ICON} />
      </button>
      {open.value && !props.disabled ? (
        <div class="nt-workspace-picker__menu" role="menu" aria-label="Choose a folder">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => activate(props.onPickFolder)}
          >
            <DeckIcon icon={FolderPlus} size={ROW_ICON} />
            <span class="nt-workspace-picker__name">Open folder…</span>
          </button>
          {paths.length > 0 ? (
            <div class="nt-workspace-picker__separator" role="separator" />
          ) : null}
          {paths.map((path, index) => {
            const selected = path === props.value;
            // Two folders with one name print where they live, or they read as one.
            const shared = labels.indexOf(labels[index]) !== labels.lastIndexOf(labels[index]);
            return (
              <button
                key={path}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                title={path}
                onClick={() => activate(() => void props.onSelect(path))}
              >
                <DeckIcon icon={Folder} size={ROW_ICON} />
                <span class="nt-workspace-picker__name">{labels[index]}</span>
                {shared ? (
                  <span class="nt-workspace-picker__detail">{tildify(path, props.homeDir)}</span>
                ) : null}
                {selected ? <DeckIcon icon={Check} size={ROW_ICON} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
