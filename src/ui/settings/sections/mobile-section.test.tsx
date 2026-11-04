// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../../host/shell-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../host/shell-host")>()),
  openUrl: vi.fn(async () => {}),
  writeText: vi.fn(async () => {}),
}));
vi.mock("../../../chrome/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../chrome/events")>()),
  reportPersistError: vi.fn(),
}));

const host = vi.hoisted(() => ({
  changed: null as null | (() => void),
  state: null as unknown,
  start: null as unknown,
  revoke: null as unknown,
  cancel: null as unknown,
}));
vi.mock("../../../host/mobile-host", () => ({
  getMobileState: vi.fn(async () => host.state),
  startMobilePairing: vi.fn(async () => host.start),
  cancelMobilePairing: vi.fn(async () => host.cancel),
  revokeMobilePhone: vi.fn(async () => host.revoke),
  listenMobileChanged: vi.fn(async (handler: () => void) => {
    host.changed = handler;
    return () => {
      host.changed = null;
    };
  }),
}));
const switches = vi.hoisted(() => ({ on: false }));
vi.mock("../../../terminal/action-availability", () => ({
  rendererReleaseSwitches: () => ({ mobileCompanion: switches.on }),
}));

import { openUrl, writeText } from "../../../host/shell-host";
import {
  cancelMobilePairing,
  revokeMobilePhone,
  startMobilePairing,
} from "../../../host/mobile-host";
import type { MobilePhone, MobileState } from "../../../lib/mobile-state";
import { mount, settle } from "../../controls/preset-test-kit";
import { visibleSettingsCategories } from "../settings-categories";
import { SettingsNav } from "../settings-nav";
import {
  mobileState,
  pairDialogOpen,
  pairError,
  pairStarting,
  revokeTarget,
} from "../mobile-store";
import { MobileSection } from "./mobile-section";

const NOW = Date.now();

