// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { createMemoryNativePaneClient } from "./native-pane-client";
import { createNativePane } from "./native-pane";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});

afterAll(() => vi.unstubAllGlobals());

describe("createNativePane accessibility", () => {
  it("announces asynchronous failures and names the retry action", async () => {
    const nativeClient = createMemoryNativePaneClient();
    const updateError = new Error("native resize failed");
    const client = {
      ...nativeClient,
      updateAlacritty: vi.fn(async () => {
        throw updateError;
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pane = createNativePane(
      0x8000_0000,
      DEFAULT_SETTINGS,
      {
        onData: vi.fn(),
        onResize: vi.fn(),
        onFocus: vi.fn(),
        onAttentionSignal: vi.fn(),
      },
      client,
    );

    document.body.appendChild(pane.element);
    pane.mount();
    pane.setVisible?.(true);

    const alert = pane.element.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    await vi.waitFor(() => {
      expect(alert?.hidden).toBe(false);
      expect(alert?.textContent).toContain("native resize failed");
    });
    expect(
      pane.element.querySelector(
        'button[aria-label="Retry embedded Alacritty pane"]',
      ),
    ).not.toBeNull();
    await expect(pane.pasteText("do not submit")).resolves.toBe(false);

    pane.dispose();
    warn.mockRestore();
  });
});
