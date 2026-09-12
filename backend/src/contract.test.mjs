import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { AGENT_KEYS, SURFACE_KEYS, UPDATE_KEYS, COUNTER_CAP, validPayload } from "./payload.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("Worker schema accepts snapshots emitted by the actual Deck telemetry service", async () => {
  const output = await build({
    stdin: {
      contents: `export * from './electron/telemetry/service.ts';
        export * as model from './electron/telemetry/model.ts';
        export * as payload from './src/telemetry/payload.ts';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const client = await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
  assert.deepEqual(AGENT_KEYS, client.model.AGENT_PAYLOAD_KEYS);
  assert.deepEqual(AGENT_KEYS, client.payload.AGENT_PAYLOAD_KEYS);
  assert.deepEqual(SURFACE_KEYS, client.payload.SURFACE_KEYS);
  assert.deepEqual(UPDATE_KEYS, client.model.UPDATE_KEYS);
  assert.deepEqual(UPDATE_KEYS, client.payload.UPDATE_KEYS);
  assert.equal(COUNTER_CAP, client.model.COUNTER_CAP);
  assert.equal(client.model.TELEMETRY_ENDPOINT, "https://api.deck.spacevibe.dev/v1/ping");
  const snapshots = [];
  const service = await client.createTelemetryService({
    now: () => Date.UTC(2026, 8, 7),
    localDay: () => "2026-09-07",
    randomUUID: () => "9f2ce125-9b07-41a5-8476-94cff98463c5",
    version: "1.1.0",
    platform: "darwin",
    arch: "arm64",
    store: {
      unreadable: () => false,
      read: () => undefined,
      write: () => {},
      flush: async () => {},
    },
    post: async (payload) => {
      snapshots.push(payload);
      return 204;
    },
    report: (message) => assert.fail(message),
    startTimer: () => () => {},
  });
  try {
    service.count("agent", "claude", 1);
    service.count("surface", "browser", 1);
    service.count("update", "checkFailed", 1);
    await service.flushOnQuit();
    assert.ok(snapshots.length > 0);
    for (const snapshot of snapshots) assert.equal(validPayload(snapshot), true);
    assert.equal(snapshots.at(-1).updates.checkFailed, 1);
  } finally {
    service.dispose();
  }
});

test("deployment disables logs, traces, public preview URLs and exposes only the ingest host", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.observability.enabled, false);
  assert.equal(config.observability.logs.enabled, false);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
  assert.equal(config.logpush, false);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "api.deck.spacevibe.dev", custom_domain: true }]);
  assert.equal(config.ratelimits[0].name, "INGEST_LIMITER");
  // The 35-day retention ceiling is only held by the sweep running DAILY; a
  // drifted schedule would keep raw rows past it and nothing else would notice,
  // because logs and traces are off by design.
  assert.deepEqual(config.triggers.crons, ["0 3 * * *"]);
});

test("privacy routes publish the dated notice and include its source in the deployment", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  // `/privacy` serves the newest notice; every earlier dated copy stays reachable.
  for (const [source, notice] of [
    ["/privacy", "2026-09-12"],
    ["/privacy/2026-09-12", "2026-09-12"],
    ["/privacy/2026-09-07", "2026-09-07"],
  ]) {
    assert.ok(
      config.rewrites.some(
        (route) => route.source === source && route.destination === `/privacy/${notice}/index.html`,
      ),
      source,
    );
  }
  const ignore = await readFile(new URL("../../.vercelignore", import.meta.url), "utf8");
  assert.ok(ignore.includes("!/marketing/public"));
  const html = await readFile(
    new URL("../../marketing/public/privacy/2026-09-12/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /anonymous/i);
  for (const term of [
    "dailyId",
    "schemaVersion",
    "surfaces",
    "restoredSessions",
    "updates",
    "35 days",
    "Time Travel",
    "no in-app opt-out",
    "1.0.0",
    "Share usage stats",
  ]) {
    assert.ok(html.replace(/\s+/g, " ").includes(term), term);
  }
});
