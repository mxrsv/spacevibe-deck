import { describe, expect, it } from "vitest";
import {
  augmentLaunchCommand,
  needsOpencodePort,
  shellQuote,
  type AugmentContext,
} from "./launch-augment";

const ALL_ON = { claude: true, codex: true, opencode: true };
const SETTINGS = "/Users/dev/Library/Application Support/SpaceVibe Deck/agent-hooks/claude.json";
const UUID = "11111111-2222-4333-8444-555555555555";

function context(over: Partial<AugmentContext> = {}): AugmentContext {
  return {
    adapters: ALL_ON,
    platform: "macos",
    claudeSettingsPath: SETTINGS,
    sessionId: UUID,
    opencodePort: 45123,
    ...over,
  };
}

describe("augmentLaunchCommand — claude", () => {
  it("preserves fresh, resume and user-configured commands even with Signals on", () => {
    for (const command of [
      "claude",
      "claude --dangerously-skip-permissions",
      "claude --resume abc",
      "claude -c",
      "claude --settings /me/x.json",
      `claude --session-id ${UUID}`,
      "claude --resume abc --fork-session",
    ]) {
      expect(augmentLaunchCommand(command, context())).toEqual({ command, sessionId: null });
      expect(augmentLaunchCommand(command, context({ platform: "windows" })).command).toBe(command);
    }
  });
});

describe("augmentLaunchCommand — codex and opencode", () => {
  it("sets codex's notification condition unless the user set it", () => {
    expect(augmentLaunchCommand("codex --full-auto", context()).command).toBe(
      "codex --full-auto -c tui.notification_condition=always",
    );
    expect(
      augmentLaunchCommand("codex -c tui.notification_condition=unfocused", context()).command,
    ).toBe("codex -c tui.notification_condition=unfocused");
    expect(
      augmentLaunchCommand("codex --config tui.notification_condition=always", context()).command,
    ).toBe("codex --config tui.notification_condition=always");
    // A different -c key is not the same flag.
    expect(augmentLaunchCommand("codex -c model=gpt-5", context()).command).toBe(
      "codex -c model=gpt-5 -c tui.notification_condition=always",
    );
  });

  it("pins opencode's port to the one main reserved, unless the user chose one", () => {
    expect(augmentLaunchCommand("opencode", context()).command).toBe("opencode --port 45123");
    expect(augmentLaunchCommand("opencode --port 4096", context()).command).toBe(
      "opencode --port 4096",
    );
    expect(augmentLaunchCommand("opencode", context({ opencodePort: null })).command).toBe(
      "opencode",
    );
  });

  it("leaves every other agent untouched", () => {
    for (const command of ["gemini", "agy -p", "cursor-agent --force", "aider --watch"]) {
      expect(augmentLaunchCommand(command, context())).toEqual({ command, sessionId: null });
    }
  });
});

describe("the two questions a launch asks before arming", () => {
  it("needsOpencodePort only for an opencode launch without a port, adapter on", () => {
    expect(needsOpencodePort("opencode", ALL_ON)).toBe(true);
    expect(needsOpencodePort("opencode --port 1", ALL_ON)).toBe(false);
    expect(needsOpencodePort("opencode", { ...ALL_ON, opencode: false })).toBe(false);
    expect(needsOpencodePort("claude", ALL_ON)).toBe(false);
  });
});

describe("shellQuote", () => {
  it("wraps in single quotes and escapes an embedded one", () => {
    expect(shellQuote("/a b/c")).toBe("'/a b/c'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
