import { signal } from "@preact/signals";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect } from "preact/hooks";
import { changedKeys, keysFor } from "../../settings/settings-changes";
import { SETTINGS_REGISTRY, type SettingScope } from "../../settings/settings-registry";
import { settings } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../controls/dialog";
import { applyReset, resetPromptOpen } from "../settings/confirm-reset";
import { RESET_ROWS } from "../settings/sections/reset-section";
import { RowShell } from "./command-settings-live-row";

/** The scope whose confirmation is open. */
const resetScope = signal<SettingScope | null>(null);
/** The last scope that was open: where focus goes back to once its dialog has closed. */
let lastScope: SettingScope | null = null;

/**
 * The dialog shares `resetPromptOpen` with the native prompt behind every page reset, so only one
 * confirmation is ever up. Every way out of the dialog (Cancel, Escape, confirm, the surface
 * closing under it) comes through here, or every reset in the app would stay disabled.
 */
function closeReset(): void {
  resetScope.value = null;
  resetPromptOpen.value = false;
}

/**
 * Closing a dialog hands focus back to the button that opened it. When the reset it just ran
 * leaves that button nothing to do it is disabled, and focus would be stranded on it; the search
 * field takes it instead.
 */
function focusAfterClose(): HTMLElement | boolean {
  const spent = lastScope !== null && changedKeys(settings.value, keysFor(lastScope)).length === 0;
  return spent
    ? (document.querySelector<HTMLElement>('input[aria-label="Search settings"]') ?? true)
    : true;
}

function openReset(scope: SettingScope): void {
  lastScope = scope;
  resetScope.value = scope;
  resetPromptOpen.value = true;
}

/** One row per reset scope; each asks first, naming what goes and what stays (FBK-3). */
export function ResetRows() {
  useEffect(
    () => () => {
      // Only a flag this dialog set is this dialog's to clear.
      if (resetScope.value !== null) closeReset();
    },
    [],
  );
  const open = resetScope.value;
  const spec = RESET_ROWS.find((row) => row.scope === open);
  const keys = spec === undefined ? [] : changedKeys(settings.value, keysFor(spec.scope));
  return (
    <>
      {RESET_ROWS.map((row) => {
        const pending = changedKeys(settings.value, keysFor(row.scope));
        return (
          <RowShell
            key={row.scope}
            itemKey={`reset:${row.scope}`}
            active={false}
            changed={false}
            label={row.label}
            crumb={row.desc}
            reset={null}
            control={
              <Button
                variant="destructive"
                size="sm"
                disabled={pending.length === 0 || (resetPromptOpen.value && open === null)}
                title={pending.length === 0 ? "Nothing to reset" : undefined}
                aria-label={row.label}
                onClick={() => openReset(row.scope)}
              >
                <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
                Reset…
              </Button>
            }
          />
        );
      })}
      <Dialog
        open={open !== null}
        onOpenChange={(next: boolean) => {
          if (!next) closeReset();
        }}
      >
        <DialogContent showCloseButton={false} finalFocus={focusAfterClose}>
          <DialogHeader>
            <DialogTitle>{spec?.label}?</DialogTitle>
            <DialogDescription>
              {keys.length === 0
                ? "Nothing here differs from the defaults."
                : "These go back to their defaults:"}
            </DialogDescription>
          </DialogHeader>
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-foreground">
            {keys.map((key) => (
              <li key={key}>{SETTINGS_REGISTRY[key].label}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">Keeps {spec?.keeps}. This can't be undone.</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={keys.length === 0}
              onClick={() => {
                applyReset(keys);
                closeReset();
              }}
            >
              {spec?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
