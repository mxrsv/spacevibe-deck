import {
  ArrowDown01Icon,
  Folder01Icon,
  FolderAddIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { tildify } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import { DeckIcon, GLYPH_ROW, type DeckGlyph } from "../ui/controls/deck-icon";

/** A row beside `Open folder…`: another way to reach a workspace or the board's other screens. */
export interface WorkspacePickerAction {
  readonly id: string;
  readonly label: string;
  readonly icon: DeckGlyph;
  readonly onActivate: () => void;
}

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
  /** Rows after `Open folder…`, at the same level and in the same menu. */
  readonly actions?: readonly WorkspacePickerAction[];
  /** The board shows `Open folder…` as a button of its own, so the menu leaves it out. */
  readonly hideOpenFolder?: boolean;
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
        <DeckIcon icon={Folder01Icon} size={GLYPH_ROW} />
        <span>{current}</span>
        <DeckIcon icon={ArrowDown01Icon} size={GLYPH_ROW} />
      </button>
      {open.value && !props.disabled ? (
        <div class="nt-workspace-picker__menu" role="menu" aria-label="Choose a folder">
          {props.hideOpenFolder === true ? null : (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => activate(props.onPickFolder)}
            >
              <DeckIcon icon={FolderAddIcon} size={GLYPH_ROW} />
              <span class="nt-workspace-picker__name">Open folder…</span>
            </button>
          )}
          {props.actions?.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => activate(action.onActivate)}
            >
              <DeckIcon icon={action.icon} size={GLYPH_ROW} />
              <span class="nt-workspace-picker__name">{action.label}</span>
            </button>
          ))}
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
                <DeckIcon icon={Folder01Icon} size={GLYPH_ROW} />
                <span class="nt-workspace-picker__name">{labels[index]}</span>
                {shared ? (
                  <span class="nt-workspace-picker__detail">{tildify(path, props.homeDir)}</span>
                ) : null}
                {selected ? <DeckIcon icon={Tick02Icon} size={GLYPH_ROW} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
