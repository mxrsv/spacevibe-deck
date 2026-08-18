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
import { effect, signal, type Signal } from '@preact/signals';
import { Store } from '../host/store-host';
import { reportPersistError } from '../chrome/events';
import { tabViews, activeTabIndex } from './tabs-store';
import { fileSurfaces, activeFileTab } from '../files/file-surface-store';
import {
  MAX_JOURNAL_TABS,
  pushArchiveEntry,
  validateArchive,
  validateWindowRecord,
  type ArchiveEntry,
  type SessionFileSurface,
  type SessionTab,
  type WindowRecord,
} from '../lib/session-schema';

export const SESSION_STORE_FILE = 'session.json';

const ARCHIVE_KEY = 'archive';
/**
 * Registry of every `window:<label>` key ever written, so `readWindowRecords`
 * can enumerate them through nothing but `get`/`set` — `Store` (the renderer
 * facade) has no "list keys" primitive, unlike the main-process `JsonStore`
 * it wraps.
 */
const LABELS_KEY = 'windowLabels';
const MARKER_KEY = 'restoreAttempt';
const DEFAULT_DEBOUNCE_MS = 1000;

function windowKey(label: string): string {
  return `window:${label}`;
}

type StoreSeam = Pick<Store, 'get' | 'set' | 'delete' | 'save'>;

export interface SessionJournalDeps {
  /** TabManager.captureSession, injected to avoid a manager import cycle. */
  capture(): readonly SessionTab[];
  /** This window's label, from `currentWindowLabel()` (added in this task). */
  windowLabel: string;
  /** True only for the normal-boot (main) window; adopt windows pass false. */
  isMain: boolean;
  store?: StoreSeam; // test seam
  debounceMs?: number; // default 1000
}

/** Last known session per workspace — the rail's data source. */
export const sessionArchive: Signal<Readonly<Record<string, ArchiveEntry>>> = signal({});

let storePromise: Promise<StoreSeam> | null = null;
let activeDeps: SessionJournalDeps | null = null;
let disposeEffect: (() => void) | null = null;
let suspended = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

function openStore(): Promise<StoreSeam> {
  return (storePromise ??= Store.load(SESSION_STORE_FILE, {
    defaults: {},
    autoSave: false,
  }));
}

async function registeredLabels(store: StoreSeam): Promise<readonly string[]> {
  const raw = await store.get<unknown>(LABELS_KEY);
  return Array.isArray(raw)
    ? raw.filter((label): label is string => typeof label === 'string')
    : [];
}

async function registerLabel(store: StoreSeam, label: string): Promise<void> {
  const current = await registeredLabels(store);
  if (current.includes(label)) {
    return;
  }
  await store.set(LABELS_KEY, [...current, label]);
}

async function unregisterLabel(store: StoreSeam, label: string): Promise<void> {
  const current = await registeredLabels(store);
  if (!current.includes(label)) {
    return;
  }
  await store.set(
    LABELS_KEY,
    current.filter((entry) => entry !== label),
  );
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
  return result;
}

export async function clearWindowRecord(label: string): Promise<void> {
  const store = await openStore();
  await store.delete(windowKey(label));
  await unregisterLabel(store, label);
  await store.save();
}

/**
 * Crash-loop guard for boot restore, the `update-attempt.json` pattern
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
  return {
    savedAt: Date.now(),
    activeTabIndex: activeTabIndex.value,
    tabs: cappedTabs(deps),
    files: deps.isMain ? fileSurfacesToRecords() : [],
    activeFileTab: deps.isMain ? activeFileTab.value : null,
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

async function writeNow(deps: SessionJournalDeps): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const record = buildRecord(deps);
  const fingerprint = fingerprintOf(record);
  if (fingerprint === lastWritten) {
    return;
  }
  try {
    const store = await openStore();
    await store.set(windowKey(deps.windowLabel), record);
    await registerLabel(store, deps.windowLabel);
    if (deps.isMain) {
      let next = sessionArchive.value;
      for (const [workspacePath, tabs] of groupTabsByWorkspace(record.tabs)) {
        next = pushArchiveEntry(next, workspacePath, {
          savedAt: record.savedAt,
          tabs,
        });
      }
      sessionArchive.value = next;
      await store.set(ARCHIVE_KEY, next);
    }
    await store.save();
    lastWritten = fingerprint;
  } catch (err) {
    console.warn('Failed to write session journal:', err);
    reportPersistError("Couldn't save your session — it may not restore.");
  }
}

function schedule(deps: SessionJournalDeps): void {
  if (suspended) {
    return;
  }
  if (timer !== null) {
    clearTimeout(timer);
  }
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  timer = setTimeout(() => {
    timer = null;
    void writeNow(deps);
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
    console.warn('Failed to load session archive:', err);
    reportPersistError("Couldn't load your saved sessions.");
  }
  activeDeps = deps;
  disposeEffect?.();
  disposeEffect = effect(() => {
    // Read every dependency so the effect re-runs on any of them — the
    // record itself is rebuilt from `deps.capture()` inside `writeNow`, not
    // from these values, but each one changing is what a write must react to.
    tabViews.value;
    activeTabIndex.value;
    fileSurfaces.value;
    activeFileTab.value;
    schedule(deps);
  });
}

/** Pause captures (restore in flight must not clobber the journal). */
export function suspendSessionJournal(): void {
  suspended = true;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export function resumeSessionJournal(): void {
  suspended = false;
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
 * still blocks re-arming after this write, because `suspended` stays true.
 */
export async function flushSessionJournal(
  options: { readonly force?: boolean } = {},
): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (activeDeps === null || (suspended && options.force !== true)) {
    return;
  }
  await writeNow(activeDeps);
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
  suspended = false;
  lastWritten = null;
  sessionArchive.value = {};
}
