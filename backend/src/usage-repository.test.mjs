import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createUsageRepository, RAW_RETENTION_MS, PURGE_AFTER_MS } from "./usage-repository.mjs";
import worker from "./worker.mjs";

const snapshot = {
  schemaVersion: 1,
  dailyId: "9f2ce125-9b07-41a5-8476-94cff98463c5",
  day: new Date().toISOString().slice(0, 10),
  version: "1.1.0",
  platform: "darwin",
  arch: "arm64",
  agents: { claude: 2, "cursor-agent": 1 },
  surfaces: { browser: 1, explorer: 0, usage: 0 },
  maxTabs: 2,
  maxPanes: 4,
  restoredSessions: false,
};

/** Run the production SQL against SQLite; mirror D1 batch transaction semantics. */
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001-usage.sql", import.meta.url), "utf8"));
  const prepare = (sql) => ({
    bind: (...args) => ({ run: async () => sqlite.prepare(sql).run(...args) }),
  });
  const batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  return { sqlite, binding: { prepare, batch } };
}

test("HTTP ingestion returns 204 only after storage; cumulative retries replace one row", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  for (const launches of [2, 2, 7]) {
    const response = await worker.fetch(
      new Request("https://api.deck.spacevibe.dev/v1/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...snapshot, agents: { claude: launches } }),
      }),
      { DB: binding, INGEST_LIMITER: { limit: async () => ({ success: true }) } },
    );
    assert.equal(response.status, 204);
  }
  const rows = sqlite.prepare("SELECT * FROM usage_days").all();
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].agents), { claude: 7 });
});

test("upsert replaces the entire payload without extending first-receipt retention", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  const repository = createUsageRepository(binding);
  await repository.upsert(snapshot, 1000);
  await repository.upsert({ ...snapshot, agents: { custom: 4 }, version: "1.2.0" }, 2000);
  const row = sqlite.prepare("SELECT * FROM usage_days").get();
  assert.deepEqual(JSON.parse(row.agents), { custom: 4 });
  assert.equal(row.received_at, 1000);
  assert.equal(row.version, "1.2.0");
});

test("35-day cron aggregates then deletes, preserves younger rows, and repeats harmlessly", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  const repository = createUsageRepository(binding);
  await repository.upsert(snapshot, 1000);
  await repository.upsert({ ...snapshot, dailyId: "0f2ce125-9b07-41a5-8476-94cff98463c5" }, 1001);
  await worker.scheduled({ scheduledTime: 1000 + PURGE_AFTER_MS }, { DB: binding });
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM usage_days").get().count, 1);
  const first = sqlite.prepare("SELECT * FROM usage_aggregates").get();
  assert.equal(first.participating_installs, 1);
  assert.equal(JSON.parse(first.agents)["cursor-agent"], 1);
  assert.equal(Object.hasOwn(first, "daily_id"), false);
  await repository.expire(1000 + PURGE_AFTER_MS);
  assert.deepEqual(sqlite.prepare("SELECT * FROM usage_aggregates").get(), first);
  await repository.expire(1001 + PURGE_AFTER_MS);
  const second = sqlite.prepare("SELECT * FROM usage_aggregates").get();
  assert.equal(second.participating_installs, 2);
  assert.equal(JSON.parse(second.agents).claude, 4);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM usage_days").get().count, 0);
});

test("failure deleting raw rows rolls back aggregate writes and remains visible", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  const repository = createUsageRepository(binding);
  await repository.upsert(snapshot, 1000);
  sqlite.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON usage_days BEGIN SELECT RAISE(ABORT, 'retention failure'); END;",
  );
  await assert.rejects(repository.expire(1000 + RAW_RETENTION_MS), /retention failure/);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM usage_days").get().count, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM usage_aggregates").get().count, 0);
});

test("daily cleanup leaves a one-day margin inside the 35-day retention ceiling", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  const repository = createUsageRepository(binding);
  await repository.upsert(snapshot, 1000);
  await repository.expire(1000 + RAW_RETENTION_MS - 24 * 60 * 60 * 1000);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM usage_days").get().count, 0);
});

test("aggregation preserves every metric and separates cohort dimensions", async (t) => {
  const { sqlite, binding } = database();
  t.after(() => sqlite.close());
  const repository = createUsageRepository(binding);
  const base = {
    ...snapshot,
    agents: { claude: 3, custom: 2 },
    surfaces: { browser: 2, explorer: 4, usage: 6 },
    maxTabs: 5,
    maxPanes: 7,
    restoredSessions: true,
  };
  const variants = [
    {},
    { version: "1.2.0" },
    { platform: "win32" },
    { arch: "x64" },
    { day: "2026-09-06" },
  ];
  for (const [index, variant] of variants.entries()) {
    await repository.upsert(
      { ...base, ...variant, dailyId: `${index}f2ce125-9b07-41a5-8476-94cff98463c5` },
      1000,
    );
  }
  await repository.expire(1000 + PURGE_AFTER_MS);
  const rows = sqlite.prepare("SELECT * FROM usage_aggregates").all();
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.deepEqual(
      { ...row, agents: JSON.parse(row.agents), surfaces: JSON.parse(row.surfaces) },
      {
        schema_version: 1,
        day: row.day,
        version: row.version,
        platform: row.platform,
        arch: row.arch,
        participating_installs: 1,
        agents: {
          claude: 3,
          codex: 0,
          opencode: 0,
          agy: 0,
          gemini: 0,
          "cursor-agent": 0,
          custom: 2,
        },
        surfaces: base.surfaces,
        tabs_total: 5,
        panes_total: 7,
        restored_total: 1,
      },
    );
  }
  await repository.expire(1000 + PURGE_AFTER_MS);
  assert.deepEqual(sqlite.prepare("SELECT * FROM usage_aggregates").all(), rows);
  await repository.upsert({ ...base, dailyId: "8f2ce125-9b07-41a5-8476-94cff98463c5" }, 2000);
  await repository.expire(2000 + PURGE_AFTER_MS);
  const combined = sqlite
    .prepare(
      "SELECT * FROM usage_aggregates WHERE day = ? AND version = ? AND platform = ? AND arch = ?",
    )
    .get(base.day, base.version, base.platform, base.arch);
  assert.equal(combined.participating_installs, 2);
  assert.deepEqual(JSON.parse(combined.surfaces), { browser: 4, explorer: 8, usage: 12 });
  assert.equal(JSON.parse(combined.agents).custom, 4);
  assert.deepEqual(
    [combined.tabs_total, combined.panes_total, combined.restored_total],
    [10, 14, 2],
  );
});
