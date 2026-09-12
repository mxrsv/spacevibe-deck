import { AGENT_KEYS, SURFACE_KEYS, UPDATE_KEYS } from "./payload.mjs";

export const RAW_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Start expiry at day 34 so the daily sweep stays inside the 35-day ceiling.
export const PURGE_AFTER_MS = RAW_RETENTION_MS - CRON_INTERVAL_MS;
const DIMENSIONS = "schema_version, day, version, platform, arch";

// SQL identifiers and JSON paths come exclusively from these closed constants.
function jsonTotals(column, keys, conflict = false) {
  return `json_object(${keys
    .map((key) => {
      const path = `'$.' || '${key}'`;
      const expression = conflict
        ? `coalesce(json_extract(usage_aggregates.${column}, ${path}), 0) + coalesce(json_extract(excluded.${column}, ${path}), 0)`
        : `sum(coalesce(json_extract(${column}, ${path}), 0))`;
      return `'${key}', ${expression}`;
    })
    .join(", ")})`;
}

const UPSERT = `INSERT INTO usage_days
  (schema_version, daily_id, day, version, platform, arch, agents, surfaces, max_tabs, max_panes, restored_sessions, updates, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (schema_version, daily_id, day) DO UPDATE SET
    version = excluded.version, platform = excluded.platform, arch = excluded.arch,
    agents = excluded.agents, surfaces = excluded.surfaces,
    max_tabs = excluded.max_tabs, max_panes = excluded.max_panes,
    restored_sessions = excluded.restored_sessions, updates = excluded.updates`;

const AGGREGATE = `INSERT INTO usage_aggregates
  (${DIMENSIONS}, participating_installs, agents, surfaces, tabs_total, panes_total, restored_total, updates)
  SELECT ${DIMENSIONS}, count(*), ${jsonTotals("agents", AGENT_KEYS)},
    ${jsonTotals("surfaces", SURFACE_KEYS)}, sum(max_tabs), sum(max_panes), sum(restored_sessions),
    ${jsonTotals("updates", UPDATE_KEYS)}
  FROM usage_days WHERE received_at <= ? GROUP BY ${DIMENSIONS}
  ON CONFLICT (${DIMENSIONS}) DO UPDATE SET
    participating_installs = usage_aggregates.participating_installs + excluded.participating_installs,
    agents = ${jsonTotals("agents", AGENT_KEYS, true)},
    surfaces = ${jsonTotals("surfaces", SURFACE_KEYS, true)},
    updates = ${jsonTotals("updates", UPDATE_KEYS, true)},
    tabs_total = usage_aggregates.tabs_total + excluded.tabs_total,
    panes_total = usage_aggregates.panes_total + excluded.panes_total,
    restored_total = usage_aggregates.restored_total + excluded.restored_total`;

export function createUsageRepository(db) {
  return {
    async upsert(payload, receivedAt) {
      // Preserve FIRST receipt: a retry must never extend the raw retention clock.
      await db
        .prepare(UPSERT)
        .bind(
          payload.schemaVersion,
          payload.dailyId,
          payload.day,
          payload.version,
          payload.platform,
          payload.arch,
          JSON.stringify(payload.agents),
          JSON.stringify(payload.surfaces),
          payload.maxTabs,
          payload.maxPanes,
          Number(payload.restoredSessions),
          // Absent from clients up to 1.2.0; the column's own default.
          JSON.stringify(payload.updates ?? {}),
          receivedAt,
        )
        .run();
    },
    async expire(now) {
      const cutoff = now - PURGE_AFTER_MS;
      // D1 batch is a transaction. Repeating a successful cron sees no expired rows.
      await db.batch([
        db.prepare(AGGREGATE).bind(cutoff),
        db.prepare("DELETE FROM usage_days WHERE received_at <= ?").bind(cutoff),
      ]);
    },
  };
}
