// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section pulls in the Tauri-backed settings store; stub it so the
// component tree mounts under jsdom.
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../../chrome/events", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../chrome/events")>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { NotificationsSection } from "./notifications-section";
import { settings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";
import { requestAgentNotificationPermission } from "../../../lib/native-notification";
import { reportPersistError } from "../../../chrome/events";

const mockedRequestPermission = vi.mocked(requestAgentNotificationPermission);
const mockedReportPersistError = vi.mocked(reportPersistError);

/** Flushes the whole microtask queue — a single `await Promise.resolve()`
 * only advances one hop, which isn't enough for an `await`-chained handler
 * (permission request → settings update/error → `finally`). A macrotask
 * boundary guarantees every pending microtask has drained first. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("NotificationsSection — agent notifications toggle (Task 22)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = DEFAULT_SETTINGS;
    mockedRequestPermission.mockReset();
    mockedReportPersistError.mockReset();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (): void => {
    act(() => {
      render(<NotificationsSection />, host);
    });
  };

  const getToggle = (): HTMLButtonElement =>
    host.querySelector(
      '[aria-label="agent notifications"]',
    ) as HTMLButtonElement;

  it("does NOT request permission on render/mount", () => {
    mount();
    expect(mockedRequestPermission).not.toHaveBeenCalled();
    expect(getToggle().getAttribute("aria-checked")).toBe("false");
  });

  it("enable + granted: requests permission once, setting becomes true", async () => {
    mockedRequestPermission.mockResolvedValueOnce(true);
    mount();

    await act(async () => {
      getToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
    expect(settings.value.agentNotifications).toBe(true);
    expect(mockedReportPersistError).not.toHaveBeenCalled();
    expect(getToggle().getAttribute("aria-checked")).toBe("true");
  });

  it("enable + denied: requests permission, setting stays false, error surfaced", async () => {
    mockedRequestPermission.mockResolvedValueOnce(false);
    mount();

    await act(async () => {
      getToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
    expect(settings.value.agentNotifications).toBe(false);
    expect(mockedReportPersistError).toHaveBeenCalledTimes(1);
    expect(getToggle().getAttribute("aria-checked")).toBe("false");
  });

  it("permission API rejects: setting stays false, error surfaced, no throw escapes", async () => {
    mockedRequestPermission.mockRejectedValueOnce(new Error("boom"));
    mount();

    await expect(
      act(async () => {
        getToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushMicrotasks();
      }),
    ).resolves.not.toThrow();

    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
    expect(settings.value.agentNotifications).toBe(false);
    expect(mockedReportPersistError).toHaveBeenCalledTimes(1);
  });

  it("disable (currently true): setting becomes false, permission NOT requested", async () => {
    settings.value = { ...DEFAULT_SETTINGS, agentNotifications: true };
    mount();
    expect(getToggle().getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      getToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(settings.value.agentNotifications).toBe(false);
    expect(mockedRequestPermission).not.toHaveBeenCalled();
    expect(getToggle().getAttribute("aria-checked")).toBe("false");
  });

  it("double-click / re-entry while a request is in flight: permission requested exactly once", async () => {
    let resolvePermission: (granted: boolean) => void = () => {};
    mockedRequestPermission.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePermission = resolve;
        }),
    );
    mount();
    const toggle = getToggle();

    await act(async () => {
      // Both dispatches happen in the same synchronous tick, before Preact
      // re-renders the `disabled` attribute — this exercises the local
      // `requesting.value` guard, not the DOM `disabled` enforcement.
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      resolvePermission(true);
      await flushMicrotasks();
    });

    expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
    expect(settings.value.agentNotifications).toBe(true);
  });
});
