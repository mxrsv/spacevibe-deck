import { cn } from "@/lib/cn";
import { useSignal } from "@preact/signals";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Comment01Icon,
  Copy01Icon,
  FileViewIcon,
  GitCompareIcon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentLogo } from "../../agent-parts";
import {
  AGENT_NAME,
  agentById,
  placeOf,
  spaceById,
  type MockAgent,
  type MockFileChange,
} from "../../layout-fixture";

export const STATUS_CLASS: Readonly<Record<MockFileChange["status"], string>> = {
  M: "text-(--term-warn)",
  A: "text-(--term-ok)",
  D: "text-(--term-err)",
};
export const STATUS_WORD: Readonly<Record<MockFileChange["status"], string>> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
};
/** Visible only while the row is hovered or holds keyboard focus. */
export const REVEAL =
  "hidden group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex";
export const HIDE_ON_REVEAL =
  "group-hover/row:hidden group-has-[:focus-visible]/row:hidden group-has-[[aria-expanded=true]]/row:hidden";

export function Icon({ icon, size = 14 }: { icon: typeof Tick02Icon; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export const Chevron = ({ open }: { open: boolean }) => (
  <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
);

export function changesOf(agent: MockAgent): readonly MockFileChange[] {
  return placeOf(agent).checkout.changes;
}

export function totalsOf(changes: readonly MockFileChange[]) {
  return {
    added: changes.reduce((sum, item) => sum + item.added, 0),
    removed: changes.reduce((sum, item) => sum + item.removed, 0),
  };
}

export function splitPath(path: string) {
  const cut = path.lastIndexOf("/");
  return { dir: cut < 0 ? "" : path.slice(0, cut + 1), file: path.slice(cut + 1) };
}

export function StatusLetter({ status }: { status: MockFileChange["status"] }) {
  return (
    <span
      role="img"
      aria-label={STATUS_WORD[status]}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-code font-semibold",
        STATUS_CLASS[status],
      )}
    >
      {status}
    </span>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof Tick02Icon;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
            <Icon icon={icon} size={13} />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Agents of the checkout's spaces: the people a comment can be sent to. */
function commentTargets(agent: MockAgent): readonly MockAgent[] {
  const { space } = placeOf(agent);
  return spaceById(space.id).paneIds.map(agentById);
}

/** The quick action set: open diff, open file, copy path, send a comment to an agent. */
export function RowActions({
  change,
  agent,
  onOpen,
  className,
}: {
  change: MockFileChange;
  agent: MockAgent;
  onOpen: () => void;
  className?: string;
}) {
  const copied = useSignal(false);
  const sentTo = useSignal<string | null>(null);
  return (
    <span
      className={cn("items-center gap-px", className)}
      role="group"
      aria-label={`Actions for ${change.path}`}
    >
      <ActionButton label="Open diff" icon={GitCompareIcon} onClick={onOpen} />
      <ActionButton label="Open file" icon={FileViewIcon} />
      <ActionButton
        label={copied.value ? "Copied" : "Copy path"}
        icon={copied.value ? Tick02Icon : Copy01Icon}
        onClick={() => {
          copied.value = true;
          setTimeout(() => (copied.value = false), 1200);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={sentTo.value ? `Sent to ${sentTo.value}` : "Send comment to agent"}
              title={sentTo.value ? `Sent to ${sentTo.value}` : "Send comment to agent"}
            >
              <Icon icon={sentTo.value ? Tick02Icon : Comment01Icon} size={13} />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Send comment to</DropdownMenuLabel>
            {commentTargets(agent).map((target) => (
              <DropdownMenuItem
                key={target.id}
                onClick={() => (sentTo.value = AGENT_NAME[target.kind])}
              >
                <AgentLogo kind={target.kind} className="size-3.5" />
                {AGENT_NAME[target.kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** At most the first four changed lines of the file's hunks. */
export function Preview({ change }: { change: MockFileChange }) {
  const lines = (change.hunks ?? [])
    .flatMap((item) => item.lines)
    .filter((l) => l.kind !== "ctx")
    .slice(0, 4);
  return (
    <pre className="m-0 mb-1 ml-9 mr-3 overflow-hidden rounded-md bg-muted px-2 py-1.5 font-mono text-2xs leading-4">
      {lines.map((line, index) => (
        <div key={index} className="truncate">
          <span className={line.kind === "add" ? "text-(--term-ok)" : "text-(--term-err)"}>
            {line.kind === "add" ? "+" : "−"}
          </span>
          <span className="text-foreground"> {line.text.trim()}</span>
        </div>
      ))}
    </pre>
  );
}

export function RefreshButton() {
  const done = useSignal(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh changes"
            onClick={() => {
              done.value = true;
              setTimeout(() => (done.value = false), 1000);
            }}
          >
            <Icon icon={done.value ? Tick02Icon : Refresh01Icon} />
          </Button>
        }
      />
      <TooltipContent>{done.value ? "Up to date" : "Refresh"}</TooltipContent>
    </Tooltip>
  );
}

export function EmptyChanges() {
  return <p className="m-0 px-3 py-6 text-xs text-muted-foreground">No changes against HEAD.</p>;
}

export const ROW_BASE = "group/row relative flex h-7 items-center pr-2 hover:bg-muted";
export const ROW_SELECTED = "bg-muted shadow-[inset_2px_0_0_var(--foreground)]";
export const ROW_PRESS =
  "flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
export const ROW_ACTIONS = "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md bg-muted";
