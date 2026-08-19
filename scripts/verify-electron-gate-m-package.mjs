#!/usr/bin/env node
/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface */
/**
 * Gate M verifier (file-explorer plan §5.0.2 / §5.0.4).
 *
 * Two halves, both required:
 *
 *  1. **Structure.** The packaged `Deck Gate M.app` must contain both renderer
 *     graphs, the complete compiled host graph, the vendored react-grab
 *     bundle, a universal (x64 + arm64) executable, node-pty unpacked from the
 *     asar with its helper binaries still executable, and a packaged
 *     `package.json` whose `main` is exactly `dist-electron/electron/main.cjs`.
 *  2. **Runtime.** It launches the packaged executable with `DECK_GATE_M=1`
 *     against a disposable fixture OUTSIDE the repo, requires the harness's
 *     explicit `DECK_GATE_M_READY` signal, then drives the page over CDP:
 *     focuses Monaco and types a marker, focuses xterm and types another,
 *     asserts each surface received its own marker and not the other's,
 *     saves through the harness button and asserts the marker reached the
 *     fixture on disk, and fails on any `file://` worker/asset load failure.
 *
 * The fixture and every temp file are owned (created and removed) here.
 * Six-line human evidence still gets pasted into the plan — this script is
 * what makes lines 1, 4, 5 and 6 assertions instead of impressions.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `main` the packaged app must declare — the builder writes it via extraMetadata. */
export const EXPECTED_MAIN = "dist-electron/electron/main.cjs";

/* ── Minimal asar reader ────────────────────────────────────────────────────
   The format is a Chromium Pickle: UInt32LE 4, UInt32LE header pickle size,
   UInt32LE header payload size, UInt32LE JSON length, then the JSON index
   (padded), then every file's bytes concatenated. Entry offsets are strings,
   relative to the end of the header pickle. Reading it directly keeps the
   verifier free of a dependency that exists only to be verified. */

export function readAsarIndex(asarPath) {
  const fd = openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(fd, json, 0, jsonLength, 16);
    return {
      index: JSON.parse(json.toString("utf8")),
      dataStart: 8 + headerPickleSize,
    };
  } finally {
    closeSync(fd);
  }
}

function asarEntry(index, innerPath) {
  let node = index;
  for (const part of innerPath.split("/")) {
    node = node?.files?.[part];
    if (node === undefined) {
      return null;
    }
  }
  return node;
}

export function readAsarFile(asarPath, innerPath) {
  const { index, dataStart } = readAsarIndex(asarPath);
  const entry = asarEntry(index, innerPath);
  if (entry === null || entry.offset === undefined) {
    throw new Error(`${innerPath} is not a file inside ${asarPath}`);
  }
  const buffer = Buffer.alloc(entry.size);
  const fd = openSync(asarPath, "r");
  try {
    readSync(fd, buffer, 0, entry.size, dataStart + Number(entry.offset));
  } finally {
    closeSync(fd);
  }
  return buffer;
}

export function asarHasDir(asarPath, innerPath) {
  const { index } = readAsarIndex(asarPath);
  const entry = asarEntry(index, innerPath);
  return entry !== null && entry.files !== undefined;
}

/* ── Mach-O universal check ─────────────────────────────────────────────────
   A fat binary starts with 0xcafebabe (or 0xcafebabf for 64-bit offsets),
   big-endian, followed by the slice count. Two slices = x64 + arm64 here. */

export function machOArchCount(executablePath) {
  const fd = openSync(executablePath, "r");
  try {
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, 0);
    const magic = head.readUInt32BE(0);
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) {
      return 1;
    }
    return head.readUInt32BE(4);
  } finally {
    closeSync(fd);
  }
}

/* ── Structure checks, pure over a resolved app layout ───────────────────── */

export function structureFailures(app) {
  const failures = [];
  const need = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  need(existsSync(app.asar), `missing app.asar at ${app.asar}`);
  if (failures.length > 0) {
    return failures;
  }

  let entry = null;
  try {
    entry = JSON.parse(readAsarFile(app.asar, "package.json").toString()).main;
  } catch (error) {
    failures.push(`packaged package.json unreadable: ${String(error)}`);
  }
  need(entry === EXPECTED_MAIN, `packaged main is ${String(entry)}, expected ${EXPECTED_MAIN}`);

  need(
    asarHasDir(app.asar, "dist") &&
      (() => {
        try {
          readAsarFile(app.asar, "dist/index.html");
          return true;
        } catch {
          return false;
        }
      })(),
    "application renderer graph (dist/index.html) missing",
  );
  need(
    (() => {
      try {
        readAsarFile(app.asar, "dist-gate-m-renderer/gate-m.html");
        return true;
      } catch {
        return false;
      }
    })(),
    "gate renderer graph (dist-gate-m-renderer/gate-m.html) missing",
  );
  need(
    (() => {
      try {
        readAsarFile(app.asar, "dist-electron/electron/main.cjs");
        return true;
      } catch {
        return false;
      }
    })(),
    "compiled host graph (dist-electron/electron/main.cjs) missing",
  );
  need(
    asarHasDir(app.asar, "dist-electron/src"),
    "compiled shared graph (dist-electron/src) missing",
  );
  need(
    asarHasDir(app.asar, "dist-electron/electron/vendor/react-grab"),
    "vendored react-grab missing",
  );

  need(
    existsSync(path.join(app.unpacked, "node_modules", "node-pty")),
    "node-pty is not unpacked from the asar",
  );
  const helper = findSpawnHelper(app.unpacked);
  if (helper !== null) {
    const mode = statSync(helper).mode;
    need(
      (mode & 0o111) !== 0,
      `spawn-helper at ${helper} is not executable (mode ${(mode & 0o777).toString(8)})`,
    );
  }

  need(existsSync(app.executable), `missing executable at ${app.executable}`);
  if (existsSync(app.executable)) {
    need(
      machOArchCount(app.executable) >= 2,
      "executable is not a universal (two-architecture) binary",
    );
  }
  return failures;
}

