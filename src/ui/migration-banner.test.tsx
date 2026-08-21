// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATION_NOTICE_URL } from "../updater/migration-notice";
import { MigrationBanner } from "./migration-banner";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../host/shell-host", () => ({ openUrl }));

describe("MigrationBanner", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    openUrl.mockClear();
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  it("is a status region, never an alert", () => {
    // DL-30.3: true for as long as the window is open, so an assertive region
    // would interrupt a screen-reader user to say something still true later.
    act(() => render(<MigrationBanner onDismiss={() => {}} />, host));

    const banner = host.querySelector(".migration-banner");
    expect(banner?.getAttribute("role")).toBe("status");
  });

  it("says the update is over AND that settings do not carry over", () => {
    // The settings sentence is the fact most likely to make someone delay the
    // move; finding it out afterwards is worse than reading it here.
    act(() => render(<MigrationBanner onDismiss={() => {}} />, host));

    const message = host.querySelector(".migration-banner__message")?.textContent ?? "";
    expect(message).toContain("no longer updates itself");
    expect(message).toContain("settings do not carry over");
  });

  it("opens the landing root, and says so on the control", () => {
    // DL-8: a control says what happens, and what happens is a browser tab.
    act(() => render(<MigrationBanner onDismiss={() => {}} />, host));

    const action = host.querySelector<HTMLButtonElement>(".migration-banner__action");
    expect(action?.textContent).toContain("Open the download page");

    act(() => action?.click());
    expect(openUrl).toHaveBeenCalledWith(MIGRATION_NOTICE_URL);
  });

  it("names the dismissal as temporary on the close control", () => {
    // DL-30.5: a bare ✕ otherwise reads as a promise never to show it again,
    // which is a promise this surface deliberately does not make.
    const onDismiss = vi.fn();
    act(() => render(<MigrationBanner onDismiss={onDismiss} />, host));

    const close = host.querySelector<HTMLButtonElement>(".migration-banner__close");
    expect(close?.getAttribute("aria-label")).toBe("Hide this notice until Deck restarts");

    act(() => close?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
