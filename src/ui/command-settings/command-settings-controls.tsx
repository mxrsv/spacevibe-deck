import type { ComponentChild } from "preact";
import { quickAgentChoices } from "../../settings/quick-agent-choices";
import type { SettingRow } from "../../settings/settings-rows";
import type { Settings } from "../../settings/settings-schema";
import { updateSettings } from "../../settings/settings-store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../controls/select";
import { Switch } from "../controls/switch";
import { ToggleGroup, ToggleGroupItem } from "../controls/toggle-group";
import { CommitField } from "./command-settings-field";
import { AppMenu, FontMenu } from "./command-settings-menus";
import { NotificationsControl } from "./command-settings-notifications";

/** Two or three options sit side by side; more open a menu (DL-6.5). */
const SEGMENT_LIMIT = 3;

interface ControlProps {
  readonly row: SettingRow;
  /** The settings snapshot is still loading: every control is inert, whatever element it is. */
  readonly disabled: boolean;
}

/** One write, through the store, exactly as the legacy rows do. */
function write(key: keyof Settings, value: unknown): void {
  // The value comes from a control built from the key's own `SETTING_CONTROLS` entry.
  updateSettings({ [key]: value } as Partial<Settings>);
}

function ChoiceControl({ row, disabled }: ControlProps) {
  if (row.control.kind !== "choice") {
    return null;
  }
  const choices = row.control.choices;
  if (choices.length <= SEGMENT_LIMIT) {
    return (
      <ToggleGroup
        aria-label={row.label}
        variant="outline"
        size="sm"
        spacing={0}
        disabled={disabled}
        value={[String(row.value)]}
        onValueChange={(next: string[]) => {
          // Pressing the chosen segment again reports nothing: keep the value.
          const choice = choices.find((entry) => String(entry.value) === next[0]);
          if (choice !== undefined) write(row.key, choice.value);
        }}
      >
        {choices.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={String(choice.value)}
            aria-label={`${row.label}: ${choice.label}`}
          >
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  // Menu values are strings; the choice found by its string keeps the stored type (a number).
  const items = choices.map((choice) => ({ value: String(choice.value), label: choice.label }));
  return (
    <Select
      items={items}
      value={String(row.value)}
      disabled={disabled}
      onValueChange={(next: unknown) => {
        const choice = choices.find((entry) => String(entry.value) === next);
        if (choice !== undefined) write(row.key, choice.value);
      }}
    >
      <SelectTrigger size="sm" aria-label={row.label}>
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
  );
}

function StepperControl({ row, disabled }: ControlProps) {
  if (row.control.kind !== "stepper") {
    return null;
  }
  const { min, max, step, unit } = row.control;
  return (
    <span className="flex items-center gap-1.5">
      <CommitField
        live
        type="number"
        aria-label={row.label}
        className="w-20"
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={String(row.value)}
        onCommit={(raw) => {
          // Out of range is refused, not clamped: the field shows the saved size again.
          const size = Number(raw);
          if (!Number.isInteger(size) || size < min || size > max) return false;
          write(row.key, size);
        }}
      />
      <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}

/** The control a row edits its key with; null where a legacy piece edits it. */
export function SettingControl({ row, disabled }: ControlProps): ComponentChild {
  switch (row.control.kind) {
    case "switch":
      return row.key === "agentNotifications" ? (
        <NotificationsControl label={row.label} checked={row.value === true} disabled={disabled} />
      ) : (
        <Switch
          aria-label={row.label}
          disabled={disabled}
          checked={row.value === true}
          onCheckedChange={(next: boolean) => write(row.key, next)}
        />
      );
    case "choice":
      return <ChoiceControl row={row} disabled={disabled} />;
    case "stepper":
      return <StepperControl row={row} disabled={disabled} />;
    case "text":
      return (
        <CommitField
          aria-label={row.label}
          className="w-64"
          disabled={disabled}
          placeholder={String(row.fallback)}
          value={String(row.value)}
          onCommit={(next) => write(row.key, next)}
        />
      );
    case "pins":
      // Each agent row holds its own pin switch; this row says how many, and resets to automatic.
      return (
        <span className="text-muted-foreground">
          {quickAgentChoices().filter((choice) => choice.pinned).length} pinned
        </span>
      );
    case "menu":
      return row.control.source === "fonts" ? (
        <FontMenu label={row.label} value={String(row.value)} disabled={disabled} />
      ) : (
        <AppMenu label={row.label} value={String(row.value)} disabled={disabled} />
      );
    default:
      return null;
  }
}
