import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  BrowserIcon,
  ChartHistogramIcon,
  Clock01Icon,
  File01Icon,
  FileEditIcon,
  Folder01Icon,
  GitBranchIcon,
  Message01Icon,
  MessageQuestionIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { cn } from "@/lib/cn";
import { useEffect, useState } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import { AgentLogo, AgentStateMark } from "../../agent-parts";
import {
  AGENT_NAME,
  AGENTS,
  STATE_LABEL,
  placeOf,
  type MockAgent,
  type MockFileChange,
} from "../../layout-fixture";

/** Below this window width every option applies its own narrow rule. */
export const NARROW_BELOW = 1360;

export function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export type ToolId = "agent" | "changes" | "files" | "history" | "usage";

export interface ToolSpec {
  readonly id: ToolId;
  readonly label: string;
  readonly keys: readonly string[];
}

export const TOOLS: readonly ToolSpec[] = [
  { id: "changes", label: "Changes", keys: [] },
  { id: "files", label: "Files", keys: ["⌘", "⇧", "B"] },
  { id: "usage", label: "Usage", keys: ["⌘", "⇧", "U"] },
  { id: "history", label: "History", keys: ["⌘", "⇧", "Y"] },
];

const ICONS = {
  changes: FileEditIcon,
  files: Folder01Icon,
  usage: ChartHistogramIcon,
  history: Clock01Icon,
  ask: MessageQuestionIcon,
  prompts: Message01Icon,
  file: File01Icon,
  branch: GitBranchIcon,
  settings: Settings02Icon,
  browser: BrowserIcon,
  down: ArrowDown01Icon,
  right: ArrowRight01Icon,
} as const;

export type DockIconName = keyof typeof ICONS;

export function DockIcon({ name, size = 16 }: { name: DockIconName; size?: number }) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function changeTotals(agent: MockAgent) {
  const { changes } = placeOf(agent).checkout;
  return {
    files: changes.length,
    added: changes.reduce((sum, change) => sum + change.added, 0),
    removed: changes.reduce((sum, change) => sum + change.removed, 0),
  };
}

export const SECTION_LABEL = "text-2xs font-medium text-muted-foreground";

const STATUS_CLASS: Readonly<Record<MockFileChange["status"], string>> = {
  M: "text-(--term-warn)",
  A: "text-(--term-ok)",
  D: "text-(--term-err)",
};

/** Who the dock is about: logo, name, project and branch. */
export function AgentIdentity({ agent }: { readonly agent: MockAgent }) {
  const { checkout, project } = placeOf(agent);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AgentLogo kind={agent.kind} className="size-5" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-foreground">
          {AGENT_NAME[agent.kind]}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
          <span className="truncate">
            {project.name} / {checkout.branch ?? "no branch"}
          </span>
          {checkout.worktree ? <DockIcon name="branch" size={11} /> : null}
        </span>
      </div>
    </div>
  );
}

/** The plain list of the focused agent's changed files. The Changes surface owns its design. */
export function ChangesList({ agent }: { readonly agent: MockAgent }) {
  const { changes } = placeOf(agent).checkout;
  const sum = changeTotals(agent);
  if (!changes.length) return <p className="m-0 px-3 py-4 text-xs text-foreground">No changes</p>;
  return (
    <>
      <ul className="m-0 list-none p-0 py-1">
        {changes.map((change) => {
          const cut = change.path.lastIndexOf("/");
          return (
            <li
              key={change.path}
              className="flex h-7 items-center gap-2 px-3 font-mono text-code hover:bg-muted"
            >
              <span
                className={cn(
                  "w-3 shrink-0 text-center font-semibold",
                  STATUS_CLASS[change.status],
                )}
              >
                {change.status}
              </span>
              <span className="min-w-0 flex-1 truncate" title={change.path}>
                <span className="text-muted-foreground">{change.path.slice(0, cut + 1)}</span>
                <span className="text-foreground">{change.path.slice(cut + 1)}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-(--term-ok)">+{change.added}</span>{" "}
                <span className="text-(--term-err)">−{change.removed}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 flex h-8 items-center justify-between border-t px-3 text-xs tabular-nums">
        <span className="text-foreground">
          {sum.files} {sum.files === 1 ? "file" : "files"}
        </span>
        <span className="font-mono">
          <span className="text-(--term-ok)">+{sum.added}</span>{" "}
          <span className="text-(--term-err)">−{sum.removed}</span>
        </span>
      </p>
    </>
  );
}

interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: TreeNode[] | null;
}

/** A small tree: the changed paths, one neighbour per folder, and the usual root files. */
function buildTree(agent: MockAgent): TreeNode[] {
  const paths = new Set(placeOf(agent).checkout.changes.map((change) => change.path));
  for (const path of [...paths]) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    if (dir) paths.add(`${dir}index.ts`);
  }
  paths.add("package.json");
  paths.add("README.md");
  const root: TreeNode[] = [];
  for (const path of [...paths].sort()) {
    let level = root;
    const parts = path.split("/");
    parts.forEach((name, index) => {
      const full = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = level.find((item) => item.name === name);
      if (!node) {
        node = { name, path: full, children: isFile ? null : [] };
        level.push(node);
      }
      if (node.children) level = node.children;
    });
  }
  const order = (nodes: TreeNode[]): TreeNode[] =>
    [...nodes]
      .sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name))
      .map((node) => (node.children ? { ...node, children: order(node.children) } : node));
  return order(root);
}

