import { cn } from "@/lib/cn";
import { ChangeCounts } from "../../../../ui/blocks/change-counts";
import { Chord } from "../../../../ui/blocks/chord";
import { Button } from "../../../../ui/controls/button";
import { ToggleGroup, ToggleGroupItem } from "../../../../ui/controls/toggle-group";
import type { MockFileChange } from "../../layout-fixture";
import type { DiffFile, Review } from "./diff-data";

const STATUS_CLASS: Readonly<Record<MockFileChange["status"], string>> = {
  M: "text-(--term-warn)",
  A: "text-(--term-ok)",
  D: "text-(--term-err)",
};

/** One changed file as a button; `rail` stacks the directory under the name. */
export function FileButton({
  file,
  active,
  rail,
  onOpen,
}: {
  readonly file: DiffFile;
  readonly active: boolean;
  readonly rail?: boolean;
  readonly onOpen: () => void;
}) {
  const { path, status } = file.change;
  const cut = path.lastIndexOf("/");
  const dir = cut < 0 ? "" : path.slice(0, cut + 1);
  const name = path.slice(cut + 1);
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={`${path}, ${status === "A" ? "added" : status === "D" ? "deleted" : "modified"}`}
      title={path}
      onClick={onOpen}
      className={cn(
        "flex w-full cursor-default items-center gap-2 px-3 text-left font-mono text-code outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        rail ? "min-h-9 flex-wrap py-1.5" : "h-7",
        active ? "bg-accent" : "hover:bg-muted",
      )}
    >
      <span className={cn("w-3 shrink-0 text-center font-semibold", STATUS_CLASS[status])}>
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {rail ? null : <span className="text-foreground">{dir}</span>}
        <span className={cn("font-medium text-foreground", active && "font-semibold")}>{name}</span>
      </span>
      <ChangeCounts added={file.change.added} removed={file.change.removed} />
      {rail && dir ? (
        <span className="w-full truncate pl-5 text-2xs text-foreground">{dir}</span>
      ) : null}
    </button>
  );
}

export function SplitToggle({ review }: { readonly review: Review }) {
  return (
    <ToggleGroup
      aria-label="Diff layout"
      variant="outline"
      size="sm"
      value={[review.split.value ? "split" : "unified"]}
      onValueChange={(next: unknown[]) => {
        if (typeof next[0] === "string") review.split.value = next[0] === "split";
      }}
    >
      <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
      <ToggleGroupItem value="split">Split</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** The pointer affordance on a selection; the chord is the keyboard twin. */
export function CommentButton({ review }: { readonly review: Review }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={review.range.value === null || review.composing.value}
      onClick={review.open}
    >
      Comment
      <Chord keys={["⌘", "⌥", "M"]} />
    </Button>
  );
}
