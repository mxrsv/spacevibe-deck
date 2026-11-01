// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section pulls in the Tauri-backed settings store; stub it so the
// component tree mounts under jsdom.
vi.mock("../../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../../host/dialog-host", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../chrome/events")>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { ask } from "../../../host/dialog-host";
import { ResetSection } from "./reset-section";
import { settings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";
import { reportPersistError } from "../../../chrome/events";

const mockedReportPersistError = vi.mocked(reportPersistError);
const mockedAsk = vi.mocked(ask);

/** Flushes the whole microtask queue — a single `await Promise.resolve()`
 * only advances one hop, which isn't enough for an `await`-chained handler
 * (confirm dialog → reset/finally). A macrotask boundary guarantees every
 * pending microtask has drained first. */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("ResetSection — scoped resets", () => {
  let host: HTMLDivElement;
  const CUSTOM = {
    ...DEFAULT_SETTINGS,
    fontSize: 20,
    themeId: "dracula",
    sidebarWidth: 300,
    promptTemplates: [{ id: "t", name: "t", body: "b" }] as never,
  };

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
      render(<ResetSection />, host);
    });
  };

  const buttons = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-slot="button"]'));

  const click = async (button: HTMLButtonElement): Promise<void> => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
  };

  it("offers preferences, layout and data as three separate rows with the word reset", () => {
    mount();
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      "reset",
      "reset",
      "reset",
    ]);
  });

  it("asks first, names what it resets and keeps, and resets only preferences", async () => {
    mockedAsk.mockResolvedValueOnce(true);
    mount();
    expect(mockedAsk).not.toHaveBeenCalled();

    await click(buttons()[0]);

    expect(mockedAsk).toHaveBeenCalledWith(
      expect.stringMatching(/Resets: .*Font size.*Color mode.*\nKeeps: layout/s),
      expect.objectContaining({ title: "Reset preferences" }),
    );
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settings.value.themeId).toBe(DEFAULT_SETTINGS.themeId);
    expect(settings.value.sidebarWidth).toBe(300);
    expect(settings.value.promptTemplates).toEqual(CUSTOM.promptTemplates);
  });

  it("a row is disabled when nothing in its scope differs", () => {
    settings.value = { ...DEFAULT_SETTINGS };
    mount();
    expect(buttons().every((button) => button.disabled)).toBe(true);
  });

  it("cancelling the prompt leaves every setting untouched", async () => {
    mockedAsk.mockResolvedValueOnce(false);
    mount();

    await click(buttons()[0]);

    expect(settings.value.fontSize).toBe(20);
    expect(mockedReportPersistError).not.toHaveBeenCalled();
  });

  it("a failed prompt is fail-safe: nothing reset, error surfaced", async () => {
    mockedAsk.mockRejectedValueOnce(new Error("no dialog"));
    mount();

    await click(buttons()[0]);

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
    const button = buttons()[0];

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      resolveAsk(true);
      await flushMicrotasks();
    });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });
});