function TreeRows({
  nodes,
  depth,
  open,
  status,
}: {
  readonly nodes: readonly TreeNode[];
  readonly depth: number;
  readonly open: { value: Record<string, boolean> };
  readonly status: Readonly<Record<string, MockFileChange["status"]>>;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {nodes.map((node) => {
        const expanded = open.value[node.path] ?? true;
        const mark = status[node.path];
        return (
          <li key={node.path}>
            <button
              type="button"
              aria-expanded={node.children ? expanded : undefined}
              onClick={() => {
                if (node.children) open.value = { ...open.value, [node.path]: !expanded };
              }}
              style={{ paddingLeft: 12 + depth * 14 }}
              className="flex h-7 w-full items-center gap-1.5 pr-3 text-left font-mono text-code text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {node.children ? (
                <DockIcon name={expanded ? "down" : "right"} size={11} />
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {mark ? (
                <span className={cn("shrink-0 font-semibold", STATUS_CLASS[mark])}>{mark}</span>
              ) : null}
            </button>
            {node.children && expanded ? (
              <TreeRows nodes={node.children} depth={depth + 1} open={open} status={status} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function FileTree({ agent }: { readonly agent: MockAgent }) {
  const open = useSignal<Record<string, boolean>>({});
  const status = Object.fromEntries(
    placeOf(agent).checkout.changes.map((change) => [change.path, change.status]),
  );
  return (
    <div className="py-1">
      <TreeRows nodes={buildTree(agent)} depth={0} open={open} status={status} />
    </div>
  );
}

const PAST_SESSIONS: readonly (readonly [string, string])[] = [
  ["Rename the rail section ids", "Yesterday"],
  ["Why does the pty resize twice?", "Mon"],
  ["Add a changelog entry for 2.13", "Oct 18"],
];

export function HistoryList({ agent }: { readonly agent: MockAgent }) {
  const rows: readonly (readonly [string, string])[] = [
    [agent.sentence ?? "New session", "Now"],
    ...PAST_SESSIONS,
  ];
  return (
    <ul className="m-0 list-none p-1">
      {rows.map(([title, when], index) => (
        <li key={title}>
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 font-normal text-foreground"
          >
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{when}</span>
            <span className="sr-only">{index === 0 ? "current session" : "resume"}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function UsageFacts({ agent }: { readonly agent: MockAgent }) {
  // The scanner reads Claude Code and Codex transcripts only, keyed by repository: every other
  // agent has no usage, and two agents of one kind in a repo share their numbers.
  const scanned = agent.kind === "claude" || agent.kind === "codex";
  const rows: readonly (readonly [string, string])[] = [
    ["Tokens in this repo", scanned ? agent.tokens : "—"],
    ["Cost in this repo", scanned ? agent.cost : "—"],
    ["Running for", agent.since],
  ];
  return (
    <dl className="m-0 py-1 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex h-7 items-center justify-between gap-3 px-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="m-0 text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The ask, when the agent needs input. Null otherwise, so callers do not reserve room. */
export function AskBlock({
  agent,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly onFocus: (id: string) => void;
}) {
  if (agent.state !== "needs-you" || !agent.ask) return null;
  const ask = agent.ask;
  return (
    <section aria-label="Ask" className="px-3 py-2">
      <div className="rounded-md border border-amber-600/50 bg-muted p-2 dark:border-amber-400/50">
        <p className="m-0 font-mono text-code text-foreground">{ask}</p>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onFocus(agent.id)}>
            Open pane
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigator.clipboard?.writeText(ask)}
          >
            Copy
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The other agents of the focused agent's space. */
export function SpaceList({
  agent,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly onFocus: (id: string) => void;
}) {
  const { space } = placeOf(agent);
  const others = AGENTS.filter((item) => item.spaceId === space.id && item.id !== agent.id);
  if (!others.length)
    return <p className="m-0 px-3 py-2 text-xs text-foreground">Only agent here</p>;
  return (
    <ul className="m-0 list-none p-1">
      {others.map((item) => (
        <li key={item.id}>
          <Button
            variant="ghost"
            onClick={() => onFocus(item.id)}
            aria-label={`${AGENT_NAME[item.kind]}, ${STATE_LABEL[item.state]}`}
            className="h-8 w-full justify-start gap-2 px-2 text-foreground"
          >
            <AgentStateMark state={item.state} confidence={item.confidence} />
            <AgentLogo kind={item.kind} />
            <span className="shrink-0 font-medium">{AGENT_NAME[item.kind]}</span>
            <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
              {item.sentence}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** One tool's content, shared by every option so the comparison is about the chrome. */
export function ToolBody({
  tool,
  agent,
  onFocus,
}: {
  readonly tool: ToolId;
  readonly agent: MockAgent;
  readonly onFocus: (id: string) => void;
}) {
  switch (tool) {
    case "changes":
      return <ChangesList agent={agent} />;
    case "files":
      return <FileTree agent={agent} />;
    case "history":
      return <HistoryList agent={agent} />;
    case "usage":
      return <UsageFacts agent={agent} />;
    case "agent":
      return (
        <>
          <AskBlock agent={agent} onFocus={onFocus} />
          <h3 className={cn(SECTION_LABEL, "m-0 px-3 pt-2.5 pb-1")}>In this space</h3>
          <SpaceList agent={agent} onFocus={onFocus} />
        </>
      );
  }
}
