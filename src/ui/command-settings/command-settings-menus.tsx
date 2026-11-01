import { useEffect, useMemo, useState } from "preact/hooks";
import { externalApp, isExternalAppId, type ExternalAppId } from "../../lib/external-app-catalog";
import { getDesktopEnvironment } from "../../lib/platform";
import { externalAppChoices, groupExternalApps } from "../../links/external-app-choices";
import {
  ensureExternalAppsScanned,
  externalAppsScanned,
  installedExternalApps,
} from "../../links/external-apps-store";
import { updateSettings } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { NOT_AVAILABLE_ON_WINDOWS } from "../controls/config-row";
import { detectInstalledFonts, fontCandidates } from "../controls/font-row";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../controls/select";
import { GROUP_LABELS } from "../settings/sections/links-editor-section";
import { CommitField } from "./command-settings-field";

interface MenuProps {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
}

const CUSTOM_FONT = "__custom__";

/**
 * The installed monospace faces, then "Custom…" for a family the list does not know. The same
 * detection and the same rule as `font-row.tsx`: the saved family stays listed when it is a known
 * candidate, and one that is neither listed nor known opens the custom field.
 */
export function FontMenu({ label, value, disabled }: MenuProps) {
  /* oxlint-disable react-hooks/exhaustive-deps -- detection runs once per mount; re-running per value would re-scan */
  const available = useMemo(() => {
    const detected = detectInstalledFonts();
    return !detected.includes(value) && fontCandidates().includes(value)
      ? [value, ...detected]
      : detected;
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */
  const [custom, setCustom] = useState(() => !available.includes(value));
  const shown = custom || !available.includes(value) ? CUSTOM_FONT : value;
  const items = [
    ...available.map((family) => ({ value: family, label: family })),
    { value: CUSTOM_FONT, label: "Custom…" },
  ];
  return (
    <span className="flex flex-col items-end gap-1.5">
      <Select
        items={items}
        value={shown}
        disabled={disabled}
        onValueChange={(next: unknown) => {
          if (next === CUSTOM_FONT) {
            setCustom(true);
          } else if (typeof next === "string") {
            setCustom(false);
            updateSettings({ fontFamily: next });
          }
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {shown === CUSTOM_FONT ? (
        <CommitField
          aria-label="Custom font name"
          className="w-64"
          disabled={disabled}
          placeholder='e.g. "Iosevka", monospace'
          value={value}
          onCommit={(fontFamily) => updateSettings({ fontFamily })}
        />
      ) : null}
    </span>
  );
}

/**
 * Where a path outside the open workspaces goes. The list is what the host found installed, shown
 * in its groups; a saved app that has left the machine stays visible under "Not installed". Off
 * macOS the host cannot open other apps, so the row keeps its place and its reason instead.
 */
export function AppMenu({ label, value, disabled }: MenuProps) {
  useEffect(() => {
    void ensureExternalAppsScanned();
  }, []);
  const choices = externalAppChoices(installedExternalApps.value, externalAppsScanned.value);
  const groups = groupExternalApps(choices);
  const missing = choices.some((choice) => choice.id === value)
    ? null
    : externalApp(value as ExternalAppId);
  const items = [
    ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
    ...(missing === null ? [] : [{ value: missing.id, label: missing.label }]),
  ];
  if (getDesktopEnvironment().platform === "windows") {
    // aria-disabled, not disabled: the reason stays reachable by keyboard (DL-23.6).
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={label}
        aria-disabled="true"
        title={NOT_AVAILABLE_ON_WINDOWS}
      >
        {items.find((item) => item.value === value)?.label ?? value}
      </Button>
    );
  }
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next: unknown) => {
        if (isExternalAppId(next)) updateSettings({ externalAppId: next });
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {groups.map((view) => (
          <SelectGroup key={view.group}>
            <SelectLabel>{GROUP_LABELS[view.group]}</SelectLabel>
            {view.items.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {missing === null ? null : (
          <SelectGroup>
            <SelectLabel>Not installed</SelectLabel>
            <SelectItem value={missing.id}>{missing.label}</SelectItem>
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
