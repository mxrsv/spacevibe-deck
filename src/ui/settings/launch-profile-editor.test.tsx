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
  const actual = await vi.importActual<typeof import("../../settings/settings-store")>(
    "../../settings/settings-store",
  );
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
    vi.mocked(updateSettings).mockReset();
    vi.mocked(updateSettings).mockImplementation((patch) => {
      settings.value = { ...settings.value, ...patch };
    });
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
    expect(host.textContent).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  // The ↗ link and Set default were removed on the owner's ask (2026-08-19).
  // `BuiltinAgent.url` and `Settings.defaultAgent` are kept, so nothing here
  // asserts their absence from the DATA — only from the surface.
  it("offers no website link and no default control", () => {
    install("claude");
    mount();

    expect(host.querySelector(".lp-agent__link")).toBeNull();
    expect(byLabel("Make Claude Code the default agent")).toBeNull();
  });

  it("splits the catalog on what is actually on PATH", () => {
    install("claude");
    mount();

    expect(host.textContent).toContain("Installed");
    expect(host.textContent).toContain("1 detected");
    expect(host.textContent).toContain("Available to install");
    // Both lists carry the same row; only the heading above them differs.
    expect(host.querySelectorAll(".lp-agent")).toHaveLength(5);
  });

  it("shows runtime defaults only for installed agents and supported flags", () => {
    install("claude", "codex");
    mount();

    click(byLabel("Configure Claude Code"));
    click(byLabel("Configure Codex"));
    expect(byLabel("Additional models for Claude Code")).not.toBeNull();
    expect(byLabel("Default model for Claude Code")).not.toBeNull();
    expect(byLabel("Default effort for Claude Code")).not.toBeNull();
    expect(byLabel("Additional models for Codex")).not.toBeNull();
    expect(byLabel("Default effort for Codex")).toBeNull();
    expect(host.querySelector('[data-runtime-agent="opencode"]')).toBeNull();
  });

  it("starts collapsed and opens each agent without changing saved settings", () => {
    install("claude", "codex");
    mount();
    const disclosure = byLabel("Configure Claude Code")!;
    const panel = document.getElementById(disclosure.getAttribute("aria-controls")!)!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);

    click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(byLabel("Configure Codex")?.getAttribute("aria-expanded")).toBe("false");
    expect(
      Array.from(panel.querySelectorAll(".cfg-row__label"), (label) => label.textContent),
    ).toEqual([
      "Command",
      "Permissions",
      "Connect to IDE",
      "Verbose",
      "Default model",
      "Default effort",
      "Additional models",
      "Signals",
    ]);
    click(disclosure);
    expect(panel.hidden).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("changes availability while collapsed and keeps Signals independent", () => {
    install("claude", "codex");
    mount();
    const originalAdapters = settings.value.agentSignalAdapters;
    click(byLabel("Claude Code availability"));
    expect(byLabel("Claude Code availability")?.getAttribute("aria-checked")).toBe("false");
    expect(byLabel("Configure Claude Code")?.getAttribute("aria-expanded")).toBe("false");
    expect(settings.value.agentSignalAdapters).toEqual(originalAdapters);
    click(byLabel("Configure Claude Code"));
    click(byLabel("Claude Code signals"));
    expect(settings.value.agentSignalAdapters).toEqual({
      ...originalAdapters,
      claude: !originalAdapters.claude,
    });
    expect(settings.value.disabledAgents).toEqual(["claude"]);
    click(byLabel("Claude Code availability"));
    expect(settings.value.disabledAgents).toEqual([]);
  });

  it("preserves an invalid model draft and its error after collapse and reopen", () => {
    install("claude");
    mount();
    click(byLabel("Configure Claude Code"));
    const input = byLabel("Additional models for Claude Code") as HTMLInputElement;
    act(() => {
      input.focus();
      input.value = "model with spaces";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    click(byLabel("Configure Claude Code"));
    click(byLabel("Configure Claude Code"));
    const reopenedInput = byLabel("Additional models for Claude Code") as HTMLInputElement;
    expect(reopenedInput.isConnected).toBe(true);
    expect(reopenedInput.closest<HTMLElement>(".lp-agent-details")?.hidden).toBe(false);
    expect(reopenedInput.value).toBe("model with spaces");
    expect(reopenedInput.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('#agent-settings-claude [role="alert"]')?.textContent).toContain(
      "shell-safe",
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("saves additional models and retains runtime defaults across disclosure", () => {
    install("claude", "codex");
    mount();
    click(byLabel("Configure Codex"));
    const input = byLabel("Additional models for Codex") as HTMLInputElement;
    act(() => {
      input.focus();
      input.value = "provider/model-a, provider/model-a, model-b";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
    expect(settings.value.agentModels.codex).toEqual(["provider/model-a", "model-b"]);
    const model = byLabel("Default model for Codex")!;
    click(
      Array.from(model.querySelectorAll('[role="radio"]')).find(
        (radio) => radio.textContent === "model-b",
      )!,
    );
    click(byLabel("Configure Codex"));
    click(byLabel("Configure Codex"));
    expect(
      byLabel("Default model for Codex")?.querySelector('[aria-checked="true"]')?.textContent,
    ).toBe("model-b");
    expect(settings.value.agentRuntimeDefaults.codex).toEqual({ model: "model-b", effort: null });
  });

  it("keeps Add command distinct from declaring an agent identity", () => {
    mount();

    const row = byLabel("Add command")?.closest(".cfg-row");
    expect(row?.querySelector(".cfg-row__label")?.textContent).toBe("Add command");
    expect(row?.querySelector(".cfg-row__desc")?.textContent).toContain("existing agent identity");
  });

  it("says so when nothing is installed", () => {
    mount();

    expect(host.querySelector('[role="status"]')?.textContent).toContain("No agent CLI found");
  });

  it("a user preset replaces the shipped command for that agent", () => {
    install("claude");
    withProfiles([plan], { claude: "lp:plan" });
    mount();

    const header = host.querySelector(".lp-agent .lp-command");
    expect(header?.textContent).toBe("claude --permission-mode plan");
  });

  it("disables an agent without deleting it", () => {
    install("claude");
    mount();

    click(byLabel("Claude Code availability"));

    // A built-in cannot be deleted — the probe would find it again — so the
    // switch is the only thing that takes it out of the pickers.
    expect(updateSettings).toHaveBeenCalledWith({
      disabledAgents: ["claude"],
    });
  });

  const panel = (agentId: string): HTMLElement =>
    document.getElementById(`agent-settings-${agentId}`)!;

  /** A toggle's accessible name is its bare label, so look inside one agent. */
  const inPanel = (agentId: string, label: string): HTMLElement | null =>
    panel(agentId).querySelector(`[aria-label="${label}"]`);

  /** Type into an agent's Command field and leave it, the way a user commits. */
  const editCommand = (label: string, value: string): HTMLInputElement => {
    const input = byLabel(`Command for ${label}`) as HTMLInputElement;
    act(() => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
    return input;
  };

  const choose = (label: string, value: string): void => {
    const select = byLabel(label) as HTMLSelectElement;
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("shows each agent's own flags, read from the command it launches", () => {
    install("claude", "codex");
    mount();
    click(byLabel("Configure Claude Code"));
    click(byLabel("Configure Codex"));

    expect((byLabel("Permissions for Claude Code") as HTMLSelectElement).value).toBe("skip");
    expect(inPanel("codex", "No approvals or sandbox")?.getAttribute("aria-checked")).toBe("true");
    expect(inPanel("codex", "Web search")?.getAttribute("aria-checked")).toBe("false");
    expect(inPanel("claude", "No approvals or sandbox")).toBeNull();
    // The field holds the whole command, so focusing it shows what launches.
    expect((byLabel("Command for Codex") as HTMLInputElement).value).toBe(
      "codex --dangerously-bypass-approvals-and-sandbox",
    );
  });

  it("a menu choice saves the new command as a starred preset", () => {
    install("claude");
    mount();
    click(byLabel("Configure Claude Code"));
    choose("Permissions for Claude Code", "plan");

    expect(settings.value.launchProfiles).toEqual([
      { id: "lp:claude-permission-mode-plan", command: "claude --permission-mode plan" },
    ]);
    expect(settings.value.defaultLaunchProfiles).toEqual({
      claude: "lp:claude-permission-mode-plan",
    });
    expect(host.querySelector(".lp-agent")?.textContent).toContain("claude --permission-mode plan");
  });

  it("a toggle rewrites the starred preset in place and keeps other flags", () => {
    install("claude");
    withProfiles([{ id: "lp:mine", command: "claude --add-dir /tmp --verbose" }], {
      claude: "lp:mine",
    });
    mount();
    click(byLabel("Configure Claude Code"));
    const input = byLabel("Command for Claude Code") as HTMLInputElement;
    expect(input.value).toBe("claude --add-dir /tmp --verbose");
    click(inPanel("claude", "Connect to IDE"));

    expect(settings.value.launchProfiles).toEqual([
      { id: "lp:mine", command: "claude --ide --verbose --add-dir /tmp" },
    ]);
    expect(input.value).toBe("claude --ide --verbose --add-dir /tmp");
  });

  it("saves a hand-edited command as typed and the controls follow it", () => {
    install("claude");
    withProfiles([plan], { claude: "lp:plan" });
    mount();
    click(byLabel("Configure Claude Code"));
    const input = editCommand("Claude Code", "claude --permission-mode plan --chrome --verbose");

    expect(settings.value.launchProfiles).toEqual([
      { id: "lp:plan", command: "claude --permission-mode plan --chrome --verbose" },
    ]);
    expect(inPanel("claude", "Verbose")?.getAttribute("aria-checked")).toBe("true");
    expect(input.value).toBe("claude --permission-mode plan --chrome --verbose");
  });

  it("leaves settings alone when nothing changed", () => {
    install("claude");
    mount();
    click(byLabel("Configure Claude Code"));
    editCommand("Claude Code", " claude --dangerously-skip-permissions ");
    choose("Permissions for Claude Code", "skip");

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("refuses another agent's binary or shell syntax and keeps the draft", () => {
    install("claude");
    mount();
    click(byLabel("Configure Claude Code"));
    editCommand("Claude Code", "codex --yolo");
    expect(panel("claude").querySelector('[role="alert"]')?.textContent).toContain(
      "must start with claude",
    );
    const input = editCommand("Claude Code", "claude --add-dir /tmp; rm -rf /");

    expect(panel("claude").querySelector('[role="alert"]')?.textContent).toContain(
      "letters, digits",
    );
    expect(input.value).toBe("claude --add-dir /tmp; rm -rf /");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("offers Reset only over the user's own command, and falls back", () => {
    install("claude");
    mount();
    click(byLabel("Configure Claude Code"));
    expect(byLabel("Reset command for Claude Code")).toBeNull();
    choose("Permissions for Claude Code", "plan");
    const reset = byLabel("Reset command for Claude Code")!;
    expect(reset.title).toBe("Reset command to claude --dangerously-skip-permissions");
    expect(reset.closest(".cfg-row")?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Command for Claude Code",
    );
    click(byLabel("Reset command for Claude Code"));

    expect(settings.value.launchProfiles).toEqual([]);
    expect(settings.value.defaultLaunchProfiles).toEqual({});
    expect((byLabel("Permissions for Claude Code") as HTMLSelectElement).value).toBe("skip");
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

  it("defers an uninstalled agent's form without losing edits across disclosure", () => {
    mount();
    click(byLabel("Configure Gemini CLI"));
    const form = panel("gemini").querySelector(".lp-launch-flags")?.parentElement;
    expect(form?.hidden).toBe(true);
    const configure = Array.from(panel("gemini").querySelectorAll("button")).find(
      (button) => button.textContent === "Configure launch",
    )!;
    act(() => {
      configure.focus();
    });
    click(
      Array.from(panel("gemini").querySelectorAll("button")).find(
        (button) => button.textContent === "Configure launch",
      )!,
    );
    expect(form?.hidden).toBe(false);
    expect(document.activeElement).toBe(byLabel("Command for Gemini CLI"));
    expect(byLabel("Additional models for Gemini CLI")).toBeNull();
    editCommand("Gemini CLI", "gemini --approval-mode plan");
    click(byLabel("Configure Gemini CLI"));
    click(byLabel("Configure Gemini CLI"));
    expect(form?.hidden).toBe(false);
    expect((byLabel("Command for Gemini CLI") as HTMLInputElement).value).toBe(
      "gemini --approval-mode plan",
    );
  });

  it("uses three visible choices with roving focus and keeps four choices in a menu", () => {
    install("codex");
    mount();
    click(byLabel("Configure Codex"));
    const group = byLabel("Approval policy for Codex")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(group.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const first = group.querySelector('[role="radio"]') as HTMLButtonElement;
    act(() => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("On request");
    expect(document.activeElement?.textContent).toBe("On request");
    expect((byLabel("Command for Codex") as HTMLInputElement).value).toContain(
      "--ask-for-approval on-request",
    );
    expect(byLabel("Sandbox for Codex")?.tagName).toBe("SELECT");
  });

  it("clears additional models while keeping an explicit default visible and keyboard reachable", () => {
    install("codex");
    settings.value = {
      ...DEFAULT_SETTINGS,
      agentModels: { codex: ["model-a"] },
      agentRuntimeDefaults: { codex: { model: "model-a", effort: null } },
    };
    mount();
    click(byLabel("Configure Codex"));
    const input = byLabel("Additional models for Codex") as HTMLInputElement;
    act(() => {
      input.focus();
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
    expect(settings.value.agentModels.codex).toBeUndefined();
    const group = byLabel("Default model for Codex")!;
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("model-a");
    expect(group.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("restores the command on empty input and keeps invalid text through disclosure", () => {
    install("claude");
    withProfiles([plan], { claude: plan.id });
    mount();
    click(byLabel("Configure Claude Code"));
    editCommand("Claude Code", "claude; invalid");
    click(byLabel("Configure Claude Code"));
    click(byLabel("Configure Claude Code"));
    expect((byLabel("Command for Claude Code") as HTMLInputElement).value).toBe("claude; invalid");
    expect(panel("claude").querySelector('[role="alert"]')).not.toBeNull();
    editCommand("Claude Code", "");
    expect(settings.value.launchProfiles).toEqual([]);
    expect((byLabel("Command for Claude Code") as HTMLInputElement).value).toBe(
      "claude --dangerously-skip-permissions",
    );
    expect(panel("claude").querySelector('[role="alert"]')).toBeNull();
  });

  // The string is written verbatim into a live shell, so this is the gate that
  // matters most on this surface.
  it("refuses a command a shell would act on, and says why", () => {
    mount();
    type("claude; rm -rf /");
    click(byLabel("Add"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("letters, digits");
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
