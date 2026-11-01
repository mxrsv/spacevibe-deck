import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Settings } from "../../settings/settings-schema";
import { isMarkedChanged, marksChange } from "../../settings/settings-changes";
import { SETTINGS_REGISTRY } from "../../settings/settings-registry";
import { settings } from "../../settings/settings-store";
import { searchSettings } from "../../settings/settings-search";
import { settingsQuery, settingsTarget } from "../settings/settings-focus-store";
import { Switch } from "./switch";

/**
 * The tooltip on a row whose control the Windows host cannot back. The row
 * keeps its place and takes `aria-disabled` rather than `disabled`, so the
 * reason stays reachable by keyboard (DL-23.6); the tooltip carries the reason
 * instead of a sentence in the row (the minimal-text rule).
 */
export const NOT_AVAILABLE_ON_WINDOWS = "Not available on Windows";

/** Lowercase group label above a run of config rows (DL-4.2). */
export function ConfigGroup({ label }: { label: string }) {
  return <div class="cfg-group">{label}</div>;
}

type SettingKey = keyof Settings;

/**
 * Which setting a row speaks for. A `settingKey` row edits the whole key and
 * reads its text and its changed mark from the registry; an `entryOf` row
 * edits one agent's entry of a map key, so it names itself and says whether
 * its own entry changed; a plain row is not a setting.
 */
type RowIdentity =
  | {
      readonly settingKey: SettingKey;
      readonly entryOf?: undefined;
      readonly label?: undefined;
      readonly changed?: undefined;
    }
  | {
      readonly entryOf: SettingKey;
      readonly settingKey?: undefined;
      readonly label: string;
      /** Omit for a data key: only preference keys carry a mark. */
      readonly changed?: boolean;
    }
  | {
      readonly settingKey?: undefined;
      readonly entryOf?: undefined;
      readonly label: string;
      readonly changed?: undefined;
    };

type ConfigRowProps = RowIdentity & {
  /** Optional one-line lowercase description under the key. */
  desc?: string;
  /** A control under the key, where `desc` would sit; the value slot keeps its one control. */
  note?: ComponentChildren;
  danger?: boolean;
  /** The single interactive value (plus an optional clear button, DL-6.1). */
  children: ComponentChildren;
};

/** The one control: key (+ desc) left, one interactive value right (DL-5). */
export function ConfigRow(props: ConfigRowProps) {
  const { desc, note, danger, children } = props;
  const key = props.settingKey ?? props.entryOf;
  const label =
    props.settingKey === undefined ? props.label : SETTINGS_REGISTRY[props.settingKey].label;
  const ref = useRef<HTMLDivElement>(null);
  const isTarget = key !== undefined && settingsTarget.value === key;
  const isMatch = key !== undefined && searchSettings(settingsQuery.value).keys.has(key);
  const changed =
    props.settingKey !== undefined
      ? isMarkedChanged(settings.value, props.settingKey)
      : props.entryOf !== undefined && marksChange(props.entryOf, props.changed === true);
  useEffect(() => {
    if (isTarget) {
      ref.current?.scrollIntoView({ block: "center" });
    }
  }, [isTarget]);
  return (
    <div
      ref={ref}
      class={`cfg-row ${isMatch ? "is-match" : ""} ${isTarget ? "is-target" : ""} ${changed ? "is-changed" : ""}`}
      data-setting={key}
    >
      <div class="cfg-row__key">
        <span class={`cfg-row__label ${danger ? "cfg-row__label--danger" : ""}`}>{label}</span>
        {desc !== undefined && <span class="cfg-row__desc">{desc}</span>}
        {note != null && <div class="cfg-row__note">{note}</div>}
      </div>
      <div class="cfg-row__value">{children}</div>
    </div>
  );
}

type ToggleRowProps = (
  | { readonly settingKey: SettingKey; readonly label?: undefined }
  | { readonly settingKey?: undefined; readonly label: string }
) & {
  desc?: string;
  note?: ComponentChildren;
  checked: boolean;
  onToggle: () => void;
  /** Disables the switch (real enforcement, not just styling); default false. */
  disabled?: boolean;
};

/** A setting that is on or off: the shared switch, one click flips it. */
export function ToggleRow({
  desc,
  note,
  checked,
  onToggle,
  disabled,
  ...identity
}: ToggleRowProps) {
  const label =
    identity.settingKey === undefined
      ? identity.label
      : SETTINGS_REGISTRY[identity.settingKey].label;
  return (
    <ConfigRow {...identity} desc={desc} note={note}>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle()}
      />
    </ConfigRow>
  );
}
