import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The one gate that crosses the IPC boundary — the Electron counterpart of
 * `ipc-contract.test.ts`.
 *
 * Nothing else in this repo checks this: Vitest mocks the host, and `tsc`
 * type-checks the two sides SEPARATELY because an `ipcMain.handle` payload is
 * destructured from an untyped `any`. So a handler that destructures `{ token }`
 * while the renderer sends `{ transferToken }` is green everywhere and fails
 * only in the running app.
 *
 * That is exactly how `open_pane_window` shipped on Tauri: the command declared
 * one `args` parameter while the frontend sent `{ token, screenX, screenY }`,
 * ⌘⇧M reported "Couldn't move the pane", and `npm test`, `npm run build` and
 * `cargo test` were all green. The migration spec makes this test mandatory
 * from the MVP onward for that reason.
 */

const HANDLER = /ipcMain\.handle\(\s*([^,]+),\s*(?:async\s*)?\(([^)]*)\)/g;
const INVOKE = /invoke<[^>]*>\(\s*['"]([^'"]+)['"](?:\s*,\s*\{([^}]*)\})?/g;
const INVOKE_UNTYPED = /(?<!\w)invoke\(\s*['"]([^'"]+)['"](?:\s*,\s*\{([^}]*)\})?/g;

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

/** `CHANNELS.spawnShell` → the string it resolves to. */
function resolveChannelName(expression: string, channels: Record<string, string>): string | null {
  const literal = expression.trim().match(/^['"]([^'"]+)['"]$/);
  if (literal !== null) {
    return literal[1];
  }
  const member = expression.trim().match(/^CHANNELS\.(\w+)$/);
  if (member !== null) {
    return channels[member[1]] ?? null;
  }
  return null;
}

/** The channel constant table, read from its source of truth. */
function readChannels(): Record<string, string> {
  const source = readFileSync("electron/ipc/channels.ts", "utf8");
  const table = source.slice(
    source.indexOf("export const CHANNELS"),
    source.indexOf("export const EVENTS"),
  );
  const channels: Record<string, string> = {};
  for (const match of table.matchAll(/(\w+):\s*['"]([^'"]+)['"]/g)) {
    channels[match[1]] = match[2];
  }
  return channels;
}

/** Keys a handler destructures out of its payload parameter. */
function destructuredKeys(parameters: string): string[] | null {
  const payload = parameters.split(",").slice(1).join(",").trim();
  if (!payload.startsWith("{")) {
    // No destructuring: the handler takes the payload whole (or ignores it),
    // so there are no key names to disagree about.
    return null;
  }
  const inner = payload.slice(1, payload.lastIndexOf("}"));
  return inner
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((name) => name.length > 0 && /^\w+$/.test(name));
}

/** Keys a call site sends. Null when the payload is not an inline object. */
function sentKeys(payload: string | undefined): string[] | null {
  if (payload === undefined) {
    return [];
  }
  return payload
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((name) => name.length > 0 && /^\w+$/.test(name));
}

interface Handler {
  readonly channel: string;
  readonly required: string[];
  readonly file: string;
}

function collectHandlers(channels: Record<string, string>): Handler[] {
  const handlers: Handler[] = [];
  for (const file of filesUnder("electron", [".ts"])) {
    if (file.endsWith(".test.ts")) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(HANDLER)) {
      const channel = resolveChannelName(match[1], channels);
      if (channel === null) {
        continue;
      }
      const keys = destructuredKeys(match[2]);
      if (keys === null) {
        continue;
      }
      handlers.push({ channel, required: keys, file });
    }
  }
  return handlers;
}

interface CallSite {
  readonly channel: string;
  readonly keys: string[] | null;
  readonly file: string;
}

function collectCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of filesUnder("src", [".ts", ".tsx"])) {
    if (file.includes(".test.")) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const pattern of [INVOKE, INVOKE_UNTYPED]) {
      for (const match of source.matchAll(pattern)) {
        sites.push({ channel: match[1], keys: sentKeys(match[2]), file });
      }
    }
  }
  return sites;
}

