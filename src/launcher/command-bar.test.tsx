// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import { click, mount, press, settle, waitUntil } from "../ui/controls/preset-test-kit";
import { CommandBar, type CommandBarProps } from "./command-bar";
import type { CommandBarProject } from "./command-bar-model";

const agent = (id: string, label: string, missing = false): AgentOption => ({
  id,
  label,
  detail: id,
  missing,
});
const AGENTS = [
  agent("claude", "Claude Code"),
  agent("codex", "Codex"),
  agent("amp", "Amp"),
  agent("gemini", "Gemini", true),
];
const COMMANDS: Record<string, LaunchCommandChoices> = {
  claude: { default: "claude", commands: ["claude", "claude --dangerously-skip-permissions"] },
  codex: { default: "codex", commands: ["codex"] },
  amp: { default: "amp", commands: ["amp"] },
};
const PROJECTS: readonly CommandBarProject[] = [
  { path: "/w/deck", name: "deck", branch: "main", age: null },
  { path: "/w/bench-api", name: "bench-api", branch: "dev", age: "2d" },
  { path: "/w/academy", name: "academy", branch: "main", age: "3w" },
];

function props(over: Partial<CommandBarProps> = {}) {
  return {
    projects: PROJECTS,
    currentPath: "/w/deck",
    agents: AGENTS,
    commands: COMMANDS,
    defaultPick: ["codex"],
    onRun: vi.fn(),
    onPickProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onNewWorktree: vi.fn(),
    onClone: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  } satisfies CommandBarProps;
}

const chip = (label: string): HTMLButtonElement =>
  document.querySelector(`.command-bar__chip[aria-label="${label}"]`) as HTMLButtonElement;
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.command-bar__chip[aria-pressed="true"]')].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
const runButton = (): HTMLButtonElement =>
  document.querySelector(".command-bar__run > button") as HTMLButtonElement;
const filter = (): HTMLInputElement =>
  document.querySelector('input[aria-label="Filter agents or projects"]') as HTMLInputElement;
const projectChip = (): HTMLElement =>
  document.querySelector(".command-bar__project") as HTMLElement;

async function type(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** A double-click: the two clicks a browser sends, then the dblclick, with a render between. */
async function doubleClick(target: HTMLElement, shiftKey = false): Promise<void> {
  for (const type of ["click", "click", "dblclick"]) {
    await act(async () => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, shiftKey }));
    });
    await settle();
  }
}

/** A click with the shift key held, which `click()` cannot send. */
async function shiftClick(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
  });
  await settle();
}

describe("CommandBar picking", () => {
  it("starts with the default pick and says Run", async () => {
    const view = await mount(<CommandBar {...props()} />);
    expect(pressed()).toEqual(["Codex"]);
    expect(runButton().textContent).toContain("Run");
    expect(runButton().textContent).not.toContain("Run 1");
    await view.unmount();
  });

  it("falls back to the first agent that can run when no default is given", async () => {
    const view = await mount(<CommandBar {...props({ defaultPick: [] })} />);
    expect(pressed()).toEqual(["Claude Code"]);
    await view.unmount();
  });

  it("shows a name only on a picked chip", async () => {
    const view = await mount(<CommandBar {...props()} />);
    const name = (label: string) => chip(label).querySelector(".command-bar__chip-name");
    expect(name("Codex")?.getAttribute("aria-hidden")).toBeNull();
    expect(name("Amp")?.getAttribute("aria-hidden")).toBe("true");
    await view.unmount();
  });

  it("a click picks only that agent; shift adds and removes", async () => {
    const view = await mount(<CommandBar {...props()} />);
    await click(chip("Amp"));
    expect(pressed()).toEqual(["Amp"]);
    await shiftClick(chip("Claude Code"));
    // Chips list in Settings order; the pick itself keeps the order it was made in.
    expect(pressed()).toEqual(["Claude Code", "Amp"]);
    expect(runButton().textContent).toContain("Run 2");
    await shiftClick(chip("Amp"));
    expect(pressed()).toEqual(["Claude Code"]);
    await view.unmount();
  });

  it("restarts from the default when the target project changes", async () => {
    const view = await mount(<CommandBar {...props()} />);
    await click(chip("Amp"));
    await view.update(
      <CommandBar {...props({ currentPath: "/w/academy", defaultPick: ["claude"] })} />,
    );
    expect(pressed()).toEqual(["Claude Code"]);
    await view.unmount();
  });

  it("tips the exact command a chip types, profile pick included", async () => {
    const view = await mount(<CommandBar {...props()} />);
    const tip = (): string | undefined =>
      document.body.querySelector('[data-slot="tooltip-content"]')?.textContent ?? undefined;
    // Keyboard modality first, so focus counts as focus-visible as it does after a Tab.
    await press(document.body, { key: "Tab" });
    chip("Claude Code").focus();
    await waitUntil(() => tip() !== undefined);
    expect(tip()).toBe("claudeDouble-click to run");
    await view.unmount();
  });

  it("lists only agents that are installed", async () => {
    const view = await mount(<CommandBar {...props({ defaultPick: ["gemini"] })} />);
    expect(document.body.textContent).not.toContain("Gemini");
    expect(pressed()).toEqual(["Claude Code"]);
    await view.unmount();
  });
});

