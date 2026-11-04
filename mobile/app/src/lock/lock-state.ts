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
