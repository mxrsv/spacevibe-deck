import { SlidersHorizontal } from "@phosphor-icons/react";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import type { RailGrouping, RailSorting } from "../rail-view-state";
import { RailPopupGuard, Tip } from "./project-rail-menu-parts";
import { railViewState, setRailGrouping, setRailSorting, showArchived } from "./project-rail-state";

const GROUPING_LABEL: Readonly<Record<RailGrouping, string>> = {
  project: "By project",
  status: "By status",
  time: "By time",
};

const SORTING_LABEL: Readonly<Record<RailSorting, string>> = {
  updated: "Last updated",
  priority: "Priority",
};

function keysOf<K extends string>(labels: Readonly<Record<K, string>>): K[] {
  return Object.keys(labels) as K[];
}

/** Group by, sort by and "Show archived" (LAY-3); the choices are the rail's session marks. */
export function ProjectRailOrganize() {
  const { grouping, sorting } = railViewState.value;
  return (
    <DropdownMenu>
      <Tip
        label="Organize"
        button={
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Organize" />}
          />
        }
      >
        <DeckIcon icon={SlidersHorizontal} size={ROW_ICON} />
      </Tip>
      <DropdownMenuContent align="end" className="min-w-44">
        <RailPopupGuard />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={grouping}
            onValueChange={(value: string) => setRailGrouping(value as RailGrouping)}
          >
            {keysOf(GROUPING_LABEL).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {GROUPING_LABEL[key]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sorting}
            onValueChange={(value: string) => setRailSorting(value as RailSorting)}
          >
            {keysOf(SORTING_LABEL).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {SORTING_LABEL[key]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showArchived.value}
          onCheckedChange={(checked: boolean) => (showArchived.value = checked)}
        >
          Show archived
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
