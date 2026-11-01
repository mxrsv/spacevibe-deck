import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  Copy01Icon,
  Edit02Icon,
  FolderOpenIcon,
  GitBranchIcon,
  Folder01Icon,
  Mail01Icon,
  MailOpen01Icon,
  MoreHorizontalIcon,
  Pin02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Input } from "../../../../ui/controls/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentLogo, AgentStateMark } from "../../agent-parts";
import { AGENT_NAME, STATE_LABEL } from "../../layout-fixture";
import { folderName, type RailState, type Thread } from "./rail-option-c-model";

/** Hover actions show on hover, keyboard focus or while their menu is open. */
export const REVEAL =
  "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

function Tip({
  label,
  button,
  children,
}: {
  readonly label: string;
  readonly button: preact.JSX.Element;
  readonly children: preact.ComponentChildren;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The menu that opened the rename hands focus back to its trigger as it closes; take it after. */
const MENU_CLOSE_MS = 160;

function RenameField({ thread, state }: { readonly thread: Thread; readonly state: RailState }) {
  const cancelled = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = box.current?.querySelector("input");
      input?.focus();
      input?.select();
    }, MENU_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div ref={box} className="min-w-0">
      <Input
        autoFocus
        defaultValue={thread.title}
        aria-label={`Rename ${thread.title}`}
        className="h-6 text-sm"
        onKeyDown={(event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            state.rename(thread.id, (event.target as HTMLInputElement).value);
          }
          if (event.key === "Escape") {
            cancelled.current = true;
            state.editingId.value = null;
          }
        }}
        onBlur={(event: FocusEvent) => {
          if (!cancelled.current && state.editingId.value === thread.id) {
            state.rename(thread.id, (event.target as HTMLInputElement).value);
          }
        }}
      />
    </div>
  );
}

/** Rename, pin, read state, copy and Finder; shared by the right-click and the "more" button. */
function ThreadMenu({ thread, state }: { readonly thread: Thread; readonly state: RailState }) {
  const unread = thread.state === "unchecked";
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text);
    state.say(`${what} copied`);
  };
  return (
    <>
      <DropdownMenuItem onClick={() => (state.editingId.value = thread.id)}>
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} aria-hidden="true" />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => state.togglePin(thread.id)}>
        <HugeiconsIcon icon={Pin02Icon} strokeWidth={2} aria-hidden="true" />
        {thread.pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => state.toggleUnread(thread.id)}>
        <HugeiconsIcon
          icon={unread ? MailOpen01Icon : Mail01Icon}
          strokeWidth={2}
          aria-hidden="true"
        />
        {unread ? "Mark read" : "Mark unread"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => copy(thread.path, "Path")}>
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} aria-hidden="true" />
        Copy path
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={thread.branch === null}
        onClick={() => copy(thread.branch ?? "", "Branch")}
      >
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} aria-hidden="true" />
        Copy branch
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => state.say(`Revealed ${folderName(thread.path)}`)}>
        <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} aria-hidden="true" />
        Open in Finder
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => state.setArchived(thread.id, true)}>
        <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} aria-hidden="true" />
        Archive
      </DropdownMenuItem>
    </>
  );
}

/** Two lines: the title, then agent, branch chip and time. Hover adds pin, archive and more. */
export function ThreadRow({
  thread,
  state,
  tabStop,
  projectName,
}: {
  readonly thread: Thread;
  readonly state: RailState;
  readonly tabStop: boolean;
  /** Set when the list is not grouped by project, so the row names its project. */
  readonly projectName?: string;
}) {
  const selected = state.selectedId.value === thread.id;
  const editing = state.editingId.value === thread.id;
  const menuKey = `row:${thread.id}`;
  const detail = thread.state === "needs-you" && thread.ask ? `, asking: ${thread.ask}` : "";
  return (
    <div
      className="group/item relative mx-1.5"
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        state.menuFor.value = menuKey;
      }}
    >
      {editing ? (
        <div className="grid grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2 rounded-md bg-accent px-2.5 py-1.5">
          <AgentStateMark state={thread.state} confidence={thread.confidence} />
          <RenameField thread={thread} state={state} />
        </div>
      ) : (
        <button
          type="button"
          data-thread={thread.id}
          tabIndex={tabStop ? 0 : -1}
          onClick={() => state.select(thread.id)}
          onDblClick={() => (state.editingId.value = thread.id)}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "F2") state.editingId.value = thread.id;
          }}
          aria-current={selected ? "true" : undefined}
          aria-label={`${thread.title}, ${AGENT_NAME[thread.kind]}, ${STATE_LABEL[thread.state]}${detail}, ${thread.since}`}
          className={cn(
            "grid w-full cursor-default grid-cols-[10px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            selected ? "bg-accent ring-1 ring-ring/40 ring-inset" : "hover:bg-accent/50",
          )}
        >
          <span className="flex h-[18px] items-center">
            <AgentStateMark state={thread.state} confidence={thread.confidence} />
          </span>
          <span
            className={cn(
              "truncate text-sm leading-[18px] text-foreground",
              selected && "font-medium",
            )}
          >
            {thread.title}
          </span>
          <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-2xs leading-4 text-muted-foreground">
            <AgentLogo kind={thread.kind} className="size-3" />
            {projectName === undefined ? null : (
              <span className="min-w-0 shrink truncate">{projectName}</span>
            )}
            <span className="inline-flex min-w-0 items-center gap-1 rounded-sm bg-muted px-1.5">
              <HugeiconsIcon
                icon={thread.branch === null ? Folder01Icon : GitBranchIcon}
                size={10}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0"
              />
              <span className="truncate">{thread.branch ?? folderName(thread.path)}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
              {thread.pinned ? (
                <HugeiconsIcon icon={Pin02Icon} size={10} strokeWidth={2} aria-hidden="true" />
              ) : null}
              {thread.since}
            </span>
          </span>
        </button>
      )}
      {editing ? null : (
        <div
          className={cn(
            "absolute top-1 right-1.5 flex items-center gap-0.5 rounded-md bg-accent p-0.5",
            REVEAL,
          )}
        >
          <Tip
            label={thread.pinned ? "Unpin" : "Pin"}
            button={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={thread.pinned ? "Unpin" : "Pin"}
                onClick={() => state.togglePin(thread.id)}
              />
            }
          >
            <HugeiconsIcon icon={Pin02Icon} strokeWidth={2} aria-hidden="true" />
          </Tip>
          <Tip
            label="Archive"
            button={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Archive"
                onClick={() => state.setArchived(thread.id, true)}
              />
            }
          >
            <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} aria-hidden="true" />
          </Tip>
          <DropdownMenu
            open={state.menuFor.value === menuKey}
            onOpenChange={(open: boolean) => {
              if (open) state.menuFor.value = menuKey;
              else if (state.menuFor.value === menuKey) state.menuFor.value = null;
            }}
          >
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label="More" />}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <ThreadMenu thread={thread} state={state} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

/** An archived row: dimmed, one line, with its Unarchive action. */
export function ArchivedRow({
  thread,
  state,
}: {
  readonly thread: Thread;
  readonly state: RailState;
}) {
  return (
    <div className="mx-1.5 flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent/50">
      <AgentLogo kind={thread.kind} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      <Button size="xs" variant="ghost" onClick={() => state.setArchived(thread.id, false)}>
        Unarchive
      </Button>
    </div>
  );
}