describe("CommandBar run", () => {
  it("runs the picked agents in order, with no override on a default profile", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await shiftClick(chip("Claude Code"));
    await click(runButton());
    expect(p.onRun).toHaveBeenCalledWith(["codex", "claude"], {});
    await view.unmount();
  });

  it("a double-click runs that agent alone, even with a group picked", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await shiftClick(chip("Amp"));
    expect(pressed()).toEqual(["Codex", "Amp"]);
    await doubleClick(chip("Claude Code"));
    expect(p.onRun).toHaveBeenCalledTimes(1);
    expect(p.onRun).toHaveBeenCalledWith(["claude"], {});
    await view.unmount();
  });

  it("a shift double-click toggles twice and runs nothing", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await doubleClick(chip("Amp"), true);
    expect(p.onRun).not.toHaveBeenCalled();
    expect(pressed()).toEqual(["Codex"]);
    await view.unmount();
  });

  it("Enter outside a button runs the pick", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await press(filter(), { key: "Enter" });
    expect(p.onRun).toHaveBeenCalledWith(["codex"], {});
    await view.unmount();
  });

  it("Enter on a chip is that chip's own press, not a run", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await press(chip("Amp"), { key: "Enter" });
    expect(p.onRun).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("does not run while a launch is pending", async () => {
    const p = props({ pending: true });
    const view = await mount(<CommandBar {...p} />);
    expect(runButton().disabled).toBe(true);
    await press(filter(), { key: "Enter" });
    expect(p.onRun).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("carries the profile the user chose from the caret, only for that agent", async () => {
    const p = props({ defaultPick: ["claude", "codex"] });
    const view = await mount(<CommandBar {...p} />);
    const caret = document.querySelector('[aria-label="Launch profile"]') as HTMLElement;
    await click(caret);
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (el) => el.textContent === "claude --dangerously-skip-permissions",
    ) as HTMLElement;
    await click(item);
    await click(runButton());
    expect(p.onRun).toHaveBeenCalledWith(["claude", "codex"], {
      claude: { kind: "profile", command: "claude --dangerously-skip-permissions" },
    });
    await view.unmount();
  });
});

