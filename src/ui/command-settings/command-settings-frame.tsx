import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { RefObject } from "preact";
import type { CommandAreaId } from "../../settings/command-hits";
import { Badge } from "../controls/badge";
import { Button } from "../controls/button";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { Input } from "../controls/input";
import { Kbd } from "../controls/kbd";
import { ToggleGroup, ToggleGroupItem } from "../controls/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { SETTINGS_CATEGORIES } from "../settings/settings-categories";
import { chooseArea } from "./command-settings-actions";
import { commandQuery } from "./command-settings-state";

interface SearchFieldProps {
  readonly inputRef: RefObject<HTMLInputElement>;
  readonly scope: CommandAreaId | null;
  readonly scopeLabel: string | null;
}

/** The one field: the scope badge and its way out sit in front of the text. */
export function SearchField({ inputRef, scope, scopeLabel }: SearchFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <DeckIcon icon={MagnifyingGlass} size={CHROME_ICON} class="shrink-0 text-muted-foreground" />
      {scope !== null && scopeLabel !== null ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <Badge variant="secondary">{scopeLabel}</Badge>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Leave ${scopeLabel}`}
            onClick={() => {
              chooseArea(null);
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            <DeckIcon icon={X} size={CHROME_ICON} />
          </Button>
        </span>
      ) : null}
      <Input
        ref={inputRef}
        aria-label="Search settings"
        placeholder={scope === null ? "Search settings, agents, shortcuts" : "Filter"}
        autoComplete="off"
        spellcheck={false}
        value={commandQuery.value}
        className="flex-1"
        onInput={(event: Event) => {
          commandQuery.value = (event.target as HTMLInputElement).value;
        }}
      />
    </div>
  );
}

/** One chip per area, About, Privacy and Reset included; pressing the chosen one leaves it. */
export function AreaChips({
  scope,
  onChoose,
}: {
  readonly scope: CommandAreaId | null;
  readonly onChoose: () => void;
}) {
  return (
    <ToggleGroup
      aria-label="Areas"
      size="sm"
      spacing={1}
      className="flex-wrap"
      value={scope === null ? [] : [scope]}
      onValueChange={(next: unknown[]) => {
        chooseArea((next[0] as CommandAreaId | undefined) ?? null);
        onChoose();
      }}
    >
      {SETTINGS_CATEGORIES.map((area) => (
        <Tooltip key={area.id}>
          {/* The trigger's own data-slot would replace the item's, and the item's is what styles and tests find. */}
          <TooltipTrigger
            render={<ToggleGroupItem value={area.id} data-slot="toggle-group-item" />}
          >
            {area.label}
          </TooltipTrigger>
          <TooltipContent>{area.description}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/**
 * The result count, for a screen reader only: the list itself is the visual answer, and a count
 * on the chips or a "N matches" line would only repeat it. The region is always mounted so a
 * change of text is announced.
 */
export function ResultsStatus({
  query,
  count,
}: {
  readonly query: string;
  readonly count: number;
}) {
  const text =
    query.trim() === ""
      ? ""
      : count === 0
        ? "No results"
        : `${count} ${count === 1 ? "result" : "results"}`;
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {text}
    </span>
  );
}

function Hint({ keys, label }: { readonly keys: string; readonly label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
      {label}
    </span>
  );
}

/**
 * Key hints only. The settings store reports no save state (a failed write goes
 * to the global persist-error bar), so there is no status to show here, and none
 * is drawn rather than a made-up "Saved".
 */
export function Footer({
  move,
  enter,
  esc,
}: {
  /** Whether the list holds a row the arrows can walk. */
  readonly move: boolean;
  readonly enter: string | null;
  readonly esc: string;
}) {
  return (
    <footer className="flex h-9 shrink-0 items-center justify-end gap-4 border-t px-4 text-xs text-muted-foreground">
      {move ? <Hint keys="↑↓" label="Move" /> : null}
      {enter ? <Hint keys="↵" label={enter} /> : null}
      <Hint keys="Esc" label={esc} />
    </footer>
  );
}