describe("Electron IPC contract", () => {
  const channels = readChannels();
  const handlers = collectHandlers(channels);
  const callSites = collectCallSites();

  it("finds handlers and call sites to compare", () => {
    // A parser that silently matches nothing would make every assertion below
    // vacuously true — the failure mode this whole file exists to prevent.
    expect(handlers.length).toBeGreaterThan(10);
    expect(callSites.length).toBeGreaterThan(10);
  });

  it("sends every payload key each handler destructures", () => {
    const violations: string[] = [];
    for (const site of callSites) {
      if (site.keys === null) {
        continue;
      }
      for (const handler of handlers.filter((candidate) => candidate.channel === site.channel)) {
        const missing = handler.required.filter((key) => !site.keys!.includes(key));
        if (missing.length > 0) {
          violations.push(
            `${site.channel}: ${site.file} sends {${site.keys.join(", ")}} but ${handler.file} destructures {${handler.required.join(", ")}} — missing ${missing.join(", ")}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("usage_snapshot is a zero-payload channel on both sides", () => {
    // The explicit fixture the usage port's plan requires (§6.1.6): the scan
    // takes no renderer input, so the call site must send nothing and the
    // handler must destructure nothing. A payload appearing on either side
    // is a contract change, not a refactor.
    const sites = callSites.filter((site) => site.channel === "usage_snapshot");
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.keys).toEqual([]);
    }
    expect(handlers.filter((handler) => handler.channel === "usage_snapshot")).toEqual([]);
  });

  it("worktree_add carries the flat { repoPath, branch, destPath } payload on both sides", () => {
    // Task 16's explicit fixture, pinned the same way usage_snapshot pins its
    // zero-payload contract above: proof this generic scanner actually
    // reaches the new channel, not just an assertion that would pass
    // vacuously if collectCallSites/collectHandlers found nothing for it.
    const sites = callSites.filter((site) => site.channel === "worktree_add");
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.keys).toEqual(["repoPath", "branch", "destPath"]);
    }
    const worktreeHandlers = handlers.filter((handler) => handler.channel === "worktree_add");
    expect(worktreeHandlers.length).toBeGreaterThan(0);
    for (const handler of worktreeHandlers) {
      expect(handler.required).toEqual(["repoPath", "branch", "destPath"]);
    }
  });

  it("carries the three path-open channels flat on both sides", () => {
    // The 2026-08-19 path-open work's explicit fixture, pinned the way
    // `worktree_add` above is: proof this scanner actually reaches the new
    // channels rather than passing vacuously because it found none.
    const expected: Record<string, string[]> = {
      workspace_for_path: ["path", "roots"],
      external_apps: [],
      open_in_app: ["appId", "path", "isDirectory", "line", "column"],
    };
    for (const [channel, keys] of Object.entries(expected)) {
      const sites = callSites.filter((site) => site.channel === channel);
      expect(sites.length, channel).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site.keys, channel).toEqual(keys);
      }
      // Every key a handler destructures has to be one the renderer sends;
      // `open_in_app` deliberately ignores `line`/`column`, which is legal —
      // the generic assertion above only forbids the reverse.
      for (const handler of handlers.filter(
        (candidate) => candidate.channel === channel,
      )) {
        for (const key of handler.required) {
          expect(keys, `${channel} handler key ${key}`).toContain(key);
        }
      }
    }
  });

  it("leaves resolve_paths and open_editor untouched, so the Tauri twin stays valid", () => {
    // Design §6: the two channels ⌘+click already used are unchanged, which is
    // what lets `src-tauri/src/links.rs` keep answering them.
    for (const site of callSites.filter(
      (candidate) => candidate.channel === "resolve_paths",
    )) {
      expect(site.keys).toEqual(["cwd", "paths"]);
    }
    for (const site of callSites.filter(
      (candidate) => candidate.channel === "open_editor",
    )) {
      expect(site.keys).toEqual(["request"]);
    }
  });

  it("has a handler for every channel the renderer invokes", () => {
    const handled = new Set(handlers.map((handler) => handler.channel));
    // Handlers that take the payload whole are skipped by `collectHandlers`,
    // so re-scan for their channel names before declaring one unhandled.
    for (const file of filesUnder("electron", [".ts"])) {
      if (file.endsWith(".test.ts")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/ipcMain\.handle\(\s*([^,]+),/g)) {
        const channel = resolveChannelName(match[1], channels);
        if (channel !== null) {
          handled.add(channel);
        }
      }
    }
    const unhandled = [
      ...new Set(callSites.map((site) => site.channel).filter((channel) => !handled.has(channel))),
    ];
    expect(unhandled).toEqual([]);
  });
});
