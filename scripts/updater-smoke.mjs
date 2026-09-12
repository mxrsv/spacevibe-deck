/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { buildSmokeApps, copySmokeInstallation } from "./updater-smoke-build.mjs";
import { assertUpdateEvidence } from "./updater-smoke-evidence.mjs";
import { startSmokeFeed, verifyLocalManifest } from "./updater-smoke-feed.mjs";
import {
  startOwnedProcess,
  stopInstalledProcesses,
  waitForExit,
} from "./updater-smoke-process.mjs";

const INSTALL_TIMEOUT_MS = 120_000;
const POLL_MS = 200;
const MODES = ["manifest-missing", "asset-missing", "checksum", "install"];

async function readEvents(file) {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function runScenario(config, executable, mode, signal) {
  await writeFile(join(config.root, "control.json"), JSON.stringify({ mode }));
  const native = startOwnedProcess(executable, [], {
    signal,
    stdio: ["ignore", "pipe", "pipe"],
    // Squirrel must survive the old process's normal exit to complete installation.
    stopChildrenOnExit: false,
  });
  const { child } = native;
  let output = "";
  let spawnError;
  child.stdout.on("data", (data) => {
    output = `${output}${data}`.slice(-16_000);
  });
  child.stderr.on("data", (data) => {
    output = `${output}${data}`.slice(-16_000);
  });
  const settled = native.completion.catch((error) => {
    spawnError = error;
  });
  const file = join(config.root, `${mode}.jsonl`);
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;
  let events = [];
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (spawnError) throw spawnError;
      events = await readEvents(file);
      const failure = events.find((event) => event.stage === "failed");
      if (failure) throw new Error(failure.message);
      const terminal = mode === "install" ? "restarted" : "rejected";
      if (events.some((event) => event.stage === terminal)) {
        if (mode === "install") {
          assertUpdateEvidence(events, { ...config, executable });
        } else {
          assert.equal(events.length, 1);
          assert.equal(events[0].runId, config.runId);
          assert.equal(events[0].pid, child.pid);
        }
        for (const pid of new Set([child.pid, ...events.map((event) => event.pid)]))
          await waitForExit(pid);
        await settled;
        if (spawnError) throw spawnError;
        console.log(`PASS ${mode}: ${events.map((event) => event.stage).join(" → ")}`);
        return;
      }
      if (child.exitCode !== null && child.exitCode !== 0)
        throw new Error(`Smoke app exited ${child.exitCode}`);
      await delay(POLL_MS);
    }
    throw new Error(`Timed out waiting for ${mode}`);
  } catch (error) {
    throw new Error(`${mode}: ${error.message}\n${output}`, { cause: error });
  } finally {
    native.stop();
    await stopInstalledProcesses(join(config.root, "installed", `${config.productName}.app`));
    await settled;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      identity: { type: "string" },
      install: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm run electron:smoke:updater -- --install --identity 'Certificate name (TEAMID)'",
    );
    console.log(
      "macOS only. Builds two signed test apps; exercises 404/checksum failures and real install/relaunch.",
    );
    console.log(
      "Uses the production lifecycle and attempt resolver, an isolated identity/profile, and a loopback feed.",
    );
    console.log(
      "Does not verify Deck's renderer, PTY restoration, GitHub provider, notarization, or Windows installation.",
    );
    console.log("Does not publish. All test apps and temporary data are removed on exit.");
    return;
  }
  assert.equal(process.platform, "darwin", "Native install proof currently requires macOS");
  assert.ok(
    values.install && values.identity?.trim() && values.identity !== "-",
    "Real install/relaunch requires --install and --identity (use --help)",
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), "deck-updater-smoke-")));
  const runId = randomUUID();
  const appId = `dev.spacevibe.deck.updater-smoke.${runId}`;
  const productName = `Deck Updater Smoke ${runId.slice(0, 8)}`;
  const appPath = join(root, "installed", `${productName}.app`);
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error("Updater smoke interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let feed;
  const failures = [];
  try {
    feed = await startSmokeFeed(runId);
    const config = {
      root,
      runId,
      appId,
      productName,
      fromVersion: "0.0.1",
      toVersion: "0.0.2",
      sentinel: randomUUID(),
      feedURL: feed.url,
    };
    await writeFile(join(root, "run-id"), runId);
    console.log(`Building isolated updater proof in ${root}`);
    const { oldApp, feedDirectory } = await buildSmokeApps(config, values.identity, abort.signal);
    abort.signal.throwIfAborted();
    await feed.setDirectory(feedDirectory);
    await verifyLocalManifest(feed.url, config.toVersion);
    console.log("PASS manifest: exact ZIP and blockmap URLs exist");
    const installDirectory = join(root, "installed");
    await mkdir(installDirectory);
    await copySmokeInstallation(oldApp, appPath);
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });
    const executable = join(appPath, "Contents", "MacOS", config.productName);
    for (const mode of MODES) {
      feed.setMode(mode);
      await runScenario(config, executable, mode, abort.signal);
    }
    console.log(
      "PASS macOS: real signed install and target-version relaunch; profile sentinel preserved",
    );
    console.log(
      "NOT RUN: full Deck UI/session acceptance, public release transition, Windows installation",
    );
  } catch (error) {
    failures.push(error);
  } finally {
    let processesStopped = false;
    try {
      await stopInstalledProcesses(appPath);
      processesStopped = true;
    } catch (error) {
      failures.push(error);
    }
    for (const cleanup of [
      () => feed?.close(),
      () => processesStopped && rm(root, { recursive: true, force: true }),
      // Squirrel owns a separate cache, isolated by this run's bundle ID.
      () =>
        processesStopped &&
        rm(join(homedir(), "Library", "Caches", `${appId}.ShipIt`), {
          recursive: true,
          force: true,
        }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  if (failures.length)
    throw new AggregateError(failures, `Updater smoke failed (temporary path: ${root})`);
}

main().catch((error) => {
  console.error(error);
  // main has already awaited cleanup. electron-builder's async-exit-hook
  // installs a beforeExit handler with code 0, overriding process.exitCode.
  process.exit(1);
});
