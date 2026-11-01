import { cn } from "@/lib/cn";
import type { TermLine, Tone } from "./layout-fixture";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  fg: "text-(--term-fg)",
  dim: "text-(--term-dim)",
  accent: "text-(--term-accent)",
  ok: "text-(--term-ok)",
  err: "text-(--term-err)",
  warn: "text-(--term-warn)",
  info: "text-(--term-info)",
  cursor: "bg-(--term-fg) text-(--term-bg)",
};

/**
 * A pane body: the agent CLI's own output as mono text, never a chat transcript.
 * `lastRows` clips to the tail, the way a text snapshot of a hidden pane reads.
 */
export function MockTerminal({
  lines,
  lastRows,
  className,
}: {
  readonly lines: readonly TermLine[];
  readonly lastRows?: number;
  readonly className?: string;
}) {
  const shown = lastRows === undefined ? lines : lines.slice(-lastRows);
  return (
    <pre
      className={cn(
        "m-0 min-h-0 overflow-hidden bg-(--term-bg) px-3 py-2 font-mono text-code leading-[1.5] text-(--term-fg)",
        className,
      )}
    >
      {shown.map((line, row) => (
        <div key={row} className="min-h-[1.5em] whitespace-pre">
          {line.map(([tone, text], index) => (
            <span key={index} className={TONE_CLASS[tone]}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}
