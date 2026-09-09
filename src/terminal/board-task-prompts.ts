import { signal, type Signal } from "@preact/signals";

/**
 * The launch prompt each pane was started with (spec §11.2), keyed by pane id.
 *
 * Window-scoped module state (R5). It is NOT on `PaneView`: the prompt is
 * written by `launchTask` at one moment and read by one surface, and putting a
 * user's whole first message on the view every sync would carry it through the
 * journal, the strip and the rail — three places that have no use for it.
 *
 * Written on BOTH successful delivery outcomes, deliberately.
 * `TASK_PROMPT_AUTOSEND` is false, so the normal result of a prompted launch is
 * `prompt-pending` — the text sits in the agent's composer unsent. The Board
 * still has to be able to say what the pane was opened FOR; the card's own rule
 * (spec §5.3 row 4, which waits for `hasRun`) is what keeps a placed prompt
 * from printing as `Task` before the pane has run a turn.
 */
export const paneTaskPrompts: Signal<ReadonlyMap<number, string>> = signal(new Map());

export function noteTaskPrompt(paneId: number, prompt: string): void {
  if (prompt.trim() === "") {
    return;
  }
  const next = new Map(paneTaskPrompts.value);
  next.set(paneId, prompt);
  paneTaskPrompts.value = next;
}

export function forgetTaskPrompt(paneId: number): void {
  if (!paneTaskPrompts.value.has(paneId)) {
    return;
  }
  const next = new Map(paneTaskPrompts.value);
  next.delete(paneId);
  paneTaskPrompts.value = next;
}

export function resetTaskPrompts(): void {
  paneTaskPrompts.value = new Map();
}
