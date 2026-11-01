import { useEffect, useRef } from "preact/hooks";
import { activeKeyIn, isNavigable, type CommandItem } from "../../settings/command-hits";
import { initSettings, settingsLoadState } from "../../settings/settings-store";
import { useNoteAgentListWhileSettingsOpen } from "../../launcher/agent-install-control";
import { LoadError } from "../controls/load-error";
import { settingsTarget } from "../settings/settings-focus-store";
import { AreaChips, Footer, SearchField } from "./command-settings-frame";
import { handleCommandKey } from "./command-settings-keys";
import { enterLabel, List } from "./command-settings-list";
import { rowDomId } from "./command-settings-live";
import { commandActiveKey, commandQuery, commandScope } from "./command-settings-state";
import {
  areaLabel,
  commandItemsOf,
  commandListItems,
  commandSources,
} from "./command-settings-view";

interface CommandSettingsProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The surface itself. It exists only while Settings is open, so its listener,
 * its focus and its leftover deep-link target all end with it.
 *
 * Three keyboard contracts carry over from the screen it replaces:
 *
 * - **Escape belongs to the innermost owner** (`command-settings-keys.ts`).
 * - **Focus cannot leave the surface.** The scrim covers the window but the app
 *   behind it stays in the document, so Tab is wrapped inside the panel.
 * - **A loading snapshot cannot overwrite an edit.** `initSettings` assigns the
 *   disk snapshot over `settings.value` when it resolves, so the list is inert
 *   (a disabled fieldset) until it has landed. The field and the chips stay live:
 *   they edit nothing.
 */
function CommandSurface({ onClose }: { readonly onClose: () => void }) {
  // Once for the surface, not per agent row: every call forces its own login-shell probe.
  useNoteAgentListWhileSettingsOpen();
  const rootRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<readonly CommandItem[]>([]);

  const query = commandQuery.value;
  const scope = commandScope.value;
  const sources = commandSources();
  const listItems = commandListItems(query, scope, sources);
  // The keyboard walks rows, not the pieces drawn between them.
  const items = commandItemsOf(listItems);
  itemsRef.current = items;
  const activeKey = activeKeyIn(items, commandActiveKey.value);
  const current = items.find((item) => item.key === activeKey);
  const load = settingsLoadState.value;
  const loading = load.status === "loading";

  // Focus moves in on open so Escape reaches the listener below instead of the terminal that
  // had it, and goes back to where it was when nothing (the app's own close path) put it elsewhere.
  useEffect(() => {
    const previous = document.activeElement;
    const root = rootRef.current;
    searchRef.current?.focus({ preventScroll: true });
    return () => {
      settingsTarget.value = null;
      commandQuery.value = "";
      commandActiveKey.value = null;
      const focused = document.activeElement;
      const stranded = focused === null || focused === document.body || root?.contains(focused);
      if (stranded && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      handleCommandKey(event, {
        root: rootRef.current,
        search: searchRef.current,
        items: itemsRef.current,
        onClose,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // A row that unmounts under focus (a reset in the Changed list, a value flipped back to its
  // default), or a button that disables itself under it (a reset with nothing left to reset),
  // leaves focus where Escape and the arrows reach nothing: the search takes it.
  useEffect(() => {
    const focused = document.activeElement;
    if (
      focused === document.body ||
      (focused instanceof HTMLElement && focused.matches(":disabled"))
    ) {
      searchRef.current?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (activeKey !== null) {
      document.getElementById(rowDomId(activeKey))?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeKey]);

  const focusSearch = (): void => searchRef.current?.focus({ preventScroll: true });
  const esc = query !== "" ? "Clear" : scope !== null ? "Back" : "Close";
  return (
    // The scrim is the pointer's way out: it covers the whole window, and a press that lands on
    // it (not on the panel it holds) closes. `pointerdown`, not `click`, so a drag that starts
    // in a field and ends on the scrim does not close. `fixed`, not `absolute`: this mounts
    // inside the stage, and the dim has to reach the rail and the frame row too. `no-drag`
    // because the frame row's drag strip would otherwise swallow a press on the top 34px
    // (which also means the window cannot be dragged while Settings is open).
    <div
      className="fixed inset-0 z-35 flex items-start justify-center bg-black/55 pt-[64px] [-webkit-app-region:no-drag]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="ui-preset flex max-h-[calc(100%-128px)] w-[760px] max-w-[calc(100%-48px)] flex-col overflow-hidden rounded-xl bg-background text-foreground ring-1 ring-foreground/15"
      >
        <header className="flex shrink-0 flex-col gap-2 border-b p-3">
          <SearchField
            inputRef={searchRef}
            scope={scope}
            scopeLabel={scope === null ? null : areaLabel(scope, sources)}
          />
          <AreaChips scope={scope} onChoose={focusSearch} />
        </header>
        {load.status === "error" ? (
          <LoadError message={load.message} onRetry={() => void initSettings()} />
        ) : null}
        <div
          role="region"
          aria-label="Results"
          aria-busy={loading}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5"
        >
          <fieldset disabled={loading} className="min-w-0">
            <List
              items={listItems}
              active={activeKey}
              sources={sources}
              crumbs={scope === null && query.trim() === ""}
              locked={loading}
              focusSearch={focusSearch}
            />
          </fieldset>
        </div>
        <Footer move={items.some(isNavigable)} enter={enterLabel(current)} esc={esc} />
      </section>
    </div>
  );
}

export function CommandSettings({ open, onClose }: CommandSettingsProps) {
  return open ? <CommandSurface onClose={onClose} /> : null;
}
