import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexHookCommand, reconcileCodexHooks, syncCodexHooks } from "./codex-hooks";

const scratch: string[] = [];
async function temporary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-codex-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

describe("Codex hook registration", () => {
  it("preserves user handlers, settings and another Deck installation across enable/disable", () => {
    const original = {
      description: "My hooks",
      hooks: {
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: "my-notifier" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "cleanup" }] }],
      },
    };
    const sibling = reconcileCodexHooks(original, "/other Deck/hook.sh", true);
    const enabled = reconcileCodexHooks(sibling, "/this Deck/hook.sh", true);
    expect(reconcileCodexHooks(enabled, "/this Deck/hook.sh", true)).toEqual(enabled);
    expect(reconcileCodexHooks(enabled, "/this Deck/hook.sh", false)).toEqual(sibling);
    expect(original.hooks.Stop[0].hooks).toEqual([{ type: "command", command: "my-notifier" }]);
    expect(JSON.stringify(enabled)).toContain("DECK_CODEX_HOOK_SCRIPT");
    expect(codexHookCommand("/a'b/hook.sh")).toContain("'\\''");
  });

  it("keeps symlinks and file permissions, and never edits config.toml/notify", async () => {
    const dir = await temporary();
    const actual = path.join(dir, "real.json");
    const link = path.join(dir, "hooks.json");
    const config = path.join(dir, "config.toml");
    await fs.writeFile(actual, "{}\n", { mode: 0o600 });
    await fs.symlink(actual, link);
    await fs.writeFile(config, 'notify = ["my-notifier"]\n');
    await syncCodexHooks(link, "/deck/hook.sh", true);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect((await fs.stat(actual)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(actual, "utf8")).hooks.Stop).toHaveLength(1);
    expect(await fs.readFile(config, "utf8")).toBe('notify = ["my-notifier"]\n');
    await syncCodexHooks(link, "/deck/hook.sh", false);
    expect(JSON.parse(await fs.readFile(actual, "utf8"))).toEqual({});
  });

  it("refuses malformed config, dangling links and concurrent registration locks without rewriting", async () => {
    const dir = await temporary();
    const file = path.join(dir, "hooks.json");
    await fs.writeFile(file, '{"hooks":{"Stop":false}}');
    await expect(syncCodexHooks(file, "/deck/hook.sh", true)).rejects.toThrow("Invalid Codex");
    expect(await fs.readFile(file, "utf8")).toBe('{"hooks":{"Stop":false}}');
    await fs.writeFile(`${file}.deck-hooks.lock`, "owned");
    await expect(syncCodexHooks(file, "/deck/hook.sh", true)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await fs.readFile(`${file}.deck-hooks.lock`, "utf8")).toBe("owned");
    const dangling = path.join(dir, "dangling.json");
    await fs.symlink(path.join(dir, "missing.json"), dangling);
    await expect(syncCodexHooks(dangling, "/deck/hook.sh", true)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await fs.lstat(dangling)).isSymbolicLink()).toBe(true);
  });
});
