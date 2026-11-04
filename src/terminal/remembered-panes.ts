/**
 * The rail's remembered rows: agent panes of a past session that stay on the
 * rail, dimmed, until the user resumes or forgets them (launcher spec LCH-2).
 *
 * They live under their own `remembered` key in `session.json` rather than in
 * the `archive`, because the archive is replaced for every workspace with a
 * live tab on each main-window write: resuming one of two remembered panes of
 * a project would overwrite the other. The archive and the window records keep
 * their shape and their writer (`session-journal.ts`); this module only adds a
 * key beside them, through the same store.
 *
 * Nothing here runs unless a caller invokes it, and no caller exists until the
 * `stageLauncher` stage wires boot.
 */
import { signal, type Signal } from "@preact/signals";
import { Store } from "../host/store-host";
import { reportPersistError } from "../chrome/events";
import {
  normalizeRememberedPanes,
  rememberedPaneId,
  validateRememberedPanes,
  type RememberedPane,
  type WindowRecord,
} from "../lib/session-schema";
import { SESSION_STORE_FILE } from "./session-journal";

const REMEMBERED_KEY = "remembered";

type StoreSeam = Pick<Store, "get" | "set" | "save" | "loadState">;

export const rememberedPanes: Signal<readonly RememberedPane[]> = signal([]);

/** Set by a successful load; stays null (write-locked) when the store cannot be trusted. */
let writable: StoreSeam | null = null;
/** Writes run strictly in call order, so a slow save cannot land after a newer one. */
let writeChain: Promise<void> = Promise.resolve();

/**
 * Read and validate the key into `rememberedPanes`.
 *
 * An unreadable store, or a read that throws, leaves the list empty AND the
 * module write-locked: the bytes may hold rows we could not parse, and writing
 * an empty list over them would destroy what a repair could recover. A key
 * that is merely absent or malformed is an ordinary empty list.
 */
export async function loadRememberedPanes(options: { store?: StoreSeam } = {}): Promise<void> {
  writable = null;
  rememberedPanes.value = [];
  try {
    const store =
      options.store ?? (await Store.load(SESSION_STORE_FILE, { defaults: {}, autoSave: false }));
    if (store.loadState.state === "unreadable") {
      console.warn("remembered panes: session.json is unreadable; rows disabled");
      return;
    }
    rememberedPanes.value = validateRememberedPanes(await store.get<unknown>(REMEMBERED_KEY));
    writable = store;
  } catch (err) {
    console.warn("Failed to load remembered panes:", err);
    reportPersistError("Couldn't load your remembered agents.");
  }
}

/**
 * One entry per agent pane of a window record. A pane without a cwd, or in a
 * tab without a workspace, has no row to sit under and is skipped (the archive
 * skips workspace-less tabs the same way).
 *
 * `title` is the tab's name, and only for a one-pane tab: that is the single
 * human label the journal records, and it names the tab, not a conversation.
 * `branch` is null: nothing in the journal records one.
 */
export function rememberedFromRecord(record: WindowRecord): readonly RememberedPane[] {
  return record.tabs.flatMap((tab) =>
    tab.workspacePath === null
      ? []
      : tab.panes.flatMap((pane) =>
          pane.agent === null || pane.cwd === null
            ? []
            : [
                {
                  id: rememberedPaneId(pane.agent, pane.cwd),
                  workspacePath: tab.workspacePath as string,
                  cwd: pane.cwd,
                  agent: pane.agent,
                  launchCommand: pane.launchCommand,
                  title: tab.panes.length === 1 ? tab.name : null,
                  branch: null,
                  sessionId: pane.sessionId ?? null,
                  savedAt: record.savedAt,
                },
              ],
        ),
  );
}

function persist(next: readonly RememberedPane[]): Promise<void> {
  const store = writable;
  if (store === null) {
    return Promise.resolve();
  }
  writeChain = writeChain
    .then(async () => {
      await store.set(REMEMBERED_KEY, next);
      await store.save();
    })
    .catch((err: unknown) => {
      console.warn("Failed to write remembered panes:", err);
      reportPersistError("Couldn't save your remembered agents.");
    });
  return writeChain;
}

function commit(next: readonly RememberedPane[]): Promise<void> {
  if (writable === null) {
    return Promise.resolve();
  }
  rememberedPanes.value = next;
  return persist(next);
}

/**
 * Fold the previous session's agent panes in. Call it with the main window
 * record read BEFORE the journal's first write, which replaces that record.
 * Merging the same record again changes nothing (same agent + cwd, same
 * `savedAt`); a newer one replaces the older row.
 */
export function mergeFromRecord(
  previousMainRecord: WindowRecord | null | undefined,
): Promise<void> {
  if (previousMainRecord === null || previousMainRecord === undefined) {
    return Promise.resolve();
  }
  return commit(
    normalizeRememberedPanes([
      ...rememberedPanes.value,
      ...rememberedFromRecord(previousMainRecord),
    ]),
  );
}

/** The row was resumed: drop it. Other rows, including the same project's, stay. */
export function remove(id: string): Promise<void> {
  const next = rememberedPanes.value.filter((pane) => pane.id !== id);
  return next.length === rememberedPanes.value.length ? Promise.resolve() : commit(next);
}

/** The user closed the row (its ✕). Same effect as `remove`; the name keeps call sites honest. */
export const forget = remove;

/** Tests only. */
export function resetRememberedPanes(): void {
  writable = null;
  writeChain = Promise.resolve();
  rememberedPanes.value = [];
}
