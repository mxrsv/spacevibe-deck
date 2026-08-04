// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section pulls in the Tauri-backed settings store; stub it so the
// component tree mounts under jsdom.
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../../open-board/workspaces-store", () => ({
  forgetWorkspaceAgent: vi.fn(),
}));

import { AgentsSection } from "./agents-section";
import { forgetWorkspaceAgent } from "../../../open-board/workspaces-store";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";
import { BUILTIN_AGENTS } from "../../../lib/agent-catalog";

describe("AgentsSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
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
      render(<AgentsSection />, host);
    });
  };

  const click = (element: Element): void => {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  const type = (input: HTMLInputElement, value: string): void => {
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const draftInputs = (): HTMLInputElement[] =>
    Array.from(
      host.querySelectorAll<HTMLInputElement>(
        '[aria-label="New agent name"], [aria-label="New agent command"]',
      ),
    );

  // The add pill is the LAST enabled one: every declared row also carries an
  // enabled pill for its command.
  const addButton = (): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".cfg-btn"))
      .filter((button) => !button.disabled)
      .pop()!;

  /** Open a declared row's key or value for editing (DL-12.5) and return it. */
  const openField = (trigger: string, ariaLabel: string): HTMLInputElement => {
    const button = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        ".cfg-row--item .cfg-row__label--edit, .cfg-row--item .cfg-btn",
      ),
    ).find((candidate) => candidate.textContent?.trim() === trigger)!;
    click(button);
    return host.querySelector<HTMLInputElement>(`[aria-label="${ariaLabel}"]`)!;
  };

  const declare = (label: string, command: string): void => {
    click(addButton());
    const [name, cmd] = draftInputs();
    type(name, label);
    type(cmd, command);
    click(addButton());
  };

  it("lists every built-in as a locked row (DL-12.4)", () => {
    mount();
    const locked = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".cfg-btn--disabled"),
    );
    expect(locked).toHaveLength(BUILTIN_AGENTS.length);
    expect(locked.every((button) => button.disabled)).toBe(true);
    // A built-in carries no remove affordance — only declared rows do.
    expect(host.querySelectorAll(".cfg-row__remove")).toHaveLength(0);
  });

  it("declares an agent with a generated id", () => {
    mount();
    declare("Aider", "aider --model sonnet");

    expect(settings.value.customAgents).toEqual([
      { id: "custom:aider", label: "Aider", command: "aider --model sonnet" },
    ]);
  });

  it("refuses a command whose binary would reach the shell", () => {
    mount();
    declare("Evil", "x; rm -rf ~");

    expect(settings.value.customAgents).toEqual([]);
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain(
      "letters, digits",
    );
  });

  it("refuses a name already taken by a built-in", () => {
    mount();
    declare("Claude Code", "aider");

    expect(settings.value.customAgents).toEqual([]);
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain(
      "already used",
    );
  });

  it("refuses a second agent with the same name", () => {
    mount();
    declare("Aider", "aider");
    declare("Aider", "aider --fast");

    expect(settings.value.customAgents).toHaveLength(1);
  });

  it("removes a declared agent", () => {
    mount();
    declare("Aider", "aider");
    click(host.querySelector(".cfg-row__remove")!);

    expect(settings.value.customAgents).toEqual([]);
  });

  it("keeps the id when the label is edited, so recents keep resolving", () => {
    updateSettings({
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    });
    mount();

    const nameInput = openField("Aider", "Name for Aider");
    type(nameInput, "Aider fast");
    act(() => {
      nameInput.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });

    expect(settings.value.customAgents).toEqual([
      { id: "custom:aider", label: "Aider fast", command: "aider" },
    ]);
  });

  it("rejects an edited command that is not probe-safe, leaving the stored one", () => {
    updateSettings({
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    });
    mount();

    const commandInput = openField("aider", "Command for Aider");
    type(commandInput, "$(id)");
    act(() => {
      commandInput.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });

    expect(settings.value.customAgents[0].command).toBe("aider");
  });
});

describe("AgentsSection — refusals and cleanup", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
    vi.mocked(forgetWorkspaceAgent).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    updateSettings({
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    });
    act(() => {
      render(<AgentsSection />, host);
    });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    settings.value = DEFAULT_SETTINGS;
  });

  const openAndCommit = (trigger: string, aria: string, value: string): void => {
    const button = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        ".cfg-row--item .cfg-row__label--edit, .cfg-row--item .cfg-btn",
      ),
    ).find((candidate) => candidate.textContent?.trim() === trigger)!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${aria}"]`)!;
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      // A real browser fires both: `blur` is what CommitInput commits on, and
      // `focusout` (the bubbling one) is what closes the editor.
      input.dispatchEvent(new FocusEvent("blur"));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  };

  it("says why an in-place command edit was refused", () => {
    openAndCommit("aider", "Command for Aider", "$(id)");

    expect(settings.value.customAgents[0].command).toBe("aider");
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain(
      "letters, digits",
    );
  });

  it("says why an in-place rename was refused", () => {
    openAndCommit("Aider", "Name for Aider", "Claude Code");

    expect(settings.value.customAgents[0].label).toBe("Aider");
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain(
      "already used",
    );
  });

  it("clears the refusal once a valid value is committed", () => {
    openAndCommit("aider", "Command for Aider", "$(id)");
    openAndCommit("aider", "Command for Aider", "aider --resume");

    expect(settings.value.customAgents[0].command).toBe("aider --resume");
    expect(host.querySelector(".cfg-custom--error")).toBeNull();
  });

  it("makes workspaces forget an agent it just deleted", () => {
    act(() => {
      host
        .querySelector(".cfg-row__remove")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(settings.value.customAgents).toEqual([]);
    expect(forgetWorkspaceAgent).toHaveBeenCalledWith("custom:aider");
  });
});
