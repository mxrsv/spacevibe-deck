// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentLaunchPage } from "../launcher/agent-launch-page-store";
import { LaunchCheckoutPicker } from "../launcher/launch-checkout-picker";
import { WorkspacePicker } from "../open-board/workspace-picker";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { setup } from "./tab-manager.fixtures";

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => true,
    onFocusChanged: async () => () => {},
  }),
}));

let host: HTMLDivElement;

function mountPage(): void {
  act(() =>
    render(
      <section class="agent-launch-page">
        <WorkspacePicker
          value="/repo/deck"
          paths={["/repo/deck", "/repo/api"]}
          homeDir="/Users/dev"
          disabled={false}
          onSelect={vi.fn()}
          onPickFolder={vi.fn()}
        />
        <LaunchCheckoutPicker
          checkouts={[
            { path: "/repo/deck", label: "main" } as never,
            { path: "/repo/deck-wt", label: "feat" } as never,
          ]}
          value="/repo/deck"
          disabled={false}
          onSelect={vi.fn()}
        />
      </section>,
      host,
    ),
  );
}

function openPage(): void {
  agentLaunchPage.open({
    target: { kind: "first-pane", workspacePath: "/repo/deck" },
    launch: async () => ({ kind: "cancelled" }),
    restoreFocus: vi.fn(),
    reveal: vi.fn(),
  });
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  agentLaunchPage.close();
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  agentLaunchPage.close();
});

describe("launch page Escape with the real window shortcut handler", () => {
  for (const [name, selector] of [
    ["workspace", ".nt-workspace-picker__trigger"],
    ["checkout", ".nt-workspace-picker__trigger[aria-label^='Checkout']"],
  ] as const) {
    it(`closes only the ${name} popover and returns focus to its trigger`, async () => {
      const { tm } = setup({});
      await tm.init();
      mountPage();
      openPage();
      const trigger = host.querySelector<HTMLButtonElement>(selector)!;
      act(() => trigger.click());
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
      const row = host.querySelector<HTMLButtonElement>('[role^="menuitem"]')!;
      act(() => row.focus());

      const event = pressEscape();

      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(agentLaunchPage.request.value).not.toBeNull();
      expect(document.activeElement).toBe(trigger);
      // The terminal behind never sees the key: the popover consumed it.
      expect(event.defaultPrevented).toBe(true);

      pressEscape();
      expect(agentLaunchPage.request.value).toBeNull();
      tm.dispose();
    });
  }

  it("closes the page on Escape when no popover is open", async () => {
    const { tm } = setup({});
    await tm.init();
    mountPage();
    openPage();
    pressEscape();
    expect(agentLaunchPage.request.value).toBeNull();
    tm.dispose();
  });
});
