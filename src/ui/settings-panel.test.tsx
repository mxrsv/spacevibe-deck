// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The panel pulls in Tauri-backed stores through its rows; stub them so the
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
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chrome/events")>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { ask } from "@tauri-apps/plugin-dialog";
import { SettingsPanel } from "./settings-panel";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { requestAgentNotificationPermission } from "../lib/native-notification";
import { reportPersistError } from "../chrome/events";

const mockedRequestPermission = vi.mocked(requestAgentNotificationPermission);
const mockedReportPersistError = vi.mocked(reportPersistError);
const mockedAsk = vi.mocked(ask);

/** Flushes the whole microtask queue — a single `await Promise.resolve()`
 * only advances one hop, which isn't enough for an `await`-chained handler
 * (permission request → settings update/error → `finally`). A macrotask
 * boundary guarantees every pending microtask has drained first. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("SettingsPanel — Escape / focus (M2)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  // Unmount so the panel's window keydown listener is removed between tests —
  // a leaked listener from a prior instance would fire on the next dispatch.
  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (open: boolean, onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<SettingsPanel open={open} onClose={onClose} />, host);
    });
    return onClose;
  };

  it("moves focus onto the close pill when it opens", () => {
    mount(true);
    expect(document.activeElement).toBe(host.querySelector(".panel__esc"));
  });

  it("Escape closes the panel when focus is not in a terminal", () => {
    const onClose = mount(true);
    act(() => {
      (document.activeElement ?? window).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close the panel when a terminal owns focus (vim/fzf)", () => {
    const onClose = mount(true);

    // Simulate a focused xterm sitting behind the slide-over.
    const term = document.createElement("div");
    term.className = "xterm";
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once closed", () => {
    const onClose = mount(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SettingsPanel — agent notifications toggle (Task 22)", () => {
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
      render(<SettingsPanel open onClose={vi.fn()} />, host);
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

describe("SettingsPanel — Restore defaults confirm", () => {
  let host: HTMLDivElement;
  const CUSTOM = { ...DEFAULT_SETTINGS, fontSize: 20, themeId: "dracula" };

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = CUSTOM;
    mockedAsk.mockReset();
    mockedReportPersistError.mockReset();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (): void => {
    act(() => {
      render(<SettingsPanel open onClose={vi.fn()} />, host);
    });
  };

  const getReset = (): HTMLButtonElement =>
    host.querySelector(".cfg-btn--danger") as HTMLButtonElement;

  const click = async (button: HTMLButtonElement): Promise<void> => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
  };

  it("does NOT reset on render, and asks before resetting", async () => {
    mockedAsk.mockResolvedValueOnce(true);
    mount();
    expect(mockedAsk).not.toHaveBeenCalled();

    await click(getReset());

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settings.value.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });

  it("cancelling the prompt leaves every setting untouched", async () => {
    mockedAsk.mockResolvedValueOnce(false);
    mount();

    await click(getReset());

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(settings.value.fontSize).toBe(20);
    expect(settings.value.themeId).toBe("dracula");
    expect(mockedReportPersistError).not.toHaveBeenCalled();
  });

  it("a failed prompt is fail-safe: nothing reset, error surfaced", async () => {
    mockedAsk.mockRejectedValueOnce(new Error("no dialog"));
    mount();

    await click(getReset());

    expect(settings.value.fontSize).toBe(20);
    expect(mockedReportPersistError).toHaveBeenCalledTimes(1);
  });

  it("two clicks in one tick raise a single prompt", async () => {
    let resolveAsk: (value: boolean) => void = () => {};
    mockedAsk.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAsk = resolve;
        }),
    );
    mount();
    const button = getReset();

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      resolveAsk(true);
      await flushMicrotasks();
    });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });
});
