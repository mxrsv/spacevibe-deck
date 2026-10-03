// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopChrome } from "./desktop-chrome";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
  type DesktopPlatform,
} from "../lib/platform";

let host: HTMLDivElement;

function mountSidebarShell(): void {
  act(() => {
    render(
      <DesktopChrome
        sidebar
        sidebarToggle={<button type="button">Hide</button>}
        toolbar={null}
        sidebarNavigation={<nav />}
        topTabs={null}
        stage={<main />}
        status={null}
        onMacTitlebarDoubleClick={() => {}}
      />,
      host,
    );
  });
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetDesktopEnvironmentForTests();
  vi.unstubAllGlobals();
});

/**
 * The frame row moves the window, but it is NOT one big drag surface with its
 * controls punched out of it. That arrangement made the cursor flicker while
 * the pointer MOVED across a control: Chromium hit-tests `-webkit-app-region`
 * separately, so a no-drag island inside a drag surface alternates between the
 * OS arrow and the element's own cursor. The drag lives on the two elements
 * that are nothing but space (2026-08-19).
 */
describe("frame row drag surfaces", () => {
  it("keeps the drag on the spacer and the traffic-light inset, not the row", () => {
    mountSidebarShell();

    const frame = host.querySelector<HTMLElement>(".deck-frame")!;
    expect(frame.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(
      host
        .querySelector<HTMLElement>(".deck-frame__spacer")!
        .hasAttribute("data-tauri-drag-region"),
    ).toBe(true);
    // The inset declares its own `-webkit-app-region` in the stylesheet, so it
    // needs no attribute — it must simply still be there to reserve the box.
    expect(host.querySelector(".deck-frame__lights")).not.toBeNull();
  });

  it("leaves the row's controls with no app-region of their own to fight", () => {
    mountSidebarShell();

    const control = host.querySelector<HTMLElement>(".deck-frame button")!;
    expect(control.closest("[data-tauri-drag-region]")).toBeNull();
  });
});

/**
 * The marker that turns the caption-button inset on (`22-caption-overlay.css`).
 * Only the Electron host paints caption buttons over the web contents, and only
 * on Windows: Tauri's Windows build keeps a native title bar ABOVE the row, so a
 * reservation there would be a dead gap, and macOS reserves the other side.
 * The host shows itself the way every facade reads it, through `__deckHost`.
 */
describe("caption-overlay marker", () => {
  const HOMES: Record<DesktopPlatform, string> = {
    macos: "/Users/deck",
    windows: "C:\\Users\\Deck",
    unsupported: "",
  };

  function markerFor(platform: DesktopPlatform, sidebar: boolean): boolean {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform, homeDir: HOMES[platform] });
    act(() => render(null, host));
    act(() => {
      render(
        <DesktopChrome
          sidebar={sidebar}
          toolbar={null}
          sidebarNavigation={<nav />}
          topTabs={<header />}
          stage={<main />}
          status={null}
          onMacTitlebarDoubleClick={() => {}}
        />,
        host,
      );
    });
    return host.firstElementChild!.classList.contains("window--caption-overlay");
  }

  const electronHost = () => vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
  const tauriHost = () => vi.stubGlobal("__TAURI_INTERNALS__", {});

  it.each([true, false])(
    "is carried on Windows under the Electron host (sidebar %s)",
    (sidebar) => {
      electronHost();
      expect(markerFor("windows", sidebar)).toBe(true);
    },
  );

  it.each([
    ["macOS with the Electron host", "macos", electronHost],
    ["macOS without a host", "macos", () => {}],
    ["an unsupported platform with the Electron host", "unsupported", electronHost],
    ["Windows in the browser preview, no host", "windows", () => {}],
    ["Windows under Tauri, native title bar", "windows", tauriHost],
  ] as const)("is absent on %s", (_, platform, installHost) => {
    installHost();
    for (const sidebar of [true, false]) {
      expect(markerFor(platform, sidebar)).toBe(false);
    }
  });
});
