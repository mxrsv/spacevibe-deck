import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import type { CardActions } from "../worktree-card-menus";
import { launchAgent } from "./project-rail-commands";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

const wired = (onOpenAgentLauncher: CardActions["onOpenAgentLauncher"]): CardActions => ({
  agents: [],
  agentsResolved: true,
  onRunAgent: () => {},
  onSplitHere: () => {},
  onOpenAgentLauncher,
});

describe("launchAgent", () => {
  it("opens the launcher on a named checkout, switch or no switch", () => {
    for (const development of [true, false]) {
      pinHost(development);
      const open = vi.fn();
      const board = vi.fn();
      launchAgent("/w/api", wired(open), board);
      expect(open).toHaveBeenCalledExactlyOnceWith("/w/api");
      expect(board).not.toHaveBeenCalled();
      resetDesktopEnvironmentForTests();
      vi.unstubAllGlobals();
    }
  });

  it("opens the launcher with no checkout to name when the stage launcher is on", () => {
    pinHost(true);
    const open = vi.fn();
    const board = vi.fn();
    launchAgent(null, wired(open), board);
    expect(open).toHaveBeenCalledExactlyOnceWith(null);
    expect(board).not.toHaveBeenCalled();
  });

  it("raises the board with no checkout to name when the stage launcher is off", () => {
    pinHost(false);
    const open = vi.fn();
    const board = vi.fn();
    launchAgent(null, wired(open), board);
    expect(open).not.toHaveBeenCalled();
    expect(board).toHaveBeenCalledOnce();
  });

  it("raises the board where nothing wires the launcher", () => {
    pinHost(true);
    const board = vi.fn();
    launchAgent("/w/api", wired(undefined), board);
    expect(board).toHaveBeenCalledOnce();
  });
});
