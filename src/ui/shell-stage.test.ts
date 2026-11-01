// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { applyShellFrame, flashPane, SHELL_FRAME_CLASS, shellStageEnabled } from "./shell-stage";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("flashPane", () => {
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function mountSlot(paneId: number): { slot: HTMLElement; pane: HTMLElement } {
    const slot = document.createElement("div");
    slot.className = "pane-slot";
    slot.dataset.paneId = String(paneId);
    const pane = document.createElement("div");
    pane.className = "pane";
    slot.append(pane);
    document.body.append(slot);
    return { slot, pane };
  }

  afterEach(() => document.body.replaceChildren());

  it("marks only the pressed pane's slot until its own animation ends", async () => {
    const { slot, pane } = mountSlot(7);
    const other = mountSlot(8);
    flashPane(7);
    await nextFrame();
    expect(slot.classList.contains("is-flashing")).toBe(true);
    expect(other.slot.classList.contains("is-flashing")).toBe(false);

    const child = pane.appendChild(document.createElement("span"));
    child.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(slot.classList.contains("is-flashing")).toBe(true);

    pane.dispatchEvent(new Event("animationend"));
    expect(slot.classList.contains("is-flashing")).toBe(false);
  });

  it("does nothing for a pane with no slot on screen", async () => {
    flashPane(99);
    await nextFrame();
    expect(document.querySelector(".is-flashing")).toBeNull();
  });
});

describe("the flush stage switch", () => {
  it("is off in a unit test, where no host says it is a development build", () => {
    expect(shellStageEnabled()).toBe(false);
  });

  it.each([
    ["a packaged host", false],
    ["a development host", true],
  ])("follows the host's identity: %s", (_label, isDevelopment) => {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
    expect(shellStageEnabled()).toBe(isDevelopment);
  });

  it.each([
    ["a packaged host keeps the shipped frame row", false],
    ["a development host gets the taller frame row", true],
  ])("%s", (_label, isDevelopment) => {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
    const root = document.createElement("html");
    applyShellFrame(root);
    expect(root.classList.contains(SHELL_FRAME_CLASS)).toBe(isDevelopment);
  });
});
