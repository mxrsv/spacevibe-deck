import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Preset } from "../lib/preset-schema";

export type SaveTarget =
  | { kind: "new"; name: string }
  | { kind: "overwrite"; id: string };

export interface SavePresetDialogProps {
  existing: readonly Preset[];
  onCancel(): void;
  onSave(target: SaveTarget, includeCwds: boolean): void;
}

export function SavePresetDialog({
  existing,
  onCancel,
  onSave,
}: SavePresetDialogProps) {
  const name = useSignal("");
  const overwriteId = useSignal<string | null>(null);
  const includeCwds = useSignal(true); // default on
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.querySelector("input")?.focus();
  }, []);

  const target: SaveTarget | null =
    overwriteId.value !== null
      ? { kind: "overwrite", id: overwriteId.value }
      : name.value.trim() !== ""
        ? { kind: "new", name: name.value.trim() }
        : null;

  function confirm(): void {
    if (target !== null) {
      onSave(target, includeCwds.value);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      confirm();
    } else if (event.key === "Escape") {
      onCancel();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim">
      <div
        class="save-preset"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={containerRef}
      >
        <h1>Save layout as preset</h1>
        <label class="save-preset__row">
          <span>Save as new</span>
          <input
            placeholder="Preset name"
            value={name.value}
            onInput={(event) => {
              name.value = (event.target as HTMLInputElement).value;
              overwriteId.value = null;
            }}
          />
        </label>
        {existing.length > 0 ? (
          <label class="save-preset__row">
            <span>Or overwrite</span>
            <select
              value={overwriteId.value ?? ""}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                overwriteId.value = value === "" ? null : value;
              }}
            >
              <option value="">—</option>
              {existing.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label class="save-preset__toggle">
          <input
            type="checkbox"
            checked={includeCwds.value}
            onChange={(event) => {
              includeCwds.value = (event.target as HTMLInputElement).checked;
            }}
          />
          Include per-pane folders
        </label>
        <div class="save-preset__actions">
          <button onClick={onCancel}>Cancel</button>
          <button class="is-primary" disabled={target === null} onClick={confirm}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
