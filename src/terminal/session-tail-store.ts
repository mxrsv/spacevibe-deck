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
import { effect, signal, type Signal } from "@preact/signals";
import { available as electronHostAvailable } from "../host/worktree-host";
import { sessionTails } from "../host/session-tail-host";
import { NO_PANES, tabViews, type PaneView, type TabView } from "./tabs-store";
import type { ResumeRequest, SessionTailAnswer } from "../lib/agent-resume";

/** Newest turn per pane id. Absent means "nothing known", never "silent". */
export const paneTails: Signal<ReadonlyMap<number, string>> = signal(new Map());

/**
 * Which session each pane is PAIRED with — the second half of what the store
 * holds, and the reason a sentence stays where it belongs.
 *
 * The main process cannot know which conversation a pane is running; it ranks
 * candidates by how close their mtime falls to the pane's clock. Re-asked every
 * few seconds, that ranking answered differently every time: a pane was
 * re-paired, its old session was released to the next pane, and because a null
 * tail keeps the sentence already on screen, one sentence ended up printed on
 * three rows at once (2026-08-22).
 *
 * So the pairing is remembered here and sent back as `preferredId`, and a pane
 * whose pairing DOES change drops its sentence with it. Deliberately not a
 * signal: nothing renders it, and it must not re-arm the effect that fetches.
 */
const paneSessions = new Map<number, string>();

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
/** Bumped by `resetSessionTailStore`, so an in-flight answer can be discarded. */
let epoch = 0;
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
 *
 * **A mark says "ask for this pane", never "this pane is running session X".**
 * It briefly carried the resolved session id (2026-08-22) so a restored pane
 * would start out pinned to the conversation it actually reopened. That was
 * withdrawn the same day, on review: a mark is keyed by (workspace, agent) and
 * has NO causal link to a pane. It is claimed by the first matching pane the
 * process poll happens to recognize, which need not be the pane that typed
 * `--resume <id>` — refs `[none, B]` leave one mark that the FRESH pane takes —
 * and it is left as soon as `materialize` resolves, while the command is only
 * armed and its `writePty` can still fail. Under the old count both mistakes
 * cost an extra question. Under an id they would have pinned a row to a
 * conversation it is not in, permanently. Pinning a restored pane correctly
 * needs a mark bound to a pane id, which is the tab-materialization seam and
 * therefore a fork; until then the first pairing is ranked like any other.
 */
const resumeClaims = new Map<string, number>();
const resumedPaneIds = new Set<number>();

function claimKey(workspacePath: string | null, agent: string): string {
  // NUL: a path cannot contain one, so no pair of coordinates can collide.
  return `${workspacePath ?? ""}\u0000${agent}`;
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

/**
 * Fingerprint of what would change a tail: each pane's changedAt, its AGENT
 * and whether it has run.
 *
 * `changedAt` alone is not enough, because it bumps only when a pane's VISIBLE
 * state changes. Two generation changes can slip past it — a pane going from
 * `codex` to `claude`, and the attention gate reopening for a fresh agent of
 * the same name (`hasRun` back to false) — and this batch would then be skipped
 * as a repeat, leaving `prune` unrun and the row wearing the previous
 * occupant's sentence.
 *
 * EVERY pane counts, not just agent panes: a pane dropping to a shell is a
 * generation change too, and it has to be noticed to be forgotten.
 */
function fingerprintOf(tabs: readonly TabView[]): string {
  return tabs
    .flatMap((tab) =>
      panesOf(tab).map(
        (pane) => `${pane.paneId}:${pane.agent ?? ""}:${pane.hasRun ? 1 : 0}:${pane.changedAt}`,
      ),
    )
    .join("|");
}

/** Every pane id in the snapshot, agent or not — the prune's survivor list. */
function livePaneIds(tabs: readonly TabView[]): Set<number> {
  const ids = new Set<number>();
  for (const tab of tabs) {
    for (const pane of panesOf(tab)) {
      ids.add(pane.paneId);
    }
  }
  return ids;
}

/**
 * What a pane was running the last time this store looked. A pairing is only
 * valid for one occupant of a pane, and a pane id outlives its occupants.
 */
interface PaneGeneration {
  readonly agent: string | null;
  readonly ran: boolean;
}

const paneGenerations = new Map<number, PaneGeneration>();

/**
 * Whether the thing running in this pane is a NEW one since the last look.
 *
 * Two tells, both off `PaneView`, both produced by
 * [`agent-attention.ts`](./agent-attention.ts)'s own generation handling:
 *
 * - the agent label changed, which covers `claude` → `codex` directly and
 *   `claude` → shell → `claude` through its `null` step;
 * - `hasRun` went from true back to false, which is the gate reopening for a
 *   fresh agent in the same pane. Only that DIRECTION counts: false → true is
 *   the same agent finally doing something, not a new one.
 *
 * A pane seen for the first time is not a new generation — there is nothing
 * for it to have replaced.
 */
function isNewGeneration(pane: PaneView, previous: PaneGeneration | undefined): boolean {
  if (previous === undefined) {
    return false;
  }
  return previous.agent !== pane.agent || (previous.ran && !pane.hasRun);
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
      const preferredId = paneSessions.get(pane.paneId);
      entries.push({
        paneId: pane.paneId,
        request: {
          agent: pane.agent,
          cwd: tab.workspacePath,
          lastSeenAt: pane.changedAt || now,
          // Absent on the first ask for this pane; from then on it is what
          // keeps the answer stable instead of re-guessed every few seconds.
          ...(preferredId === undefined ? {} : { preferredId }),
        },
      });
    }
  }
  return entries;
}

