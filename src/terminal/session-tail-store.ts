/**
 * Session tail store — the newest thing each agent pane has said.
 *
 * The rail wants one sentence per agent row, and the only place that sentence
 * exists is the CLI's own session log on disk. Reading it is a main-process
 * job (`session_tail`), so this module's whole responsibility is deciding
 * WHEN to ask and holding the answers: a debounced effect on `tabViews` that
 * fires only when an agent pane's `changedAt` actually moved.
 *
 * Two rules carry the correctness here:
 *
 * - **A pane gets a request once it has `hasRun` OR was resumed into an
 *   existing conversation.** A freshly opened pane has never run anything, but
 *   its cwd may well hold a recent session from yesterday — asking for it would
 *   dress a silent pane in someone else's sentence. A RESTORED pane is the
 *   opposite case: yesterday's session is exactly the one it just typed
 *   `--resume` into, so it must not stay blank until the user prompts it again
 *   (2026-08-17). `noteResumedPane` is how the restore paths say so.
 * - **A `null` answer keeps the previous tail.** Not finding a session this
 *   time (a scan that raced a write, a cwd that drifted) is not evidence that
 *   what the pane said before is wrong.
 *
 * Window-scoped module store (R5), debounced like
 * [`session-journal.ts`](./session-journal.ts) and driven the same way — by
 * the signal changing, never by an interval.
 */
import { effect, signal, type Signal } from '@preact/signals';
import { available as electronHostAvailable } from '../host/worktree-host';
import { sessionTails } from '../host/session-tail-host';
import { NO_PANES, tabViews, type PaneView, type TabView } from './tabs-store';
import type { ResumeRequest } from '../lib/agent-resume';

/** Newest turn per pane id. Absent means "nothing known", never "silent". */
export const paneTails: Signal<ReadonlyMap<number, string>> = signal(new Map());

const DEBOUNCE_MS = 300;

/** One request plus the pane it answers for — the batch is positional. */
interface TailEntry {
  readonly paneId: number;
  readonly request: ResumeRequest;
}

let disposeEffect: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Fingerprint of the batch last SENT — the dedup key, kept on failure. */
let sentFingerprint: string | null = null;
let inFlight = false;
/** A change arrived mid-flight; re-run once the current batch settles. */
let queued = false;

function panesOf(tab: TabView): readonly PaneView[] {
  return tab.panes ?? NO_PANES;
}

/**
 * Resume marks, in two halves.
 *
 * A restore path knows WHICH conversation it is reopening long before the pane
 * running it exists: the command is typed into a shell whose agent process is
 * only recognized a poll or two later. So the mark is left by workspace and
 * agent — the same coordinates the tail request itself is built from — and is
 * CLAIMED by the first agent pane that matches it, which pins the answer to a
 * pane id for the rest of that pane's life.
 *
 * A count rather than a flag, because a restored workspace can bring back
 * three `claude` panes at once and agent detection staggers across polls;
 * consuming one mark for the whole workspace would strand the other two blank.
 * And a claim rather than a permanent (workspace, agent) mark, because a FRESH
 * pane opened in that workspace an hour later must still fall under the
 * never-run rule above.
 */
const resumeClaims = new Map<string, number>();
const resumedPaneIds = new Set<number>();

function claimKey(workspacePath: string | null, agent: string): string {
  // NUL: a path cannot contain one, so no pair of coordinates can collide.
  return `${workspacePath ?? ''}\u0000${agent}`;
}

/**
 * Say that one pane about to appear in `workspacePath` continues an existing
 * `agent` conversation. Called by the restore paths once materialization has
 * actually succeeded — an intent that never became a tab must not leave a mark
 * for an unrelated pane to claim later.
 */
export function noteResumedPane(workspacePath: string | null, agent: string): void {
  const key = claimKey(workspacePath, agent);
  resumeClaims.set(key, (resumeClaims.get(key) ?? 0) + 1);
}

/** Whether this pane is (or hereby becomes) the holder of a resume mark. */
function claimsResume(pane: PaneView, workspacePath: string | null): boolean {
  if (resumedPaneIds.has(pane.paneId)) {
    return true;
  }
  if (pane.agent === null) {
    return false;
  }
  const key = claimKey(workspacePath, pane.agent);
  const remaining = resumeClaims.get(key) ?? 0;
  if (remaining <= 0) {
    return false;
  }
  if (remaining === 1) {
    resumeClaims.delete(key);
  } else {
    resumeClaims.set(key, remaining - 1);
  }
  resumedPaneIds.add(pane.paneId);
  return true;
}

