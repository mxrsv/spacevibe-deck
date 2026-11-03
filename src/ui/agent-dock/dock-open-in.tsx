import { ArrowDown01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { Fragment } from "preact";
import { groupExternalApps, type ExternalAppChoice } from "../../links/external-app-choices";
import type { ExternalAppId } from "../../lib/external-app-catalog";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";

/** What `App` hands the breadcrumb row: the installed apps and the one field Settings writes. */
export interface DockOpenInApps {
  /** Installed apps only; empty where the host cannot answer, and the control is then absent. */
  readonly choices: readonly ExternalAppChoice[];
  readonly selected: ExternalAppId | null;
  onOpen(path: string, app: ExternalAppId): void;
  onSelect(app: ExternalAppId): void;
}

/**
 * The breadcrumb row's open-in split button (DOCK-7, DL-23.11's shape): the icon hands the file
 * to the chosen app, the caret changes which app that is. The two halves share one hairline
 * frame with no gap, the caret narrower than the action. Absent, not disabled, when nothing is
 * installed (DL-19.7), as the toolbar's own split button is.
 */
export function DockOpenIn({
  path,
  apps,
}: {
  readonly path: string;
  readonly apps: DockOpenInApps;
}) {
  const current = apps.choices.find((choice) => choice.id === apps.selected) ?? apps.choices[0];
  if (current === undefined) {
    return null;
  }
  const label = `Open in ${current.label}`;
  return (
    <div className="flex shrink-0 items-center rounded-md border border-control-frame">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="rounded-r-none text-muted-foreground"
              onClick={() => apps.onOpen(path, current.id)}
            />
          }
        >
          <DeckIcon icon={LinkSquare02Icon} />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Choose which app opens a path"
              className="w-4 rounded-l-none text-muted-foreground"
            />
          }
        >
          <DeckIcon icon={ArrowDown01Icon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={(value: unknown) => apps.onSelect(value as ExternalAppId)}
          >
            {groupExternalApps(apps.choices).map((group, index) => (
              <Fragment key={group.group}>
                {index === 0 ? null : <DropdownMenuSeparator />}
                {group.items.map((choice) => (
                  <DropdownMenuRadioItem key={choice.id} value={choice.id}>
                    {choice.label}
                  </DropdownMenuRadioItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