/**
 * Merge answers into a NEW map (C1), and update the pairings alongside.
 *
 * Four cases, and the last one is the whole fix:
 *
 * - **No answer at all** — nothing could be paired this time (a scan that
 *   raced a write, a cwd that drifted). Keep the sentence AND the pairing: an
 *   absent scan is not evidence that the pane went quiet.
 * - **Same session, no sentence in the window** — keep what is on screen. This
 *   is the common case for a working pane, whose own tool traffic pushes its
 *   last words out of the read window.
 * - **Same session, a sentence** — take it.
 * - **A DIFFERENT session** — take the new pairing and the new text, INCLUDING
 *   when there is no new text. A sentence belongs to a conversation, and this
 *   pane is not in that conversation any more; keeping it is how one sentence
 *   used to end up on every row it had ever passed through.
 */
function merged(
  current: ReadonlyMap<number, string>,
  entries: readonly TailEntry[],
  answers: readonly (SessionTailAnswer | null)[],
): ReadonlyMap<number, string> {
  const next = new Map(current);
  entries.forEach((entry, index) => {
    const answer = answers[index];
    if (answer === null || answer === undefined) {
      return;
    }
    const repaired = paneSessions.get(entry.paneId) !== answer.id;
    paneSessions.set(entry.paneId, answer.id);
    if (answer.tail !== null && answer.tail.length > 0) {
      next.set(entry.paneId, answer.tail);
    } else if (repaired) {
      next.delete(entry.paneId);
    }
  });
  return next;
}

/** Everything this store remembers about one pane, gone. */
function forget(next: Map<number, string>, paneId: number): void {
  next.delete(paneId);
  paneSessions.delete(paneId);
  resumedPaneIds.delete(paneId);
}

/**
 * Drop what is remembered about panes the window no longer has, AND about
 * panes whose occupant has been replaced.
 *
 * The second half is the one that is easy to miss: a pane id is reused by
 * whatever runs in that split next, so without it a pairing survives its own
 * conversation. The pane then keeps SENDING that pairing as `preferredId`, the
 * main process keeps honouring it, and the new agent's row is pinned to the
 * previous agent's sentence for as long as the pane lives — a worse failure
 * than the drifting this store's pinning was added to stop, because a drift
 * corrects itself and a pin does not.
 */
function prune(
  current: ReadonlyMap<number, string>,
  tabs: readonly TabView[],
  live: Set<number>,
): ReadonlyMap<number, string> {
  const next = new Map(current);
  for (const paneId of [...next.keys(), ...paneSessions.keys(), ...paneGenerations.keys()]) {
    if (!live.has(paneId)) {
      forget(next, paneId);
      paneGenerations.delete(paneId);
    }
  }
  for (const tab of tabs) {
    for (const pane of panesOf(tab)) {
      if (isNewGeneration(pane, paneGenerations.get(pane.paneId))) {
        forget(next, pane.paneId);
      }
      paneGenerations.set(pane.paneId, { agent: pane.agent, ran: pane.hasRun });
    }
  }
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
  // Forgetting comes first, and unconditionally — a tail that outlives its
  // pane, or its pane's occupant, is the same fossil this module exists to
  // prevent, one scope up. Guarded on a non-empty snapshot because a window
  // momentarily publishes no tabs during restore, and pruning against that
  // would forget every pane in the window.
  if (tabs.length > 0) {
    const pruned = prune(paneTails.value, tabs, livePaneIds(tabs));
    // `prune` only ever deletes, so a size match IS a "nothing changed" proof
    // and the signal is left alone. Anything that could add would need a
    // different test.
    if (pruned.size !== paneTails.value.size) {
      paneTails.value = pruned;
    }
  }
  const entries = entriesOf(tabs);
  sentFingerprint = fingerprint;
  if (entries.length === 0) {
    return;
  }
  inFlight = true;
  const epochAtSend = epoch;
  try {
    const answers = await sessionTails(entries.map((entry) => entry.request));
    // A reset while this was in flight means those entries describe panes that
    // no longer exist as far as this store is concerned; merging them would
    // rebuild the state the reset just cleared.
    if (epoch === epochAtSend) {
      paneTails.value = merged(paneTails.value, entries, answers);
    }
  } catch (err) {
    console.warn("Failed to read session tails:", err);
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
  epoch += 1;
  resumeClaims.clear();
  resumedPaneIds.clear();
  paneSessions.clear();
  paneGenerations.clear();
  paneTails.value = new Map();
}
