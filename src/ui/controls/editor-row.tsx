import {
  EDITOR_PRESETS,
  isEditorId,
  type EditorId,
} from "../../lib/editor-command";
import { CommitInput } from "./commit-input";
import { ConfigRow } from "./config-row";
import { primaryModifierName } from "../../lib/shortcut-label";
import { ChevronDown } from "lucide-preact";
import { DeckIcon, ROW_ICON } from "./deck-icon";

interface EditorRowProps {
  value: EditorId;
  command: string;
  onChange: (id: EditorId) => void;
  onCommandChange: (command: string) => void;
}

/** menu value kind (DL-6), plus an inline command row when "custom…" is picked. */
export function EditorRow({
  value,
  command,
  onChange,
  onCommandChange,
}: EditorRowProps) {
  const label =
    EDITOR_PRESETS.find((preset) => preset.id === value)?.label ?? value;

  return (
    <>
      <ConfigRow
        label="Editor"
        desc={`${primaryModifierName()}+click a file path`}
      >
        <span class="cfg-btn cfg-btn--overlay">
          <span class="cfg-btn__text">{label}</span>
          <span class="cfg-btn__hint">
            <DeckIcon icon={ChevronDown} size={ROW_ICON} />
          </span>
          <select
            value={value}
            aria-label="Editor"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (isEditorId(next)) {
                onChange(next);
              }
            }}
          >
            {EDITOR_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </span>
      </ConfigRow>
      {value === "custom" && (
        <div class="cfg-custom">
          <CommitInput
            value={command}
            placeholder="e.g. vim +{line} {file}"
            ariaLabel="Custom editor command"
            onCommit={onCommandChange}
          />
        </div>
      )}
    </>
  );
}
