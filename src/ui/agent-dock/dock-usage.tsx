import { CaretRight } from "@phosphor-icons/react";
import { useEffect } from "preact/hooks";
import { formatUsd } from "../../lib/usage-pricing";
import { tabViews } from "../../terminal/tabs-store";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { displayAgent } from "../agent-rail-card-model";
import { Button } from "../controls/button";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { railNow, runRailClock } from "../project-rail/project-rail-state";
import type { RailItem } from "../rail-view-model";
import { formatTokensCompact } from "../usage/usage-format";
import { repoUsageToday, runningFor, usageAgentOf, type RepoUsageToday } from "./dock-usage-model";

const EM_DASH = "—";

export interface DockUsageProps {
  /** The focused agent's row, or null when none holds the keyboard. */
  readonly item: RailItem | null;
  /** The other agents of its space. */
  readonly space: readonly RailItem[];
  /** Opens the full usage page: `App` routes it through the `open-usage` action. */
  readonly onOpenDetails: () => void;
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex h-7 items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

const tokensOf = (usage: RepoUsageToday | null): string =>
  usage === null ? EM_DASH : formatTokensCompact(usage.tokens);
const costOf = (usage: RepoUsageToday | null): string =>
  usage === null || usage.costUsd === null ? EM_DASH : formatUsd(usage.costUsd);

/** The repository's own folder name, for the note: the usage is that repository's, not a session's. */
function repoName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1]?.replace(/\.git$/, "") || path;
}

/** When the focused pane's agent started, from the tab views, or null when it did not say. */
function startedAtOf(item: RailItem): number | null {
  const { entry } = item;
  if (entry.kind !== "agent") {
    return null;
  }
  const pane = tabViews.value[entry.tabIndex]?.panes?.find((view) => view.paneId === entry.paneId);
  return pane?.startedAt ?? null;
}

/**
 * The stacked dock's Usage section (LAY-6): the focused agent's repository today, in tokens and
 * estimated cost, the space's cost beside it when the space holds other agents, and how long the
 * agent has been running. The figures are the repository's, for that agent and not one session:
 * the scanner has no session dimension, and reads Claude Code and Codex only, so any other agent
 * has a dash and a line that says why. The full page is one press away.
 */
export function DockUsage({ item, space, onOpenDetails }: DockUsageProps) {
  // Mounted only while unfolded, so a folded Usage polls nothing (the legacy tab's rule).
  useEffect(() => {
    startUsagePolling();
    return () => stopUsagePolling();
  }, []);
  useEffect(() => runRailClock(), []);

  const snapshot = usageSnapshot.value;
  const now = railNow.value;
  const agent = item !== null && item.entry.kind === "agent" ? item.entry.agent : null;
  const scanned = agent === null ? null : usageAgentOf(agent);
  const repo = item?.checkout.repositoryPath ?? null;

  const own =
    scanned === null || repo === null ? null : repoUsageToday(snapshot, repo, [scanned], now);
  const kinds = [item, ...space].flatMap((row) =>
    row !== null && row.entry.kind === "agent" ? [usageAgentOf(row.entry.agent)] : [],
  );
  const spaceKinds = [...new Set(kinds.filter((kind) => kind !== null))];
  const together = repo === null ? null : repoUsageToday(snapshot, repo, spaceKinds, now);
  const startedAt = item === null ? null : startedAtOf(item);

  return (
    <div className="flex flex-col px-3 pb-2 text-xs">
      {snapshot === null && usageLoading.value ? (
        <p className="pt-2 text-2xs text-muted-foreground">Reading this machine's usage…</p>
      ) : null}
      {usageStale.value ? (
        <p className="pt-2 text-2xs text-muted-foreground">Stale: showing the last good read.</p>
      ) : null}
      {agent === null ? (
        <p className="py-2 text-muted-foreground">Focus an agent to see its usage.</p>
      ) : (
        <>
          <dl className="py-1">
            <Fact label="Tokens today" value={tokensOf(own)} />
            <Fact label="Cost today" value={costOf(own)} />
            {space.length > 0 ? <Fact label="Space cost today" value={costOf(together)} /> : null}
            <Fact
              label="Running for"
              value={startedAt === null ? EM_DASH : runningFor(startedAt, now)}
            />
          </dl>
          <p className="text-2xs text-muted-foreground">
            {scanned === null
              ? `Usage is read for Claude Code and Codex only, not ${displayAgent(agent)}.`
              : `Every ${displayAgent(agent)} session in ${repo === null ? "this folder" : repoName(repo)} today, not this one alone. Estimated at API prices.`}
          </p>
        </>
      )}
      <Button variant="ghost" size="sm" className="mt-1 self-end" onClick={onOpenDetails}>
        Details
        <DeckIcon icon={CaretRight} size={CHROME_ICON} />
      </Button>
    </div>
  );
}
