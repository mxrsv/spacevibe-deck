import { settings, updateSettings } from '../../../settings/settings-store';
import { EditorRow } from '../../controls/editor-row';

export function LinksEditorSection() {
  const current = settings.value;

  return (
    <EditorRow
      value={current.editorId}
      command={current.editorCommand}
      onChange={(editorId) => updateSettings({ editorId })}
      onCommandChange={(editorCommand) => updateSettings({ editorCommand })}
    />
  );
}
