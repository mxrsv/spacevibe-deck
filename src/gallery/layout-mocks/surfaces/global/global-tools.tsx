import { Button } from "../../../../ui/controls/button";
import { Kbd } from "../../../../ui/controls/kbd";
import { AgentLogo } from "../../agent-parts";
import { AGENTS, AGENT_NAME, placeOf, spaceLabel } from "../../layout-fixture";
import { DockIcon } from "../dock/dock-parts";

export type GlobalToolId = "usage" | "history";

const TITLE: Readonly<Record<GlobalToolId, string>> = {
  usage: "Token usage",
  history: "Session history",
};

/** Usage covers Claude Code and Codex only: the scanner reads those two agents' transcripts. */
const SCANNED = new Set(["claude", "codex"]);

const PAST: readonly (readonly [string, string, string])[] = [
  ["Rename the rail section ids", "claude", "Yesterday"],
  ["Why does the pty resize twice?", "codex", "Mon"],
  ["Add a changelog entry for 2.13", "claude", "Oct 18"],
];

/**
 * The global tools the rail footer opens (OD-5): they are not the focused agent's, so they take
 * the stage instead of living in the agent-scoped dock. Esc or the close button goes back.
 */
export function GlobalTool({
  tool,
  onClose,
}: {
  readonly tool: GlobalToolId;
  readonly onClose: () => void;
}) {
  return (
    <section aria-label={TITLE[tool]} className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <DockIcon name={tool} size={14} />
        <h2 className="m-0 flex-1 text-xs font-medium">{TITLE[tool]}</h2>
        <span className="text-muted-foreground">All projects</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
          <Kbd>Esc</Kbd>
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tool === "usage" ? <UsageTable /> : <HistoryTable />}
      </div>
    </section>
  );
}

function UsageTable() {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="h-8 border-b text-left text-muted-foreground">
          <th className="px-3 font-normal">Agent</th>
          <th className="px-3 font-normal">Space</th>
          <th className="px-3 text-right font-normal">Tokens</th>
          <th className="px-3 text-right font-normal">Cost</th>
        </tr>
      </thead>
      <tbody>
        {AGENTS.map((agent) => {
          const scanned = SCANNED.has(agent.kind);
          return (
            <tr key={agent.id} className="h-8 border-b">
              <td className="px-3">
                <span className="flex items-center gap-2">
                  <AgentLogo kind={agent.kind} className="size-3.5" />
                  {AGENT_NAME[agent.kind]}
                </span>
              </td>
              <td className="px-3 text-muted-foreground">
                {placeOf(agent).project.name} / {spaceLabel(placeOf(agent).space)}
              </td>
              <td className="px-3 text-right tabular-nums">{scanned ? agent.tokens : "—"}</td>
              <td className="px-3 text-right tabular-nums">{scanned ? agent.cost : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HistoryTable() {
  return (
    <ul className="m-0 list-none p-1">
      {PAST.map(([title, kind, when]) => (
        <li key={title}>
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 font-normal text-foreground"
          >
            <AgentLogo kind={kind as (typeof AGENTS)[number]["kind"]} className="size-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{when}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
