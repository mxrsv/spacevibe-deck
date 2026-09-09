import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createUsageRepository, RAW_RETENTION_MS } from "./usage-repository.mjs";

test(
  "workerd/D1 accepts cumulative snapshots and expires them atomically",
  { timeout: 20000 },
  async (t) => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL("./worker.mjs", import.meta.url))],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
    });
    const mf = new Miniflare({
      modules: true,
      script: output.outputFiles[0].text,
      compatibilityDate: "2026-07-30",
      d1Databases: ["DB"],
      ratelimits: {
        INGEST_LIMITER: { namespace_id: "34201", simple: { limit: 1000, period: 60 } },
      },
    });
    t.after(() => mf.dispose());
    const db = await mf.getD1Database("DB");
    const migration = await readFile(
      new URL("../migrations/0001-usage.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split(";").filter((sql) => sql.trim())) {
      await db.prepare(statement).run();
    }
    const snapshot = {
      schemaVersion: 1,
      dailyId: "9f2ce125-9b07-41a5-8476-94cff98463c5",
      day: new Date().toISOString().slice(0, 10),
      version: "1.1.0",
      platform: "darwin",
      arch: "arm64",
      surfaces: { browser: 0, explorer: 1, usage: 0 },
      maxTabs: 1,
      maxPanes: 1,
      restoredSessions: false,
    };
    for (const launches of [1, 1, 3]) {
      const response = await mf.dispatchFetch("https://api.deck.spacevibe.dev/v1/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...snapshot, agents: { claude: launches } }),
      });
      assert.equal(response.status, 204);
    }
    const rows = await db.prepare("SELECT agents FROM usage_days").all();
    assert.equal(rows.results.length, 1);
    assert.deepEqual(JSON.parse(rows.results[0].agents), { claude: 3 });
    const repository = createUsageRepository(db);

    // `expire` puts the aggregate insert and the raw delete in one `db.batch`,
    // and the whole retention design rests on that being a transaction: if the
    // delete failed alone, the next sweep would re-aggregate rows already
    // counted and double them permanently — `usage_aggregates` keeps no
    // `daily_id`, so nothing could recompute it. The SQLite twin proves this
    // against its own BEGIN/COMMIT shim, which is the shim's behaviour, not
    // D1's. Force the failure here, on the real thing.
    await db
      .prepare(
        "CREATE TRIGGER refuse_delete BEFORE DELETE ON usage_days BEGIN SELECT raise(ABORT, 'refused'); END",
      )
      .run();
    await assert.rejects(() => repository.expire(Date.now() + RAW_RETENTION_MS));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM usage_aggregates").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM usage_days").first()).n, 1);
    await db.prepare("DROP TRIGGER refuse_delete").run();

    await repository.expire(Date.now() + RAW_RETENTION_MS);
    await repository.expire(Date.now() + RAW_RETENTION_MS);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM usage_days").first()).n, 0);
    assert.equal(
      (await db.prepare("SELECT participating_installs AS n FROM usage_aggregates").first()).n,
      1,
    );
  },
);
