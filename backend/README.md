# Deck analytics service

Specification and decisions: [DECK-1](https://linear.app/mxrsv/issue/DECK-1) `decided`.
This directory is deployed independently from the desktop and landing. It shares no database
with sibling SpaceVibe products. Entry point: [Worker](src/worker.mjs) `current`;
[deployment configuration](wrangler.jsonc) `current`; [privacy notice](../marketing/public/privacy/2026-10-08/index.html) `current`.

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
integer counters in 0–1,000,000. Unknown fields are rejected. `updates` is the one optional
field: clients up to 1.2.0 omit it, and when present it must carry all six update keys.
Deploy and migrate before any client release that changes the payload — a 400 is terminal on
the client and drops that install's whole day. The
[handler](src/worker.mjs) `current` accepts the preceding 30 UTC calendar days through
tomorrow (local-date skew). Closed days receive terminal 400 before any D1 write; this
prevents stale retries from reinserting identifiers already removed by retention.

204 means the D1 upsert completed. 400/413 are terminal, 429/503 retryable. Other routes
return 404 and non-POST ingest returns 405. No route reads or exports usage data; the one
read route, the feedback board below, reads only feedback tables through the
[feedback repository](src/feedback-repository.mjs). A shared
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
no public surface shows usage data. See [migration](migrations/0001-usage.sql) `current`
and [the update-counter column](migrations/0002-update-counters.sql).

## Feedback

The [feedback routes](src/feedback-routes.mjs) accept anonymous reports when
`FEEDBACK_STORAGE=supabase` and `FEEDBACK_SUBMISSIONS_OPEN=true`. No Google login,
Linear issue or notification email is required in this mode. Google sign-in can be
introduced later without replacing Supabase Postgres or Storage. The older D1/Linear
implementation remains dormant with `FEEDBACK_SYNC_ENABLED=false`.

[Supabase persistence](src/feedback-supabase.mjs) stores each report in
`public.feedback_reports`. It reserves the draft before uploading screenshots and
sets `ready=true` only after all uploads succeed. New reports start in public Pending
under the [public-intake migration](supabase/migrations/20261008000200_public_feedback.sql). A 201 means the complete submission
is stored; retrying the same draft and content returns the same receipt. Changed
content returns 409. Incomplete uploads never appear publicly.

[Image validation](src/feedback-images.mjs) accepts at most three PNG, JPEG or WebP
files of 5 MB each and caps the streamed request at 16 MB. The
[feedback form](../marketing/landing-prototype/src/feedback-images.js) accepts images
from the file picker or a paste within the form (Command-V / Ctrl-V); ordinary text
paste remains unchanged. The private
`feedback-images` Storage bucket uses server-generated paths, not uploaded filenames.
The Worker serves images only while their parent report is ready and public, with
`Cache-Control: no-store`; hiding the report revokes subsequent image requests.
[The schema](supabase/migrations/20261008000100_feedback.sql) enables RLS and denies
`anon` and `authenticated` access to the report table; no public Storage policies
are installed. Only the Worker's service key and Studio administrators can access
private records and files. Never expose the service key to the landing.

### Setup and deployment

[CLI configuration](supabase/config.toml) belongs to this backend. Use CLI 2.120.0
for passwordless CLI login-role support; the older installed 2.30.4 requires a DB
password. Local link metadata and secrets are [ignored](supabase/.gitignore).

```sh
npx --yes supabase@2.120.0 link --workdir backend --project-ref calkpkscykzmvyayfxih
npx --yes supabase@2.120.0 db push --workdir backend --linked --dry-run
npx --yes supabase@2.120.0 db push --workdir backend --linked
```

Configure `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret and `SUPABASE_URL` in
[Wrangler configuration](wrangler.jsonc). Deploy with intake closed, verify storage
and access boundaries, then open `FEEDBACK_SUBMISSIONS_OPEN` and deploy the landing.
The [landing switches](../marketing/landing-prototype/src/feedback-api.js) enable
reads and submission only when the Worker also reports intake open. Roll back by
closing intake; retain Postgres rows and Storage objects for retries and review.
Analytics continues using the existing D1 database and its separate migrations.

### Review reports in Supabase

Open the project's Table Editor and select `feedback_reports`. Review only rows
with `ready=true`; screenshots are under `feedback-images/<report id>/` in Storage.
New complete reports appear immediately in `pending`; no approval is required. Change
`status` to `review` for work in progress, `done` when completed, or `hidden` to withdraw
a report later. The form refreshes the board after sending; other status changes appear
on reload. Original draft IDs and request hashes are never public.

The [intake trigger](supabase/migrations/20261008000100_feedback.sql) limits new drafts
to 100 per rolling 24 hours across all locations. The Worker adds the existing
20-request/minute/location budget before parsing uploads and a separate
120-request/minute/location budget for public board and image reads. These protect storage
without recording IP addresses; they are not a CAPTCHA and may reject legitimate
submissions during spam. A 429 keeps the browser draft for retry. A partial upload
counts toward the daily budget and remains private for owner cleanup.

Hiding is not erasure. To erase a report, remove its Storage objects and then its
row through Studio; partial uploads use the same report-ID folder. There is no
automatic feedback expiry. The [privacy notice](../marketing/public/privacy/2026-10-08/index.html)
describes text drafts, screenshots and the separate feedback storage lifecycle.

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
