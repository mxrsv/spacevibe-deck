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
 * against the version that actually came back. Same trick as a journal — the
 * record survives the process that wrote it.
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
  | { readonly kind: "none" }
  /** The running version is the one we were installing. */
  | { readonly kind: "succeeded"; readonly version: string }
  /** An attempt was recorded but the version did not move. */
  | { readonly kind: "failed"; readonly attempt: UpdateAttempt };

export function isUpdateAttempt(value: unknown): value is UpdateAttempt {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const attempt = value as Record<string, unknown>;
  return (
    typeof attempt.targetVersion === "string" &&
    attempt.targetVersion !== "" &&
    typeof attempt.fromVersion === "string" &&
    attempt.fromVersion !== "" &&
    typeof attempt.startedAt === "number" &&
    Number.isFinite(attempt.startedAt)
  );
}

/**
 * What the recorded attempt means now that `currentVersion` is running.
 *
 * A malformed record is treated as no attempt: the breadcrumb exists to warn
 * about a failure, and warning on garbage would train users to ignore it.
 */
export function resolveAttemptOutcome(
  attempt: unknown,
  currentVersion: string,
): AttemptOutcome {
  if (!isUpdateAttempt(attempt)) {
    return { kind: "none" };
  }
  if (attempt.targetVersion === currentVersion) {
    return { kind: "succeeded", version: currentVersion };
  }
  return { kind: "failed", attempt };
}

/**
 * What to tell the user about a failed attempt. Deliberately does not claim to
 * know why: the app never saw the installer. It says what did not happen and
 * what to do, which is all Deck can honestly assert.
 */
export function failedAttemptMessage(attempt: UpdateAttempt): string {
  return `Deck ${attempt.targetVersion} didn't finish installing — still running ${attempt.fromVersion}. Download it manually if this keeps happening.`;
}
