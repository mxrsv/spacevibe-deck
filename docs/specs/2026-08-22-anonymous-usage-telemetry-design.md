# Privacy-Preserving Usage Analytics — Design

Date: 2026-08-22 · Status: **decided** — approved 2026-08-22 by the owner's
"implement this spec"; the client half is built the same day (see the
[plan](../plans/2026-08-22-anonymous-usage-telemetry.md)).

> **Amended (owner-decided in conversation 2026-08-23, committed 2026-08-24 as
> `cdc07a0`): the consent model is REVERSED.** Analytics ships ON by default with no consent question; Settings →
> Privacy is the switch, and `declined` is the only state never inferred away.
> Principle 1 below ("Explicit opt-in"), §6's consent surface and §7's version
> gate describe the superseded model and are kept as the approved record —
> `USAGE_CONSENT_ASKED` in `src/telemetry/usage-notice.ts` is the whole
> reversal switch. Consequence the rollout order in §12 must absorb: every
> install of the next release POSTs, so the Worker and the privacy page stop
> being "can land after the client ships dark" and become prerequisites.

Target host: **Electron only**. The Tauri host sends nothing and shows nothing.
Source context: [tauri migration notice](2026-08-17-tauri-migration-notice-design.md)
`decided` (the banner precedent) · [electron stable release](2026-08-20-electron-stable-release-design.md)
`decided` (the channel the client reaches users through).

## Goal

Deck currently answers "how many times was a release asset downloaded" and
nothing about use after install. The owner needs two product signals: **how many
participating installs run Deck on a given day**, and **which parts of Deck those
participating installs use**.

The client sends a small cumulative daily snapshot only after an explicit opt-in.
The server stores one row per participating install-day; payload and D1 rows
carry no deterministic identifier linking one day to the next.

**Non-goals:** identifying a person; a crash reporter; an event stream with
per-action timestamps; anything that reads file paths, repository names, branch
names, prompts or terminal output; a Tauri implementation; accounts, licensing
or billing; measuring retention across days; estimating the full install base;
or producing a public social-proof number. SQL against D1 is the internal read
path; the landing continues to use auditable GitHub figures.

