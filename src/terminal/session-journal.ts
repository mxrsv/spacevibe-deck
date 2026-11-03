/**
 * Session journal — the continuously-written `session.json`.
 *
 * A debounced effect mirrors this window's live tabs (and, for the main
 * window, its file surfaces) into `window:<label>` on every relevant signal
 * change, so the file is current at the moment of a hard power-off rather
 * than only at a clean quit. A per-workspace `archive` entry is folded in on
 * every main-window write, which is what `sessionArchive` (the rail's data
 * source) reads back.
 *
 * `openStore()` is lazily memoized and shared by every export in this module
 * — `readWindowRecords`/`clearWindowRecord`/`sessionRestoreMarker` run at
 * boot BEFORE `initSessionJournal`, so none of them may depend on init having
 * run first. Whichever caller opens the store first wins; everyone else
 * reuses that same instance.
 */
import { effect, signal, type Signal } from "@preact/signals";
import { Store } from "../host/store-host";
import { reportPersistError } from "../chrome/events";
import { tabViews, activeTabIndex } from "./tabs-store";
import { fileSurfaces, activeFileTab } from "../files/file-surface-store";
import { agentBoardOpen, agentBoardSurfaceActive } from "../ui/agent-board-store";
import { paneTaskPrompts } from "./board-task-prompts";
import {
  MAX_JOURNAL_TABS,
  pushArchiveEntry,
  validateArchive,
  validateWindowRecord,
  type ArchiveEntry,
  type SessionFileSurface,
  type SessionTab,
  type WindowRecord,
} from "../lib/session-schema";

export const SESSION_STORE_FILE = "session.json";

const ARCHIVE_KEY = "archive";
const PENDING_RESTORE_KEY = "pendingRestore";
const PENDING_LABEL_PREFIX = "pending-restore:";
/**
 * Main derives this virtual index from the existing `window:<label>` keys.
 * Keeping the read key preserves the facade without a shared array that
 * concurrent renderers could overwrite with stale labels.
 */
const LABELS_KEY = "windowLabels";
const MARKER_KEY = "restoreAttempt";
const DEFAULT_DEBOUNCE_MS = 1000;

function windowKey(label: string): string {
  return `window:${label}`;
}

type StoreSeam = Pick<Store, "get" | "set" | "delete" | "save" | "patch">;

export interface SessionJournalDeps {
  /** TabManager.captureSession, injected to avoid a manager import cycle. */
  capture(): readonly SessionTab[];
  /** This window's label, from `currentWindowLabel()` (added in this task). */
  windowLabel: string;
  /** True only for the normal-boot (main) window; adopt windows pass false. */
  isMain: boolean;
  /**
   * True while an EMPTY capture must not overwrite this window's record: the
   * Board is still offering the last session read from it, and a write of the
   * fresh, tabless window would erase that offer for the next launch.
   */
  holdEmpty?(): boolean;
  store?: StoreSeam; // test seam
  debounceMs?: number; // default 1000
}

/** Last known session per workspace — the rail's data source. */
export const sessionArchive: Signal<Readonly<Record<string, ArchiveEntry>>> = signal({});

let storePromise: Promise<StoreSeam> | null = null;
let activeDeps: SessionJournalDeps | null = null;
let disposeEffect: (() => void) | null = null;
// Restore and lifecycle teardown can overlap. A depth keeps one caller's
// resume from releasing another caller's still-active suspension.
let suspensionDepth = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;
let writeTail: Promise<void> = Promise.resolve();
let pendingRestore: ReadonlyMap<string, WindowRecord> = new Map();
let consumedLabels: ReadonlySet<string> = new Set();
let restoreCheckpointPending = false;

function serializeWrite(operation: () => Promise<void>): Promise<void> {
  const next = writeTail.then(operation);
  writeTail = next.catch(() => {});
  return next;
}

async function readPendingRestore(store: StoreSeam): Promise<ReadonlyMap<string, WindowRecord>> {
  const raw = await store.get<unknown>(PENDING_RESTORE_KEY);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return new Map();
  return new Map(
    Object.entries(raw).flatMap(([label, value]) => {
      const record = validateWindowRecord(value);
      return record === null || record.tabs.length === 0 ? [] : [[label, record] as const];
    }),
  );
}

