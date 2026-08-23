// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE_PRIVACY_URL } from "../telemetry/usage-notice";
import { UsageConsentModal } from "./usage-consent-modal";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../host/shell-host", () => ({ openUrl }));

const setTelemetryEnabled = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../telemetry/consent-store", () => ({ setTelemetryEnabled }));

describe("UsageConsentModal", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    openUrl.mockClear();
    setTelemetryEnabled.mockClear();
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  function panel(): HTMLDivElement | null {
    return host.querySelector<HTMLDivElement>(".usage-consent");
  }

  /**
   * Let an in-flight decision finish and the panel repaint. A macrotask, not
   * one microtask turn: `decide` chains `.catch().finally()`, so the flag
   * clears two ticks after the store's promise settles, and the `disabled`
   * attribute needs the signal re-render after that.
   */
  async function settled(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("is a dialog on the shared modal shell", () => {
    act(() => render(<UsageConsentModal />, host));
    expect(host.querySelector(".modal-scrim")).not.toBeNull();
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.getAttribute("aria-modal")).toBe("true");
  });

  it("pins the consent copy: optional, the exclusions, the way back — never anonymous", () => {
    // The privacy-copy contract (spec §11): the dialog must say the stats are
    // OPTIONAL, name the exclusions, and — since it has no other exit — say
    // where the answer can be changed. It must never call them anonymous.
    act(() => render(<UsageConsentModal />, host));
    const text = panel()?.textContent ?? "";
    expect(text).toContain("optional usage stats");
    expect(text).toContain("No code, paths or prompts");
    expect(text).toContain("Settings");
    expect(text.toLowerCase()).not.toContain("anonymous");
  });

  it("offers a decision, not a dismissal: two buttons, no close control", () => {
    // DL-29.9: every way out persists an answer, so there is no ✕.
    act(() => render(<UsageConsentModal />, host));
    const actions = [...host.querySelectorAll(".usage-consent__actions button")].map(
      (button) => button.textContent,
    );
    expect(actions).toEqual(["Share usage stats", "Not now"]);
    expect(host.querySelector(".usage-consent__close")).toBeNull();
  });

  it("persists the chosen answer through the consent store", async () => {
    act(() => render(<UsageConsentModal />, host));
    const [share, notNow] = [
      ...host.querySelectorAll<HTMLButtonElement>(".usage-consent__actions button"),
    ];
    act(() => share.click());
    expect(setTelemetryEnabled).toHaveBeenCalledWith(true);
    // The write has to settle before the other button answers: since
    // 2026-08-23 a decision in flight disables both (see the guard test
    // below). Two presses in one tick is a test-only sequence — a real
    // dialog leaves on the first answer.
    await settled();
    act(() => notNow.click());
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false);
  });

  it("refuses a second answer while the first is still in flight", async () => {
    // Both buttons go, not just the pressed one. The two calls settle the same
    // question, so letting "Not now" land on top of an in-flight "Share" would
    // decide it by whichever IPC answered last.
    let settle = (): void => {};
    setTelemetryEnabled.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    act(() => render(<UsageConsentModal />, host));
    const [share, notNow] = [
      ...host.querySelectorAll<HTMLButtonElement>(".usage-consent__actions button"),
    ];

    act(() => share.click());
    expect(share.disabled).toBe(true);
    expect(notNow.disabled).toBe(true);
    act(() => notNow.click());
    expect(setTelemetryEnabled).toHaveBeenCalledTimes(1);

    settle();
    await settled();
    expect(share.disabled).toBe(false);
  });

  it("ignores Escape: a key must not be a third answer", () => {
    act(() => render(<UsageConsentModal />, host));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(setTelemetryEnabled).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it("ignores a scrim click for the same reason", () => {
    act(() => render(<UsageConsentModal />, host));
    const scrim = host.querySelector<HTMLDivElement>(".modal-scrim");
    if (scrim === null) {
      throw new Error("scrim missing");
    }
    act(() => {
      scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      scrim.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setTelemetryEnabled).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it("focus starts on the panel, not the primary button", () => {
    // DL-29.2 kept on purpose: a reflexive Enter right after launch must not
    // opt anyone into anything.
    act(() => render(<UsageConsentModal />, host));
    expect(document.activeElement).toBe(panel());
  });

  it("opens the frozen privacy URL from the disclosure link", () => {
    act(() => render(<UsageConsentModal />, host));
    const link = host.querySelector<HTMLButtonElement>(".usage-link");
    expect(link?.textContent).toContain("What Deck sends");
    act(() => link?.click());
    expect(openUrl).toHaveBeenCalledWith(USAGE_PRIVACY_URL);
  });
});
