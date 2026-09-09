/**
 * Everything a Board control DOES, with its seams injected (spec §5.6, §7).
 *
 * `App` owns the instances; this module owns the RULES. It exists as a factory
 * rather than as closures inside `App` because this repo has no `<App>` render
 * harness — `src/ui/app.test.tsx` renders `DesktopChrome` and tests the pure
 * predicates in `app-policy.ts`, which says so in its own comment. Behaviour
 * written inline in `App` is behaviour no test can reach.
 */
import type { InjectOutcome } from "../prompts/inject";
import type { PtyClient } from "../terminal/pty-client";
import { boardSnapshotTick, stepAgentBoardBack } from "./agent-board-store";
import type { BoardCard } from "./agent-board-model";
import { BOARD_SNAPSHOT_LINES, type BoardPanelState } from "./agent-board-panel";
import type { BoardHostActions } from "./agent-board-surface";

/**
 * The tab-layer methods the Board calls, declared STRUCTURALLY rather than as
 * `Pick<TabManager, …>`.
 *
 * `Pick<T, K>` requires `K extends keyof T`, and the seams the later tasks add
 * do not exist on `TabManager` yet — `restartPane` is still to come. A `Pick`
 * naming it would not compile today. Declared structurally, `TabManager`
 * satisfies this as each seam lands and `App` keeps passing `tabsRef.current`.
 *
 * Only the ones that exist today are declared. Every later task adds exactly
 * the method it implements, so `tsc` proves the seam arrived.
 */
export interface BoardManagerSeams {
  activateForAttention(index: number, paneId: number): void;
  closePaneAt(index: number, paneId: number): Promise<void>;
  injectIntoPane(
    paneId: number,
    text: string,
    opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
  ): Promise<InjectOutcome>;
  /**
   * Shipped on `TabManager` by Task 9 and declared here now, because this file
   * was held by another implementer while that task ran. Nothing calls it
   * until Task 11's `onReply`, and only on a `sent` outcome.
   */
  acknowledgePane(paneId: number): void;
  serializePane(paneId: number, lines: number): string | null;
  paneAlive(paneId: number): boolean;
  /**
   * Task 13's seam. It answers false for FIVE refusals — an unknown pane, an
   * exited PTY, an agent still running, a pane that never ran one, and an
   * agent with no resume form — so the boolean is worth reading rather than
   * voiding: four of the five are reachable from a card that is showing the
   * control.
   */
  restartPane(paneId: number): Promise<boolean>;
}

/**
 * What the panel says after a press, and WHICH pane it says it about.
 *
 * The pane id is the whole point. The notice signal is window-scoped and is
 * cleared only by the next press, so a bare string let a reply to card A print
 * "placed — confirm in the terminal" under card B the moment the user selected
 * it — a claim about B's terminal that was never true. Keying it here means no
 * module has to remember to clear it at the selection boundary, which is the
 * failure class this repo keeps rediscovering (the 2026-08-22 rail bug, the
 * task prompt outliving its agent generation): state one module writes, another
 * reads, and nobody deletes.
 */
export interface BoardNotice {
  readonly paneId: number;
  readonly text: string;
}

/**
 * The narrowest slice of each seam the Board actually reaches, so a test hands
 * in a handful of functions instead of a TabManager.
 */
export interface BoardActionDeps {
  /**
   * Stop's one seam. `Pick` compiles now that `killForeground` is a member of
   * `PtyClient`, and the real client satisfies the weak type for the same
   * reason: it declares that property, optional or not.
   */
  readonly pty: Pick<PtyClient, "killForeground">;
  /**
   * A per-render snapshot of `tabsRef.current`, so it is `null` on the very
   * first render and on any render before the manager is constructed. Every
   * member that uses it must handle that, exactly as `App`'s own call sites do.
   */
  readonly manager: BoardManagerSeams | null;
  /**
   * Spec §4.4's empty-state control: it raises the TASK LAUNCHER for the active
   * workspace, not a bare new tab. There is no bare `newTab` in `App`, and
   * `TabManager.newTab()` raises Quick Launch rather than materializing
   * anything.
   */
  readonly openTaskLauncher: () => void;
  /**
   * `TabManager.notifySurfacesChanged` — a store-signal transition is invisible
   * to `syncViews` otherwise, so anything that changes which surface holds the
   * stage has to say so.
   */
  readonly notifySurfacesChanged: () => void;
  /** `TabManager.focusActive` — where the keyboard goes when the Board leaves. */
  readonly focusActive: () => void;
  /** Notice + in-flight state; `App` holds the signals, this writes them. */
  readonly setNotice: (notice: BoardNotice | null) => void;
  /**
   * And reads them back for the panel. Without this the notice signal is
   * written by every reply and read by nothing, so "the panel says so"
   * (spec §7.4) would be a claim no user ever sees.
   */
  readonly notice: () => BoardNotice | null;
  /**
   * In-flight state, deliberately NOT keyed by pane: one reply at a time in
   * the whole window. The panel disables its own box while it is true, so the
   * `isSending()` refusal in `onReply` is unreachable through the surface —
   * and a second card briefly reading `sending` is a state that clears itself
   * within one inject, unlike a notice, which persists until the next press.
   */
  readonly setSending: (sending: boolean) => void;
  readonly isSending: () => boolean;
  readonly clearSelection: () => void;
  readonly selectedPaneId: () => number | null;
}

