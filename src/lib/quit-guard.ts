import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Seams the quit flow composes over — injected so `lib/` stays import-light. */
export interface QuitFlowDeps {
  /** Busy-guard gate: resolves true when quitting may proceed. */
  confirmQuit(): Promise<boolean>;
  /** Persist pending debounced state — the process exits right after. */
  flush(): Promise<void>;
  quit(): Promise<void>;
}

/**
 * One quit attempt: gate on the busy guard, flush pending saves, then exit.
 * Re-entrant calls while a prompt is open are dropped; a failed flush never
 * blocks the quit the user just confirmed.
 */
export function createQuitFlow(deps: QuitFlowDeps): () => Promise<void> {
  let prompting = false;
  return async () => {
    if (prompting) {
      return;
    }
    prompting = true;
    try {
      if (!(await deps.confirmQuit())) {
        return;
      }
      try {
        await deps.flush();
      } catch (err: unknown) {
        console.warn("Flush before quit failed:", err);
      }
      await deps.quit();
    } catch (err: unknown) {
      console.error("Quit flow failed:", err);
    } finally {
      prompting = false;
    }
  };
}

/** Cài guard cho cả nút đóng cửa sổ lẫn ⌘Q. Trả về hàm gỡ listener. */
export async function installQuitGuard(
  deps: QuitFlowDeps,
): Promise<UnlistenFn> {
  const promptQuit = createQuitFlow(deps);
  const unlistenClose = await getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    void promptQuit();
  });
  const unlistenQuit = await listen("quit-requested", () => {
    void promptQuit();
  });
  return () => {
    unlistenClose();
    unlistenQuit();
  };
}
