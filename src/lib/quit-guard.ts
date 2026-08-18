import { listen, type UnlistenFn } from '../host/bridge';
import {
  confirmMessage,
  QUIT_COPY,
  unknownMessage,
  WINDOW_CLOSE_COPY,
  type ConfirmCopy,
} from '../terminal/close-guard';

/**
 * A close or quit request from Rust, census included.
 *
 * Rust owns the census (merged §0.2): it can see every window's panes and a
 * pane that is mid-transfer, which a per-window `allPaneIds()` cannot. The
 * result travels with the request so the dialog never has to ask twice.
 */
export interface CloseRequest {
  readonly requestId: number;
  /** Distinct process names, already deduplicated by Rust. */
  readonly busyProcesses: readonly string[];
  /** Count of busy PANES, which may exceed the number of names. */
  readonly busyPanes: number;
  /** False when inspection could not name every busy process. */
  readonly fullyNamed: boolean;
  /**
   * Absolute paths of unsaved editor buffers in scope (spec §6).
   *
   * Part of the census, not a second question asked later: a window holding
   * only file tabs has zero busy panes, and the empty-census branch below used
   * to confirm outright — which is the fail-toward-asking invariant inverted.
   */
  readonly dirtyFiles: readonly string[];
}

/** Seams the quit/close flow composes over — injected so `lib/` stays import-light. */
export interface QuitFlowDeps {
  /** Show the dialog; resolves true when the user accepts. */
  ask(message: string): Promise<boolean>;
  /** Persist pending debounced state — the process or window goes right after. */
  flush(): Promise<void>;
  confirm(requestId: number): Promise<void>;
  cancel(requestId: number): Promise<void>;
}

/**
 * Validate the request rather than cast it: it crosses the IPC boundary as
 * untrusted data (C7/C8), and a guessed `requestId` would answer a request
 * Rust never asked while leaving the real one hanging forever.
 */
export function closeRequestOrNull(raw: unknown): CloseRequest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const names = value.busyProcesses;
  // WIDEN THIS WHENEVER THE CENSUS GROWS A FIELD. The object below is REBUILT
  // from known keys and everything else is discarded, so a field added to the
  // payload and forgotten here is dropped on arrival — silently, with the
  // sender and the typecheck both green. `dirtyFiles` is exactly that case:
  // dropped, `busyPanes === 0` then auto-confirms, and the unsaved file dies
  // without a prompt. `quit-guard.test.ts` locks it.
  const dirty = value.dirtyFiles;
  if (
    typeof value.requestId !== 'number' ||
    typeof value.busyPanes !== 'number' ||
    typeof value.fullyNamed !== 'boolean' ||
    !Array.isArray(names) ||
    names.some((name) => typeof name !== 'string')
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    busyProcesses: names as string[],
    busyPanes: value.busyPanes,
    fullyNamed: value.fullyNamed,
    // Absent is treated as none rather than rejecting the whole request: an
    // older payload shape must still be answerable, or the window can never
    // close. A malformed entry is dropped, not repaired.
    dirtyFiles: Array.isArray(dirty)
      ? dirty.filter((path): path is string => typeof path === 'string')
      : [],
  };
}

/**
 * One quit/close attempt: prompt only when Rust reported something busy,
 * then answer the request either way.
 *
 * EVERY path answers. The old flow dropped a re-entrant call silently, which
 * was safe when nothing was waiting for a reply; Rust now blocks the close
 * on an answer, so a dropped request is a window that never closes and never
 * says why.
 */
export function createQuitFlow(
  deps: QuitFlowDeps,
  copy: ConfirmCopy = QUIT_COPY,
): (request: CloseRequest) => Promise<void> {
  let prompting = false;
  return async (request) => {
    async function finish(ok: boolean): Promise<void> {
      if (!ok) {
        await deps.cancel(request.requestId);
        return;
      }
      try {
        await deps.flush();
      } catch (err: unknown) {
        console.warn('Flush before quit failed:', err);
      }
      await deps.confirm(request.requestId);
    }

    // Empty in ALL THREE dimensions, not just the pane one.
    //
    // `busyPanes === 0` alone auto-confirmed, which is how a window holding
    // only file tabs quit with unsaved edits and no prompt (spec §6, plan §1
    // findings 4 and 5). `fullyNamed` is the third: an `unknown` pane is not
    // busy, so a census that could not classify anything reports zero busy
    // panes with `fullyNamed: false` — and auto-confirming there kills agents
    // with no prompt. `quit-flow.ts`'s `allIdle` states the rule ("`unknown` is
    // NOT idle") but nothing enforced it on this side.
    if (request.fullyNamed && request.busyPanes === 0 && request.dirtyFiles.length === 0) {
      await finish(true);
      return;
    }
    if (prompting) {
      await deps.cancel(request.requestId);
      return;
    }
    prompting = true;
    let accepted = false;
    try {
      const message =
        (request.fullyNamed
          ? confirmMessage(
              request.busyProcesses,
              copy.action,
              request.busyPanes,
              request.dirtyFiles,
            )
          : unknownMessage(copy.action, request.dirtyFiles)) +
        (copy.detail === undefined ? '' : `\n\n${copy.detail}`);
      accepted = await deps.ask(message);
    } catch (err: unknown) {
      console.error('Close prompt failed:', err);
      accepted = false;
    } finally {
      prompting = false;
    }
    await finish(accepted);
  };
}

/**
 * Install the quit and window-close guards. Returns a function that removes
 * both listeners.
 *
 * There is deliberately NO `getCurrentWindow().onCloseRequested` here. Tauri
 * auto-prevents close for any window carrying a JS close listener, so
 * registering one made the frontend the veto authority over every window
 * close — which, with peer windows (spec §9.5), means the Rust
 * `CloseRequested` handler and this flow both run and the user confirms
 * twice. Rust now owns the decision and asks this window to prompt.
 */
export async function installQuitGuard(deps: {
  readonly quit: QuitFlowDeps;
  readonly close: QuitFlowDeps;
}): Promise<UnlistenFn> {
  const promptQuit = createQuitFlow(deps.quit, QUIT_COPY);
  const promptClose = createQuitFlow(deps.close, WINDOW_CLOSE_COPY);
  const route =
    (flow: (request: CloseRequest) => Promise<void>) =>
    (event: { payload: unknown }): void => {
      const request = closeRequestOrNull(event.payload);
      if (request === null) {
        // No id means no safe answer: replying with a guessed one would
        // resolve a request Rust never asked.
        console.warn('Ignoring malformed close/quit request payload');
        return;
      }
      void flow(request);
    };
  const unlistenQuit = await listen('quit-requested', route(promptQuit));
  const unlistenClose = await listen('window:close-requested', route(promptClose));
  return () => {
    unlistenQuit();
    unlistenClose();
  };
}
