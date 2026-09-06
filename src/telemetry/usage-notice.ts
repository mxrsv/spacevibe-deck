/**
 * The usage-analytics consent question — where it sends people, and the
 * switch that keeps it off screen.
 *
 * The surface is `UsageConsentModal` (DL-29.9), a decision dialog rather than
 * a notice row, and it could only ever render while consent is unanswered on
 * a host that can do analytics at all — the Electron host — so on Tauri and
 * in the browser preview nothing ever shows. But no consent question is asked
 * any more, and since 2026-09-06 there is no answer to give: analytics is
 * MANDATORY, `USAGE_CONSENT_ASKED` below is false and
 * `USAGE_ANALYTICS_MANDATORY` is true, so `declined` is unreachable and an
 * existing one folds back to `enabled`. An unreadable `telemetry.json` still
 * fails closed to off — that is a disk Deck cannot read, not a preference, and
 * guessing past it would mean writing over state of unknown shape. See
 * docs/internals/telemetry.md.
 */

/**
 * The whole release switch, following the `MIGRATION_NOTICE_ENABLED`
 * precedent: typed `boolean` rather than left as the literal so neither
 * branch becomes statically unreachable and invites a dead-code pass to
 * delete the half this constant exists to keep.
 */
export const USAGE_ANALYTICS_AVAILABLE: boolean = true;

/**
 * Frozen into every shipped binary: the page behind it shows the
 * CURRENT privacy notice and an archive keyed by effective date and consent
 * version, so editing the page alone can never broaden consent a shipped
 * binary already stored.
 */
export const USAGE_PRIVACY_URL = "https://deck.spacevibe.dev/privacy";

/**
 * Whether Deck ASKS before counting (owner-decided 2026-08-23: it does not).
 *
 * Analytics is on by default now and is turned off in Settings → Privacy, so
 * there is no question to raise and `UsageConsentModal` mounts nowhere. The
 * component, its stylesheet and its tests are all left standing — this is the
 * `GRAB_PASTE_DISABLED` shape, and flipping this one constant back is the whole
 * reversal, which matters more here than usual because the reason to reverse
 * would be legal rather than technical.
 *
 * Typed `boolean` rather than left as the literal so neither branch becomes
 * statically unreachable and invites a dead-code pass to delete the half this
 * constant exists to keep.
 */
export const USAGE_CONSENT_ASKED: boolean = false;

/**
 * Whether analytics is MANDATORY — on for every install, with no way to turn
 * it off (owner-decided 2026-09-06).
 *
 * This is a step beyond the 2026-08-23 default-on reversal, which kept the
 * Settings → Privacy switch as the one way out. There is no way out now:
 * `declined` stops being a state the user can reach, `parsePersisted` folds an
 * existing one back to `enabled`, and `setEnabled(false)` is refused by main
 * rather than merely unreachable from the UI — the renderer is not the trust
 * boundary, so a channel that still exists must not honour a request the
 * product no longer offers.
 *
 * The disclosure did NOT go with the switch: Settings → Privacy still states
 * exactly what is sent and what is not, and still links the privacy notice.
 * Taking the control away while keeping the account of what is taken is the
 * whole shape of this decision — a surface that collects silently would be
 * worse on every axis that matters.
 *
 * Typed `boolean` rather than left as the literal, the `USAGE_CONSENT_ASKED`
 * and `GRAB_PASTE_DISABLED` shape: neither branch becomes statically
 * unreachable, so a dead-code pass cannot delete the half that makes this
 * reversible. Flipping this one constant back, re-mounting `ToggleRow` in
 * `privacy-section.tsx` and restoring the copy is the whole reversal.
 */
export const USAGE_ANALYTICS_MANDATORY: boolean = true;

export interface UsageNoticeConditions {
  /** True only where the telemetry host answers — the Electron host. */
  readonly electronHost: boolean;
  /** Main-owned consent phase, as `consent-store.ts` reports it. */
  readonly consent: string;
  /** Defaults to the constant; a parameter so the tests can drive both. */
  readonly enabled?: boolean;
}

/**
 * Pure, so the decision is testable without mounting anything — the
 * `shouldShowNotice` precedent. The case that matters most — a host that
 * cannot do analytics -> false, whatever consent claims — is exactly the one
 * a rendering test would be worst at proving.
 */
export function shouldShowUsageNotice(conditions: UsageNoticeConditions): boolean {
  const enabled = conditions.enabled ?? USAGE_ANALYTICS_AVAILABLE;
  // `USAGE_CONSENT_ASKED` short-circuits everything below it. The rest of the
  // predicate is kept intact rather than deleted: it is the condition the
  // dialog would come back under, and the tests still drive it through the
  // `enabled` parameter.
  return (
    USAGE_CONSENT_ASKED && enabled && conditions.electronHost && conditions.consent === "unanswered"
  );
}
