import { HugeiconsIcon } from "@hugeicons/react";
import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "../../../../ui/controls/button";
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
} from "../../../../ui/controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { SECTION_LABEL, SECTION_ORDER, type InboxSectionId } from "../../option-inbox-model";
import {
  matchesQuery,
  ordered,
  type Grouping,
  type RailState,
  type Sorting,
  type Thread,
} from "./rail-option-c-model";
import { ThreadRow } from "./rail-option-c-row";

const GROUPING_LABEL: Readonly<Record<Grouping, string>> = {
  project: "By project",
  status: "By status",
  time: "By time",
};
const SORTING_LABEL: Readonly<Record<Sorting, string>> = {
  recent: "Last updated",
  priority: "Priority",
};

export interface FlatGroup {
  readonly key: string;
  readonly label: string;
  readonly threads: readonly Thread[];
}

function sectionOfState(state: Thread["state"]): InboxSectionId {
  if (state === "failed" || state === "needs-you") return "needs";
  if (state === "unchecked") return "unread";
  return state === "working" ? "working" : "quiet";
}

const TIME_BUCKETS = [
  { key: "t1", label: "Last 5 minutes", max: 5 },
  { key: "t2", label: "Last 15 minutes", max: 15 },
  { key: "t3", label: "Earlier", max: Number.POSITIVE_INFINITY },
] as const;

/** The status and time groupings of every shown project's threads, empty groups left out. */
export function flatGroups(state: RailState): FlatGroup[] {
  const hidden = new Set(state.projects.value.filter((p) => p.hidden).map((p) => p.id));
  const all = ordered(
    state.threads.value.filter((t) => !hidden.has(t.projectId)),
    state.sorting.value,
  ).filter((t) => matchesQuery(t, state));
  const groups: FlatGroup[] =
    state.grouping.value === "status"
      ? SECTION_ORDER.map((id) => ({
          key: id,
          label: SECTION_LABEL[id],
          threads: all.filter((t) => sectionOfState(t.state) === id),
        }))
      : TIME_BUCKETS.map((bucket, at) => ({
          key: bucket.key,
          label: bucket.label,
          threads: all.filter(
            (t) => t.mins < bucket.max && t.mins >= (TIME_BUCKETS[at - 1]?.max ?? 0),
          ),
        }));
  return groups.filter((group) => group.threads.length > 0);
}

export function OrganizeMenu({ state }: { readonly state: RailState }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Organize" />}
              >
                <HugeiconsIcon icon={FilterHorizontalIcon} strokeWidth={2} aria-hidden="true" />
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent>Organize</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={state.grouping.value}
            onValueChange={(value: string) => (state.grouping.value = value as Grouping)}
          >
            {(Object.keys(GROUPING_LABEL) as Grouping[]).map((key) => (
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
            value={state.sorting.value}
            onValueChange={(value: string) => (state.sorting.value = value as Sorting)}
          >
            {(Object.keys(SORTING_LABEL) as Sorting[]).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {SORTING_LABEL[key]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={state.archivedOpen.value}
          onCheckedChange={(checked: boolean) => (state.archivedOpen.value = checked)}
        >
          Show archived
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Status or time grouping: plain headers with a count, rows naming their project. */
export function FlatGroups({
  groups,
  state,
  firstTab,
}: {
  readonly groups: readonly FlatGroup[];
  readonly state: RailState;
  readonly firstTab: string | null;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="m-0 mx-3.5 mt-3 mb-0.5 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            {group.label}
            <span className="tabular-nums">{group.threads.length}</span>
          </h3>
          {group.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              state={state}
              tabStop={firstTab === thread.id}
              projectName={state.projectOf(thread.projectId)?.name}
            />
          ))}
        </section>
      ))}
    </>
  );
}
