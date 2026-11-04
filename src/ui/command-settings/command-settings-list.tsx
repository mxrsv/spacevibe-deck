import { cn } from "@/lib/cn";
import type { CommandItem } from "../../settings/command-hits";
import type { CommandSources } from "../../settings/command-search";
import { openHit, openIssue } from "./command-settings-actions";
import { isLiveHit, isLiveKey } from "./command-settings-live";
import { AgentRow } from "./command-settings-agent-row";
import { LiveRow } from "./command-settings-live-row";
import {
  AttentionRow,
  EmptyRow,
  Head,
  HitRow,
  PieceMount,
  SectionMount,
} from "./command-settings-rows";
import { ShortcutRow } from "./command-settings-shortcut-row";
import { shortcutContext } from "./command-settings-shortcuts";
import { commandQuery } from "./command-settings-state";
import { areaLabel, hitValueText, issueText, type ListItem } from "./command-settings-view";

/** What Enter does on the highlighted row, for the footer hint. */
export function enterLabel(item: CommandItem | undefined): string | null {
  if (item === undefined) {
    return null;
  }
  if (item.type !== "hit") {
    return "Go to";
  }
  return isLiveHit(item.hit) ? "Edit" : item.hit.kind === "area" ? "Open" : "Go to";
}

interface ListProps {
  readonly items: readonly ListItem[];
  readonly active: string | null;
  readonly sources: CommandSources;
  /** The home list has no area headings, so a row names its own area. */
  readonly crumbs: boolean;
  /** The settings snapshot is still loading: every control in the list is inert. */
  readonly locked: boolean;
  /** A row or button that unmounts itself on press leaves focus on the body; the search takes it back. */
  readonly focusSearch: () => void;
}

/** A setting row that edits in place and names no area of its own: the kind that shares a card. */
function isCardRow(item: ListItem, crumbs: boolean): boolean {
  return !crumbs && item.type === "hit" && item.hit.kind === "setting" && isLiveKey(item.hit.key);
}

type Entry = { readonly card: readonly ListItem[] } | { readonly item: ListItem };

/** The list with each run of card rows folded into one entry, so the run is drawn as one card. */
function groupCardRows(items: readonly ListItem[], crumbs: boolean): readonly Entry[] {
  const out: Entry[] = [];
  let run: ListItem[] | null = null;
  for (const item of items) {
    if (!isCardRow(item, crumbs)) {
      run = null;
      out.push({ item });
    } else if (run === null) {
      run = [item];
      out.push({ card: run });
    } else {
      run.push(item);
    }
  }
  return out;
}

export function List({ items, active, sources, crumbs, locked, focusSearch }: ListProps) {
  // Resolved once for every shortcut row of this render, not per row.
  const shortcuts = items.some((item) => item.type === "hit" && item.hit.kind === "shortcut")
    ? shortcutContext(sources)
    : null;
  const draw = (item: ListItem) => {
    switch (item.type) {
      case "head":
        return <Head key={item.key} title={item.title} />;
      case "hit": {
        const { hit } = item;
        const crumb = crumbs ? areaLabel(hit.area, sources) : null;
        if (hit.kind === "shortcut" && shortcuts !== null) {
          return (
            <ShortcutRow
              key={item.key}
              itemKey={item.key}
              action={hit.action}
              label={hit.label}
              context={shortcuts}
              crumb={crumb}
              active={item.key === active}
              locked={locked}
            />
          );
        }
        if (hit.kind === "agent") {
          return (
            <AgentRow
              key={item.key}
              itemKey={item.key}
              agentId={hit.agentId}
              settings={sources.settings}
              crumb={crumb}
              active={item.key === active}
              locked={locked}
            />
          );
        }
        return hit.kind === "setting" && isLiveKey(hit.key) ? (
          <LiveRow
            key={item.key}
            itemKey={item.key}
            settingKey={hit.key}
            settings={sources.settings}
            crumb={crumb}
            active={item.key === active}
            locked={locked}
          />
        ) : (
          <HitRow
            key={item.key}
            itemKey={item.key}
            hit={hit}
            value={hitValueText(hit, sources)}
            crumb={crumb}
            active={item.key === active}
            onOpen={() => {
              openHit(hit);
              focusSearch();
            }}
          />
        );
      }
      case "attention":
        return (
          <AttentionRow
            key={item.key}
            itemKey={item.key}
            issue={item.issue}
            text={issueText(item.issue, sources)}
            crumb={areaLabel(item.issue.area, sources)}
            active={item.key === active}
            onOpen={() => {
              openIssue(item.issue);
              focusSearch();
            }}
          />
        );
      case "section":
        return <SectionMount key={item.key} area={item.area} />;
      case "piece":
        return <PieceMount key={item.key} area={item.area} piece={item.piece} locked={locked} />;
      case "empty":
        return (
          <EmptyRow
            key={item.key}
            query={item.query}
            onClear={() => {
              commandQuery.value = "";
              focusSearch();
            }}
          />
        );
    }
  };
  return (
    <ul className="m-0 list-none">
      {groupCardRows(items, crumbs).map((entry) =>
        "card" in entry ? (
          // The rows are short, so a card holds two to a line instead of stretching each across the dialog.
          <li key={`card:${entry.card[0].key}`} className="px-1 pb-3">
            <ul
              className={cn(
                "m-0 grid list-none gap-x-2 rounded-[var(--radius-surface)] bg-[var(--chrome-1)] p-2",
                entry.card.length > 1 ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {entry.card.map(draw)}
            </ul>
          </li>
        ) : (
          draw(entry.item)
        ),
      )}
    </ul>
  );
}
