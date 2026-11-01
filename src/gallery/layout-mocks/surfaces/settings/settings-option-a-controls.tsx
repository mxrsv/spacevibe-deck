import { HugeiconsIcon } from "@hugeicons/react";
import { Undo02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../../../ui/controls/button";
import { Input } from "../../../../ui/controls/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../ui/controls/select";
import { Switch } from "../../../../ui/controls/switch";
import { ToggleGroup, ToggleGroupItem } from "../../../../ui/controls/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import type { Choice, MockSetting } from "./settings-data";
import { currentValue, openMenu, setValue, valueOf } from "./settings-option-a-state";

/** Alert rules and sound mean nothing while notifications are off. */
const NEEDS_NOTIFICATIONS = new Set(["turnCompleteAlert", "needsInputAlert", "alertSound"]);

export const ROW_INPUT = "data-a-input";

export function refocusSearch(): void {
  document.getElementById("a-search")?.focus();
}

/** A toggle group for up to three options, a select beyond that. */
export function ChoiceControl({
  label,
  value,
  choices,
  onChange,
  menuKey,
  disabled,
  width = "w-40",
}: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly onChange: (value: string) => void;
  readonly menuKey: string;
  readonly disabled?: boolean;
  readonly width?: string;
}) {
  if (choices.length <= 3) {
    return (
      <ToggleGroup
        aria-label={label}
        variant="outline"
        size="sm"
        spacing={0}
        disabled={disabled}
        value={[value]}
        onValueChange={(next: unknown[]) => {
          if (typeof next[0] === "string") onChange(next[0]);
        }}
      >
        {choices.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            aria-label={`${label}: ${choice.label}`}
          >
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  return (
    <Select
      value={value}
      disabled={disabled}
      open={openMenu.value === menuKey}
      onOpenChange={(next: boolean) => {
        openMenu.value = next ? menuKey : null;
        if (!next) setTimeout(refocusSearch, 0);
      }}
      onValueChange={(next: unknown) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className={width}>
        <SelectValue>
          {(current: string) =>
            choices.find((choice) => choice.value === current)?.label ?? current
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const URL_OK = /^https?:\/\/\S+$/;

/** The live control for one single-key row. */
export function SettingControl({ setting }: { readonly setting: MockSetting }) {
  const { control } = setting;
  const value = currentValue(setting);
  const disabled =
    NEEDS_NOTIFICATIONS.has(String(setting.key)) && valueOf("agentNotifications") === false;
  switch (control.kind) {
    case "switch":
      return (
        <Switch
          aria-label={setting.label}
          disabled={disabled}
          checked={value === true}
          onCheckedChange={(next: boolean) => {
            setValue(setting, next);
            refocusSearch();
          }}
        />
      );
    case "choice":
      return (
        <ChoiceControl
          label={setting.label}
          value={String(value)}
          choices={control.choices}
          disabled={disabled}
          menuKey={String(setting.key)}
          onChange={(next) => {
            setValue(setting, next);
            refocusSearch();
          }}
        />
      );
    case "number":
      return (
        <span className="flex items-center gap-1.5">
          <Input
            {...{ [ROW_INPUT]: String(setting.key) }}
            type="number"
            aria-label={setting.label}
            className="h-6 w-20 text-right tabular-nums"
            min={control.min}
            max={control.max}
            step={control.step}
            value={String(value)}
            onInput={(event: Event) => {
              const next = Number((event.target as HTMLInputElement).value);
              if (Number.isFinite(next) && next >= control.min && next <= control.max) {
                setValue(setting, next);
              }
            }}
          />
          <span className="w-4 text-muted-foreground">{control.unit ?? ""}</span>
        </span>
      );
    case "text": {
      const invalid = !URL_OK.test(String(value));
      return (
        <Input
          {...{ [ROW_INPUT]: String(setting.key) }}
          aria-label={setting.label}
          aria-invalid={invalid}
          className="h-6 w-64"
          value={String(value)}
          onInput={(event: Event) => {
            const next = (event.target as HTMLInputElement).value;
            setValue(setting, next, URL_OK.test(next));
          }}
        />
      );
    }
  }
}

export function ResetButton({
  label,
  to,
  onReset,
}: {
  readonly label: string;
  readonly to: string;
  readonly onReset: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset ${label} to ${to}`}
            onClick={() => {
              onReset();
              refocusSearch();
            }}
          />
        }
      >
        <HugeiconsIcon icon={Undo02Icon} strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent>Reset to {to}</TooltipContent>
    </Tooltip>
  );
}