**Fact:** Deck publicly ships a "no Deck telemetry" trust claim today in
[`README.md`](../../README.md#local-usage-accounting) `current` and the `1.0.0`
[`CHANGELOG.md`](../../CHANGELOG.md) `current`.

**Interpretation:** lightweight first-party analytics can improve product
decisions, but only if the copy names the network behaviour precisely and the
measurement limitations remain visible beside every result.

## 1. Decisions proposed for approval (2026-08-22)

This revision replaces the earlier opt-out design. These choices remain draft
until the owner approves this document.

1. **Explicit opt-in.** Nothing is counted, persisted for analytics or sent
   before the user chooses **Share usage stats**. **Not now** keeps the feature
   off; Settings can enable it later.
2. **Heartbeat plus aggregate counters** — not a bare heartbeat, and not a full
   event stream.
3. **Cloudflare Worker + D1, self-hosted.** No third-party analytics vendor;
   Cloudflare remains the infrastructure processor and sees ordinary network
   metadata at its edge.
4. **A random `dailyId`, not a permanent install identifier.** UUID v4,
   generated locally once per local day and reused for that day's retries and
   cumulative upserts. It is never derived from hardware, MAC address, hostname,
   username or the previous day's id.
5. **No public telemetry counter.** Product analytics stays internal. Landing
   social proof uses GitHub figures whose provenance a visitor can verify.
6. **Public copy states current behaviour precisely.** It says “optional usage
   analytics”, not “anonymous”, and links to a dated privacy notice with an
   archive of superseded versions.
7. **Windows remains evidence-gated.** A Windows analytics record proves only
   that the reported version ran on Windows. It does not prove how that version
   was installed and cannot close the native auto-update Gate C.

## 2. What the measurements can and cannot say

`electron-updater` fetches its channel file from
`releases/download/{tag}/{file}` (`GitHubProvider.js:183-185`, the counted
asset endpoint), so `latest.yml` and `latest-mac.yml` download counts already
rise on every update check. Measured 2026-08-22 on `v1.0.0`: `latest.yml` 17,
`latest-mac.yml` 5, against 7 and 2 for the installers themselves.

That is a real release-distribution signal, but it cannot answer the usage
question. It counts **checks**, not machines: one machine open three days is
indistinguishable from three machines open one day. It carries no retention, no
session length, and nothing about what happens inside the app.

It is **not a denominator** for analytics coverage. Comparing a count of update
checks with a count of participating daily ids does not yield a share of machines
or installs because the two units differ.

The analytics read path reports only:

- participating DAU: distinct `dailyId` values for a day;
- feature adoption inside that sample: participating rows whose counter is above
  zero divided by participating DAU;
- action intensity inside that sample: sums and distributions of counters;
- version/platform/architecture mix inside that sample.

It must label every result **participating installs**. It cannot report total
DAU, opt-in coverage, cross-day retention, a person's behaviour, the size of the
install base or whether an update was automatic.

## 3. Architecture and seams

Three layers, cut along seams the repo already has.

**Renderer** — `src/telemetry/usage-counters.ts` holds window-scoped signals
(R5) and a `count*` API. It knows nothing about the network. It reaches the
host through `src/host/telemetry-host.ts`, whose `available` flag reads
`window.__deckHost` directly, exactly as
[`external-apps-host.ts`](../../src/host/external-apps-host.ts) `current` does
and for the same reason: `invoke` throws when the bridge is missing, and a
thrown call is not the same answer as "this host does not do that".

**Main** — `electron/telemetry/` owns installation-local consent, daily ids and
buffers, merges counters from **every window**, decides when to send, and sends.

**Worker + D1** — a different repo, a different session (§13). This document
freezes the HTTP contract it must implement (§8).

Three new flat channels (R6), registered in
[`electron/ipc/channels.ts`](../../electron/ipc/channels.ts) `current`:
`telemetry_count` (renderer → main, fire and forget) and
`telemetry_state` / `telemetry_set_enabled` (read and change the main-owned
consent state). No identifier crosses into the renderer.

Three decisions in that split are rules, not preferences:

- **The whole analytics state lives in `telemetry.json`, never in
  `settings.json`.** Settings get copied to another machine and pasted into
  issues. Neither consent, notice dismissal, daily ids nor buffers may travel
  with them. The Privacy category is a view over main-owned state rather than a
  new pair in the general settings schema.
- **Main decides when to send.** Three windows are one machine and must be one
  stored install-day row. This is the problem `begin_update_check`'s
  process-wide single flight already solved; the same shape applies.
- **Electron only.** Tauri has no handler, so `available` is false, the renderer
  never counts, nothing is sent and the notice never renders. That respects the
  feature freeze, and those builds cannot receive the code anyway — their update
  check has 404'd since `1.0.0` took `releases/latest`.

## 4. The payload

The schema lives in ONE readable file, `src/telemetry/payload.ts`, and that
file is a design constraint rather than an implementation detail: the landing
tour may `cat` it on screen as a disclosure aid (§9), so it must read as a
contract to a person who is not a programmer. It is not proof of server-side
retention or Cloudflare behaviour; the dated privacy notice covers those.

```jsonc
{
  "schemaVersion": 1,
  "dailyId": "9f2c…",          // fresh random UUID for this local day
  "day": "2026-08-22",         // the client's LOCAL day, not a timestamp
  "version": "1.0.1",
  "platform": "darwin",        // darwin | win32
  "arch": "arm64",             // arm64 | x64
  "agents":   { "claude": 12, "codex": 3 },        // launches that day
  "surfaces": { "browser": 1, "explorer": 4, "usage": 0 },  // opens that day
  "maxTabs": 4,                // high-water mark that day
  "maxPanes": 6,
  "restoredSessions": true
}
```

**Deliberately absent, and this list is the point of the file:** a permanent
identifier, file paths,
repository names, branch names, file names, terminal output, prompts, agent
replies, hostname, username, locale, timezone and any per-action timestamp. The
Worker code never reads or stores IP addresses; Cloudflare still processes
ordinary connection metadata at its edge, which the privacy notice states.

**`agents` keys are a closed enum, never a user-authored string.** Deck's custom
agents carry names the user typed, and a custom agent called
`acme-internal-tool` would put a user-generated string into a payload whose
whole premise is that it contains none. The map is keyed by the six built-in
agent ids plus a single aggregate `"custom"` bucket, and the snapshot test in
§11 pins that key set.

`day` instead of a timestamp is a deliberate loss of resolution. It is enough to
compute participating DAU but cannot compute retention because `dailyId` changes
without a link. Timezone is omitted because it narrows location.

**Local day** is the client's own calendar day. Main keeps up to seven day
buffers keyed by local date. Returning to a date after a timezone change reuses
that buffer's `dailyId` and cumulative counters, so the upsert in §8 replaces
the same row instead of adding a second one.

Metric meanings are fixed with their sources:

- an agent launch increments when materialization issues an agent command,
  including a resumed agent; it is a **launch**, not a conversation or session;
- a surface open increments when browser, explorer or usage changes from not
  visible to visible; repeated hide/show transitions count again;
- `maxTabs` and `maxPanes` are high-water marks read from `tabViews`;
- `restoredSessions` is true when boot restore materialized at least one pane.

Changing one of these meanings requires a schema version, a spec/privacy-notice
update and a read-path boundary so unlike definitions are never summed silently.

## 5. Lifecycle: consent, cumulative upsert, retry

Boot → main reads `telemetry.json` → if consent is not enabled, it creates no id,
accepts no count and starts no network timer → if enabled, it resumes or creates
the current day's buffer → the renderer counts fire-and-forget → main folds each
count into the cumulative buffer and autosaves on a debounce so it survives a
restart and an unclean exit.

**Send conditions:** one initial snapshot as soon as the first window is ready
in an enabled run; a dirty-buffer snapshot no more than once every 15 minutes;
a six-hour heartbeat even when counters did not change; and a best-effort final
snapshot during orderly quit. No UI path awaits a POST. Main owns its timer at
the same interval value as
[`BACKGROUND_CHECK_INTERVAL_MS`](../../src/updater/update-controller.ts)
`current`, rather than being triggered through the renderer — §3 makes main the
sender, and that timer is renderer-side.

Every POST carries the **whole cumulative snapshot**, never a delta. The server
replaces the row at `(schemaVersion, dailyId, day)`, so retries and later
snapshots cannot double-count. A machine that opens Deck only once still reaches
participating DAU after the initial snapshot. Later actions can be undercounted
if the app or machine dies before the next dirty send; that is accepted and must
be stated in analysis.

**Failure handling.** The governing rule is that a dead Worker must be
indistinguishable from a healthy one from inside the app — no UI state reads the
result of a POST, and no UI path awaits one.

- Network failure, timeout, 408, 429 or 5xx: keep the buffer, retry at the next
  scheduled check.
  No backoff, no fast retry.
- **400 or 413:** mark that buffer terminal and stop retrying it. These are the
  only client-invalid responses in the frozen contract. Other 4xx responses may
  come from routing or edge policy and retain the buffer under the seven-day cap.
- Cap of **seven days** of pending buffers; the oldest is dropped first. A
  machine offline for three months must not deliver ninety records at once.
- 5 second timeout.
- An unreadable `telemetry.json` fails closed: analytics stays off and the app
  exposes a non-blocking error in Privacy settings. It does not infer consent or
  generate an id. Resetting that file requires an explicit user action.

## 6. Consent surface

> **Amended 2026-08-22 (owner, same day as approval):** the consent surface is
> a full-screen **decision modal** (DL-29.9 —
> [`UsageConsentModal`](../../src/ui/usage-consent-modal.tsx) `current`), not
> the notice row below. The row shipped for a few hours; the owner asked for a
> modal overlay so a fresh install meets the question over the Open board
> rather than as a strip under the tabs. Everything else in this section —
> the copy's pinned phrases, the two persisting buttons, the show condition,
> the release switch, the frozen URL — carries over unchanged. DL §30 is back
> to one instance (the Tauri migration notice). The original row design is
> kept below as the approved record.

A single row, in the same place and of the same shape as
[`MigrationBanner`](../../src/ui/migration-banner.tsx) `current`: beneath the
tab strip, costing `--notice-h` of stage height rather than floating over the
panes (DL §30).

> Help improve Deck by sharing optional usage stats. No code, paths or prompts.
> — [Share usage stats] [Not now] [What Deck sends →]

The row asks for a decision; it does not merely announce a default. Neither a
scrim click nor Escape counts as consent. **Share usage stats** persists enabled
consent with `consentVersion`; **Not now** persists declined state. Both dismiss
the row across every window. Settings remains the way to reverse either choice.

The two banners can never stack: `MigrationBanner` renders only under Tauri,
this one only under Electron. They are mutually exclusive by host.

Shown when `USAGE_ANALYTICS_AVAILABLE && electronHost && consent ===
"unanswered"`, decided by a pure `shouldShowUsageNotice` in
`src/telemetry/usage-notice.ts`, which also holds the release switch:

```ts
export const USAGE_ANALYTICS_AVAILABLE: boolean = true;
```

Typed `boolean` rather than left as a literal, following
[`MIGRATION_NOTICE_ENABLED`](../../src/updater/migration-notice.ts) `current`,
so neither branch becomes statically unreachable and a dead-code pass cannot
delete the half the constant exists to preserve.

**The doc URL freezes into every shipped binary.** The stable URL is
`https://deck.spacevibe.dev/privacy`; that page shows the current notice and an
archive keyed by effective date and `consentVersion`. A material payload,
purpose, retention or processor change increments `consentVersion`, returns the
installation to `unanswered`, and requires a fresh opt-in before analytics
resumes. Editing the page alone cannot broaden consent already stored by a
shipped binary.

## 7. Settings

A new `privacy` category in
[`settings-categories.ts`](../../src/ui/settings/settings-categories.ts)
`current`: one switch backed by `telemetry_state`, the exact field list and
metric definitions, the 35-day raw retention, Cloudflare's processor role, and
a link to the dated privacy notice. It displays no identifier because no daily
id needs to cross into the renderer.

The category has four states: loading, enabled, declined/off and unreadable.
The switch is disabled while loading or unreadable. A failed enable/disable
write stays visible as a user-facing error; the UI never claims a change that
main did not persist.

**Off means off.** `telemetry_set_enabled(false)` first blocks new counts and
timers, then deletes every unsent buffer and local daily id, then persists the
declined state. Previously accepted D1 rows remain only until their raw-retention
deadline; the copy says this explicitly. Turning it back on records the current
`consentVersion` and creates a fresh daily id.

## 8. HTTP contract

The Worker session builds from this section alone.

```
POST https://api.deck.spacevibe.dev/v1/ping
Content-Type: application/json
```

- **204** — accepted.
- **400** — schema violation, including any unknown field. The client deletes
  the payload on this code, so 400 must mean "never send this again".
- **413** — body exceeds 4 KB; terminal for that buffer like 400.
- **429 / 5xx** — the client keeps the payload and retries later.
- Unique key **`(schemaVersion, dailyId, day)`**. Upsert replaces the full
  cumulative payload on conflict. A retry after a lost 204 is therefore
  harmless, and a later snapshot advances rather than doubles the counters.
- Body cap 4 KB. Unknown fields rejected rather than ignored — a strict schema
  is the only thing that keeps the payload from drifting away from the doc page.
- Worker code never reads or writes `CF-Connecting-IP`, `request.cf` location or
  User-Agent. D1 receives only validated body fields and server-side
  `receivedAt`, used solely to operate the retention job.
- Workers observability is disabled, the handler emits no custom logs, and the
  privacy page states that Cloudflare can still process and retain edge/security
  metadata under its own infrastructure controls.
- Raw D1 rows expire after **35 days**. A daily scheduled job first produces
  aggregates with no `dailyId`, then deletes expired raw rows. Aggregate tables
  retain day, schema version and coarse dimensions/counter totals only; cells
  below the publication threshold are not exported.
- D1 and analytics queries are owner-only. There is no public `/v1/stats`
  endpoint.

The endpoint host is deliberately neither `telemetry.*` nor a path on the
landing. It is frozen into every shipped binary, so it must survive the landing
moving off Vercel. This route is analytics-only; a later licensing service must
not silently reuse its consent or payload contract. `api.spacevibe.dev` is
avoided because the workspace already has a `spacevibe-api` repo serving Bench,
and Deck is independent of that system.

## 9. Copy and the four touchpoints

Approved wording:

> **Your work stays on your machine**
> Your code, terminals and agent sessions stay local. Deck offers optional
> first-party usage analytics — off until you choose to share, with no code,
> file paths or prompts. [What Deck sends →]

Four places change:

1. [`copy.js`](../../marketing/landing-prototype/src/copy.js) `current` — the EN
   proof point at lines 61-63 and its VI twin at line 142.
2. `README.md` — the local-first line. **Re-verify its line number before
   editing:** [`github readme design`](2026-08-22-github-readme-design.md)
   `decided` is in flight over the same file.
3. [`stage-states.js`](../../marketing/landing-prototype/src/tour/stage-states.js)
   `current` — the tour runs `grep -ri telemetry src`, which from now on
   **returns results**. It becomes `cat` of `src/telemetry/payload.ts`, presented
   as the client payload contract rather than proof of the whole data lifecycle.
4. `AGENTS.md` in THIS repo, whose "no accounts, no telemetry remains valid" line
   is internal policy and would otherwise contradict this spec.

The subdomain decision belongs in [`../AGENTS.md`](../../../AGENTS.md) `current`
instead, and only a workspace session may write it (X1).

**No analytics-derived number reaches the landing.** The unauthenticated ingest
cannot establish trustworthy public social proof, and an action launch is not an
agent conversation or a person. Downloads, releases, stars and commits may stay
when read from the GitHub API with their source stated.

## 10. Risks and limits

**10.1 The endpoint is unauthenticated.** Anyone can submit a schema-valid fake
snapshot. Strict validation, body caps and Cloudflare edge rate limiting reduce
accidental or cheap abuse but do not establish authenticity. Therefore the data
is directional internal evidence, never billing, release gating, public social
proof or a source of exact population totals.

**10.2 Tauri users are permanently invisible.** They cannot receive this code and
their update check 404s. `v0.12.3` shows 31 manifest fetches, so the group is not
small. Every figure produced here describes Electron users only, and the landing
copy must not imply otherwise.

**10.3 Windows self-update is not proven.** The specific frictions remain real:
the NSIS installer is `oneClick: false`, so `quitAndInstall` opens a wizard and waits for
a click, and the build is unsigned, so SmartScreen warns. Expect Windows to
update later and less completely than macOS, and do not read platform ratios in
the first fortnight as install-base ratios. A Windows analytics row proves a
build ran, not how it arrived.

**10.4 Opt-in creates selection bias.** Participating users may be more engaged
or more trusting than non-participants. There is no valid coverage denominator,
so results never extrapolate to all Deck users.

**10.5 Daily unlinkability removes retention.** Product questions about 7/14/28
day return behaviour require a separate future design and a new explicit consent
decision; this spec does not smuggle that capability in through a permanent id.

**10.6 Small cohorts can still be distinctive.** Platform, architecture, version
and unusual counter combinations can single out a row in a small dataset even
without a stable id. Raw access stays owner-only, expires after 35 days and is
never exposed through a public endpoint.

**Assumption:** 35 raw days are enough to diagnose metric regressions and compare
release cohorts without retaining a durable activity history. Owner approval of
this spec confirms that retention window; otherwise it remains a gap.

## 11. Verification

- **The payload snapshot test is the privacy contract**, not a technical test:
  it pins the exact field list, so adding a field turns it red and updating it
  forces the spec, current privacy page and versioned notice archive to change in
  the same release.
- `shouldSend(buffer, now, consent)` and `shouldShowUsageNotice(...)` are pure
  and tested without mounting or networking, as
  [`shouldShowNotice`](../../src/updater/migration-notice.ts) `current` is.
- The multi-window cumulative merge is pure and tested directly: repeated
  snapshots replace rather than add; counters never decrease; a retry is
  idempotent; returning to a prior local day reuses that day's buffer.
- A lifecycle test proves declined, unanswered and unreadable states create no
  id, retain no counter and start no timer. Enabling creates the first id only
  after the consent write succeeds; disabling blocks counts before deletion.
- A one-run-only case proves the initial snapshot reaches participating DAU
  without requiring a second launch.
- A cross-day test proves two local days have unrelated UUIDs and no linking
  field. No IPC response or event contains either id.
- `post` is injected the way `loadUpdater` is, so no test touches the network.
- All three channels join
  [`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts)
  `current` so R6 keeps its force.
- Worker contract tests reject unknown fields and over-size bodies, upsert a
  cumulative retry into one row, retry transient statuses, disable observability
  in deployed configuration, aggregate expired data and delete raw rows after
  35 days.
- A privacy-copy test pins “optional”, “off until you choose”, the field list,
  Cloudflare's processor role and raw retention. The copy must never call the
  payload anonymous.
- Gates owed before any claim: `npm test`, `npm run build`,
  `npm run electron:build`, the design-language gate, and a real
  `npm run electron:dev` pass proving the row appears before any network request,
  both choices persist across windows/relaunches, off emits no request, and the
  Settings state matches main. Owner eye approval of the rendered consent and
  Privacy surfaces remains a separate gate.

## 12. Rollout order

1. **Worker + D1 live in production and curl-able.** Different repo, different
   session. Its schema, retention job, access controls and disabled observability
   are deployment gates, not follow-ups.
2. **The current privacy page and first versioned archive deployed** at
   `https://deck.spacevibe.dev/privacy`. The
   URL freezes into the binary and the consent banner links straight to it, so a
   client shipped ahead of the page makes its first act a 404. Written is not the
   gate; deployed is.
3. **The Deck client**, riding whatever release comes next. Analytics must not
   drive the release schedule — two specs dated 2026-08-22 are built with nothing
   run yet, and this should not be coupled to them. A stable tag is required:
   a `1.0.0` client resolves `latest.yml`, while a prerelease tag produces
   `electron-mac.yml`, so a prerelease cannot reach existing users at all.
4. **Two to four weeks before interpretation.** Report sample size and label all
   results participating installs. Do not publish the totals on the landing.
5. **A 35-day retention audit.** Confirm expired raw ids are gone from D1 and
   document what Cloudflare edge/security retention remains outside D1.

## 13. Forks recorded

- **New optional network egress from the app, main-owned analytics state, three
  new IPC channels, and a DL amendment.** The app has had exactly two outbound
  paths — the updater and `gh` for the star button — and this adds a third that runs
  unattended only after opt-in. DL §30 widens from "the migration notice" to a
  notice-row genre with two instances; the row's geometry does not change.
- **A new subdomain, `api.deck.spacevibe.dev`, plus infrastructure owned by no
  existing repo.** Workspace-level by `../AGENTS.md`: it must be recorded there
  in a workspace session, not this one.
- **A public claim is being retired.** "No telemetry" shipped with `1.0.0` and is
  withdrawn only when the opt-in client ships. The replacement describes current
  behaviour precisely and links to an effective-date archive; it does not make a
  permanent product promise.
- **The general settings schema is not the owner.** This deliberately reverses
  the earlier draft's two settings fields: copying settings must not copy consent
  or suppress disclosure on another machine.
- **Cross-day retention is removed.** The earlier permanent `installId` could
  build a durable activity history. This revision spends that capability to
  preserve Deck's local-first trust boundary.

## Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| Deck offers opt-in daily usage analytics | `proposed` | **unbuilt** | Nothing exists: no module, channel, Worker, D1, Privacy surface or copy change. This draft is the whole artefact. |
| A participating daily payload carries no deterministic cross-day identifier | `proposed` | unbuilt | Requires a fresh random `dailyId`, no renderer exposure, payload snapshot tests and a Worker schema with no durable identifier. |
| Raw analytics expires after 35 days | `proposed` | blocked | Requires the Worker repository, scheduled aggregation/deletion and a production retention audit. |
| Windows machines receive updates automatically | `current` | unverified | No Windows auto-update has been observed. An analytics row cannot prove its install path; Gate C remains open. |
| The landing shows telemetry-derived social proof | `deprecated` | rejected | The ingest is unauthenticated and the sample has unknown opt-in bias. Use auditable GitHub figures instead. |

Updated 2026-08-22.
