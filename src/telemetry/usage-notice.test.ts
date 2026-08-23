import { describe, expect, it } from "vitest";
import { shouldShowUsageNotice, USAGE_CONSENT_ASKED } from "./usage-notice";

describe("shouldShowUsageNotice", () => {
  it("never shows at all: Deck does not ask (2026-08-23)", () => {
    // The one case that used to answer true. Analytics is on by default now
    // and is turned off in Settings → Privacy, so there is no question to
    // raise and `UsageConsentModal` mounts nowhere. `USAGE_CONSENT_ASKED`
    // short-circuits this, which is also the whole reversal if the decision
    // is ever taken back.
    expect(USAGE_CONSENT_ASKED).toBe(false);
    expect(shouldShowUsageNotice({ electronHost: true, consent: "unanswered" })).toBe(false);
  });

  it("keeps the rest of the predicate intact behind that switch", () => {
    // Asserted through the `enabled` parameter so the conditions the dialog
    // would return under are still covered while the switch is off — the
    // release-switch precedent, not a deleted branch.
    expect(
      shouldShowUsageNotice({ electronHost: true, consent: "unanswered", enabled: true }),
    ).toBe(false);
    expect(
      shouldShowUsageNotice({ electronHost: false, consent: "unanswered", enabled: true }),
    ).toBe(false);
  });

  it("never shows away from the Electron host, whatever consent claims", () => {
    for (const consent of ["unanswered", "enabled", "declined", "unreadable", "loading"]) {
      expect(shouldShowUsageNotice({ electronHost: false, consent })).toBe(false);
    }
  });

  it("never shows once a decision or a failure state exists", () => {
    for (const consent of ["enabled", "declined", "unreadable", "loading", "unavailable"]) {
      expect(shouldShowUsageNotice({ electronHost: true, consent })).toBe(false);
    }
  });

  it("stays off when the release switch is off", () => {
    expect(
      shouldShowUsageNotice({ electronHost: true, consent: "unanswered", enabled: false }),
    ).toBe(false);
  });
});
