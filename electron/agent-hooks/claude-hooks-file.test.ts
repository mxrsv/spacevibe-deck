import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CLAUDE_HOOK_EVENTS,
  claudeHooksDocument,
  hookScriptSource,
  NOTIFICATION_MATCHER,
  shellQuote,
  writeClaudeHooksFiles,
} from "./claude-hooks-file";

const ROOT = mkdtempSync(path.join(tmpdir(), "deck-hooks-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("shellQuote", () => {
  it("single-quotes a path with spaces and escapes an embedded quote", () => {
    expect(shellQuote("/Users/dev/Library/Application Support/SpaceVibe Deck/x.sh")).toBe(
      "'/Users/dev/Library/Application Support/SpaceVibe Deck/x.sh'",
    );
    expect(shellQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'");
  });
});

describe("claudeHooksDocument", () => {
  const doc = claudeHooksDocument(
    "/Users/dev/Library/Application Support/SpaceVibe Deck/agent-hooks/deck-hook.sh",
  );
  const hooks = doc.hooks as Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;

  it("installs exactly the six events, and no sub-agent or teammate ones", () => {
    expect(Object.keys(hooks)).toEqual([...CLAUDE_HOOK_EVENTS]);
    expect(hooks).not.toHaveProperty("SubagentStop");
    expect(hooks).not.toHaveProperty("TeammateIdle");
  });

  it("quotes the script path for a userData directory with spaces, and passes the event name", () => {
    expect(hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command:
        "'/Users/dev/Library/Application Support/SpaceVibe Deck/agent-hooks/deck-hook.sh' Stop",
    });
  });

  it("matches Notification on the two prompts only", () => {
    expect(hooks.Notification[0].matcher).toBe(NOTIFICATION_MATCHER);
    expect(hooks.Stop[0]).not.toHaveProperty("matcher");
  });
});

describe("hookScriptSource", () => {
  const script = hookScriptSource();

  it("exits 0 on every path and posts with the two pane headers", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script.trim().endsWith("exit 0")).toBe(true);
    expect(script).toContain('-H "X-Deck-Pane: $DECK_PANE_ID"');
    expect(script).toContain('-H "X-Deck-Token: $DECK_HOOK_TOKEN"');
    expect(script).toContain('"http://127.0.0.1:$DECK_HOOK_PORT/hook"');
    expect(script).toContain("-m 2");
  });

  it("does nothing without a port, and falls back to an OSC 777 on a failed Notification post only", () => {
    expect(script).toContain('if [ -z "$DECK_HOOK_PORT" ]');
    expect(script).toContain('if [ "$EVENT" = "Notification" ]; then');
    expect(script).toContain('{"terminalSequence":"\\u001b]777;notify;Deck;needs input\\u0007"}');
  });
});

describe("writeClaudeHooksFiles", () => {
  it("writes an executable script and a settings file naming it, under agent-hooks/", async () => {
    const written = await writeClaudeHooksFiles(ROOT);
    expect(written).not.toBeNull();
    expect(written?.scriptPath).toBe(path.join(ROOT, "agent-hooks", "deck-hook.sh"));
    expect(written?.settingsPath).toBe(path.join(ROOT, "agent-hooks", "claude.json"));
    if (process.platform !== "win32") {
      expect(statSync(written!.scriptPath).mode & 0o111).not.toBe(0);
    }
    const doc = JSON.parse(readFileSync(written!.settingsPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(doc.hooks.Stop[0].hooks[0].command).toBe(`'${written!.scriptPath}' Stop`);
    // Idempotent: a second write answers the same paths.
    expect(await writeClaudeHooksFiles(ROOT)).toEqual(written);
  });

  it("answers null rather than throwing when the directory cannot be created", async () => {
    const file = path.join(ROOT, "not-a-dir");
    await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));
    expect(await writeClaudeHooksFiles(file)).toBeNull();
  });
});
