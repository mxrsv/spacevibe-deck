/**
 * The eight cases of `shouldShowNotice`, and the one that matters most is the
 * one a rendering test would be worst at proving: the Electron host must never
 * tell a user to leave Electron.
 */
import { describe, expect, it } from "vitest";
import {
  MIGRATION_NOTICE_ENABLED,
  MIGRATION_NOTICE_URL,
  shouldShowNotice,
} from "./migration-notice";

describe("shouldShowNotice", () => {
  it("shows on Tauri when enabled and not dismissed", () => {
    expect(shouldShowNotice({ tauriHost: true, dismissed: false, enabled: true })).toBe(true);
  });

  it("never shows on the Electron host, however everything else is set", () => {
    // The whole reason this is a pure function: the Electron build shares the
    // renderer bundle, and a banner telling its user to leave Electron would
    // be the worst possible bug to find in a screenshot.
    expect(shouldShowNotice({ tauriHost: false, dismissed: false, enabled: true })).toBe(false);
    expect(shouldShowNotice({ tauriHost: false, dismissed: true, enabled: true })).toBe(false);
    expect(shouldShowNotice({ tauriHost: false, dismissed: false, enabled: false })).toBe(false);
    expect(shouldShowNotice({ tauriHost: false, dismissed: true, enabled: false })).toBe(false);
  });

  it("stays hidden once dismissed, and stays off when the constant is off", () => {
    expect(shouldShowNotice({ tauriHost: true, dismissed: true, enabled: true })).toBe(false);
    expect(shouldShowNotice({ tauriHost: true, dismissed: false, enabled: false })).toBe(false);
    expect(shouldShowNotice({ tauriHost: true, dismissed: true, enabled: false })).toBe(false);
  });

  it("defaults to the shipped constant when the caller does not say", () => {
    // `App` calls it this way, so the constant is what actually decides.
    expect(shouldShowNotice({ tauriHost: true, dismissed: false })).toBe(MIGRATION_NOTICE_ENABLED);
  });
});

describe("the notice's frozen strings", () => {
  it("points at the landing root, which is the only editable half", () => {
    // Once a build ships this string is frozen in every copy of it; the page
    // behind it is not. A deep link would freeze the explanation too.
    expect(MIGRATION_NOTICE_URL).toBe("https://deck.spacevibe.dev/");
  });

  it("ships enabled", () => {
    // Owner decision, spec §10. If a Tauri hotfix should NOT carry the notice,
    // this constant is set to false for that build — one line, and this test
    // is the reminder that it was deliberate either way.
    expect(MIGRATION_NOTICE_ENABLED).toBe(true);
  });
});
