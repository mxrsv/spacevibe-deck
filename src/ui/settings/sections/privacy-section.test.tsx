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

  it("pins the privacy copy: on by default, the way off, retention, processor — never anonymous", () => {
    // The privacy-copy contract (spec §11), rewritten 2026-08-23 when
    // analytics went on by default: this row is now the ONLY place in the app
    // that says Deck collects anything, so it has to say both halves — that it
    // is on, and where it goes off.
    act(() => render(<PrivacySection />, mount));
    const text = mount.textContent ?? "";
    expect(text).toContain("On by default");
    expect(text).toContain("Turn it off here");
    expect(text).toContain("35 days");
    expect(text).toContain("Cloudflare");
    expect(text).toContain("random id for that day");
    expect(text.toLowerCase()).not.toContain("anonymous");
  });

  it("disables the switch while loading or unreadable, enables it on an answer", () => {
    telemetryConsent.value = "loading";
    act(() => render(<PrivacySection />, mount));
    const toggle = (): HTMLButtonElement | null =>
      mount.querySelector<HTMLButtonElement>("button[role='switch']");
    expect(toggle()?.disabled).toBe(true);
    act(() => {
      telemetryConsent.value = "unreadable";
    });
    expect(toggle()?.disabled).toBe(true);
    act(() => {
      telemetryConsent.value = "declined";
    });
    expect(toggle()?.disabled).toBe(false);
  });

  it("says why an unreadable state file keeps sharing off", () => {
    telemetryConsent.value = "unreadable";
    act(() => render(<PrivacySection />, mount));
    expect(mount.textContent).toContain("could not be read");
    expect(mount.textContent).toContain("telemetry.json");
  });

  it("writes the flipped consent through to the host", async () => {
    telemetryConsent.value = "declined";
    act(() => render(<PrivacySection />, mount));
    const toggle = mount.querySelector<HTMLButtonElement>("button[role='switch']");
    await act(async () => {
      toggle?.click();
    });
    expect(host.telemetrySetEnabled).toHaveBeenCalledWith(true);
  });
});
