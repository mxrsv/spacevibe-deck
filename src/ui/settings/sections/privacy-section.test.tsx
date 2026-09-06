// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../../host/shell-host", () => ({ openUrl }));

// The REAL consent store runs over a mocked host, so the section is tested
// against the exact signal it ships with; each case drives `telemetryConsent`
// directly and re-renders ride the signal, as they do in the app.
const host = vi.hoisted(() => ({
  available: true,
  telemetryState: vi.fn(() => Promise.resolve(null)),
  telemetrySetEnabled: vi.fn(() =>
    Promise.resolve({ consent: "enabled" as const, consentVersion: 1 }),
  ),
  telemetryCount: vi.fn(),
}));
vi.mock("../../../host/telemetry-host", () => host);

import { telemetryConsent } from "../../../telemetry/consent-store";
import { PrivacySection } from "./privacy-section";

describe("PrivacySection", () => {
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    telemetryConsent.value = "declined";
    host.telemetrySetEnabled.mockClear();
  });

  afterEach(() => {
    act(() => render(null, mount));
    mount.remove();
  });

  it("pins the privacy copy: always on, no opt-out, retention, processor — never anonymous", () => {
    // The privacy-copy contract (spec §11), rewritten 2026-09-06 when the
    // switch went: this is the ONLY place in the app that says Deck collects
    // anything, and it is now the only place that says the collection cannot
    // be refused. Taking the control away is not a licence to soften either
    // half, so both are pinned — including the word "anonymous" staying out.
    act(() => render(<PrivacySection />, mount));
    const text = mount.textContent ?? "";
    expect(text).toContain("always on");
    expect(text).toContain("cannot be turned off");
    expect(text).toContain("35 days");
    expect(text).toContain("Cloudflare");
    expect(text).toContain("random id for that day");
    expect(text.toLowerCase()).not.toContain("anonymous");
  });

  it("offers no control at all, in every consent phase", () => {
    // A switch here would be a lie in both positions: working, it would
    // contradict main, which refuses `setEnabled(false)`; disabled, it would
    // be a dead thing to keep pressing. The phases are walked because the old
    // section rendered the control in all of them.
    for (const phase of ["loading", "unreadable", "declined", "enabled"] as const) {
      act(() => {
        telemetryConsent.value = phase;
      });
      act(() => render(<PrivacySection />, mount));
      expect(mount.querySelector("button[role='switch']")).toBeNull();
    }
    expect(host.telemetrySetEnabled).not.toHaveBeenCalled();
  });

  it("says why an unreadable state file keeps sharing off", () => {
    // Fail-closed survives the mandatory policy, and a page that says "always
    // on" owes the reader the one case where it is in fact off.
    telemetryConsent.value = "unreadable";
    act(() => render(<PrivacySection />, mount));
    expect(mount.textContent).toContain("could not be read");
    expect(mount.textContent).toContain("telemetry.json");
  });
});
