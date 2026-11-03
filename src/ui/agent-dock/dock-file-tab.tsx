import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { baseName } from "../../lib/path-name";
import { writeText } from "../../host/shell-host";
import { fileIcon } from "../../files/ui/file-icons";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { closeTargets } from "./dock-file-tabs-close";

export type CloseAction = "one" | "others" | "right" | "all";

export interface DockFileTabProps {
  readonly path: string;
  readonly preview: boolean;
  readonly dirty: boolean;
  readonly active: boolean;
  /** Every open file tab's path, in strip order, for the menu's bulk closes. */
  readonly paths: readonly string[];
  onSelect(): void;
  onKeep(): void;
  onClose(targets: readonly string[]): void;
}

/**
 * One file tab: type glyph, name (italic while it is the preview), an unsaved dot and a close
 * mark on the active tab only. A right-click or the menu key opens Close, Close others,
 * Close to the right, Close all and Copy path. No count or badge sits on it (DOCK-7).
 */
export function DockFileTab({
  path,
  preview,
  dirty,
  active,
  paths,
  onSelect,
  onKeep,
  onClose,
}: DockFileTabProps) {
  const name = baseName(path);
  const [menuOpen, setMenuOpen] = useState(false);
  const index = paths.indexOf(path);
  const run = (action: CloseAction): void => onClose(closeTargets(action, paths, path));
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      aria-label={dirty ? `${name}, unsaved changes` : name}
      title={path}
      data-path={path}
      className={cn(
        "group/tab relative flex h-full min-w-0 max-w-40 shrink-0 items-center gap-1 px-2.5 text-xs",
        active
          ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
          : "text-muted-foreground hover:bg-muted/50",
      )}
      onClick={onSelect}
      onDblClick={onKeep}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      <DeckIcon icon={fileIcon(name)} size={ROW_ICON} />
      <span className={cn("min-w-0 truncate", preview && "italic")}>{name}</span>
      {dirty ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/60" />
      ) : null}
      {active ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${name}`}
          tabIndex={-1}
          className="shrink-0"
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            run("one");
          }}
        >
          <DeckIcon icon={Cancel01Icon} />
        </Button>
      ) : null}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          nativeButton={false}
          render={<span aria-hidden="true" className="pointer-events-none absolute inset-0" />}
        />
        <DropdownMenuContent className="min-w-44">
          <DropdownMenuItem onClick={() => run("one")}>Close</DropdownMenuItem>
          <DropdownMenuItem disabled={paths.length < 2} onClick={() => run("others")}>
            Close others
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === paths.length - 1} onClick={() => run("right")}>
            Close to the right
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("all")}>Close all</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              writeText(path).catch((error: unknown) => {
                console.warn("Deck: could not copy to the clipboard", error);
              });
            }}
          >
            Copy path
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
