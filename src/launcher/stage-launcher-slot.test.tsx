// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { stageLauncherEnabled } from "./stage-launcher-enabled";
import { StageLauncherSlot } from "./stage-launcher-slot";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  document.body.innerHTML = "";
});

describe("stageLauncherEnabled", () => {
  function pinHost(isDevelopment: boolean): void {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
  }

  it("is on in a development build, where every switch is on", () => {
    pinHost(true);
    expect(stageLauncherEnabled()).toBe(true);
  });

  it("is off in a packaged release", () => {
    pinHost(false);
    expect(stageLauncherEnabled()).toBe(false);
  });

  it("is off in a unit test that pins no host", () => {
    expect(stageLauncherEnabled()).toBe(false);
  });
});

describe("StageLauncherSlot", () => {
  it("renders a stable container and hosts whatever the launcher puts in it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      render(
        <StageLauncherSlot>
          <input data-testid="bar" />
        </StageLauncherSlot>,
        host,
      );
    });
    const slot = host.querySelector(".stage-launcher");
    expect(slot).not.toBeNull();
    expect(slot?.hasAttribute("data-stage-launcher")).toBe(true);
    expect(slot?.querySelector('[data-testid="bar"]')).not.toBeNull();
    act(() => render(null, host));
  });

  it("is flat by default and a scrim over the panes when floating", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => render(<StageLauncherSlot />, host));
    expect(host.querySelector(".stage-launcher--floating")).toBeNull();
    act(() => render(<StageLauncherSlot floating />, host));
    expect(host.querySelector(".stage-launcher--floating")).not.toBeNull();
    act(() => render(null, host));
  });
});
