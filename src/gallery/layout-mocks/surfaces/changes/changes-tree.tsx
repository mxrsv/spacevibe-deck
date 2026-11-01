import { cn } from "@/lib/cn";
import { useSignal } from "@preact/signals";
import { ChangeCounts } from "../../../../ui/blocks/change-counts";
import type { MockAgent, MockFileChange } from "../../layout-fixture";
import { Chevron, EmptyChanges, RefreshButton, changesOf, totalsOf } from "./changes-parts";
import { FileRow, flipped } from "./changes-row";

interface DirNode {
  readonly path: string;
  readonly label: string;
  readonly dirs: DirNode[];
  readonly files: MockFileChange[];
}

function build(changes: readonly MockFileChange[]): DirNode {
  const root: DirNode = { path: "", label: "", dirs: [], files: [] };
  for (const change of changes) {
    const parts = change.path.split("/");
    let node = root;
    parts.slice(0, -1).forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let next = node.dirs.find((item) => item.path === path);
      if (!next) node.dirs.push((next = { path, label: part, dirs: [], files: [] }));
      node = next;
    });
    node.files.push(change);
  }
  return root;
}

/** A directory holding only one directory folds into it: `src/ui`, not `src` then `ui`. */
function fold(node: DirNode): DirNode {
  let current = node;
  let label = node.label;
  while (current.files.length === 0 && current.dirs.length === 1) {
    current = current.dirs[0];
    label = `${label}/${current.label}`;
  }
  return { ...current, label, dirs: current.dirs.map(fold) };
}

function filesUnder(node: DirNode): MockFileChange[] {
  return [...node.files, ...node.dirs.flatMap(filesUnder)];
}

const INDENT = 10;
const STEP = 14;

/** `onOpen` hears a pressed file, for a shell that opens its diff. */
export function TreeChanges({
  agent,
  onOpen,
}: {
  agent: MockAgent;
  onOpen?: (change: MockFileChange) => void;
}) {
  const changes = changesOf(agent);
  const closed = useSignal<ReadonlySet<string>>(new Set());
  const selected = useSignal<string | null>(null);
  if (changes.length === 0) return <EmptyChanges />;
  const root = fold(build(changes));
  const total = totalsOf(changes);

  const renderDir = (node: DirNode, depth: number) => {
    const files = filesUnder(node);
    const sums = totalsOf(files);
    const open = !closed.value.has(node.path);
    return (
      <li key={node.path}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => (closed.value = flipped(closed.value, node.path))}
          style={{ paddingLeft: INDENT + depth * STEP }}
          className="flex h-7 w-full items-center gap-1.5 pr-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="text-muted-foreground">
            <Chevron open={open} />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-code text-foreground">
            {node.label}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
            {files.length}
          </span>
          <ChangeCounts added={sums.added} removed={sums.removed} />
        </button>
        {open ? <ul className="m-0 list-none p-0">{children(node, depth + 1)}</ul> : null}
      </li>
    );
  };
  const children = (node: DirNode, depth: number) => [
    ...node.dirs.map((dir) => renderDir(dir, depth)),
    ...node.files.map((change) => (
      <FileRow
        key={change.path}
        change={change}
        agent={agent}
        indent={INDENT + depth * STEP + 6}
        selected={selected.value === change.path}
        onSelect={() => {
          selected.value = change.path;
          onOpen?.(change);
        }}
      />
    )),
  ];

  return (
    <div className="flex min-h-0 flex-col text-xs">
      <div className="flex h-9 items-center justify-between pr-2 pl-3 text-foreground">
        <span className="tabular-nums">{changes.length} files</span>
        <span className="flex items-center gap-1.5">
          <ChangeCounts added={total.added} removed={total.removed} />
          <RefreshButton />
        </span>
      </div>
      <ul className={cn("m-0 list-none p-0")}>{children(root, 0)}</ul>
    </div>
  );
}
