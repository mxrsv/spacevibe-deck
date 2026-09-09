# Deck analytics service

Specification and decisions: [DECK-1](https://linear.app/mxrsv/issue/DECK-1) `decided`.
This directory is deployed independently from the desktop and landing. It shares no database
with sibling SpaceVibe products. Entry point: [Worker](src/worker.mjs) `current`;
[deployment configuration](wrangler.jsonc) `current`; [privacy notice](../marketing/public/privacy/2026-09-07/index.html) `current`.

## Run and deploy

Requires Node 22.13+ and a Cloudflare login with access to the configured account.

```sh
cd backend
npm ci
npm test
npm run build
npm run migrate
npm run deploy
```

`build` is a Wrangler dry run. `migrate` explicitly targets the remote D1 database. The
Worker uses the `api.deck.spacevibe.dev` custom domain, with workers.dev and preview URLs
disabled. Deployment does not publish a desktop release. The landing's `/privacy` rewrite
serves a dated static document; retain prior dates when publishing a new notice.

## Ingestion and retention

[Validation](src/payload.mjs) `current` accepts only schema 1, JSON UTF-8 bodies up to
4096 bytes, UUID v4 daily IDs, valid calendar days, closed dimensions/counter keys, and
integer counters in 0–1,000,000. Unknown fields are rejected. The
[handler](src/worker.mjs) `current` accepts the preceding 30 UTC calendar days through
tomorrow (local-date skew). Closed days receive terminal 400 before any D1 write; this
prevents stale retries from reinserting identifiers already removed by retention.

204 means the D1 upsert completed. 400/413 are terminal, 429/503 retryable. Other routes
return 404 and non-POST ingest returns 405. No read/export route exists. A shared
1000-request/minute, per-Cloudflare-location limiter bounds writes without reading IPs;
it is best effort, not a strict global spending cap. Its namespace is service-specific.

[Storage](src/usage-repository.mjs) `current` replaces the full cumulative snapshot under
`(schema_version, daily_id, day)` and preserves first receipt time. Retries are replacements,
not additions; delivery has no sequence number, so a stale in-window snapshot can replace
a newer one. This is an internal usage sample, not authenticated adoption or billing data.

The 03:00 UTC daily cron starts expiring rows at 34 days after first receipt, leaving one
day of margin inside the 35-day live-data target. D1 `batch` atomically groups coarse totals
by schema/day/version/platform/architecture and deletes the raw rows. An error rejects the
invocation and rolls back both operations. Aggregates contain no daily ID and remain internal;
there is no public small-cell or dashboard surface. See [migration](migrations/0001-usage.sql) `current`.

## Operations and privacy

Worker logging, invocation logging, tracing and Logpush are disabled. Do not use `wrangler
tail`, add payload logging, or export raw rows for routine diagnostics. The service neither
reads nor persists IP/UA/location; Cloudflare still processes network metadata as infrastructure.
D1 Time Travel recovery history is separate from live deletion (up to 30 additional days on
a paid plan, 7 on free). The public notice discloses this distinction.

Inspect cron execution outcomes in Cloudflare and check retention with aggregate-only SQL:

```sh
npx wrangler d1 execute spacevibe-deck-analytics --remote --command "SELECT count(*) AS overdue_rows FROM usage_days WHERE received_at <= (unixepoch() * 1000 - 3024000000)"
```

An overdue count or failed scheduled invocation requires investigation and a successful rerun
of the scheduled handler; never delete raw data independently of aggregation. There is no
external failure alert configured. Verify scheduled execution after deployment and after any
migration. Do not claim the retention SLA from deployment success alone.

Current checkout's Electron client retains its Privacy switch. The upcoming always-on policy
is the separate DECK-1 owner decision implemented at `d1531cb`; the public notice explicitly
distinguishes these builds and the analytics-free public 1.0.0/Tauri releases.

## Chưa khớp thực tế

| Claim                                                   | Intent  | Status                                 | Evidence                                                                                                           |
| ------------------------------------------------------- | ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scheduled live cleanup completes within 35 days         | current | First scheduled production run pending | Local SQLite rollback and workerd/D1 integration tests cover the handler; observe Cloudflare cron after deployment |
| Privacy document renders correctly on all target widths | current | Browser evidence pending               | HTTP and source checks do not establish visual acceptance                                                          |
