import { Plus, Trash2 } from "lucide-preact";
import type { Signal } from "@preact/signals";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { countLeaves } from "../lib/split-tree";
import { isBuiltIn, type Preset } from "../lib/preset-schema";
import { PresetThumb } from "../presets/preset-thumb";

export interface LayoutSectionProps {
  readonly presets: readonly Preset[];
  readonly focused: boolean;
  readonly selectedPresetId: Signal<string>;
  readonly renamingId: Signal<string | null>;
  readonly renameValue: Signal<string>;
  readonly confirmDeleteId: Signal<string | null>;
  onFocusSection(): void;
  onDoubleClickOpen(): void;
  onStartRename(preset: Preset): void;
  onCommitRename(): void;
  onOpenConfirmDelete(preset: Preset): void;
  onDeletePreset(preset: Preset): void;
  onNewPreset(): void;
}

/** The board's Layout section — one card per preset, plus New Layout. */
export function OpenBoardLayoutSection({
  presets,
  focused,
  selectedPresetId,
  renamingId,
  renameValue,
  confirmDeleteId,
  onFocusSection,
  onDoubleClickOpen,
  onStartRename,
  onCommitRename,
  onOpenConfirmDelete,
  onDeletePreset,
  onNewPreset,
}: LayoutSectionProps) {
  return (
    <section class={`sect ${focused ? "is-focused" : ""}`}>
      <div class="sect__head">
        <h2 class="sect__title">Layout</h2>
        <span class="sect__hint">Hover a card to rename or delete</span>
      </div>
      <div class="lgrid">
        {presets.map((preset) => (
          <div
            key={preset.id}
            class={`lcard ${preset.id === selectedPresetId.value ? "is-selected" : ""}`}
            title={`${countLeaves(preset.layout)} ${countLeaves(preset.layout) === 1 ? "pane" : "panes"}${preset.cwds ? " · cwds" : ""}`}
            onClick={() => {
              selectedPresetId.value = preset.id;
              onFocusSection();
            }}
            onDblClick={onDoubleClickOpen}
            onContextMenu={(event) => {
              event.preventDefault();
              onStartRename(preset);
            }}
          >
            {isBuiltIn(preset) ? (
              <span class="builtin" title="Built-in preset">
                •
              </span>
            ) : null}
            <PresetThumb layout={preset.layout} />
            <span class="lcard__foot">
              {renamingId.value === preset.id ? (
                <input
                  class="lcard__rename"
                  value={renameValue.value}
                  ref={(el) => el?.focus()}
                  onInput={(event) => {
                    renameValue.value = (
                      event.target as HTMLInputElement
                    ).value;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onCommitRename();
                    }
                    if (event.key === "Escape") {
                      renamingId.value = null;
                    }
                    event.stopPropagation();
                  }}
                  onBlur={onCommitRename}
                />
              ) : (
                <span class="lcard__name">{preset.name}</span>
              )}
              <span class="lcard__n">{countLeaves(preset.layout)}</span>
            </span>
            {!isBuiltIn(preset) ? (
              // Tools stop dblclick too — two rapid clicks would otherwise
              // bubble to the card's onDblClick and open.
              <span
                class="lcard__tools"
                onDblClick={(event) => event.stopPropagation()}
              >
                <button
                  aria-label={`Rename ${preset.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartRename(preset);
                  }}
                >
                  ✎
                </button>
                <button
                  class="x"
                  aria-label={`Delete ${preset.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenConfirmDelete(preset);
                  }}
                >
                  <DeckIcon icon={Trash2} size={ROW_ICON} />
                </button>
              </span>
            ) : null}
            {confirmDeleteId.value === preset.id ? (
              <span
                class="lcard__confirm"
                onDblClick={(event) => event.stopPropagation()}
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeletePreset(preset);
                  }}
                >
                  delete
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmDeleteId.value = null;
                  }}
                >
                  keep
                </button>
              </span>
            ) : null}
          </div>
        ))}
        <button class="lcard lcard--new" onClick={onNewPreset}>
          <span>
            <DeckIcon icon={Plus} size={ROW_ICON} />
            New Layout
          </span>
          <small>From current window</small>
        </button>
      </div>
    </section>
  );
}
