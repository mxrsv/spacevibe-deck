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

import { LaunchProfileEditor } from "./launch-profile-editor";
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

  it("prints every built-in agent as its bare binary when nothing is declared", () => {
    mount();

    // The bare binary IS what an agent with no preset launches, so the row is
    // an honest picture rather than a placeholder.
    expect(host.textContent).toContain("claude");
    expect(host.textContent).toContain("cursor-agent");
    expect(host.textContent).toContain("gemini");
    // Nothing to star or remove until the user writes a command.
    expect(host.querySelectorAll(".lp-star")).toHaveLength(0);
    expect(host.querySelectorAll(".cfg-row__remove")).toHaveLength(0);
  });

  it("prints a declared command in place of its agent's bare row", () => {
    withProfiles([plan], { claude: "lp:plan" });
    mount();

    expect(host.textContent).toContain("--permission-mode plan");
    // One claude row, not a bare one beside the declared one.
    const claudeRows = Array.from(
      host.querySelectorAll(".lp-command__binary"),
    ).filter((node) => node.textContent === "claude");
    expect(claudeRows).toHaveLength(1);
  });

  it("adds the command that was typed, and stars it as the agent's first", () => {
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

  it("refuses a duplicate command", () => {
    withProfiles([plan], { claude: "lp:plan" });
    mount();
    type("claude --permission-mode plan");
    click(byLabel("Add"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "already in the list",
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("stars another command for the same agent", () => {
    const other: LaunchProfile = {
      id: "lp:auto",
      command: "claude --permission-mode acceptEdits",
    };
    withProfiles([plan, other], { claude: "lp:plan" });
    mount();

    click(byLabel(`Make ${other.command} the default`));

    expect(updateSettings).toHaveBeenCalledWith({
      defaultLaunchProfiles: { claude: "lp:auto" },
    });
  });

  it("removing a command drops the default pointing at it, in one write", () => {
    withProfiles([plan], { claude: "lp:plan" });
    mount();

    click(byLabel(`Remove ${plan.command}`));

    // One write, not two: a dangling default must never reach disk, not even
    // for the tick between two `updateSettings` calls.
    expect(updateSettings).toHaveBeenCalledWith({
      launchProfiles: [],
      defaultLaunchProfiles: {},
    });
  });

  it("keeps a command whose binary is not a built-in", () => {
    withProfiles([{ id: "lp:aider", command: "aider --model sonnet" }]);
    mount();

    // Still something Deck will type, so it still belongs in the list.
    expect(host.textContent).toContain("aider");
    expect(host.textContent).toContain("--model sonnet");
  });
});
