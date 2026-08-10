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
        // `Option<T>` is genuinely optional on the wire: Tauri's
        // `deserialize_option` returns `visit_none()` for a missing key
        // (`tauri/src/ipc/command.rs`), so a call site may leave it out.
        .filter(({ paramType }) => baseType(paramType) !== "Option")
        .map(({ paramName }) => camelCase(paramName));
      commands.set(name, keys.sort());
    }
  }
  return commands;
}

/**
 * Keys of the OUTERMOST object only. Depth matters: Tauri looks up each
 * parameter at the top level, so counting `token` inside `{ args: { token } }`
 * as sent is exactly the mistake that would let the bug this file exists for
 * slip through a second time.
 */
export function topLevelKeys(payload: string): string[] {
  const keys = new Set<string>();
  let depth = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const char = payload[i];
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 1) {
      continue;
    }
    const rest = payload.slice(i);
    // `key:` or shorthand `key,` / `key}` — never the VALUE side, so
    // `{ path: imagePath }` is one key `path`.
    const named = /^(\w+)\s*:/.exec(rest);
    if (named && /[{,]\s*$/.test(payload.slice(0, i) || "{")) {
      keys.add(named[1]);
      continue;
    }
    const shorthand = /^(\w+)\s*(?=[,}])/.exec(rest);
    if (shorthand && /[{,]\s*$/.test(payload.slice(0, i) || "{")) {
      keys.add(shorthand[1]);
    }
  }
  return [...keys].sort();
}

/** Commands listed in `generate_handler!` — the ones actually reachable. */
function registeredCommands(): Set<string> {
  const source = readFileSync("src-tauri/src/lib.rs", "utf8");
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  if (block === null) {
    throw new Error("generate_handler! block not found in lib.rs");
  }
  return new Set(
    block[1]
      .split(",")
      .map((entry) => entry.trim().split("::").pop() ?? "")
      .filter((name) => name.length > 0),
  );
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
      calls.push({ command, keys: topLevelKeys(payload), file });
    }
  }
  return calls;
}

describe("Tauri IPC contract", () => {
  it("sends every payload key each Rust command requires", () => {
    const commands = rustCommands();
    const registered = registeredCommands();
    const violations: string[] = [];
    for (const call of invokeCalls()) {
      const required = commands.get(call.command);
      if (required === undefined) {
        // Deliberately NOT skipped as "probably a plugin". Every `invoke` in
        // `src/` targets a command in this repo, so an unknown name is a typo
        // or a command that was renamed on one side only — silence there is
        // how the whole class of bug hides.
        violations.push(
          `${call.command} (${call.file}): no #[tauri::command] with this name`,
        );
        continue;
      }
      if (!registered.has(call.command)) {
        // Declaring a command is not registering it: an entry missing from
        // `generate_handler!` fails at runtime with "command not found".
        violations.push(
          `${call.command} (${call.file}): not listed in generate_handler!`,
        );
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
    // Its two Option<f64> coordinates are optional, so only `token` is
    // required — the menu path sends no drop point at all.
    expect(commands.get("open_pane_window")).toEqual(["token"]);

    const calls = invokeCalls();
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.some((call) => call.command === "open_pane_window")).toBe(
      true,
    );
  });

  it("counts only top-level payload keys", () => {
    // The regression guard for this file's own blind spot. Tauri looks each
    // parameter up at the TOP level, so a nested object must never make an
    // outer key look present — `{ args: { token } }` sends `args`, not
    // `token`, which is precisely the shape of the bug this file exists for.
    expect(topLevelKeys("{ token, payload }")).toEqual(["payload", "token"]);
    expect(topLevelKeys("{ path: imagePath }")).toEqual(["path"]);
    expect(topLevelKeys("{ args: { token, screenX } }")).toEqual(["args"]);
    expect(
      topLevelKeys("{ token, ...(screen ? { screenX: a, screenY: b } : {}) }"),
    ).toEqual(["token"]);
  });
});