export function createBoardActions(deps: BoardActionDeps): BoardHostActions {
  return {
    /**
     * Tier 3 (spec §5.5): `activateForAttention` is the whole act — it
     * deactivates the surface, activates the tab, focuses the pane and
     * acknowledges it. The ack is the one this path is supposed to make,
     * because the user is now looking at the pane.
     *
     * The chip STAYS open: only the surface's turn on the stage ended, which
     * is what lets ⌘⇧O bring the Board straight back.
     */
    onOpenInStage: (card) => {
      deps.manager?.activateForAttention(card.tabIndex, card.paneId);
      // The same pair `onEscape` takes below, for the same two reasons:
      // `activateForAttention` calls `surfaces.deactivate()`, which steps the
      // Board off the stage — but the tab layer's derived views cannot see a
      // store-signal transition on their own, and the Board's root held DOM
      // focus, so without these the strip is stale and the caret lands on
      // `<body>`. Both are idempotent here: `notifySurfacesChanged` is
      // `syncViews`, and `focusActive` reaches the pane `focusPane` just made
      // active, which already holds DOM focus.
      deps.notifySurfacesChanged();
      deps.focusActive();
    },
    /**
     * Spec §5.6: Stop ends the AGENT and leaves the pane. The card stays, turns
     * `idle` wearing the agent's name (`lastAgent`), and offers Restart once
     * the classifier's poll has seen the shell — which is why nothing here
     * touches the card, the pane or the tab.
     */
    onStop: (card) => {
      // `?.()` because the member is optional: a host without the channel
      // simply has nothing there, and the Board does not render on one anyway.
      void deps.pty.killForeground?.(card.paneId);
    },
    /**
     * Spec §5.6, §11.10: Restart RESUMES the conversation the pane was having.
     * `restartPane` composes that — the confirmed session id, the pane's own
     * launch flags and the CLI's resume form — and this only reports when it
     * declined.
     *
     * The `false` is not voided. The seam has five refusal paths and four of
     * them are reachable from a card that is currently drawing this control
     * (the PTY died, the classifier's poll has not caught up so an agent still
     * reads as running, the pane never ran one, the agent has no resume form).
     * Silence there is the Board saying nothing at all to a press — the same
     * defect class the reply notice exists to avoid.
     */
    onRestart: (card) => {
      void deps.manager?.restartPane(card.paneId).then((restarted) => {
        if (restarted) {
          return;
        }
        deps.setNotice({
          paneId: card.paneId,
          // Deliberately not naming WHICH refusal: the honest four differ
          // (a dead PTY, a poll that has not caught up, no resume form) and
          // the pane itself is where any of them is legible.
          text: "could not restart — open it in stage",
        });
      });
    },
    /**
     * Close (spec §5.6, DL-27.21): the control closes the thing its row names,
     * so this closes the PANE. Its tab follows only when the pane was the last
     * one — `closePaneAt`'s own contract, decided from `paneCount()`, never
     * from the Board's card count.
     *
     * The selection is cleared only when it NAMED this pane AND the pane
     * actually went: a panel about a pane that is gone is a panel about
     * nothing, while clearing it unconditionally would shut a panel the user
     * is reading about another card — or one they just kept. Both facts are
     * read after the close resolves rather than captured before, since the
     * busy dialog `closePaneAt` may raise gives the user time to select
     * something else.
     */
    onClose: (card) => {
      void deps.manager?.closePaneAt(card.tabIndex, card.paneId).then(() => {
        if (deps.selectedPaneId() !== card.paneId) {
          return;
        }
        // `closePaneAt` cannot say whether it closed anything: a completed
        // close, a DECLINED busy dialog, a stale index and a pane that is not
        // a member of that tab all resolve `void` (`close-coordinator.ts`,
        // three early returns). Ask the pane instead — clearing a panel about
        // a card the user just chose to KEEP is the failure this guards, and
        // it is exactly what a cancelled close produced.
        if (deps.manager?.paneAlive(card.paneId) === true) {
          return;
        }
        deps.clearSelection();
      });
    },
    /**
     * Spec §7.4 / DL-34.7. `injectIntoPane` IS the gate — it pastes, re-reads
     * fresh pane info, requires the attention revision to be unchanged across
     * the await, and asks `submitAllowed`. Nothing here re-decides any of
     * that; the outcome is mapped onto what the panel says.
     *
     * `requested` attention is refused on purpose inside that gate, so a REAL
     * question gets `pasted` — the text is in the agent's composer and the
     * user presses Enter themselves. That is the "placed" notice, not a
     * failure.
     */
    onReply: (card, text) => {
      const manager = deps.manager;
      // Every refusal is settled BEFORE the in-flight flag goes up. A
      // `setSending(true)` written above this would never be undone on a null
      // manager: `manager?.injectIntoPane(…)` short-circuits to `undefined`,
      // so there is no `.finally` to lower it and the reply box stays disabled
      // for the life of the window.
      if (manager === null || text.trim() === "" || deps.isSending()) {
        return;
      }
      deps.setSending(true);
      deps.setNotice(null);
      void manager
        .injectIntoPane(card.paneId, text, {
          // DL-34.7's second condition, which `submitAllowed` cannot see: a
          // pane that has not reached `working` once gets the text PLACED and
          // nothing pressed. Its first-run dialog reads `idle` and would
          // otherwise pass every check the gate makes.
          autoSend: card.hasRun,
          // The agent the USER was looking at, so the gate's first check
          // compares against that rather than whatever is running by the time
          // the paste lands.
          expectedAgent: card.agent,
        })
        .then((outcome) => {
          if (outcome === "sent") {
            // The ONLY acknowledging path from the Board besides tier 3
            // (spec §5.5): the user answered, so the question is answered.
            manager.acknowledgePane(card.paneId);
            return;
          }
          deps.setNotice({
            paneId: card.paneId,
            text:
              outcome === "pasted"
                ? "placed — confirm in the terminal"
                : // `failed`, `busy` and `no-target` alike: the text reached no
                  // composer, so none of them may read as "placed".
                  "could not reach the agent — open it in stage",
          });
        })
        .finally(() => {
          deps.setSending(false);
        });
    },
    onNewAgent: () => deps.openTaskLauncher(),
    /**
     * DL-34.9's second Escape: the Board leaves the stage and its chip stays.
     *
     * It is App's action rather than the surface's own, even though the store
     * write is Board-local, because stepping off the stage changes WHICH
     * surface holds it: `syncViews` cannot see that, and the Board's root held
     * DOM focus, so leaving without both calls drops the caret on `<body>`.
     * The chip's ✕ (`closeAgentBoardTab`) already pairs them; Escape not doing
     * so is the same asymmetry class as the browser chip's.
     */
    onEscape: () => {
      stepAgentBoardBack();
      deps.notifySurfacesChanged();
      deps.focusActive();
    },
  };
}