export function findSpawnHelper(unpackedDir) {
  const candidates = [
    path.join(unpackedDir, "node_modules", "node-pty", "build", "Release", "spawn-helper"),
    path.join(
      unpackedDir,
      "node_modules",
      "node-pty",
      "prebuilds",
      `darwin-${process.arch}`,
      "spawn-helper",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function resolveAppLayout(outputDir) {
  const bundle = path.join(outputDir, "mac-universal", "Deck Gate M.app");
  const resources = path.join(bundle, "Contents", "Resources");
  return {
    bundle,
    asar: path.join(resources, "app.asar"),
    unpacked: path.join(resources, "app.asar.unpacked"),
    executable: path.join(bundle, "Contents", "MacOS", "Deck Gate M"),
  };
}

/* ── Runtime drive ──────────────────────────────────────────────────────── */

const EDITOR_MARKER = "gate-m-editor-marker";
const TERMINAL_MARKER = "gate-m-terminal-marker";
const READY_TIMEOUT_MS = 30_000;

async function driveGate(app) {
  const { chromium } = await import("playwright-core");
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "deck-gate-m-"));
  const fixture = path.join(fixtureDir, "gate-m-fixture.ts");
  writeFileSync(fixture, `export function gateM(): string {\n  return "fixture";\n}\n`);
  const port = 9223 + Math.floor(Math.random() * 500);
  const child = spawn(app.executable, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      DECK_GATE_M: "1",
      DECK_GATE_M_FILE: fixture,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const badLoads = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for DECK_GATE_M_READY")),
        READY_TIMEOUT_MS,
      );
      child.stdout.on("data", (data) => {
        process.stdout.write(data);
        if (String(data).includes("DECK_GATE_M_READY")) {
          clearTimeout(timer);
          resolve(undefined);
        }
        if (String(data).includes("DECK_GATE_M_ERROR")) {
          clearTimeout(timer);
          reject(new Error(String(data).trim()));
        }
      });
      child.stderr.on("data", (data) => process.stderr.write(data));
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`gate app exited early with ${String(code)}`));
      });
    });

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("gate-m.html"));
    if (page === undefined) {
      throw new Error("no gate-m page over CDP");
    }
    page.on("requestfailed", (request) => {
      if (request.url().startsWith("file://")) {
        badLoads.push(`${request.url()} — ${request.failure()?.errorText}`);
      }
    });

    // Monaco painted more than one token class ⇒ the tokenizer registered
    // and its worker infrastructure loaded from the packaged asset graph.
    await page.waitForSelector(".monaco-editor .view-line", { timeout: 15000 });
    const tokenClasses = await page.evaluate(() => {
      const classes = new Set();
      for (const span of document.querySelectorAll(".view-line span span")) {
        span.classList.forEach((name) => classes.add(name));
      }
      return classes.size;
    });
    if (tokenClasses < 2) {
      throw new Error("no syntax tokenization in the packaged editor");
    }

    // A per-key delay: zero-delay synthetic typing under a software
    // renderer drops keystrokes into Monaco (observed on the Linux dry run
    // of this harness), and a dropped key here reads as a Gate failure.
    await page.click("#gate-m-focus-editor");
    await page.keyboard.type(EDITOR_MARKER, { delay: 60 });
    await page.click("#gate-m-focus-terminal");
    await page.keyboard.type(TERMINAL_MARKER, { delay: 60 });

    const editorText = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".view-line"), (line) => line.textContent).join("\n"),
    );
    if (!editorText.includes(EDITOR_MARKER)) {
      throw new Error("the editor never received its typed marker");
    }
    if (editorText.includes(TERMINAL_MARKER)) {
      throw new Error("the terminal marker leaked into the editor");
    }
    const terminalGotMarker = await page
      .waitForFunction((marker) => document.body.innerText.includes(marker), TERMINAL_MARKER, {
        timeout: 10000,
      })
      .then(
        () => true,
        () => false,
      );
    if (!terminalGotMarker) {
      throw new Error("the terminal never echoed its typed marker");
    }

    await page.click("#gate-m-save");
    await page.waitForTimeout(1000);
    const saved = readFileSync(fixture, "utf8");
    if (!saved.includes(EDITOR_MARKER)) {
      throw new Error("save did not reach the fixture on disk");
    }

    if (badLoads.length > 0) {
      throw new Error(`file:// loads failed:\n  ${badLoads.join("\n  ")}`);
    }
    await browser.close();
  } finally {
    child.kill();
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "darwin") {
    console.error(
      "Gate M packages and verifies the macOS universal build; run this on the verification Mac.",
    );
    process.exit(2);
  }
  const app = resolveAppLayout(path.join(REPO_ROOT, "dist-gate-m"));
  const failures = structureFailures(app);
  if (failures.length > 0) {
    console.error("Gate M structure FAILED:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log("Gate M structure OK");
  await driveGate(app);
  console.log(
    "Gate M runtime OK — editor/terminal focus markers, save-to-disk and asset loads all held",
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Gate M FAILED: ${String(error)}`);
    process.exit(1);
  });
}
