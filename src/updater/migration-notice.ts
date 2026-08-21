/**
 * The Tauri migration notice — what it says, where it sends people, and when
 * it is allowed on screen.
 *
 * Spec: docs/specs/2026-08-17-tauri-migration-notice-design.md `decided`.
 *
 * The cutover is a clean install with no updater bridge between the hosts, so
 * without an in-app surface everyone on a Tauri build sits on an app that
 * silently stops updating forever and never learns why. That silence is no
 * longer hypothetical: since `SpaceVibe Deck 1.0.0` (Electron) became
 * `releases/latest` on 2026-08-20, the endpoint
 * `tauri.macos.conf.json` serves — `releases/latest/download/latest.json` —
 * answers 404, so a Tauri client's update check now FAILS rather than
 * reporting "up to date". §10's accepted risk ("this build no longer updates
 * itself" could be false on a Tauri release tagged before the Electron build
 * shipped) is therefore closed: the sentence is now true on every deployed
 * Tauri build, and the new one is downloadable.
 *
 * This module deliberately reads no updater state and calls nothing on the
 * controller: the notice must never become a second thing that can put a
 * client into `download-failed` (spec §2).
 */

/**
 * The whole switch, following the `GRAB_PASTE_DISABLED` precedent
 * (`src/browser/browser-store.ts`): turning the notice off again is a
 * one-line revert rather than an excavation.
 *
 * Typed `boolean` rather than left as the literal so neither branch becomes
 * statically unreachable and invites a dead-code pass to delete the half this
 * constant exists to keep.
 */
export const MIGRATION_NOTICE_ENABLED: boolean = true;

/**
 * The landing ROOT, on purpose (spec §3).
 *
 * Once a build ships, this string is frozen in every copy of it — but the page
 * behind it is not. That page is the only remaining place to change what the
 * user is told, and it is where the clean-install explanation and the old
 * store path belong.
 */
export const MIGRATION_NOTICE_URL = "https://deck.spacevibe.dev/";

export interface MigrationNoticeConditions {
  /** True only under the Tauri host. The Electron host never shows this. */
  readonly tauriHost: boolean;
  /** Window-scoped and unpersisted: a relaunch brings the notice back. */
  readonly dismissed: boolean;
  /** Defaults to the constant; a parameter so the tests can drive both. */
  readonly enabled?: boolean;
}

/**
 * Pure, so the decision is testable without mounting anything.
 *
 * enabled x host x dismissed is eight cases, and the one that matters —
 * Electron host, enabled, not dismissed -> false — is exactly the one a
 * rendering test would be worst at proving.
 */
export function shouldShowNotice(conditions: MigrationNoticeConditions): boolean {
  const enabled = conditions.enabled ?? MIGRATION_NOTICE_ENABLED;
  return enabled && conditions.tauriHost && !conditions.dismissed;
}

/**
 * The same `__TAURI_INTERNALS__` probe `tauri-updater-adapter.ts` uses.
 *
 * A runtime check rather than a build flag, so one renderer bundle still
 * serves both hosts (spec §6). The browser-only `npm run dev` preview answers
 * false, which is correct: it is not a build anyone installs.
 */
export function isTauriHost(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
  );
}
