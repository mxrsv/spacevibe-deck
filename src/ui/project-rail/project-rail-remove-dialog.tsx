import { Button } from "../controls/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../controls/dialog";
import { recoverRailFocus } from "./project-rail-focus";
import { StageCover } from "./project-rail-menu-parts";

export interface ProjectRailRemoveDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly name: string;
  readonly tabCount: number;
  onConfirm(): void;
}

/**
 * Confirms taking a project off the rail. A live one closes every tab of it; a remembered one
 * only leaves the list. The shipped header asked nothing of its own (a busy agent still raises
 * the host's close dialog, so a live Remove can ask twice); a menu item is easier to hit than
 * that ✕ was.
 */
export function ProjectRailRemoveDialog({
  open,
  onOpenChange,
  name,
  tabCount,
  onConfirm,
}: ProjectRailRemoveDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen: boolean) => {
        if (!isOpen) {
          recoverRailFocus();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <StageCover />
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            {tabCount === 0
              ? "Nothing is open in it. It only leaves the rail."
              : `Closes ${tabCount} ${tabCount === 1 ? "tab" : "tabs"} and takes the project off the rail.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
