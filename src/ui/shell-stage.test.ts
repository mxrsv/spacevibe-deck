// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  applyShellFrame,
  flashPane,
  SHELL_FRAME_CLASS,
  shellStageEnabled,
  withPaneFlash,
} from "./shell-stage";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("the flash of a rail press", () => {
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function mountSlot(paneId: number, className = "pane-slot") {
    const slot = document.createElement("div");
    slot.className = className;
    slot.dataset.paneId = String(paneId);
    slot.checkVisibility = () => true;
    const pane = document.createElement("div");
    pane.className = "pane";
    const animate = vi.fn();
    pane.animate = animate;
    slot.append(pane);
    document.body.append(slot);
    return { slot, pane, animate };
  }

  function devHost(reducedMotion = false): void {
    vi.stubGlobal("__deckHost", {});
    vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/home/test",
      isDevelopment: true,
    });
  }

  afterEach(() => document.body.replaceChildren());

  it("animates only the pressed pane, once per press, so a second press restarts it", async () => {
    devHost();
    const pressed = mountSlot(7);
    const other = mountSlot(8);
    flashPane(7);
    await nextFrame();
    flashPane(7);
    await nextFrame();
    expect(pressed.animate).toHaveBeenCalledTimes(2);
    expect(other.animate).not.toHaveBeenCalled();
  });

  it("does not animate under reduced motion", async () => {
    devHost(true);
    const { animate } = mountSlot(7);
    flashPane(7);
    await nextFrame();
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not animate while the flush stage is off", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { animate } = mountSlot(7);
    flashPane(7);
    await nextFrame();
    expect(animate).not.toHaveBeenCalled();
  });

  it("finds a zoomed pane in the overlay it moved to", async () => {
    devHost();
    const { slot, pane, animate } = mountSlot(7);
    const container = document.createElement("div");
    container.className = "is-zoomed";
    const overlay = document.createElement("div");
    overlay.className = "zoom-overlay";
    overlay.append(pane);
    container.append(slot, overlay);
    document.body.append(container);
    flashPane(7);
    await nextFrame();
    expect(animate).toHaveBeenCalledOnce();
  });

  it("flashes the focused pane of a split when a press names only the tab", async () => {
    devHost();
    const rest = mountSlot(1);
    const active = mountSlot(2, "pane-slot is-active");
    const selectTab = vi.fn();
    withPaneFlash({ onFocusPane: vi.fn(), onSelectTab: selectTab }).onSelectTab(3);
    await nextFrame();
    expect(selectTab).toHaveBeenCalledWith(3);
    expect(active.animate).toHaveBeenCalledOnce();
    expect(rest.animate).not.toHaveBeenCalled();
  });

  it("focuses first, then flashes, for a press that names a pane", async () => {
    devHost();
    const { animate } = mountSlot(7);
    const focusPane = vi.fn();
    withPaneFlash({ onFocusPane: focusPane, onSelectTab: vi.fn() }).onFocusPane(0, 7);
    await nextFrame();
    expect(focusPane).toHaveBeenCalledWith(0, 7);
    expect(animate).toHaveBeenCalledOnce();
  });

  it("flashes nothing when the focus was refused", async () => {
    devHost();
    const { animate } = mountSlot(7);
    withPaneFlash({ onFocusPane: () => false, onSelectTab: vi.fn() }).onFocusPane(0, 7);
    await nextFrame();
    expect(animate).not.toHaveBeenCalled();
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
