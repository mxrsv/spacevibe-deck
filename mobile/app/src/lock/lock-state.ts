/** Spec MOB4: relock after this long in the background. */
export const RELOCK_AFTER_MS = 5 * 60_000;

export interface LockState {
  readonly enabled: boolean;
  readonly locked: boolean;
  /** When the app last went to the background, null while it is in front. */
  readonly backgroundedAt: number | null;
}

/** A cold launch starts locked whenever the lock is on. */
export function initialLock(enabled: boolean): LockState {
  return { enabled, locked: enabled, backgroundedAt: null };
}

export function onBackground(state: LockState, now: number): LockState {
  return state.backgroundedAt === null ? { ...state, backgroundedAt: now } : state;
}

/** Back in front: lock again when the lock is on and the app was away for at least five minutes. */
export function onForeground(state: LockState, now: number): LockState {
  if (state.backgroundedAt === null) return state;
  const away = now - state.backgroundedAt;
  const locked = state.locked || (state.enabled && away >= RELOCK_AFTER_MS);
  return { ...state, locked, backgroundedAt: null };
}

export function onUnlocked(state: LockState): LockState {
  return { ...state, locked: false };
}

/** Switching the lock off opens the app; switching it on does not lock the session already open. */
export function onEnabledChange(state: LockState, enabled: boolean): LockState {
  return { ...state, enabled, locked: enabled ? state.locked : false };
}

/** The system Face ID sheet makes the app inactive; its `active` can arrive after the prompt resolved. */
export const AUTH_SETTLE_MS = 1_000;

/**
 * Whether to show the Face ID prompt by itself: only while locked and in front, and not within a
 * second of the previous prompt closing, so a cancelled prompt is not shown again by the
 * `active` event the closing sheet causes. The Unlock button is always there for a deliberate retry.
 */
export function shouldAutoPrompt(
  state: Pick<LockState, "locked">,
  away: boolean,
  now: number,
  lastPromptEndedAt: number | null,
): boolean {
  if (!state.locked || away) return false;
  return lastPromptEndedAt === null || now - lastPromptEndedAt >= AUTH_SETTLE_MS;
}