describe("CommandBar filter", () => {
  it("narrows the chips", async () => {
    const view = await mount(<CommandBar {...props()} />);
    await type(filter(), "amp");
    expect(document.querySelectorAll(".command-bar__chip").length).toBe(1);
    expect(chip("Amp")).not.toBeNull();
    await view.unmount();
  });

  it("lists matching projects under the bar, not the current one", async () => {
    const view = await mount(<CommandBar {...props()} />);
    await type(filter(), "de");
    const hits = [...document.querySelectorAll(".command-bar__hit")].map((el) => el.textContent);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain("academy");
    await view.unmount();
  });

  it("Enter runs the first matching agent before any project", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await type(filter(), "amp");
    await press(filter(), { key: "Enter" });
    expect(p.onRun).toHaveBeenCalledWith(["amp"], {});
    expect(p.onPickProject).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("Enter picks the first matching project when no agent matches", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await type(filter(), "bench");
    await press(filter(), { key: "Enter" });
    expect(p.onPickProject).toHaveBeenCalledWith("/w/bench-api");
    expect(p.onRun).not.toHaveBeenCalled();
    expect(filter().value).toBe("");
    await view.unmount();
  });

  it("Escape clears the filter first, then closes the launcher", async () => {
    const onClose = vi.fn();
    const view = await mount(<CommandBar {...props({ onClose })} />);
    await type(filter(), "amp");
    await press(filter(), { key: "Escape" });
    expect(filter().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    await press(filter(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe("CommandBar project menu", () => {
  const search = (): HTMLInputElement | null =>
    document.querySelector('input[aria-label="Find a project"]');

  it("opens from the chip with its search focused, and Escape returns to the chip", async () => {
    const view = await mount(<CommandBar {...props()} />);
    await click(projectChip());
    expect(document.activeElement).toBe(search());
    await press(search() as HTMLElement, { key: "Escape" });
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(projectChip());
    await view.unmount();
  });

  it("picks a project from the menu, closes, and hands focus to the filter", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await click(projectChip());
    await press(search() as HTMLElement, { key: "ArrowDown" });
    await press(search() as HTMLElement, { key: "Enter" });
    expect(p.onPickProject).toHaveBeenCalledWith("/w/bench-api");
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(filter());
    // The menu's Enter was its own: the bar did not also run.
    expect(p.onRun).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("runs Open folder and New worktree from the menu", async () => {
    const p = props();
    const view = await mount(<CommandBar {...p} />);
    await click(projectChip());
    const actions = [...document.querySelectorAll<HTMLElement>(".command-bar-menu__action")];
    await click(actions[0]);
    expect(p.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(search()).toBeNull();
    await click(projectChip());
    await click(document.querySelectorAll<HTMLElement>(".command-bar-menu__action")[1]);
    expect(p.onNewWorktree).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe("CommandBar states", () => {
  it("first run offers Open folder and Clone, and disables the chips", async () => {
    const p = props({ projects: [], currentPath: null, firstRun: true });
    const view = await mount(<CommandBar {...p} />);
    const buttons = [...document.querySelectorAll<HTMLElement>(".command-bar__bar button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Open folder⌘O", "Clone"]);
    expect(document.querySelector(".command-bar__first-hint")?.textContent).toBe(
      "or drop a folder anywhere",
    );
    expect(document.querySelector(".command-bar__bar input")).toBeNull();
    expect(document.querySelector(".command-bar__chips")?.hasAttribute("data-off")).toBe(true);
    for (const el of document.querySelectorAll<HTMLButtonElement>(".command-bar__chip")) {
      expect(el.disabled).toBe(true);
    }
    // Enter does not run anything, and the primary button holds focus so Enter opens a folder.
    expect(document.activeElement).toBe(buttons[0]);
    await click(buttons[0]);
    await click(buttons[1]);
    expect(p.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(p.onClone).toHaveBeenCalledTimes(1);
    expect(p.onRun).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("shows a failure with Retry", async () => {
    const p = props({ failure: "The shell never became ready" });
    const view = await mount(<CommandBar {...p} />);
    const alert = document.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("The shell never became ready");
    await click(alert.querySelector("button") as HTMLElement);
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("names where the run lands, beside an agent or in a new space", async () => {
    const view = await mount(<CommandBar {...props()} />);
    const line = () => document.querySelector(".command-bar__destination")?.textContent;
    expect(line()).toBe("New space in deck");
    await view.update(<CommandBar {...props({ beside: "Claude Code" })} />);
    expect(line()).toBe("Beside Claude Code");
    await view.unmount();
  });

  it("floats over a live space when asked", async () => {
    const view = await mount(<CommandBar {...props({ floating: true })} />);
    expect(document.querySelector(".command-bar--floating")).not.toBeNull();
    await view.unmount();
  });
});