function qrFor(relay: string): string {
  const json = JSON.stringify({
    v: 1,
    r: relay,
    p: "P".repeat(22),
    k: "k",
    s: "s",
    e: NOW,
    n: "Mac",
  });
  return `deck-pair:${btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

const PHONE: MobilePhone = {
  pairingId: "A".repeat(22),
  name: "Mark's iPhone",
  model: "iPhone 16",
  pairedAt: NOW - 3 * 86_400_000,
  lastSeenAt: NOW - 90_000_000,
  online: false,
};

function state(over: Partial<MobileState> = {}): MobileState {
  return { enabled: true, encryptionAvailable: true, phones: [], pending: null, ...over };
}

const button = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
const dialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-slot="dialog-content"]');

async function press(text: string): Promise<void> {
  const target = button(text);
  if (target === undefined) throw new Error(`no button "${text}"`);
  await act(async () => {
    target.click();
  });
  await settle();
}

beforeEach(() => {
  vi.useRealTimers();
  host.state = state();
  host.start = {
    ...state({
      pending: { qr: qrFor("https://relay.example/relay"), expiresAt: Date.now() + 300_000 },
    }),
    error: null,
  };
  host.revoke = state();
  host.cancel = state();
  mobileState.value = state();
  pairDialogOpen.value = false;
  pairError.value = null;
  pairStarting.value = false;
  revokeTarget.value = null;
  switches.on = true;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("the Mobile section's visibility", () => {
  it("is not a category, in the rail or in the list, while the switch is off", async () => {
    switches.on = false;
    expect(visibleSettingsCategories().map((c) => c.id)).not.toContain("mobile");
    await mount(<SettingsNav />);
    expect(document.body.textContent).not.toContain("Mobile");
    switches.on = true;
    expect(visibleSettingsCategories().map((c) => c.id)).toContain("mobile");
    const shown = await mount(<SettingsNav />);
    expect(shown.host.textContent).toContain("Mobile");
  });
});

describe("Settings → Mobile", () => {
  it("shows the empty state and the footnote about what the relay sees", async () => {
    await mount(<MobileSection />);
    expect(document.body.textContent).toContain("No phones are paired yet.");
    expect(document.body.textContent).toContain(
      "never sees terminal text, files or notification copy",
    );
    expect(document.body.textContent).toContain("keeps this computer awake");
    await press("Read the full privacy notice");
    expect(openUrl).toHaveBeenCalledWith("https://deck.spacevibe.dev/privacy");
  });

  it("Pair a phone shows the QR from mobile_pair_start, the relay host and a countdown", async () => {
    await mount(<MobileSection />);
    await press("Pair a phone");
    expect(startMobilePairing).toHaveBeenCalledOnce();
    expect(dialog()?.querySelector("img[alt='Pairing code for the Deck app']")).not.toBeNull();
    expect(dialog()?.textContent).toContain("Waiting for your phone…");
    expect(dialog()?.textContent).toMatch(/Code expires in [45]:\d\d/);
    expect(dialog()?.textContent).toContain("Connects through relay.example");
  });

  it("Copy code puts the pairing text on the clipboard, for the phone's paste field", async () => {
    await mount(<MobileSection />);
    await press("Pair a phone");
    await press("Copy code");
    expect(writeText).toHaveBeenCalledWith((host.start as { pending: { qr: string } }).pending.qr);
  });

  it("Cancel closes the dialog and tells main", async () => {
    await mount(<MobileSection />);
    await press("Pair a phone");
    await press("Cancel");
    expect(cancelMobilePairing).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("an expired code says so and offers a new one", async () => {
    host.start = {
      ...state({ pending: { qr: qrFor("https://relay.example"), expiresAt: Date.now() + 1_500 } }),
      error: null,
    };
    await mount(<MobileSection />);
    await press("Pair a phone");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_300));
    });
    expect(dialog()?.textContent).toContain("This code expired");
    expect(dialog()?.querySelector("img.mobile-qr")).toBeNull();
    host.start = {
      ...state({
        pending: { qr: qrFor("https://relay.example"), expiresAt: Date.now() + 300_000 },
      }),
      error: null,
    };
    await press("Show a new code");
    expect(startMobilePairing).toHaveBeenCalledTimes(2);
    expect(dialog()?.querySelector("img.mobile-qr")).not.toBeNull();
  });

  it("a phone that pairs closes the dialog and appears in the list", async () => {
    await mount(<MobileSection />);
    await press("Pair a phone");
    host.state = state({ phones: [{ ...PHONE, online: true }] });
    await act(async () => {
      host.changed?.();
    });
    await settle();
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain("Mark's iPhone");
    expect(document.body.textContent).toContain("iPhone 16");
    expect(document.body.textContent).toContain("Online now");
  });

  it("shows why a pairing could not start", async () => {
    host.start = {
      ...state(),
      error: {
        reason: "relay-unreachable",
        message: "Deck could not reach the relay. Check the connection and try again.",
      },
    };
    await mount(<MobileSection />);
    await press("Pair a phone");
    expect(dialog()?.textContent).toContain("Deck could not reach the relay");
    expect(dialog()?.querySelector("img.mobile-qr")).toBeNull();
    expect(button("Show a new code")).toBeDefined();
  });

  it("disables pairing, with the reason, when secure storage is unavailable", async () => {
    host.state = state({ encryptionAvailable: false });
    await mount(<MobileSection />);
    expect(document.body.textContent).toContain("secure storage is unavailable");
    const pair = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Pair a phone",
    );
    expect(pair?.disabled).toBe(true);
  });

  it("Revoke asks first, then calls mobile_revoke with the pairing id", async () => {
    host.state = state({ phones: [PHONE] });
    host.revoke = state();
    await mount(<MobileSection />);
    expect(document.body.textContent).toContain("Last seen yesterday");
    await press("Revoke");
    expect(revokeMobilePhone).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Revoke Mark's iPhone?");
    // Declining changes nothing.
    await press("Cancel");
    expect(revokeMobilePhone).not.toHaveBeenCalled();
    await press("Revoke");
    const confirm = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Revoke",
    );
    await act(async () => {
      confirm?.click();
    });
    await settle();
    expect(revokeMobilePhone).toHaveBeenCalledWith(PHONE.pairingId);
    expect(document.body.textContent).toContain("No phones are paired yet.");
  });
});