/** Stage a restore checkpoint; the next flush saves it with the live capture
 * and removes consumed source records in the SAME atomic store save. */
export function retainPendingSessionRestore(
  records: ReadonlyMap<string, WindowRecord>,
  sourceLabels: Iterable<string>,
): ReadonlyMap<string, WindowRecord> {
  // Give each source record its own slot. A fresh main record and an older
  // pending main record may both fail on the next launch; keying by their
  // original label would overwrite one and lose its timestamp and tabs.
  pendingRestore = new Map([...records.values()].map((record, index) => [String(index), record]));
  consumedLabels = new Set(
    [...consumedLabels, ...sourceLabels].filter((label) => !label.startsWith(PENDING_LABEL_PREFIX)),
  );
  lastWritten = null;
  restoreCheckpointPending = true;
  return new Map(
    [...pendingRestore].map(([label, record]) => [`${PENDING_LABEL_PREFIX}${label}`, record]),
  );
}

function openStore(): Promise<StoreSeam> {
  return (storePromise ??= Store.load(SESSION_STORE_FILE, {
    defaults: {},
    autoSave: false,
  }));
}

async function registeredLabels(store: StoreSeam): Promise<readonly string[]> {
  const raw = await store.get<unknown>(LABELS_KEY);
  return Array.isArray(raw)
    ? raw.filter((label): label is string => typeof label === "string")
    : [];
}

/** Read all persisted window records (restore) and the archive. */
export async function readWindowRecords(): Promise<ReadonlyMap<string, WindowRecord>> {
  const store = await openStore();
  const labels = await registeredLabels(store);
  const result = new Map<string, WindowRecord>();
  for (const label of labels) {
    const raw = await store.get<unknown>(windowKey(label));
    const record = validateWindowRecord(raw);
    if (record !== null) {
      result.set(label, record);
    }
  }
  for (const [label, record] of await readPendingRestore(store)) {
    result.set(`${PENDING_LABEL_PREFIX}${label}`, record);
  }
  return result;
}

export async function clearWindowRecord(label: string): Promise<void> {
  await serializeWrite(async () => {
    const store = await openStore();
    if (label === activeDeps?.windowLabel) lastWritten = null;
    await store.delete(windowKey(label));
    await store.save();
  });
}

/**
 * Crash-loop guard for session restore, the `update-attempt.json` pattern
 * applied to `session.json` under key `restoreAttempt`. `take()` deliberately
 * does NOT clear the marker — restore decides whether/when to clear it, so a
 * restore that never finishes leaves it set for next launch to see.
 */
export const sessionRestoreMarker = {
  async take(): Promise<boolean> {
    const store = await openStore();
    const raw = await store.get<unknown>(MARKER_KEY);
    return raw !== undefined && raw !== null;
  },
  async set(): Promise<void> {
    const store = await openStore();
    await store.set(MARKER_KEY, true);
    await store.save();
  },
  async clear(): Promise<void> {
    const store = await openStore();
    await store.delete(MARKER_KEY);
    await store.save();
  },
};

function fileSurfacesToRecords(): readonly SessionFileSurface[] {
  return [...fileSurfaces.value.entries()]
    .filter(([, state]) => state.tabs.length > 0)
    .map(([workspacePath, state]) => ({
      workspacePath,
      tabs: state.tabs.map((tab) => ({
        path: tab.path,
        preview: tab.preview,
      })),
      activePath: state.activePath,
    }));
}

/** `validateWindowRecord`/`validateArchiveEntry` already cap on read, but the
 *  write path persisted `capture()` uncapped — a workspace past
 *  MAX_JOURNAL_TABS lost tabs silently on the next restore. Cap here too, so
 *  what's written matches what a later read would accept. */
function cappedTabs(deps: SessionJournalDeps): readonly SessionTab[] {
  const tabs = deps.capture();
  if (tabs.length <= MAX_JOURNAL_TABS) {
    return tabs;
  }
  console.warn(
    `session journal: captured ${tabs.length} tabs for window "${deps.windowLabel}", truncating to ${MAX_JOURNAL_TABS}`,
  );
  return tabs.slice(0, MAX_JOURNAL_TABS);
}

