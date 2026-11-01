import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import { useRef } from "preact/hooks";
import { Badge } from "../../../../ui/controls/badge";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Input } from "../../../../ui/controls/input";
import { Chord } from "../../../../ui/blocks/chord";
import { Kbd } from "../../../../ui/controls/kbd";
import { AgentLogo } from "../../agent-parts";
import { locate, rowsIn, type Review } from "./diff-data";

export type ComposerVariant = "inline" | "bar" | "panel";

function TargetPicker({ review }: { readonly review: Review }) {
  const { target, targets } = review;
  if (!target) return null;
  const label = (
    <>
      <AgentLogo kind={target.agent.kind} className="size-3.5" />
      <span className="truncate">{target.label}</span>
    </>
  );
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      <span>to</span>
      {targets.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Send to ${target.label}`}
                className="min-w-0 gap-1.5 px-1.5 text-foreground"
              />
            }
          >
            {label}
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuRadioGroup
              value={target.agent.id}
              onValueChange={(id: string) => review.setTarget(id)}
            >
              {targets.map((item) => (
                <DropdownMenuRadioItem key={item.agent.id} value={item.agent.id}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-foreground">{label}</span>
      )}
    </span>
  );
}

/** The one-line comment composer; where it stands is the option's choice. */
export function DiffComposer({
  review,
  variant,
}: {
  readonly review: Review;
  readonly variant: ComposerVariant;
}) {
  const where = locate(rowsIn(review.file, review.range.value));
  const empty = review.text.value.trim() === "";
  const opened = useRef(false);
  const field = (
    <Input
      autoFocus
      onFocus={(event) => {
        // The deep link opens with a drafted comment; show its start, not its end.
        if (opened.current) return;
        opened.current = true;
        const input = event.currentTarget as HTMLInputElement;
        input.setSelectionRange(0, 0);
        input.scrollLeft = 0;
      }}
      aria-label="Comment"
      placeholder="Comment for the agent"
      value={review.text.value}
      onInput={(event) => {
        review.text.value = (event.currentTarget as HTMLInputElement).value;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          review.discard();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          review.send();
        }
      }}
      className="h-8 min-w-0 flex-1 text-xs"
    />
  );
  const send = (
    <Button size="lg" onClick={review.send} disabled={empty} aria-label="Send comment">
      Send
      <Chord keys={["⌘", "↵"]} />
    </Button>
  );
  const cancel = (
    <Button size="lg" variant="ghost" onClick={review.discard} aria-label="Discard comment">
      <Kbd>Esc</Kbd>
    </Button>
  );
  const head = (
    <div className="flex min-w-0 items-center gap-1 text-xs">
      <Badge variant="secondary" className="font-mono text-foreground">
        {where.label}
      </Badge>
      {where.suffix ? (
        <span className="truncate text-muted-foreground">{where.suffix.trim()}</span>
      ) : null}
      <TargetPicker review={review} />
    </div>
  );
  return (
    <div
      role="group"
      aria-label={`Line comment on ${where.label}`}
      className={cn(
        "flex flex-col gap-2 bg-card p-2 font-sans text-xs text-card-foreground",
        variant === "inline" &&
          "mx-3 my-1 rounded-md border shadow-[inset_2px_0_0_var(--foreground)]",
        variant === "bar" && "border-t px-3 py-2.5",
        variant === "panel" && "rounded-md border p-3",
      )}
    >
      {head}
      <div className="flex items-center gap-1.5">
        {field}
        {variant === "panel" ? null : cancel}
        {variant === "panel" ? null : send}
      </div>
      {variant === "panel" ? (
        <div className="flex items-center justify-between gap-2">
          {cancel}
          {send}
        </div>
      ) : null}
      {variant === "inline" ? null : (
        <p className="m-0 truncate font-mono text-2xs text-muted-foreground" title={review.payload}>
          {review.payload}
        </p>
      )}
    </div>
  );
}

/** The result of the last send, read aloud and shown until the next selection. */
export function SendNotice({
  review,
  className,
}: {
  readonly review: Review;
  readonly className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("min-h-4 text-xs text-foreground", className)}
    >
      {review.notice.value}
    </div>
  );
}
