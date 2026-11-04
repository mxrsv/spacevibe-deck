import { useState } from "preact/hooks";
import { reportPersistError } from "../../chrome/events";
import { absolutePath } from "../../files/changes/changes-model";
import { available as externalAppsAvailable, openInApp } from "../../host/external-apps-host";
import { writeText } from "../../host/shell-host";
import { installedExternalApps } from "../../links/external-apps-store";
import type { ChangeEntry } from "../../host/git-changes-host";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";

/**
 * Every action a changed file has lives here, in one place: its row in the list and its card
 * header open the same menu, and neither carries a button of its own. What is offered is what
 * this machine reports, so an app that is not installed is absent rather than disabled.
 */

/** The state and handlers a row or a header needs to open its file menu. */
export function useFileMenu() {
  const [open, setOpen] = useState(false);
  return {
    open,
    setOpen,
    triggerProps: {
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault();
        setOpen(true);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          setOpen(true);
        }
      },
    },
  };
}

export interface DockChangesFileMenuProps {
  readonly root: string;
  readonly entry: ChangeEntry;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  /** Opens the file as a dock tab, as pressing a card's name does. */
  onOpenFile(entry: ChangeEntry): void;
}

function openIn(appId: Parameters<typeof openInApp>[0]["appId"], label: string, path: string) {
  openInApp({ appId, path, isDirectory: false, line: 1, column: 1 }).catch((error: unknown) => {
    reportPersistError(`Couldn't open ${label}: ${String(error)}`);
  });
}

/** The menu itself; mount it inside the element that is `relative` and owns `triggerProps`. */
export function DockChangesFileMenu({
  root,
  entry,
  open,
  onOpenChange,
  onOpenFile,
}: DockChangesFileMenuProps) {
  const path = absolutePath(root, entry.path);
  const gone = entry.status === "deleted";
  const apps = externalAppsAvailable ? installedExternalApps.value : [];
  const files = apps.find((app) => app.group === "files");
  const editors = apps.filter((app) => app.group === "editor");
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        nativeButton={false}
        render={<span aria-hidden="true" className="pointer-events-none absolute inset-0" />}
      />
      <DropdownMenuContent className="min-w-44">
        {gone ? null : (
          <>
            <DropdownMenuItem onClick={() => onOpenFile(entry)}>Open</DropdownMenuItem>
            {files === undefined ? null : (
              <DropdownMenuItem onClick={() => openIn(files.id, files.label, path)}>
                Reveal in {files.label}
              </DropdownMenuItem>
            )}
            {editors.length === 0 ? null : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Open with</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {editors.map((editor) => (
                    <DropdownMenuItem
                      key={editor.id}
                      onClick={() => openIn(editor.id, editor.label, path)}
                    >
                      {editor.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
          </>
        )}
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
  );
}
