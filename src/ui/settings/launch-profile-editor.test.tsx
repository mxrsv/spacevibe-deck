// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The editor pulls in the host-backed settings store; stub it so the tree
// mounts under jsdom (same shape as agents-section.test.tsx).
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../settings/settings-store", async () => {
  const actual = await vi.importActual<
    typeof import("../../settings/settings-store")
  >("../../settings/settings-store");
  return { ...actual, updateSettings: vi.fn() };
});

vi.mock("../../terminal/link-client", () => ({
  defaultLinkClient: { openUrl: vi.fn(async () => {}) },
}));

import { LaunchProfileEditor } from "./launch-profile-editor";
import { detectedAgents } from "../../terminal/agent-detection-store";
import { settings, updateSettings } from "../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import type { LaunchProfile } from "../../lib/launch-profile";

const plan: LaunchProfile = {
  id: "lp:plan",
  command: "claude --permission-mode plan",
};

describe("LaunchProfileEditor", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
    detectedAgents.value = [];
    vi.mocked(updateSettings).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    settings.value = DEFAULT_SETTINGS;
    detectedAgents.value = [];
  });

  const mount = (): void => {
    act(() => {
      render(<LaunchProfileEditor />, host);
    });
  };

  const click = (element: Element | null): void => {
    expect(element).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  /** Type into the add field, which is a plain controlled input. */
  const type = (value: string): void => {
    const input = byLabel("Add command") as HTMLInputElement;
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const byLabel = (label: string): HTMLElement | null =>
    host.querySelector(`[aria-label="${label}"]`);

  const withProfiles = (
    profiles: readonly LaunchProfile[],
    defaults: Readonly<Record<string, string>> = {},
  ): void => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      launchProfiles: profiles,
      defaultLaunchProfiles: defaults,
    };
  };

  const install = (...ids: readonly string[]): void => {
    detectedAgents.value = ids.map((name) => ({ name, path: `/bin/${name}` }));
  };

  it("prints each agent's shipped command, with no preset declared", () => {
    install("claude", "codex");
    mount();

    // The catalog's recommendation, not a bare binary and not something the
    // user had to type — this is what a fresh install shows.
    expect(host.textContent).toContain("--dangerously-skip-permissions");
    expect(host.textContent).toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("splits the catalog on what is actually on PATH", () => {
    install("claude");
    mount();

    expect(host.textContent).toContain("Installed");
    expect(host.textContent).toContain("1 detected");
    expect(host.textContent).toContain("Available to install");
    // Only an installed agent can be made the default.
    expect(byLabel("Make Claude Code the default agent")).not.toBeNull();
    expect(byLabel("Make Codex the default agent")).toBeNull();
  });

  it("says so when nothing is installed", () => {
    mount();

    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "No agent CLI found",
    );
  });

  it("a user preset replaces the shipped command for that agent", () => {
    install("claude");
    withProfiles([plan], { claude: "lp:plan" });
    mount();

    expect(host.textContent).toContain("claude --permission-mode plan");
    // The shipped claude command is gone; agy's, which shares that flag, is
    // not — so the assertion names the binary rather than the flag alone.
    expect(host.textContent).not.toContain(
      "claude --dangerously-skip-permissions",
    );
  });

  it("disables an agent without deleting it", () => {
    install("claude");
    mount();

    click(byLabel("Disable Claude Code"));

    // A built-in cannot be deleted — the probe would find it again — so the
    // switch is the only thing that takes it out of the pickers.
    expect(updateSettings).toHaveBeenCalledWith({
      disabledAgents: ["claude"],
    });
  });

  it("sets the default agent", () => {
    install("claude", "codex");
    mount();

    click(byLabel("Make Codex the default agent"));

    expect(updateSettings).toHaveBeenCalledWith({ defaultAgent: "codex" });
  });

  it("marks the agent that is already the default", () => {
    install("claude");
    settings.value = { ...DEFAULT_SETTINGS, defaultAgent: "claude" };
    mount();

    expect(byLabel("Claude Code is the default agent")).not.toBeNull();
    expect(byLabel("Make Claude Code the default agent")).toBeNull();
  });

  it("adds a typed command and stars it for its agent", () => {
    install("claude");
    mount();
    type("claude --plan");
    click(byLabel("Add"));

    expect(updateSettings).toHaveBeenCalledWith({
      launchProfiles: [{ id: "lp:claude-plan", command: "claude --plan" }],
      defaultLaunchProfiles: { claude: "lp:claude-plan" },
    });
  });

  // The string is written verbatim into a live shell, so this is the gate that
  // matters most on this surface.
  it("refuses a command a shell would act on, and says why", () => {
    mount();
    type("claude; rm -rf /");
    click(byLabel("Add"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "letters, digits",
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
