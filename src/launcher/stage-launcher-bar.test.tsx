// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { click, mount, press } from "../ui/controls/preset-test-kit";
import { StageLauncherBar, type StageLauncherBarProps } from "./stage-launcher-bar";

const NOW = 1_000_000_000_000;
const agent = (id: string, label: string): AgentOption => ({
  id,
  label,
  detail: id,
  missing: false,
});
const AGENTS = [agent("claude", "Claude Code"), agent("codex", "Codex")];
const COMMANDS: Record<string, LaunchCommandChoices> = {
  claude: { default: "claude", commands: ["claude"] },
  codex: { default: "codex", commands: ["codex"] },
};
const recents: readonly RecentWorkspace[] = [
  { path: "/w/deck", lastOpenedAt: NOW - 1000, lastAgent: "codex" },
  { path: "/w/api", lastOpenedAt: NOW - 5 * 86_400_000 },
];

function props(over: Partial<StageLauncherBarProps> = {}): StageLauncherBarProps {
  return {
    mode: "resident",
    targetPath: "/w/deck",
    target: null,
    recents,
    livePaths: [],
    scans: new Map(),
    tabs: [],
    now: NOW,
    agents: AGENTS,
    commands: COMMANDS,
    pending: false,
    failure: null,
    active: true,
    onRun: vi.fn(),
    onPickProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onNewWorktree: vi.fn(),
    onClone: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    onEditProfiles: vi.fn(),
    ...over,
  };
}

const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.command-bar__chip[aria-pressed="true"]')].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
const destination = (): string =>
  document.querySelector(".command-bar__destination")?.textContent ?? "";

describe("StageLauncherBar", () => {
  it("starts on the agent the target project last ran, and runs it", async () => {
    const onRun = vi.fn();
    const view = await mount(<StageLauncherBar {...props({ onRun })} />);
    expect(pressed()).toEqual(["Codex"]);
    expect(document.querySelector(".command-bar__project-name")?.textContent).toBe("deck");
    await click(document.querySelector(".command-bar__run > button") as HTMLElement);
    expect(onRun).toHaveBeenCalledWith(["codex"], {});
    await view.unmount();
  });

  it("falls back to the first quick agent for a project that ran none", async () => {
    const view = await mount(<StageLauncherBar {...props({ targetPath: "/w/api" })} />);
    expect(pressed()).toEqual(["Claude Code"]);
    await view.unmount();
  });

  it("reads New space in the project over an empty stage and Beside the agent for a split", async () => {
    const view = await mount(<StageLauncherBar {...props()} />);
    expect(destination()).toBe("New space in deck");
    await view.unmount();

    const split = { kind: "split", workspacePath: "/w/deck", tabKey: 2, paneId: 7 } as const;
    const beside = await mount(
      <StageLauncherBar
        {...props({
          mode: "floating",
          target: split,
          tabs: [{ key: 2, panes: [{ paneId: 7, agent: "claude" }] }],
        })}
      />,
    );
    expect(destination()).toBe("Beside Claude Code");
    await beside.unmount();
  });

  it("floats over a live space and sits flat on an empty stage", async () => {
    const flat = await mount(<StageLauncherBar {...props()} />);
    expect(document.querySelector(".stage-launcher--floating")).toBeNull();
    expect(document.querySelector(".command-bar--floating")).toBeNull();
    await flat.unmount();
    const over = await mount(<StageLauncherBar {...props({ mode: "floating" })} />);
    expect(document.querySelector(".stage-launcher--floating")).not.toBeNull();
    expect(document.querySelector(".command-bar--floating")).not.toBeNull();
    await over.unmount();
  });

  it("closes on Escape, and offers the ⇧ hint on the chip row", async () => {
    const onClose = vi.fn();
    const view = await mount(<StageLauncherBar {...props({ onClose })} />);
    expect(document.querySelector(".command-bar__chips .command-bar__hint")?.textContent).toContain(
      "adds",
    );
    await press(document.querySelector(".command-bar__filter") as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("shows Open folder and Clone with no project at all", async () => {
    const view = await mount(<StageLauncherBar {...props({ recents: [], targetPath: null })} />);
    expect(document.body.textContent).toContain("Open folder");
    expect(document.body.textContent).toContain("Clone");
    await view.unmount();
  });
});
