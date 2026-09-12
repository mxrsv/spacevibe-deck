/* oxlint-disable eslint/no-console -- Isolated native test process. */
// Packaged ONLY by updater-smoke-build.mjs, never by the shipping app config.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { MacUpdater } = require("electron-updater");
const { ElectronHttpExecutor } = require("electron-updater/out/electronHttpExecutor");
const { createUpdateLifecycle } = require("./updater.cjs");
const { resolveAttemptOutcome } = require("./update-attempt.cjs");
const { expectRejectedUpdate } = require("./updater-smoke-rejection.cjs");
const config = require("./smoke-config.json");
const MODES = ["manifest-missing", "asset-missing", "checksum", "install"];
const TIMEOUT_MS = 90_000;

assert.equal(app.getName(), config.productName, "Refusing to run outside the test app");
assert.equal(fs.readFileSync(path.join(config.root, "run-id"), "utf8"), config.runId);
const { mode } = JSON.parse(fs.readFileSync(path.join(config.root, "control.json"), "utf8"));
assert.ok(MODES.includes(mode), "Unknown smoke scenario");
const profile = path.join(config.root, mode, "profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setPath("sessionData", path.join(profile, "session"));
const evidencePath = path.join(config.root, `${mode}.jsonl`);

function record(stage, detail = {}) {
  const event = {
    ...detail,
    runId: config.runId,
    stage,
    version: app.getVersion(),
    pid: process.pid,
  };
  fs.appendFileSync(evidencePath, `${JSON.stringify(event)}\n`);
  console.log(JSON.stringify(event));
}

function fail(error) {
  record("failed", { message: String(error?.stack ?? error) });
  app.exit(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
setTimeout(() => fail(new Error("Native updater timed out")), TIMEOUT_MS).unref();

function loadUpdater() {
  // Real Electron HTTP and Squirrel.Mac; only paths/feed are isolated.
  const updater = new MacUpdater(null, {
    version: app.getVersion(),
    name: config.productName,
    isPackaged: app.isPackaged,
    appUpdateConfigPath: path.join(process.resourcesPath, "app-update.yml"),
    userDataPath: profile,
    baseCachePath: path.join(config.root, mode, "cache"),
    whenReady: () => app.whenReady(),
    quit: () => app.quit(),
    relaunch: () => app.relaunch(),
    onQuit: (handler) => app.once("quit", (_event, code) => handler(code)),
  });
  updater.httpExecutor = new ElectronHttpExecutor();
  // Providers capture the executor when configured; configure after injection.
  updater.setFeedURL({ provider: "generic", url: config.feedURL });
  updater.logger = console;
  return updater;
}

async function rejectBrokenFeed(lifecycle) {
  record("rejected", await expectRejectedUpdate(lifecycle, mode, config.toVersion));
  app.exit(0);
}

async function run() {
  await app.whenReady();
  assert.ok(app.isPackaged, "Install proof requires a packaged app");
  const attemptPath = path.join(profile, "update-attempt.json");
  const sentinelPath = path.join(profile, "sentinel.json");
  if (app.getVersion() === config.toVersion) {
    assert.equal(mode, "install");
    const attempt = JSON.parse(fs.readFileSync(attemptPath, "utf8"));
    const outcome = resolveAttemptOutcome(attempt, app.getVersion());
    const { sentinel } = JSON.parse(fs.readFileSync(sentinelPath, "utf8"));
    record("restarted", { executable: process.execPath, outcome: outcome.kind, sentinel });
    app.exit(0);
    return;
  }
  assert.equal(app.getVersion(), config.fromVersion, "Unexpected starting version");
  const lifecycle = createUpdateLifecycle({
    supported: app.isPackaged,
    currentVersion: app.getVersion(),
    loadUpdater,
    prepareForInstall: async () => {
      record("install-started", { targetVersion: config.toVersion });
    },
    countOutcome: () => {},
    report: (message, error) => {
      console.error(message, error);
      if (mode === "install") fail(error);
    },
  });
  if (mode !== "install") return rejectBrokenFeed(lifecycle);
  record("started", { executable: process.execPath });
  fs.writeFileSync(sentinelPath, JSON.stringify({ sentinel: config.sentinel }));
  const result = await lifecycle.check();
  assert.equal(result.status, "available");
  assert.equal(result.version, config.toVersion);
  record("checked", { targetVersion: result.version });
  await lifecycle.download();
  record("downloaded", { targetVersion: result.version });
  fs.writeFileSync(
    attemptPath,
    JSON.stringify({
      targetVersion: result.version,
      fromVersion: app.getVersion(),
      startedAt: Date.now(),
    }),
  );
  await lifecycle.install();
  throw new Error("Install resolved without terminating the old process");
}

void run().catch(fail);
