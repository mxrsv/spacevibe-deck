import { cn } from "@/lib/cn";
import { ChangeCounts } from "../../../../ui/blocks/change-counts";
import type { MockAgent, MockFileChange } from "../../layout-fixture";
import {
  Chevron,
  HIDE_ON_REVEAL,
  Preview,
  REVEAL,
  ROW_ACTIONS,
  ROW_BASE,
  ROW_PRESS,
  ROW_SELECTED,
  RowActions,
  StatusLetter,
  splitPath,
} from "./changes-parts";

/**
 * One changed file: press to select, hover for the action set, chevron for the preview.
 * `indent` is the left inset in px; `fullPath` shows the dim directory before the name.
 */
export function FileRow({
  change,
  agent,
  selected,
  onSelect,
  expanded = false,
  onToggle,
  indent = 0,
  fullPath = false,
}: {
  change: MockFileChange;
  agent: MockAgent;
  selected: boolean;
  onSelect: () => void;
  expanded?: boolean;
  onToggle?: () => void;
  indent?: number;
  fullPath?: boolean;
}) {
  const { dir, file } = splitPath(change.path);
  return (
    <li>
      <div className={cn(ROW_BASE, selected && ROW_SELECTED)} style={{ paddingLeft: indent }}>
        {onToggle && change.hunks ? (
          <button
            type="button"
            aria-label={`${expanded ? "Hide" : "Show"} preview of ${file}`}
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex h-full w-6 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Chevron open={expanded} />
          </button>
        ) : onToggle ? (
          <span className="w-6 shrink-0" />
        ) : null}
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={cn(ROW_PRESS, !onToggle && "pl-2")}
        >
          <StatusLetter status={change.status} />
          <span className="min-w-0 flex-1 truncate font-mono text-code" title={change.path}>
            {fullPath ? <span className="text-muted-foreground">{dir}</span> : null}
            <span className="text-foreground">{file}</span>
          </span>
          <span className={cn("flex", HIDE_ON_REVEAL)}>
            <ChangeCounts added={change.added} removed={change.removed} />
          </span>
        </button>
        <RowActions
          change={change}
          agent={agent}
          onOpen={onSelect}
          className={cn(REVEAL, ROW_ACTIONS)}
        />
      </div>
      {expanded ? <Preview change={change} /> : null}
    </li>
  );
}

/** Set-in-a-signal helper: a new Set with `key` flipped. */
export function flipped(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