/** Fingerprint of what would change a tail: each agent pane's changedAt. */
function fingerprintOf(tabs: readonly TabView[]): string {
  return tabs
    .flatMap((tab) =>
      panesOf(tab)
        .filter((pane) => pane.agent !== null)
        .map((pane) => `${pane.paneId}:${pane.changedAt}`),
    )
    .join('|');
}

/**
 * The batch, in pane order. `cwd` is the TAB's workspace path — a known
 * approximation: a pane spawned in a subdirectory or another worktree drifts
 * from it, the main process's exact-match then fails silently, and that pane
 * simply keeps no tail (accepted for v1).
 */
function entriesOf(tabs: readonly TabView[]): readonly TailEntry[] {
  const now = Date.now();
  const entries: TailEntry[] = [];
  // Never-run panes are offered the marks FIRST, across every tab. A resumed
  // pane is by definition one that has not run, while the workspace it lands
  // in may already hold a live pane of the same agent — and that one sits
  // earlier in `tabViews`, so a single pass in list order would let it eat a
  // mark it does not need and leave the resumed pane blank, which is the exact
  // bug this exists to fix (the sessions panel's resume, 2026-08-17).
  for (const tab of tabs) {
    for (const pane of panesOf(tab)) {
      if (pane.agent !== null && !pane.hasRun) {
        claimsResume(pane, tab.workspacePath);
      }
    }
  }
  for (const tab of tabs) {
    for (const pane of panesOf(tab)) {
      if (pane.agent === null) {
        continue;
      }
      // Mop-up for the panes the first pass skipped: a restored pane the user
      // prompted before the first fetch has `hasRun` already, and its mark
      // must be spent here rather than left lying around for the next FRESH
      // pane in that workspace to pick up.
      const resumed = claimsResume(pane, tab.workspacePath);
      if (!pane.hasRun && !resumed) {
        continue;
      }
      entries.push({
        paneId: pane.paneId,
        request: {
          agent: pane.agent,
          cwd: tab.workspacePath,
          lastSeenAt: pane.changedAt || now,
        },
      });
    }
  }
  return entries;
}

/** Merge answers into a NEW map (C1); a null answer keeps what was there. */
function merged(
  current: ReadonlyMap<number, string>,
  entries: readonly TailEntry[],
  answers: readonly (string | null)[],
): ReadonlyMap<number, string> {
  const next = new Map(current);
  entries.forEach((entry, index) => {
    const tail = answers[index];
    if (typeof tail === 'string' && tail.length > 0) {
      next.set(entry.paneId, tail);
    }
  });
  return next;
}

/**
 * One batch, at most one in flight. The fingerprint is claimed BEFORE the
 * await so a repeat of the same state cannot re-send it; a rejection keeps
 * that claim on purpose — retrying every poll would be the interval this
 * module exists to avoid, and a missing tail is cosmetic.
 */
async function run(): Promise<void> {
  const tabs = tabViews.peek();
  const fingerprint = fingerprintOf(tabs);
  if (fingerprint === sentFingerprint) {
    return;
  }
  if (inFlight) {
    queued = true;
    return;
  }
  const entries = entriesOf(tabs);
  sentFingerprint = fingerprint;
  if (entries.length === 0) {
    return;
  }
  inFlight = true;
  try {
    const answers = await sessionTails(entries.map((entry) => entry.request));
    paneTails.value = merged(paneTails.value, entries, answers);
  } catch (err) {
    console.warn('Failed to read session tails:', err);
  } finally {
    inFlight = false;
    if (queued) {
      queued = false;
      // Recomputed from the live snapshot, which is what makes the LATEST
      // state win rather than the one that arrived first.
      void run();
    }
  }
}

function schedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, DEBOUNCE_MS);
}

function cancelTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Install the sync and return its disposer.
 *
 * Inert on a host with no `session_tail` channel — Tauri and the browser-only
 * preview both reach this code, and neither may issue the invoke. The flag is
 * read here, at call time, not captured at module load.
 */
export function installSessionTailSync(): () => void {
  if (!electronHostAvailable) {
    return () => {};
  }
  disposeEffect?.();
  const dispose = effect(() => {
    // The one dependency: any new `tabViews` identity re-arms the debounce,
    // and `run` decides from the fingerprint whether it was a real change.
    void tabViews.value;
    schedule();
  });
  disposeEffect = dispose;
  return () => {
    dispose();
    if (disposeEffect === dispose) {
      disposeEffect = null;
    }
    cancelTimer();
  };
}

/** Tests only. */
export function resetSessionTailStore(): void {
  disposeEffect?.();
  disposeEffect = null;
  cancelTimer();
  sentFingerprint = null;
  inFlight = false;
  queued = false;
  resumeClaims.clear();
  resumedPaneIds.clear();
  paneTails.value = new Map();
}
