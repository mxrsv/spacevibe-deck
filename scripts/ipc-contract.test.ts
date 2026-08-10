import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The one gate that crosses the IPC boundary.
 *
 * Nothing else in this repo does: Vitest mocks the PTY client, `tsc` has never
 * heard of a Rust signature, and `cargo test` cannot see `src/`. So a command
 * whose Rust parameter names disagree with the object the frontend invokes it
 * with is green everywhere and fails only in the running app — which is
 * exactly how `open_pane_window` shipped expecting a key named `args` while
 * the frontend sent `{ token, screenX, screenY }`, and ⌘⇧M reported
 * "Couldn't move the pane" with no failing test anywhere.
 *
 * Tauri resolves each command parameter by looking up its name in the invoke
 * payload (`tauri-2.11.5/src/ipc/command.rs:97-103`), camelCasing it first
 * (`tauri-macros-2.6.3/src/command/wrapper.rs:70`). So the parameter names ARE
 * the wire keys, and this test is what holds the two spellings together.
 */

/**
 * Parameter types Tauri injects itself — never read from the payload.
 *
 * Compared against the type's BASE name, not by substring: `OpenPaneWindowArgs`
 * contains "Window", and a substring test silently dropped exactly the
 * parameter this test exists to check.
 */
const INJECTED = new Set([
  "AppHandle",
  "State",
  "WebviewWindow",
  "Window",
  "Request",
  "Channel",
]);

/** `State<'_, PtyState>` → `State`; `tauri::AppHandle` → `AppHandle`. */
function baseType(rustType: string): string {
  const withoutGenerics = rustType.split("<")[0].trim();
  const segments = withoutGenerics.split("::");
  return segments[segments.length - 1].trim();
}

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

function camelCase(name: string): string {
  const [head, ...rest] = name.split("_");
  return (
    head + rest.map((word) => word[0].toUpperCase() + word.slice(1)).join("")
  );
}

/** Command name → the payload keys its Rust signature requires. */
function rustCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  for (const file of filesUnder("src-tauri/src", [".rs"])) {
    const source = readFileSync(file, "utf8");
    const pattern =
      /#\[tauri::command\][^\n]*\n(?:pub )?(?:async )?fn (\w+)\s*\(([^)]*)\)/g;
    for (const match of source.matchAll(pattern)) {
      const [, name, params] = match;
      const keys = params
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.includes(":"))
        .map((part) => {
          const [paramName, paramType] = part.split(/:(.+)/);
          return { paramName: paramName.trim(), paramType: paramType.trim() };
        })
        .filter(({ paramType }) => !INJECTED.has(baseType(paramType)))
        .map(({ paramName }) => camelCase(paramName));
      commands.set(name, keys.sort());
    }
  }
  return commands;
}

interface InvokeCall {
  readonly command: string;
  readonly keys: readonly string[];
  readonly file: string;
}

/**
 * Every `invoke("cmd", { … })` in `src/`, with the keys of its payload object.
 * Keys only — never the values, so `{ path: imagePath }` is one key `path`.
 */
function invokeCalls(): InvokeCall[] {
  const calls: InvokeCall[] = [];
  for (const file of filesUnder("src", [".ts", ".tsx"])) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    const pattern =
      /invoke(?:<[^>]*>)?\(\s*"(\w+)"\s*(?:,\s*(\{[\s\S]*?\})\s*)?\)/g;
    for (const match of source.matchAll(pattern)) {
      const [, command, payload = "{}"] = match;
      const keys = new Set<string>();
      for (const key of payload.matchAll(/[{,]\s*(\w+)\s*:/g)) {
        keys.add(key[1]);
      }
      for (const key of payload.matchAll(/[{,]\s*(\w+)\s*(?=[,}])/g)) {
        keys.add(key[1]);
      }
      calls.push({ command, keys: [...keys].sort(), file });
    }
  }
  return calls;
}

describe("Tauri IPC contract", () => {
  it("sends every payload key each Rust command requires", () => {
    const commands = rustCommands();
    const violations: string[] = [];
    for (const call of invokeCalls()) {
      const required = commands.get(call.command);
      if (required === undefined) {
        // A plugin command (store, dialog, updater…) — not ours to check.
        continue;
      }
      const missing = required.filter((key) => !call.keys.includes(key));
      if (missing.length > 0) {
        violations.push(
          `${call.command} (${call.file}): Rust requires [${required.join(", ")}], ` +
            `invoke sends [${call.keys.join(", ")}] — missing [${missing.join(", ")}]`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("finds the commands it claims to check, so a broken parser cannot pass silently", () => {
    // Without this, a regex that matched nothing would make the test above
    // vacuously green — the exact failure mode it exists to prevent.
    const commands = rustCommands();
    expect(commands.size).toBeGreaterThan(20);
    expect(commands.get("prepare_transfer")).toEqual(["paneId"]);
    expect(commands.get("stage_transfer")).toEqual(["payload", "token"]);

    const calls = invokeCalls();
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.some((call) => call.command === "open_pane_window")).toBe(
      true,
    );
  });
});