function buildRecord(deps: SessionJournalDeps): WindowRecord {
  const tabs = cappedTabs(deps);
  return {
    savedAt: Date.now(),
    activeTabIndex: activeTabIndex.value,
    tabs,
    files: deps.isMain ? fileSurfacesToRecords() : [],
    activeFileTab: deps.isMain ? activeFileTab.value : null,
    // Zero tabs = no Board (spec §4.2): the chip cannot render, so a
    // remembered `true` would restore a surface with nothing to show. Written
    // false rather than left alone, so the next launch does not retry it.
    // Always false while `AGENT_BOARD_RETIRED` holds: nothing raises the Board.
    agentBoardOpen: tabs.length > 0 && agentBoardOpen.value,
    agentBoardSurfaceActive:
      tabs.length > 0 && agentBoardOpen.value && agentBoardSurfaceActive.value,
  };
}

/** Same record, minus `savedAt` — the dedup fingerprint. */
function fingerprintOf(record: WindowRecord): string {
  const { savedAt: _savedAt, ...rest } = record;
  return JSON.stringify(rest);
}

function groupTabsByWorkspace(
  tabs: readonly SessionTab[],
): ReadonlyMap<string, readonly SessionTab[]> {
  const map = new Map<string, SessionTab[]>();
  for (const tab of tabs) {
    if (tab.workspacePath === null) {
      continue;
    }
    const existing = map.get(tab.workspacePath);
    if (existing === undefined) {
      map.set(tab.workspacePath, [tab]);
    } else {
      existing.push(tab);
    }
  }
  return map;
}

async function writeNow(deps: SessionJournalDeps, strict = false): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const record = buildRecord(deps);
  if (record.tabs.length === 0 && deps.holdEmpty?.() === true && !restoreCheckpointPending) {
    return;
  }
  const pending = pendingRestore;
  const consumed = consumedLabels;
  const fingerprint = JSON.stringify([fingerprintOf(record), [...pending]]);
  if (fingerprint === lastWritten && !restoreCheckpointPending && consumedLabels.size === 0) {
    return;
  }
  try {
    const store = await openStore();
    let next = sessionArchive.value;
    if (deps.isMain) {
      // Pending tabs have their own dated records; archive is only the rail's
      // bounded view. Put pending tabs first so a live capture cannot hide them.
      const archiveTabs = [...pending.values()].flatMap((entry) => entry.tabs).concat(record.tabs);
      for (const [workspacePath, tabs] of groupTabsByWorkspace(archiveTabs)) {
        next = pushArchiveEntry(next, workspacePath, {
          savedAt: record.savedAt,
          tabs: tabs.slice(0, MAX_JOURNAL_TABS),
        });
      }
    }
    const values = {
      [windowKey(deps.windowLabel)]: record,
      ...(deps.isMain
        ? { [ARCHIVE_KEY]: next, [PENDING_RESTORE_KEY]: Object.fromEntries(pending) }
        : {}),
    };
    const deleted = deps.isMain
      ? [...consumed].filter((label) => label !== deps.windowLabel).map(windowKey)
      : [];
    await store.patch(values, deleted);
    if (deps.isMain) sessionArchive.value = next;
    lastWritten = fingerprint;
    if (pendingRestore === pending) {
      restoreCheckpointPending = false;
      consumedLabels = new Set([...consumedLabels].filter((label) => !consumed.has(label)));
    }
  } catch (err) {
    // The store may already hold an unsaved newer record. Even a return to
    // the last durable capture must rewrite it before a strict flush can ACK.
    lastWritten = null;
    console.warn("Failed to write session journal:", err);
    reportPersistError("Couldn't save your session — it may not restore.");
    if (strict) throw err;
  }
}

function schedule(deps: SessionJournalDeps): void {
  if (suspensionDepth > 0) {
    return;
  }
  if (timer !== null) {
    clearTimeout(timer);
  }
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  timer = setTimeout(() => {
    timer = null;
    void serializeWrite(async () => {
      if (suspensionDepth === 0) await writeNow(deps);
    });
  }, debounceMs);
}

