import { cn } from "@/lib/cn";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { DEFAULT_SETTINGS, type Settings } from "../../settings/settings-schema";
import { settingRow } from "../../settings/settings-rows";
import { resetSettingsKeys } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { SettingControl } from "./command-settings-controls";
import { LIVE_ROW_ATTRIBUTE, rowDomId } from "./command-settings-live";
import { commandActiveKey } from "./command-settings-state";
import { settingValueText } from "./command-settings-view";

interface RowShellProps {
  readonly itemKey: string;
  readonly active: boolean;
  readonly changed: boolean;
  /** Text, or a node that truncates itself (an agent's mark, name and state). */
  readonly label: ComponentChildren;
  /** The area's name, shown where no heading names it. */
  readonly crumb: string | null;
  readonly control: ComponentChildren;
  readonly reset: ComponentChildren;
  /** Full-width content under the row, such as a conflict. */
  readonly below?: ComponentChildren;
}

/**
 * The frame every live row shares: a changed mark, the label, the control in place and a reset
 * slot. The row is a plain container; its control owns the keyboard.
 */
export function RowShell({
  itemKey,
  active,
  changed,
  label,
  crumb,
  control,
  reset,
  below,
}: RowShellProps) {
  return (
    <li
      id={rowDomId(itemKey)}
      {...{ [LIVE_ROW_ATTRIBUTE]: "" }}
      data-active={active || undefined}
      aria-current={active || undefined}
      onPointerMove={() => {
        if (commandActiveKey.peek() !== itemKey) commandActiveKey.value = itemKey;
      }}
      className={cn(
        "grid min-h-9 grid-cols-[8px_minmax(0,1fr)_auto_28px] items-center gap-x-2.5 rounded-md px-2.5 py-1 text-xs text-foreground",
        active && "bg-muted",
      )}
    >
      <span className="flex justify-center">
        {changed ? (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            <span className="sr-only">Changed</span>
          </>
        ) : null}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        {typeof label === "string" ? <span className="truncate">{label}</span> : label}
        {crumb ? <span className="shrink-0 text-muted-foreground">{crumb}</span> : null}
      </span>
      <span className="flex items-center justify-end gap-2">{control}</span>
      <span className="flex justify-end">{reset}</span>
      {below ? <div className="col-span-4 pb-1.5 pl-[18px]">{below}</div> : null}
    </li>
  );
}

interface RowResetProps {
  /** What is reset, for the accessible name. */
  readonly label: string;
  /** The default, as the row would print it. */
  readonly to: string;
  readonly locked: boolean;
  readonly onReset: () => void;
}

export function RowReset({ label, to, locked, onReset }: RowResetProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={locked}
            aria-label={`Reset ${label} to ${to}`}
            onClick={onReset}
          />
        }
      >
        <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
      </TooltipTrigger>
      <TooltipContent>Reset to {to}</TooltipContent>
    </Tooltip>
  );
}

interface LiveRowProps {
  readonly itemKey: string;
  readonly settingKey: keyof Settings;
  readonly settings: Settings;
  readonly crumb: string | null;
  readonly active: boolean;
  /** The settings snapshot is still loading. */
  readonly locked: boolean;
}

/** One setting as a row: its control in place and, once the value differs from its default, a reset. */
export function LiveRow({ itemKey, settingKey, settings, crumb, active, locked }: LiveRowProps) {
  const row = settingRow(settingKey, settings);
  const keys = row.changed && row.resetKeys !== null ? row.resetKeys : null;
  return (
    <RowShell
      itemKey={itemKey}
      active={active}
      changed={row.changed}
      label={row.label}
      crumb={crumb}
      control={<SettingControl row={row} disabled={locked} />}
      reset={
        keys === null ? null : (
          <RowReset
            label={row.label}
            to={settingValueText(settingKey, DEFAULT_SETTINGS)}
            locked={locked}
            onReset={() => resetSettingsKeys(keys)}
          />
        )
      }
    />
  );
}
