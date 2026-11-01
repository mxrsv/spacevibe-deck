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

export function List({ items, active, sources, crumbs, locked, focusSearch }: ListProps) {
  // Resolved once for every shortcut row of this render, not per row.
  const shortcuts = items.some((item) => item.type === "hit" && item.hit.kind === "shortcut")
    ? shortcutContext(sources)
    : null;
  return (
    <ul className="m-0 list-none">
      {items.map((item) => {
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
            return <PieceMount key={item.key} area={item.area} piece={item.piece} />;
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
      })}
    </ul>
  );
}
