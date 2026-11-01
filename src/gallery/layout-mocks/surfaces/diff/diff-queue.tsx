import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { cn } from "@/lib/cn";
import { ChangeCounts } from "../../../../ui/blocks/change-counts";
import { Button } from "../../../../ui/controls/button";
import { Kbd } from "../../../../ui/controls/kbd";
import { AgentLogo } from "../../agent-parts";
import { AGENT_NAME, agentById, type MockAgent } from "../../layout-fixture";
import { DiffCode } from "./diff-code";
import { DiffComposer, SendNotice } from "./diff-composer";
import { diffFiles, useReview, type Review } from "./diff-data";
import { CommentButton, SplitToggle } from "./diff-parts";
import { DiffStageShell } from "./diff-stage-shell";

interface Step {
  readonly file: number;
  readonly hunk: number;
}

/** The file's hunk holding the review's opening range, so the composer's lines are on screen. */
function startStep(review: Review, steps: readonly Step[], file: number): number {
  const from = review.range.value?.from;
  const holding = steps.findIndex(
    (step) =>
      step.file === file && review.files[file].hunks[step.hunk].rows.some((row) => row.id === from),
  );
  return holding >= 0 ? holding : steps.findIndex((step) => step.file === file);
}

/**
 * Option c: one hunk at a time with a progress count, a queue list and a side composer.
 * `startPath` opens on that file's first hunk; `onClose` hands the way back to the shell.
 */
export function DiffQueue({
  agent,
  startPath,
  onClose,
}: {
  readonly agent: MockAgent;
  readonly startPath?: string;
  readonly onClose?: () => void;
}) {
  const startFile = diffFiles(agent).findIndex((file) => file.change.path === startPath);
  const review = useReview(agent, { file: Math.max(startFile, 0) });
  const steps: readonly Step[] = review.files.flatMap((file, fileIndex) =>
    file.hunks.map((_, hunk): Step => ({ file: fileIndex, hunk })),
  );
  // Without a start file the queue opens mid-way: the first hunk is reviewed, the second is
  // under the composer.
  const at = useSignal(
    startFile >= 0 ? startStep(review, steps, startFile) : Math.min(1, steps.length - 1),
  );
  const reviewed = useSignal<readonly number[]>(startFile < 0 && steps.length > 1 ? [0] : []);
  const step = steps[at.value];
  const file = review.files[step.file];
  const hunk = file.hunks[step.hunk];

  const go = (index: number) => {
    const next = steps[(index + steps.length) % steps.length];
    at.value = (index + steps.length) % steps.length;
    review.openFile(next.file);
    const rows = review.files[next.file].hunks[next.hunk].rows;
    const first = rows.find((row) => row.kind !== "ctx") ?? rows[0];
    review.select(first.id, false);
  };
  const markReviewed = () => {
    if (!reviewed.value.includes(at.value)) reviewed.value = [...reviewed.value, at.value];
    const pending = steps.findIndex((_, i) => i > at.value && !reviewed.value.includes(i));
    go(pending >= 0 ? pending : at.value + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowRight") go(at.value + 1);
      else if (event.key === "ArrowLeft") go(at.value - 1);
      else if (event.key.toLowerCase() === "r") markReviewed();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handler reads signals' current values when it fires, so the listener mounts once
  }, []);

  const author = agentById(file.change.by);
  const done = reviewed.value.length;
  const zoneRange = review.range.value;
  return (
    <DiffStageShell agent={agent} review={review} label="Back to review" onClose={onClose}>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4">
        <span className="shrink-0 text-xs font-medium text-foreground tabular-nums">
          Hunk {at.value + 1} of {steps.length}
        </span>
        <ol
          aria-label={`${done} of ${steps.length} hunks reviewed`}
          className="m-0 flex min-w-0 flex-1 list-none gap-1 p-0"
        >
          {steps.map((_, index) => (
            <li
              key={index}
              aria-current={index === at.value ? "step" : undefined}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                reviewed.value.includes(index) ? "bg-foreground" : "bg-muted",
                index === at.value && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
            >
              <span className="sr-only">
                {reviewed.value.includes(index) ? "Reviewed" : "Pending"}
              </span>
            </li>
          ))}
        </ol>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{done} reviewed</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="lg"
            variant="outline"
            onClick={() => go(at.value - 1)}
            aria-label="Previous hunk"
          >
            Previous
            <Kbd>←</Kbd>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => go(at.value + 1)}
            aria-label="Next hunk"
          >
            Next
            <Kbd>→</Kbd>
          </Button>
          <Button size="lg" onClick={markReviewed} aria-label="Mark hunk reviewed">
            Mark reviewed
            <Kbd>R</Kbd>
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <section
            aria-label={`Hunk in ${file.change.path}`}
            className="flex min-h-0 flex-col overflow-hidden rounded-md border"
          >
            <header className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs">
              <span className="min-w-0 truncate font-mono text-foreground">{file.change.path}</span>
              <ChangeCounts added={file.change.added} removed={file.change.removed} />
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                <AgentLogo kind={author.kind} className="size-3.5" />
                {AGENT_NAME[author.kind]} · turn {file.change.turn}
              </span>
              <span className="min-w-0 flex-1" />
              <SplitToggle review={review} />
            </header>
            <DiffCode
              file={file}
              hunk={step.hunk}
              mode={review.split.value ? "split" : "unified"}
              range={zoneRange}
              sent={review.sent.value}
              onSelect={review.select}
              onDrag={review.drag}
              className="min-h-0 flex-1"
            />
          </section>
        </div>
        <aside
          aria-label="Review"
          className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-3"
        >
          {review.composing.value ? (
            <DiffComposer review={review} variant="panel" />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <SendNotice review={review} />
              <CommentButton review={review} />
            </div>
          )}
          <nav aria-label="Hunk queue" className="flex flex-col">
            <h3 className="m-0 px-1 pb-1 text-2xs font-medium text-muted-foreground">Queue</h3>
            {steps.map((item, index) => {
              const f = review.files[item.file];
              const name = f.change.path.slice(f.change.path.lastIndexOf("/") + 1);
              const isDone = reviewed.value.includes(index);
              return (
                <button
                  key={index}
                  type="button"
                  aria-current={index === at.value ? "step" : undefined}
                  onClick={() => go(index)}
                  className={cn(
                    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left font-mono text-code outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    index === at.value ? "bg-accent" : "hover:bg-muted",
                  )}
                >
                  <span aria-hidden="true" className="w-3 shrink-0 text-center text-foreground">
                    {isDone ? "✓" : "·"}
                  </span>
                  <span className="sr-only">{isDone ? "Reviewed" : "Pending"}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
                  <span className="shrink-0 text-foreground tabular-nums">
                    {" "}
                    L{f.hunks[item.hunk].header.match(/\+(\d+)/)?.[1] ?? ""}
                  </span>
                </button>
              );
            })}
          </nav>
          <span hidden>{hunk.header}</span>
        </aside>
      </div>
    </DiffStageShell>
  );
}
