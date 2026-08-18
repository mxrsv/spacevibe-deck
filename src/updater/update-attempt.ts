/**
 * A breadcrumb dropped before an install, read on the next launch.
 *
 * Deck hands installation to the platform and cannot watch it finish. On
 * Windows the pinned updater calls `ShellExecuteW`, ignores the result and
 * exits the process immediately, so a failed install — or a user who declines
 * the UAC prompt — is indistinguishable from a successful one from inside the
 * app. On macOS a late failure in the bundle swap can leave nothing installed.
 *
 * Since the attempt cannot be observed while it happens, it is inferred
 * afterwards: write down which version we were trying to reach, then compare
 * against the version that actually came back.
 */

/** What Deck was attempting, written before control leaves the app. */
export interface UpdateAttempt {
  /** The version the installer was supposed to produce. */
  readonly targetVersion: string;
  /** The version that was running when the attempt started. */
  readonly fromVersion: string;
  /** Epoch ms, supplied by the caller so this module stays pure. */
  readonly startedAt: number;
}

export type AttemptOutcome =
  /** No attempt recorded — an ordinary launch. */
  | { readonly kind: 'none' }
  /** The running version is the one we were installing. */
  | { readonly kind: 'succeeded'; readonly version: string }
  /** Still on the version we started from: the install never happened. */
  | { readonly kind: 'incomplete'; readonly attempt: UpdateAttempt }
  /**
   * Neither the target nor the origin is running. Something else moved the
   * install — a manual download, a second attempt, a rollback — so the record
   * describes a world that no longer exists and must not be reported as if it
   * did.
   */
  | {
      readonly kind: 'superseded';
      readonly attempt: UpdateAttempt;
      readonly version: string;
    };

export function isUpdateAttempt(value: unknown): value is UpdateAttempt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const attempt = value as Record<string, unknown>;
  return (
    typeof attempt.targetVersion === 'string' &&
    attempt.targetVersion !== '' &&
    typeof attempt.fromVersion === 'string' &&
    attempt.fromVersion !== '' &&
    typeof attempt.startedAt === 'number' &&
    Number.isFinite(attempt.startedAt)
  );
}

/**
 * What the recorded attempt means now that `currentVersion` is running.
 *
 * Three outcomes, not two. Treating "not the target" as "install failed" was
 * wrong: a user who downloads 0.12.0 by hand after a failed 0.11.0 attempt is
 * running neither version in the record, and telling them they are "still
 * running 0.10.0" is simply false.
 *
 * A malformed record is treated as no attempt: the breadcrumb exists to warn
 * about a failure, and warning on garbage would train users to ignore it.
 */
export function resolveAttemptOutcome(attempt: unknown, currentVersion: string): AttemptOutcome {
  if (!isUpdateAttempt(attempt)) {
    return { kind: 'none' };
  }
  if (attempt.targetVersion === currentVersion) {
    return { kind: 'succeeded', version: currentVersion };
  }
  if (attempt.fromVersion === currentVersion) {
    return { kind: 'incomplete', attempt };
  }
  return { kind: 'superseded', attempt, version: currentVersion };
}

/**
 * What to tell the user, or `null` when there is nothing worth saying.
 *
 * Deliberately never claims to know WHY: the app never saw the installer. It
 * states what did not happen and what to do, which is all Deck can honestly
 * assert. A superseded record says the version actually running rather than
 * the stale one it was written with.
 */
export function attemptMessage(outcome: AttemptOutcome): string | null {
  switch (outcome.kind) {
    case 'incomplete':
      return `Deck ${outcome.attempt.targetVersion} didn't finish installing — still running ${outcome.attempt.fromVersion}. Download it manually if this keeps happening.`;
    case 'superseded':
      return `An earlier update to Deck ${outcome.attempt.targetVersion} never completed. Now running ${outcome.version}.`;
    case 'succeeded':
    case 'none':
      return null;
  }
}
