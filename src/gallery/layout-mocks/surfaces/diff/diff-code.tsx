import { cn } from "@/lib/cn";
import type { ComponentChildren } from "preact";
import type { DiffFile, DiffRow, Range, Sent } from "./diff-data";

const TINT = {
  add: "bg-[color-mix(in_oklch,var(--term-ok)_14%,transparent)]",
  del: "bg-[color-mix(in_oklch,var(--term-err)_14%,transparent)]",
  ctx: "",
} as const;
const GLYPH = { add: "+", del: "−", ctx: " " } as const;
const KIND_WORD = { add: "added", del: "deleted", ctx: "unchanged" } as const;

interface Handlers {
  readonly range: Range | null;
  readonly marked: ReadonlySet<number>;
  readonly onSelect: (id: number, extend: boolean) => void;
  readonly onDrag: (id: number) => void;
}

function Gutter({ row, side }: { readonly row: DiffRow; readonly side: "old" | "new" }) {
  const n = side === "old" ? row.old : row.new;
  return (
    <span className="w-10 shrink-0 pr-2 text-right text-foreground tabular-nums">{n ?? ""}</span>
  );
}

function LineButton({
  row,
  handlers,
  selected,
}: {
  readonly row: DiffRow;
  readonly handlers: Handlers;
  readonly selected: boolean;
}) {
  const n = row.new ?? row.old;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Line ${n}, ${KIND_WORD[row.kind]}`}
      onClick={(event) => {
        if (event.detail === 0) handlers.onSelect(row.id, event.shiftKey);
      }}
      className="absolute inset-y-0 left-0 w-10 cursor-default rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    />
  );
}

function selectedAt(handlers: Handlers, id: number): boolean {
  const { range } = handlers;
  return range !== null && id >= range.from && id <= range.to;
}

function UnifiedRow({ row, handlers }: { readonly row: DiffRow; readonly handlers: Handlers }) {
  const selected = selectedAt(handlers, row.id);
  return (
    <div
      role="row"
      onPointerDown={(event) => handlers.onSelect(row.id, event.shiftKey)}
      onPointerEnter={(event) => {
        if (event.buttons === 1) handlers.onDrag(row.id);
      }}
      className={cn(
        "relative flex h-5 w-max min-w-full cursor-default select-none items-center",
        selected ? "bg-accent shadow-[inset_2px_0_0_var(--foreground)]" : TINT[row.kind],
        !selected && handlers.marked.has(row.id) && "shadow-[inset_2px_0_0_var(--term-info)]",
      )}
    >
      <LineButton row={row} handlers={handlers} selected={selected} />
      <Gutter row={row} side="old" />
      <Gutter row={row} side="new" />
      <span aria-hidden="true" className="w-4 shrink-0 text-center font-semibold text-foreground">
        {GLYPH[row.kind]}
      </span>
      <span className="pr-4 whitespace-pre text-foreground">{row.text}</span>
    </div>
  );
}

function Cell({
  row,
  side,
  handlers,
}: {
  readonly row: DiffRow | null;
  readonly side: "old" | "new";
  readonly handlers: Handlers;
}) {
  if (!row) return <div className="h-5 bg-muted/50" aria-hidden="true" />;
  const selected = selectedAt(handlers, row.id);
  return (
    <div
      role="cell"
      onPointerDown={(event) => handlers.onSelect(row.id, event.shiftKey)}
      onPointerEnter={(event) => {
        if (event.buttons === 1) handlers.onDrag(row.id);
      }}
      className={cn(
        "relative flex h-5 min-w-0 cursor-default select-none items-center overflow-hidden",
        selected ? "bg-accent" : TINT[row.kind],
        selected && side === "new" && "shadow-[inset_2px_0_0_var(--foreground)]",
        !selected &&
          handlers.marked.has(row.id) &&
          side === "new" &&
          "shadow-[inset_2px_0_0_var(--term-info)]",
      )}
    >
      {side === "new" || row.kind === "del" ? (
        <LineButton row={row} handlers={handlers} selected={selected} />
      ) : null}
      <Gutter row={row} side={side} />
      <span aria-hidden="true" className="w-4 shrink-0 text-center font-semibold text-foreground">
        {GLYPH[row.kind]}
      </span>
      <span className="min-w-0 truncate whitespace-pre text-foreground">{row.text}</span>
    </div>
  );
}

type Pair = readonly [DiffRow | null, DiffRow | null];

/** Pairs each run of deletions with the additions that replace it. */
function pairsOf(rows: readonly DiffRow[]): readonly Pair[] {
  const out: Pair[] = [];
  let at = 0;
  while (at < rows.length) {
    const row = rows[at];
    if (row.kind === "ctx") {
      out.push([row, row]);
      at += 1;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (at < rows.length && rows[at].kind === "del") dels.push(rows[at++]);
    while (at < rows.length && rows[at].kind === "add") adds.push(rows[at++]);
    for (let i = 0; i < Math.max(dels.length, adds.length); i += 1)
      out.push([dels[i] ?? null, adds[i] ?? null]);
  }
  return out;
}

function HunkHeader({ children }: { readonly children: string }) {
  return (
    <div className="flex h-6 w-full items-center bg-muted px-3 text-foreground">{children}</div>
  );
}

/**
 * Mono diff the owner can select lines in: click or drag a gutter, shift extends.
 * `zone` is drawn full width right after the row holding its id (the inline composer).
 */
export function DiffCode({
  file,
  mode,
  range,
  sent,
  hunk,
  onSelect,
  onDrag,
  zone,
  className,
}: {
  readonly file: DiffFile;
  readonly mode: "unified" | "split";
  readonly range: Range | null;
  readonly sent: readonly Sent[];
  readonly hunk?: number;
  readonly onSelect: (id: number, extend: boolean) => void;
  readonly onDrag: (id: number) => void;
  readonly zone?: { readonly after: number; readonly node: ComponentChildren };
  readonly className?: string;
}) {
  const marked = new Set(
    sent
      .filter((item) => item.path === file.change.path)
      .flatMap((item) =>
        file.rows
          .filter((row) => row.id >= item.range.from && row.id <= item.range.to)
          .map((row) => row.id),
      ),
  );
  const handlers: Handlers = { range, marked, onSelect, onDrag };
  const hunks = file.hunks
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => hunk === undefined || index === hunk);
  return (
    <div
      role="table"
      aria-label={`Diff of ${file.change.path}`}
      className={cn(
        "min-w-0 overflow-auto bg-background py-1 font-mono text-code leading-5",
        className,
      )}
    >
      {hunks.map(({ item, index }) => (
        <div key={index} role="rowgroup" className="mb-1">
          <HunkHeader>{item.header}</HunkHeader>
          {mode === "unified"
            ? item.rows.map((row) => (
                <div key={row.id}>
                  <UnifiedRow row={row} handlers={handlers} />
                  {zone?.after === row.id ? zone.node : null}
                </div>
              ))
            : pairsOf(item.rows).map(([left, right]) => (
                <div key={(left?.id ?? -1) * 1000 + (right?.id ?? -1)}>
                  <div role="row" className="grid grid-cols-2 divide-x">
                    <Cell row={left} side="old" handlers={handlers} />
                    <Cell row={right} side="new" handlers={handlers} />
                  </div>
                  {zone && (left?.id === zone.after || right?.id === zone.after) ? zone.node : null}
                </div>
              ))}
        </div>
      ))}
    </div>
  );
}
