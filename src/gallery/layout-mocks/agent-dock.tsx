import { cn } from "@/lib/cn";
import { ChangeCounts } from "../../ui/blocks/change-counts";
import { Badge } from "../../ui/controls/badge";
import { Button } from "../../ui/controls/button";
import { ScrollArea } from "../../ui/controls/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/controls/tabs";
import { AgentLogo, AgentStateMark } from "./agent-parts";
import {
  AGENT_NAME,
  AGENTS,
  STATE_LABEL,
  placeOf,
  type MockAgent,
  type MockFileChange,
} from "./layout-fixture";
import { RibbonIcon, totals } from "./option-ribbon-parts";

const STATUS_CLASS: Readonly<Record<MockFileChange["status"], string>> = {
  M: "text-(--term-warn)",
  A: "text-(--term-ok)",
  D: "text-(--term-err)",
};

function ChangeRow({ change }: { readonly change: MockFileChange }) {
  const cut = change.path.lastIndexOf("/");
  const dir = cut < 0 ? "" : change.path.slice(0, cut + 1);
  const file = change.path.slice(cut + 1);
  return (
    <li className="flex h-7 items-center gap-2 px-3 font-mono text-code hover:bg-muted">
      <span className={cn("w-3 shrink-0 text-center font-semibold", STATUS_CLASS[change.status])}>
        {change.status}
      </span>
      <span className="min-w-0 flex-1 truncate" title={change.path}>
        <span className="text-muted-foreground">{dir}</span>
        <span className="text-foreground">{file}</span>
      </span>
      <ChangeCounts added={change.added} removed={change.removed} />
    </li>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: preact.ComponentChildren;
}) {
  return (
    <div className="flex h-7 items-center justify-between gap-3 px-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 flex items-center gap-1.5 text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

const SECTION_LABEL = "px-3 pt-2.5 pb-1 text-2xs font-medium text-muted-foreground";

function AttentionStrip({
  agent,
  siblings,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly siblings: readonly MockAgent[];
  readonly onFocus: (id: string) => void;
}) {
  const others = siblings.filter((item) => item.id !== agent.id);
  const ask = agent.state === "needs-you" ? agent.ask : null;
  return (
    <div className="flex flex-col">
      {ask ? (
        <section aria-label="Ask">
          <h3 className={cn(SECTION_LABEL, "m-0")}>Ask</h3>
          <div className="mx-3 rounded-md border border-amber-600/50 bg-muted p-2 dark:border-amber-400/50">
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
      ) : null}
      {others.length ? (
        <section aria-label="In this space">
          <h3 className={cn(SECTION_LABEL, "m-0")}>In this space</h3>
          <ul className="m-0 list-none p-1 pt-0">
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
        </section>
      ) : null}
    </div>
  );
}

/** The dock follows the focused agent: its checkout's changes, its session. */
export function AgentDock({
  agent,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly onFocus: (id: string) => void;
}) {
  const { checkout, project, space } = placeOf(agent);
  const sum = totals(agent);
  const siblings = AGENTS.filter((item) => item.spaceId === space.id);
  return (
    <aside
      aria-label={`${AGENT_NAME[agent.kind]} details`}
      className="flex w-[340px] shrink-0 flex-col border-l bg-background"
    >
      {/* 40px, so its seam continues the stage bar's when the dock reaches the window top. */}
      <header className="flex h-10 shrink-0 items-center gap-2.5 border-b px-3">
        <AgentLogo kind={agent.kind} className="size-5" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs font-medium text-foreground">
            {AGENT_NAME[agent.kind]}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
            <span className="truncate">
              {project.name} / {checkout.branch ?? "no branch"}
            </span>
            {checkout.worktree ? <RibbonIcon name="branch" size={11} /> : null}
          </span>
        </div>
      </header>
      <Tabs defaultValue="changes" className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-9 w-full justify-start gap-3 border-b px-3">
          <TabsTrigger value="changes" className="h-8 flex-none px-0.5 after:bottom-0">
            Changes
            {sum.files ? (
              <span className="tabular-nums text-muted-foreground">{sum.files}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="session" className="h-8 flex-none px-0.5 after:bottom-0">
            Session
          </TabsTrigger>
        </TabsList>
        <TabsContent value="changes" className="flex min-h-0 flex-col">
          {sum.files === 0 ? (
            <div className="grid place-items-center py-8 text-xs text-muted-foreground">
              No changes
            </div>
          ) : (
            <>
              <ScrollArea className="max-h-[45%] min-h-0">
                <ul className="m-0 list-none p-0 py-1">
                  {checkout.changes.map((change) => (
                    <ChangeRow key={change.path} change={change} />
                  ))}
                </ul>
              </ScrollArea>
              <footer className="flex h-8 items-center justify-between border-y px-3 text-xs tabular-nums">
                <span className="text-foreground">
                  {sum.files} {sum.files === 1 ? "file" : "files"}
                </span>
                <span className="font-mono">
                  <span className="text-(--term-ok)">+{sum.added}</span>{" "}
                  <span className="text-(--term-err)">−{sum.removed}</span>
                </span>
              </footer>
            </>
          )}
          <AttentionStrip agent={agent} siblings={siblings} onFocus={onFocus} />
        </TabsContent>
        <TabsContent value="session" className="py-1">
          <dl className="m-0 text-xs">
            <Fact label="State">
              <AgentStateMark state={agent.state} confidence={agent.confidence} />
              {STATE_LABEL[agent.state]}
            </Fact>
            <Fact label="Since">{agent.since}</Fact>
            <Fact label="Tokens">{agent.tokens}</Fact>
            <Fact label="Cost">{agent.cost}</Fact>
            {checkout.pr ? (
              <Fact label="PR">
                <Badge variant="outline" className="text-foreground">
                  #{checkout.pr.number} {checkout.pr.state}
                </Badge>
              </Fact>
            ) : null}
          </dl>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
