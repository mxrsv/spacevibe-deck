import { Button } from "../../../../ui/controls/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../ui/controls/dialog";
import { AGENT_CONFIGS, RESET_SCOPES } from "./settings-setup-data";
import {
  changedSettings,
  changedShortcuts,
  resetScope,
  resetTarget,
} from "./settings-option-a-state";
import { refocusSearch } from "./settings-option-a-controls";

/** FBK-3/4: a reset names exactly what it takes away before it runs. */
function lost(id: string): readonly string[] {
  if (id === "settings") {
    return [
      ...changedSettings().map((setting) => setting.label),
      ...changedShortcuts().map((shortcut) => `${shortcut.label} shortcut`),
    ];
  }
  if (id === "agents") {
    return [`Enabled, pinned, model, effort and launch flags of ${AGENT_CONFIGS.length} agents`];
  }
  return ["3 saved prompt templates, deleted for good"];
}

export function ResetDialog() {
  const id = resetTarget.value;
  const scope = RESET_SCOPES.find((item) => item.id === id);
  const items = id ? lost(id) : [];
  return (
    <Dialog
      open={id !== null}
      onOpenChange={(next: boolean) => {
        if (!next) {
          resetTarget.value = null;
          setTimeout(refocusSearch, 0);
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reset {scope?.label.toLowerCase()}?</DialogTitle>
          <DialogDescription>
            {items.length === 0 ? "Nothing here differs from the defaults." : "You lose:"}
          </DialogDescription>
        </DialogHeader>
        <ul className="m-0 list-disc space-y-0.5 pl-4 text-foreground">
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={items.length === 0}
            onClick={() => {
              if (id) resetScope(id);
              resetTarget.value = null;
            }}
          >
            Reset {scope?.label.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
