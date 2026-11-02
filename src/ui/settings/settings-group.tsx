import type { ComponentChildren } from "preact";
import { isMarkedChanged } from "../../settings/settings-changes";
import { SETTINGS_REGISTRY } from "../../settings/settings-registry";
import type { Settings } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";

interface SettingsGroupProps {
  readonly description?: string;
  readonly children: ComponentChildren;
}

/**
 * DL-11.6: Studio groups share the existing settings controls. A group that
 * IS one setting (the theme cards) names it with `settingKey`: the title
 * then comes from the registry and carries the same changed mark a row would.
 */
export function SettingsGroup(
  props: SettingsGroupProps &
    (
      | { readonly settingKey: keyof Settings; readonly title?: undefined }
      | { readonly settingKey?: undefined; readonly title?: string }
    ),
) {
  const { description, children, settingKey } = props;
  const title = settingKey === undefined ? props.title : SETTINGS_REGISTRY[settingKey].label;
  const changed = settingKey !== undefined && isMarkedChanged(settings.value, settingKey);
  return (
    <section class="settings-group" data-setting={settingKey}>
      {title && (
        <header class={`settings-group__head ${changed ? "is-changed" : ""}`}>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </header>
      )}
      <div class="settings-group__body">{children}</div>
    </section>
  );
}
