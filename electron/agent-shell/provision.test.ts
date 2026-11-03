import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WRAPPED_AGENTS, agentWrapperSource } from "./agent-wrappers";
import { DECK_CLI_FILE, deckCliSource } from "./deck-cli";
import { OPENCODE_PLUGIN_FILE, opencodePluginSource } from "./opencode-plugin";
import { provisionAgentShell, userOpencodeInstructions, wrapperOptions } from "./provision";
import { opencodeConfigDir } from "./shell-bootstrap";

const ROOT = mkdtempSync(path.join(tmpdir(), "deck-provision-"));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("provisionAgentShell", () => {
  it("writes the wrappers, the zsh dotfiles and the bash rcfile under agent-shell/", async () => {
    const userData = path.join(ROOT, "ok");
    const paths = await provisionAgentShell(userData);
    expect(paths).not.toBeNull();
    expect(paths?.binDir).toBe(path.join(userData, "agent-shell", "bin"));
    for (const agent of WRAPPED_AGENTS) {
      const file = path.join(paths!.binDir, agent);
      expect(readFileSync(file, "utf8")).toBe(agentWrapperSource(agent, wrapperOptions(userData)));
      // POSIX only: Windows has no permission bits and reports 0o666 whatever was asked.
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o755);
    }
    expect(readdirSync(paths!.zshDir).sort()).toEqual([
      ".zlogin",
      ".zprofile",
      ".zshenv",
      ".zshrc",
    ]);
    expect(readFileSync(paths!.bashRcfile, "utf8")).toContain(paths!.binDir);
  });

  it("writes Deck's opencode plugin where the opencode wrapper points OPENCODE_CONFIG_DIR", async () => {
    const userData = path.join(ROOT, "plugin");
    await provisionAgentShell(userData);
    const file = path.join(opencodeConfigDir(userData), "plugin", OPENCODE_PLUGIN_FILE);
    expect(readFileSync(file, "utf8")).toBe(opencodePluginSource());
    expect(readFileSync(path.join(userData, "agent-shell", "bin", "opencode"), "utf8")).toContain(
      opencodeConfigDir(userData),
    );
  });

  it("is idempotent and leaves no temp files behind", async () => {
    const userData = path.join(ROOT, "twice");
    await provisionAgentShell(userData);
    const again = await provisionAgentShell(userData);
    expect(again).not.toBeNull();
    const names = [again!.binDir, again!.zshDir, path.dirname(again!.bashRcfile)].flatMap((dir) =>
      readdirSync(dir),
    );
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("answers null and logs when the directory cannot be created", async () => {
    const blocker = path.join(ROOT, "blocker");
    writeFileSync(blocker, "a file, not a directory");
    const log = vi.fn();
    expect(await provisionAgentShell(blocker, log)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

// POSIX only: Deck makes no link on Windows, where panes get no wrappers.
describe.skipIf(process.platform === "win32")("the opencode global AGENTS.md link", () => {
  const linkIn = (userData: string) => path.join(opencodeConfigDir(userData), "AGENTS.md");

  it("points Deck's opencode config dir at the user's XDG_CONFIG_HOME AGENTS.md", async () => {
    const userData = path.join(ROOT, "link-xdg");
    const configHome = path.join(ROOT, "xdg-config");
    await provisionAgentShell(userData, vi.fn(), { XDG_CONFIG_HOME: configHome });
    expect(readlinkSync(linkIn(userData))).toBe(path.join(configHome, "opencode", "AGENTS.md"));
  });

  it("falls back to ~/.config like opencode when XDG_CONFIG_HOME is unset or empty", () => {
    const expected = path.join(homedir(), ".config", "opencode", "AGENTS.md");
    expect(userOpencodeInstructions({})).toBe(expected);
    expect(userOpencodeInstructions({ XDG_CONFIG_HOME: "" })).toBe(expected);
  });

  it("makes the link even while the user has no AGENTS.md, and replaces an old one", async () => {
    const userData = path.join(ROOT, "link-replace");
    await provisionAgentShell(userData, vi.fn(), { XDG_CONFIG_HOME: path.join(ROOT, "first") });
    await provisionAgentShell(userData, vi.fn(), { XDG_CONFIG_HOME: path.join(ROOT, "second") });
    expect(readlinkSync(linkIn(userData))).toBe(path.join(ROOT, "second", "opencode", "AGENTS.md"));
    expect(readdirSync(opencodeConfigDir(userData)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the wrappers when the link cannot be made", async () => {
    const userData = path.join(ROOT, "link-blocked");
    mkdirSync(path.join(linkIn(userData), "occupied"), { recursive: true });
    const log = vi.fn();
    const paths = await provisionAgentShell(userData, log);
    expect(paths).not.toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(lstatSync(linkIn(userData)).isDirectory()).toBe(true);
  });
});

describe("provisionAgentShell — the deck command", () => {
  const deckIn = (binDir: string) => path.join(binDir, DECK_CLI_FILE);

  it("writes an executable deck beside the wrappers when agent control is on", async () => {
    const userData = path.join(ROOT, "control-on");
    const paths = await provisionAgentShell(userData, vi.fn(), process.env, {
      agentControl: true,
    });
    expect(readFileSync(deckIn(paths!.binDir), "utf8")).toBe(deckCliSource());
    if (process.platform !== "win32") {
      expect(statSync(deckIn(paths!.binDir)).mode & 0o777).toBe(0o755);
    }
    expect(readdirSync(paths!.binDir).sort()).toEqual([...WRAPPED_AGENTS, DECK_CLI_FILE].sort());
  });

  it("writes nothing when agent control is off, which is the default", async () => {
    const userData = path.join(ROOT, "control-off");
    const paths = await provisionAgentShell(userData);
    expect(readdirSync(paths!.binDir).sort()).toEqual([...WRAPPED_AGENTS].sort());
    const explicit = await provisionAgentShell(userData, vi.fn(), process.env, {
      agentControl: false,
    });
    expect(readdirSync(explicit!.binDir)).not.toContain(DECK_CLI_FILE);
  });

  it("removes a deck an earlier run left behind once the switch is off", async () => {
    const userData = path.join(ROOT, "control-stale");
    const on = await provisionAgentShell(userData, vi.fn(), process.env, { agentControl: true });
    expect(readdirSync(on!.binDir)).toContain(DECK_CLI_FILE);
    const off = await provisionAgentShell(userData);
    expect(readdirSync(off!.binDir)).not.toContain(DECK_CLI_FILE);
  });

  it("keeps the wrappers and reports it when a stale deck cannot be removed", async () => {
    const userData = path.join(ROOT, "control-stuck");
    const binDir = path.join(userData, "agent-shell", "bin");
    // A directory named deck is something `rm` without `recursive` refuses to delete.
    mkdirSync(path.join(deckIn(binDir), "occupied"), { recursive: true });
    const log = vi.fn();
    const paths = await provisionAgentShell(userData, log);
    expect(paths).not.toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(readdirSync(binDir)).toContain("claude");
  });
});