/** Load the store, seed `sessionArchive`, install the debounced write effect. */
export async function initSessionJournal(deps: SessionJournalDeps): Promise<void> {
  if (deps.store) {
    storePromise = Promise.resolve(deps.store);
  }
  const store = await openStore();
  try {
    const raw = await store.get<unknown>(ARCHIVE_KEY);
    sessionArchive.value = validateArchive(raw);
  } catch (err) {
    console.warn("Failed to load session archive:", err);
    reportPersistError("Couldn't load your saved sessions.");
  }
  // A failed pending-record read must never turn into permission to overwrite it.
  if (deps.isMain) pendingRestore = await readPendingRestore(store);
  activeDeps = deps;
  disposeEffect?.();
  disposeEffect = effect(() => {
    // Read every dependency so the effect re-runs on any of them — the
    // record itself is rebuilt from `deps.capture()` inside `writeNow`, not
    // from these values, but each one changing is what a write must react to.
    void tabViews.value;
    void activeTabIndex.value;
    void fileSurfaces.value;
    void activeFileTab.value;
    // Opening or closing the chip is a change a write must react to; without
    // this read the effect never re-runs for it, and the state is saved only
    // when something else happens to move.
    void agentBoardOpen.value;
    // Switching between an existing Board chip and the terminal must also save.
    void agentBoardSurfaceActive.value;
    // Same reason, and it bites harder: `TASK_PROMPT_AUTOSEND` is false, so a
    // launch's prompt is normally recorded AFTER the agent appeared and
    // `tabViews` already moved. Nothing else changes while the text sits
    // unsent in the composer, so without this read the field a Board card
    // exists to print is the one thing a crash loses.
    void paneTaskPrompts.value;
    schedule(deps);
  });
}

/** Pause captures (restore in flight must not clobber the journal). */
export function suspendSessionJournal(): void {
  suspensionDepth += 1;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Begin a user restore only when no close/quit capture already owns the journal. */
export function trySuspendSessionJournal(): boolean {
  if (suspensionDepth > 0) return false;
  suspendSessionJournal();
  return true;
}

export function resumeSessionJournal(): void {
  const wasSuspended = suspensionDepth > 0;
  suspensionDepth = Math.max(0, suspensionDepth - 1);
  if (wasSuspended && suspensionDepth === 0 && activeDeps !== null) schedule(activeDeps);
}

/**
 * Write pending state now — the quit flow's flush hook.
 *
 * `force` exists because the quit flow SUSPENDS first, on purpose: a pane-exit
 * signal arriving mid-teardown must not re-arm the debounce and clobber what
 * was just flushed. Without `force` that ordering made this function a no-op
 * — it cancelled the armed write and then returned on the suspension check,
 * so quitting inside the debounce window silently dropped the last tab change
 * instead of persisting it. Suspension still blocks every OTHER caller, and
 * still blocks re-arming after this write, because the suspension stays held.
 */
export async function flushSessionJournal(
  options: { readonly force?: boolean; readonly strict?: boolean } = {},
): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (activeDeps === null) {
    if (options.strict) throw new Error("Session journal is not initialized");
    return;
  }
  if (suspensionDepth > 0 && options.force !== true) {
    if (options.strict)
      throw new Error("Session journal is busy; retry after the current operation");
    return;
  }
  const deps = activeDeps;
  await serializeWrite(async () => {
    // Quit owns one suspension. It cannot acknowledge a partial restore that
    // owns another, including a restore started while this write was queued.
    const allowedSuspensions = options.force === true ? 1 : 0;
    if (suspensionDepth > allowedSuspensions) {
      if (options.strict)
        throw new Error("Session journal is busy; retry after the current operation");
      if (options.force !== true) return;
    }
    await writeNow(deps, options.strict);
  });
}

/** Tests only. */
export function resetSessionJournal(): void {
  disposeEffect?.();
  disposeEffect = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  storePromise = null;
  activeDeps = null;
  suspensionDepth = 0;
  lastWritten = null;
  writeTail = Promise.resolve();
  pendingRestore = new Map();
  consumedLabels = new Set();
  restoreCheckpointPending = false;
  sessionArchive.value = {};
}
