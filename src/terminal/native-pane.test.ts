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
});

afterAll(() => vi.unstubAllGlobals());

describe("createNativePane accessibility", () => {
  it("announces asynchronous failures and names the retry action", async () => {
    const pane = createNativePane(
      0x8000_0000,
      DEFAULT_SETTINGS,
      {
        onData: vi.fn(),
        onResize: vi.fn(),
        onFocus: vi.fn(),
        onAttentionSignal: vi.fn(),
      },
      createMemoryNativePaneClient(),
    );

    expect(pane.element.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      pane.element.querySelector(
        'button[aria-label="Retry embedded Alacritty pane"]',
      ),
    ).not.toBeNull();
    await expect(pane.pasteText("do not submit")).resolves.toBe(false);

    pane.dispose();
  });
});
