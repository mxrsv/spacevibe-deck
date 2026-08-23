import { beforeEach, describe, expect, it, vi } from "vitest";

// The REAL store runs over a mocked host (the privacy-section pattern), so
// the window-scoped signal, the ask-once guard and the event adoption are
// tested exactly as they ship. `available` is captured by the signal
// initializer at module init, so it stays true for the whole file — the
// unavailable host is the notice gate's case, not this store's.
const host = vi.hoisted(() => ({
  available: true,
  telemetryState: vi.fn(() =>
    Promise.resolve({ consent: "unanswered" as const, consentVersion: 1 }),
  ),
  telemetrySetEnabled: vi.fn(() =>
    Promise.resolve({ consent: "enabled" as const, consentVersion: 1 }),
  ),
  telemetryCount: vi.fn(),
}));
vi.mock("../host/telemetry-host", () => host);

const bridge = vi.hoisted(() => ({
  listeners: [] as Array<(payload: unknown) => void>,
  listen: vi.fn((_event: string, handler: (payload: unknown) => void) => {
    bridge.listeners.push(handler);
    return Promise.resolve(() => {});
  }),
}));
vi.mock("../host/bridge", () => ({ listen: bridge.listen }));

import {
  ensureTelemetryStateLoaded,
  resetTelemetryConsentStore,
  setTelemetryEnabled,
  telemetryConsent,
} from "./consent-store";

describe("consent-store", () => {
  beforeEach(() => {
    resetTelemetryConsentStore();
    bridge.listeners.length = 0;
    host.telemetryState.mockClear();
    host.telemetrySetEnabled.mockClear();
    bridge.listen.mockClear();
  });

  it("starts loading and adopts the first answer", async () => {
    expect(telemetryConsent.value).toBe("loading");
    await ensureTelemetryStateLoaded();
    expect(telemetryConsent.value).toBe("unanswered");
  });

  it("asks main once per window; later calls are free", async () => {
    await ensureTelemetryStateLoaded();
    await ensureTelemetryStateLoaded();
    expect(host.telemetryState).toHaveBeenCalledTimes(1);
    expect(bridge.listen).toHaveBeenCalledTimes(1);
  });

  it("falls to unavailable when the host cannot answer the read", async () => {
    host.telemetryState.mockResolvedValueOnce(
      null as unknown as { consent: "unanswered"; consentVersion: number },
    );
    await ensureTelemetryStateLoaded();
    expect(telemetryConsent.value).toBe("unavailable");
  });

  it("follows telemetry:state-changed so another window's decision lands here", async () => {
    await ensureTelemetryStateLoaded();
    expect(bridge.listen).toHaveBeenCalledWith("telemetry:state-changed", expect.any(Function));
    bridge.listeners[0]({ consent: "declined" });
    expect(telemetryConsent.value).toBe("declined");
  });

  it("ignores a malformed event payload rather than guessing a state", async () => {
    await ensureTelemetryStateLoaded();
    for (const junk of [null, 42, "enabled", {}, { consent: "bogus" }]) {
      bridge.listeners[0](junk);
      expect(telemetryConsent.value).toBe("unanswered");
    }
  });

  it("moves the signal only on a confirmed setEnabled answer", async () => {
    await ensureTelemetryStateLoaded();
    await setTelemetryEnabled(true);
    expect(host.telemetrySetEnabled).toHaveBeenCalledWith(true);
    expect(telemetryConsent.value).toBe("enabled");
  });

  it("reports an unusable write answer as a failure, not as silence", async () => {
    // This used to resolve, which is what a code review caught on 2026-08-23:
    // the signal stayed put AND the caller's `catch` never ran, so on the
    // consent dialog — the one surface with no other way out — the button did
    // nothing and said nothing. A read may degrade to `unavailable`; a WRITE
    // may not degrade to anything.
    await ensureTelemetryStateLoaded();
    host.telemetrySetEnabled.mockResolvedValueOnce(
      null as unknown as { consent: "enabled"; consentVersion: number },
    );
    await expect(setTelemetryEnabled(false)).rejects.toThrow("could not be saved");
    expect(telemetryConsent.value).toBe("unanswered");
  });

  it("propagates a failed persist and leaves the signal untouched", async () => {
    await ensureTelemetryStateLoaded();
    host.telemetrySetEnabled.mockRejectedValueOnce(new Error("disk said no"));
    await expect(setTelemetryEnabled(true)).rejects.toThrow("disk said no");
    expect(telemetryConsent.value).toBe("unanswered");
  });

  it("reset forgets the load so a fresh mount asks again", async () => {
    await ensureTelemetryStateLoaded();
    resetTelemetryConsentStore();
    expect(telemetryConsent.value).toBe("loading");
    await ensureTelemetryStateLoaded();
    expect(host.telemetryState).toHaveBeenCalledTimes(2);
  });
});
