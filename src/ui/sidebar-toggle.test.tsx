// @vitest-environment jsdom
import { render } from "preact";
import deckLogoUrl from "../../.github/assets/icon.svg";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarFrameActions, SidebarNewButton, SidebarToggle } from "./sidebar-toggle";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { appVersion } from "../updater/app-version";

describe("SidebarToggle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    appVersion.value = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    resetDesktopEnvironmentForTests();
    appVersion.value = "";
  });

  function control(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>("button.iconbtn");
    if (button === null) {
      throw new Error("SidebarToggle rendered no control");
    }
    return button;
  }

  it("offers to collapse an expanded sidebar", () => {
    act(() => render(<SidebarToggle collapsed={false} onToggle={vi.fn()} />, host));

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Collapse the sidebar");
    expect(button.getAttribute("title")).toBe("Collapse the sidebar");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  // The one control says both things: collapsed, it is the way back out, and
  // it reads pressed so the state is not carried by the label alone.
  //
  // DL-21.8: pressed is said in ARIA and NOWHERE in the paint. A hidden
  // sidebar is a change to the whole window, so the class assertion below is
  // inverted on purpose — it guards against the wash coming back.
  it("offers to expand a collapsed sidebar, and reads pressed without painting it", () => {
    act(() => render(<SidebarToggle collapsed onToggle={vi.fn()} />, host));

    const button = control();
    expect(button.getAttribute("aria-label")).toBe("Expand the sidebar");
    expect(button.getAttribute("title")).toBe("Expand the sidebar");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("is-active")).toBe(false);
  });

  it("reports a click and keeps no state of its own", () => {
    const onToggle = vi.fn();
    act(() => render(<SidebarToggle collapsed={false} onToggle={onToggle} />, host));

    act(() => {
      control().click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    // Nothing repainted: the owner of the state decides what happens next.
    expect(control().getAttribute("aria-pressed")).toBe("false");
  });

  it("pairs the collapse control with Deck branding", () => {
    act(() => render(<SidebarFrameActions collapsed={false} onToggle={vi.fn()} />, host));
    expect(control().getAttribute("aria-label")).toBe("Collapse the sidebar");
    expect(host.querySelector(".sidebar-brand")?.textContent).toBe("Deck");
    expect(host.querySelector(".sidebar-brand img")?.getAttribute("src")).toBe(deckLogoUrl);
    expect(host.querySelector(".sidebar-new")).toBeNull();
  });

  it("shows DEV for a local build even before the version loads", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev", isDevelopment: true });
    act(() => render(<SidebarFrameActions collapsed={false} onToggle={vi.fn()} />, host));
    expect(host.querySelector(".sidebar-brand__dev")?.textContent).toBe("DEV");
    act(() => {
      appVersion.value = "43.3.0";
    });
    expect(host.querySelector(".sidebar-brand__dev")?.textContent).toBe("DEV");
    expect(host.querySelector(".sidebar-brand__version")).toBeNull();
  });

  it("keeps the version label for a packaged build", () => {
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
      isDevelopment: false,
    });
    appVersion.value = "1.2.0";
    act(() => render(<SidebarFrameActions collapsed={false} onToggle={vi.fn()} />, host));
    expect(host.querySelector(".sidebar-brand__dev")).toBeNull();
    expect(host.querySelector(".sidebar-brand__version")?.textContent).toBe("V1.2.0");
  });

  it("ends the identity row with a small New that keeps its full accessible name", () => {
    const onOpenWorkspace = vi.fn();
    act(() =>
      render(
        <SidebarFrameActions
          collapsed={false}
          onToggle={vi.fn()}
          newButton={<SidebarNewButton onOpenWorkspace={onOpenWorkspace} />}
        />,
        host,
      ),
    );
    const row = host.querySelector(".sidebar-frame-actions");
    const button = row?.lastElementChild as HTMLButtonElement;
    expect(button.classList.contains("sidebar-new")).toBe(true);
    expect(button.textContent).toBe("New");
    expect(button.getAttribute("aria-label")).toBe("New Workspace");
    act(() => button.click());
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("opens the workspace from the standalone launcher", () => {
    const onOpenWorkspace = vi.fn();
    act(() => render(<SidebarNewButton onOpenWorkspace={onOpenWorkspace} />, host));
    act(() => host.querySelector<HTMLButtonElement>(".sidebar-new")!.click());
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("disables New while another task operation is in flight", () => {
    const onOpenWorkspace = vi.fn();
    act(() => render(<SidebarNewButton disabled onOpenWorkspace={onOpenWorkspace} />, host));

    const button = host.querySelector<HTMLButtonElement>(".sidebar-new");
    expect(button?.disabled).toBe(true);
    act(() => button?.click());
    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });
});
