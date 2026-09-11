import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  managedHookCommand,
  reconcileClaudeHooks,
  syncClaudeUserSettings,
  claudeUserSettingsPath,
} from "./claude-user-settings";

const roots: string[] = [];
const SCRIPT = "/Deck/agent-hooks/deck-hook.sh";
const OTHER = "/Deck Dev/agent-hooks/deck-hook.sh";
const USER = { type: "command", command: "user-notification" };
const ORIGINAL = {
  model: "opus",
  permissions: { allow: ["Read"] },
  hooks: {
    Stop: [{ matcher: "*", hooks: [USER] }],
    CustomEvent: [],
  },
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "deck-claude-settings-"));
  roots.push(root);
  return { root, file: path.join(root, "settings.json") };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude user settings ownership", () => {
  it.each([false, true])(
    "preserves a concurrent change, including symlink retarget=%s",
    async (retarget) => {
      const { root, file } = await fixture();
      const originalTarget = path.join(root, "original.json");
      const newTarget = path.join(root, "new.json");
      await fs.writeFile(originalTarget, "{}");
      await fs.writeFile(newTarget, '{"model":"new-choice"}');
      await fs.symlink(originalTarget, file);
      const stat = fs.stat.bind(fs);
      vi.spyOn(fs, "stat").mockImplementationOnce(async (target) => {
        if (retarget) {
          await fs.unlink(file);
          await fs.symlink(newTarget, file);
        } else {
          await fs.writeFile(originalTarget, '{"model":"new-choice"}');
        }
        return stat(target);
      });
      await expect(syncClaudeUserSettings(file, SCRIPT, true)).rejects.toThrow(/changed during/);
      expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ model: "new-choice" });
      await expect(fs.stat(`${originalTarget}.deck-hooks.lock`)).rejects.toThrow(/ENOENT/);
    },
  );
  it("adds once, preserves user hooks and removes only the selected installation", () => {
    const added = reconcileClaudeHooks(ORIGINAL, SCRIPT, true);
    expect(reconcileClaudeHooks(added, SCRIPT, true)).toEqual(added);
    const both = reconcileClaudeHooks(added, OTHER, true);
    expect(reconcileClaudeHooks(both, SCRIPT, false)).toEqual(
      reconcileClaudeHooks(ORIGINAL, OTHER, true),
    );
    expect(reconcileClaudeHooks(added, SCRIPT, false)).toEqual(ORIGINAL);
    expect(ORIGINAL.hooks.Stop[0].hooks).toEqual([USER]);
  });

  it.each([null, [], { hooks: [] }, { hooks: { Stop: {} } }, { hooks: { Stop: [{}] } }])(
    "refuses malformed settings: %j",
    (value) => {
      expect(() => reconcileClaudeHooks(value, SCRIPT, true)).toThrow(/settings|hook/i);
    },
  );

  it("honors Claude's configuration directory override", () => {
    expect(claudeUserSettingsPath({ CLAUDE_CONFIG_DIR: "/custom/claude" })).toBe(
      "/custom/claude/settings.json",
    );
  });

  it("preserves a settings symlink, file permissions and unrelated values", async () => {
    const { root, file } = await fixture();
    const target = path.join(root, "actual.json");
    await fs.writeFile(target, JSON.stringify(ORIGINAL), { mode: 0o600 });
    await fs.symlink(target, file);
    await syncClaudeUserSettings(file, SCRIPT, true);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    if (process.platform !== "win32") expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
    await syncClaudeUserSettings(file, SCRIPT, false);
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual(ORIGINAL);
  });

  it("leaves invalid JSON untouched and releases the lock after failure", async () => {
    const { file } = await fixture();
    await fs.writeFile(file, "{broken");
    await expect(syncClaudeUserSettings(file, SCRIPT, true)).rejects.toThrow(SyntaxError);
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
    await fs.writeFile(file, "{}");
    await expect(syncClaudeUserSettings(file, SCRIPT, true)).resolves.toBeUndefined();
  });

  it("does not replace dangling links or steal another process's lock", async () => {
    const { root, file } = await fixture();
    await fs.symlink(path.join(root, "missing"), file);
    await expect(syncClaudeUserSettings(file, SCRIPT, true)).rejects.toThrow(/ENOENT/);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    await fs.unlink(file);
    await fs.writeFile(`${file}.deck-hooks.lock`, "other process");
    await expect(syncClaudeUserSettings(file, SCRIPT, true)).rejects.toThrow(/EEXIST/);
    expect(await fs.readFile(`${file}.deck-hooks.lock`, "utf8")).toBe("other process");
  });

  it("does not create settings when disabled and leaves an idempotent file byte-for-byte intact", async () => {
    const { file } = await fixture();
    await syncClaudeUserSettings(file, SCRIPT, false);
    await expect(fs.stat(file)).rejects.toThrow(/ENOENT/);
    await syncClaudeUserSettings(file, SCRIPT, true);
    const before = await fs.readFile(file, "utf8");
    await syncClaudeUserSettings(file, SCRIPT, true);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});

describe.skipIf(process.platform === "win32")("guarded hook command", () => {
  it("runs for a manual shell in its Deck installation, and ignores foreign or incomplete environments", async () => {
    const { root } = await fixture();
    const script = path.join(root, "it's a hook.sh");
    await fs.writeFile(script, '#!/bin/sh\nprintf "received:%s" "$1"\n', { mode: 0o700 });
    const command = managedHookCommand(script, "Stop");
    const run = (env: NodeJS.ProcessEnv) =>
      promisify(execFile)("/bin/sh", ["-c", command], { env });
    const deck = {
      DECK_CLAUDE_HOOK_SCRIPT: script,
      DECK_PANE_ID: "1",
      DECK_HOOK_PORT: "2",
      DECK_HOOK_TOKEN: "token",
    };
    expect((await run(deck)).stdout).toBe("received:Stop");
    expect((await run({})).stdout).toBe("");
    expect((await run({ ...deck, DECK_CLAUDE_HOOK_SCRIPT: OTHER })).stdout).toBe("");
    expect((await run({ ...deck, DECK_HOOK_TOKEN: "" })).stdout).toBe("");
    await fs.unlink(script);
    expect((await run(deck)).stdout).toBe("");
  });
});