/**
 * The panel's live state for the selected card (spec §7). A null card is the
 * closed panel, which can have nothing in flight of its own, reads no buffer
 * and says nothing — a notice left by the last press belongs to the card it
 * was pressed from.
 *
 * Recomputed each render rather than cached: the snapshot is the pane's own
 * live scrollback, and a card whose agent is mid-turn has to show that.
 */
/** The notice text, but only if it was said about this pane. */
function noticeFor(notice: BoardNotice | null, paneId: number): string | null {
  return notice?.paneId === paneId ? notice.text : null;
}

export function boardPanelState(deps: BoardActionDeps, card: BoardCard | null): BoardPanelState {
  if (card === null) {
    return {
      snapshot: null,
      replyEnabled: false,
      replyNotice: null,
      sending: false,
      paneExited: false,
    };
  }
  // Spec §7.3's cadence, read and deliberately unused. `boardPanelState` runs
  // inside `App`'s render, so touching the signal is what subscribes that
  // render to it — without this line the snapshot re-reads only when something
  // ELSE happened to move, which for a pane streaming in the active tab is
  // nothing at all.
  void boardSnapshotTick.value;
  return {
    // Read by pane id, from whichever tab holds it — the pane does NOT have to
    // be the manager's active one, and selecting a card deliberately does not
    // make it so (spec §5.4). A hidden tab is `display: none`, so its xterm
    // instances are all still alive and still answering.
    snapshot: deps.manager?.serializePane(card.paneId, BOARD_SNAPSHOT_LINES) ?? null,
    // A departed pane has no agent to answer (spec §7.4) — its shell is back,
    // so `paneAlive` is true and would open a box that pastes into `zsh`. A
    // dead one has no PTY at all. A manager that does not exist yet answers
    // neither, so the box stays closed rather than claiming a live agent.
    replyEnabled: !card.departed && deps.manager?.paneAlive(card.paneId) === true,
    // Only when it was said ABOUT this card. The signal outlives the press
    // that wrote it, and the user may have selected another card since.
    replyNotice: noticeFor(deps.notice(), card.paneId),
    sending: deps.isSending(),
    // NOT `snapshot === null`: an exited pane still holds its buffer and still
    // answers, which is the point — the panel shows what the agent last said.
    // `paneAlive` is the separate question. A manager that does not exist yet
    // answers neither, so this stays false rather than claiming a death.
    paneExited: deps.manager?.paneAlive(card.paneId) === false,
  };
}
