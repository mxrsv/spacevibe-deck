# Opt-in Usage Analytics (client) — Implementation Plan

> **Amended (decided 2026-08-23, committed 2026-08-24):** executed as written, then the owner reversed the
> consent model — analytics is ON by default and no dialog is asked
> (`USAGE_CONSENT_ASKED=false`; commit `cdc07a0`). The opt-in flow this plan
> builds stays in the tree behind that constant. Frozen as the record of what
> was built.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Deck-client half of the opt-in daily usage analytics: renderer counters, three IPC channels, a main-owned consent/buffer/sender module, the consent notice row, the Privacy settings category, and the four copy touchpoints.

**Architecture:** Renderer counts fire-and-forget over `telemetry_count`; `electron/telemetry/` owns `telemetry.json` (consent, per-day buffers, daily ids), merges every window, and POSTs whole cumulative snapshots to `https://api.deck.spacevibe.dev/v1/ping` on its own timer. No identifier ever crosses into the renderer. Tauri has no handler, so `available` is false and nothing renders or sends there.

**Tech Stack:** Preact signals (R5), flat IPC channels (R6), `JsonStore`/`StoreRegistry` persistence, injected `post` (global fetch + `AbortSignal.timeout(5000)`), Vitest.

**Spec:** [docs/specs/2026-08-22-anonymous-usage-telemetry-design.md](../specs/2026-08-22-anonymous-usage-telemetry-design.md) — Worker/D1, the privacy page and the workspace-level subdomain record are OUT of scope (other repos/sessions, X1).

## Global Constraints

- English only (R1); no new dependency; no `src-tauri/` change; no `src/` → `electron/` import (duplicate the 6h constant with a spec-§5 comment).
- Payload = spec §4 verbatim: `schemaVersion 1, dailyId, day, version, platform, arch, agents, surfaces, maxTabs, maxPanes, restoredSessions`. `agents` keys = six built-in ids + `"custom"`, never a user string.
- Endpoint `https://api.deck.spacevibe.dev/v1/ping`; privacy URL `https://deck.spacevibe.dev/privacy`; 15-min dirty cadence; 6h heartbeat (= `BACKGROUND_CHECK_INTERVAL_MS` value, duplicated); 5s timeout; 7-day buffer cap; 400/413 terminal, everything else retained.
- `telemetry.json` NEVER in `settings.json` and NEVER in `register-store.ts`'s `STORE_FILES` (that allowlist would hand the renderer the daily id).
- Consent copy: "optional", "off until you choose"; never the word "anonymous".
- Verification: tests are WRITTEN but per owner standing instruction no build/test/typecheck runs unasked — everything reported as unverified.

---

### Task 1: Payload contract — `src/telemetry/payload.ts` (+ snapshot test)

**Files:** Create `src/telemetry/payload.ts`, `src/telemetry/payload.test.ts`.

**Produces:** `SCHEMA_VERSION = 1`; `AGENT_PAYLOAD_KEYS` (six built-ins + `"custom"`); `SURFACE_KEYS = ["browser","explorer","usage"]`; types `AgentPayloadKey`, `SurfaceKey`, `UsagePayload`; `agentPayloadKey(id: string): AgentPayloadKey` (`isBuiltinAgentId(id) ? id : "custom"`). File is short and comment-annotated — the landing tour `cat`s it as a disclosure aid, so the "deliberately absent" list from spec §4 lives here as a comment.

**Test:** snapshot pins the exact top-level field list, the closed agent key set, and the absence of any other field; asserts the six ids match `BUILTIN_AGENTS` order-independently.

### Task 2: IPC channels + contract test

**Files:** Modify `electron/ipc/channels.ts` (three `CHANNELS` entries inside the parsed slice: `telemetryCount: "telemetry_count"`, `telemetryState: "telemetry_state"`, `telemetrySetEnabled: "telemetry_set_enabled"`; one `EVENTS` entry `telemetryState: "telemetry:state-changed"`), `scripts/electron-ipc-contract.test.ts` (pinned fixture block in the `expected: Record<string, string[]>` shape of the path-open trio: `telemetry_count: ["kind","key","value"]`, `telemetry_state: []`, `telemetry_set_enabled: ["enabled"]`).

Preload needs nothing else — `INVOKABLE_CHANNELS`/`LISTENABLE_EVENTS` build from these tables.

### Task 3: Main service — `electron/telemetry/`

**Files:** Create `electron/telemetry/model.ts` (types + constants: `TELEMETRY_ENDPOINT`, `CONSENT_VERSION = 1`, `SEND_CHECK_INTERVAL_MS = 15*60_000`, `HEARTBEAT_INTERVAL_MS = 6*60*60*1000`, `POST_TIMEOUT_MS = 5000`, `MAX_PENDING_DAYS = 7`, `TELEMETRY_FILE = "telemetry.json"`), `electron/telemetry/service.ts`, `electron/telemetry/service.test.ts`.

**Produces:**

```ts
export interface TelemetryDeps {
  now(): number;
  localDay(nowMs: number): string;          // client-local YYYY-MM-DD
  randomUUID(): string;
  post(payload: UsagePayloadLike): Promise<number>; // resolves HTTP status, rejects on network error
  readonly version: string; readonly platform: string; readonly arch: string;
  readonly store: TelemetryStoreAccess;     // load/save/state over JsonStore
  report(message: string, error: unknown): void;
}
export interface TelemetryService {
  count(kind: string, key: string, value: number): void;
  state(): { consent: "unanswered"|"enabled"|"declined"|"unreadable"; consentVersion: number };
  setEnabled(enabled: boolean): Promise<void>;
  noteWindowReady(): void;      // initial snapshot in an enabled run
  flushOnQuit(): Promise<void>; // best-effort final snapshot
  dispose(): void;
}
export function createTelemetryService(deps: TelemetryDeps): TelemetryService;
export function shouldSend(buffer, nowMs, consent): boolean;  // pure, exported for tests
```

Rules encoded: disabled/unanswered/unreadable ⇒ no id, no count accepted, no timer; enable persists consent FIRST, then creates the day's UUID; disable blocks counts, deletes every buffer/id, persists declined; stored `consentVersion < CONSENT_VERSION` with enabled consent ⇒ reported `unanswered`; returning to a prior local day reuses that day's buffer and id; counters fold cumulatively (`agents`/`surfaces` add, `maxTabs`/`maxPanes` `Math.max`, `restoredSessions` OR); main re-validates kind/key against the closed enums and non-negative integers (renderer is not the trust boundary); every send posts the WHOLE snapshot; 204 marks sent; 400/413 marks that buffer terminal; 408/429/5xx/network keep it; other 4xx keep it under the 7-day cap; oldest pending dropped first.

**Tests (spec §11):** lifecycle (three off-states create nothing), enable-after-write, off-means-off, cumulative merge idempotence, one-run initial snapshot, cross-day unrelated UUIDs, retry matrix, 7-day cap, heartbeat vs dirty cadence via pure `shouldSend`.

### Task 4: Registration — `electron/ipc/register-telemetry.ts` + `main.ts`

**Files:** Create `electron/ipc/register-telemetry.ts`; modify `electron/main.ts`.

Follows `register-updater.ts`: opens the store via the existing `StoreRegistry` (`stores.open(TELEMETRY_FILE, ...)` — unreadable ⇒ write-locked ⇒ the service's `unreadable` state), supplies real `post` (global fetch, `AbortSignal.timeout(POST_TIMEOUT_MS)`, resolves `res.status`), registers the three handlers with destructured flat args, fans `EVENTS.telemetryState` to every window on state change (the `storeWriteFailed` precedent), returns `{ noteWindowReady, flushOnQuit }`. `main.ts`: call beside `registerUpdater`, hook `flushOnQuit` into the `confirm_quit` chain and `prepareForInstall`, `noteWindowReady` where the first window reports ready.

### Task 5: Renderer host facade + consent store

**Files:** Create `src/host/telemetry-host.ts` (the `external-apps-host.ts` shape: `available` reads `__deckHost` directly; `telemetryCount({kind,key,value})` un-awaited fail-soft; `telemetryState()`; `telemetrySetEnabled(enabled)`), `src/telemetry/consent-store.ts` (+ test): window-scoped signal `consentState: "loading"|…|"unavailable"`, `ensureTelemetryStateLoaded()`, `setTelemetryEnabled()`, `listenTelemetryState()` subscribing to `telemetry:state-changed` so both banner buttons dismiss across every window.

### Task 6: Notice gate — `src/telemetry/usage-notice.ts`

**Files:** Create `src/telemetry/usage-notice.ts` + test. `USAGE_ANALYTICS_AVAILABLE: boolean = true` (typed, the `MIGRATION_NOTICE_ENABLED` precedent), `USAGE_PRIVACY_URL`, pure `shouldShowUsageNotice({ electronHost, consent, enabled? })` ⇒ enabled && electronHost && consent === "unanswered". The case that matters: Tauri/browser host ⇒ false.

### Task 7: Consent banner — `src/ui/usage-consent-banner.tsx`

**Files:** Create component + test; modify `src/styles/06-stage-panes.css`.

Copy (spec §6 verbatim): "Help improve Deck by sharing optional usage stats. No code, paths or prompts." — buttons **Share usage stats** / **Not now**, link **What Deck sends →** (opens `USAGE_PRIVACY_URL`). No ✕ — both buttons persist a decision (DL-30.5 amendment, Task 11). `role="status"`, `--chrome-1` + `--seam-divider`, one bold lead (DL-30.2/3/4). CSS: add `.usage-banner` beside `.migration-banner` in the grouped selectors, plus its two-button styles.

**The landmine (advisor + `06-stage-panes.css:166-169`):** the migration banner never offsets `.stage__surface` because it is Tauri-only. This row is Electron-only, so add `.stage--notice .stage__surface { top: var(--notice-h) }` (and the `stage--strip` variant) and confirm browser bounds follow — `browser_set_bounds` is measured from the surface element's rect, so CSS offset must be the one source; verify the measuring code, do not duplicate the offset host-side.

### Task 8: Mount + counters wiring

**Files:** Modify `src/ui/app.tsx`; create `src/telemetry/usage-counters.ts` + test; modify `src/terminal/tab-manager.ts`, `src/sessions/resume-session.ts`, `src/terminal/session-restore.ts` call sites only if the id is not already in hand at a renderer seam.

- Banner mount beside `MigrationBanner` (mutually exclusive by host); `stage--notice` class covers either notice.
- `usage-counters.ts`: `countAgentLaunch(agentId)`, `countSurfaceOpen(surface)`, `countRestoredSessions()`, `installUsageCounterGauges()` — an `effect` (the `session-journal.ts:276` shape) over `tabViews` reporting tab/pane counts as gauges (main folds max), and false→true transition detection for `browserSurfaceActive` / dock-explorer / dock-usage predicates, seeded on first tick so a boot-persisted open dock does not count.
- Launch counting: inside `materialize` per armed agent command when `intent.agent` is set; in `dropAgentPane`; at the two resume call sites where the id is in hand (`resume-session.ts` `entry.agent`; `session-restore.ts` per-pane refs). **Do NOT widen `MaterializeIntent`** — that seam is fork-listed and the spec's fork list does not include it. No double count: resume intents carry `agent === undefined`.
- `restoredSessions`: the boot `restored` boolean in `app.tsx:498` only.

### Task 9: Privacy settings category

**Files:** Create `src/ui/settings/sections/privacy-section.tsx` + test; modify `src/ui/settings/settings-categories.ts` (entry after `about`, before `reset`), `src/ui/settings/active-category-store.ts` (`| "privacy"`), its test.

Four states from `consent-store`: loading (disabled switch), enabled, declined/off, unreadable (`LoadError`-style row, switch disabled, no auto-reset — manual file deletion documented in copy). Failed writes surface via `reportPersistError`. Body: the switch, exact field list + metric definitions, 35-day raw retention, Cloudflare processor role, privacy-notice link. Never the word "anonymous" (pinned by test).

### Task 10: Copy touchpoints

**Files:** Modify `README.md` (BOTH spots: `### Local usage accounting` lines ~67-72 AND the Trust row ~90-91 — re-verify numbers at edit time), `marketing/landing-prototype/src/copy.js` (EN 61-63, VI 142-144, spec §9 approved wording), `marketing/landing-prototype/src/tour/stage-states.js` (the `grep -ri telemetry` step becomes `cat` of `src/telemetry/payload.ts` presented as the client payload contract, `out` kept short), repo `AGENTS.md` ("no accounts, no telemetry remains valid" line).

### Task 11: DL §30 amendment

**Files:** Modify `docs/DESIGN-LANGUAGE.md`. DL-30.1 widens from "exactly one" to a two-instance genre mutually exclusive by host (spec §6/§13); DL-30.5 gains the decision-row branch (a consent row has no ✕; its buttons persist). Note the `.stage__surface` offset carve-out change in the 06-stage-panes comment. Keep section/rule integrity — `scripts/design-language.test.ts` machine-checks it.

### Task 12: Docs closeout

**Files:** Modify the spec (Status → decided, approved 2026-08-22 by "implement this spec"), repo `AGENTS.md` (fork queue entry; drift-table row `building/unverified`; current-direction bullet), `docs/CONTEXT.md` (D9 section with evidence state). No commit without owner review (D14; peer sessions' uncommitted edits sit inside shared files).

## Self-review

Spec coverage: §3 tasks 2-5; §4 task 1; §5 tasks 3-4; §6 tasks 6-7; §7 task 9; §9 task 10; §11 spread per task; §13 forks tasks 11-12. Out of scope by spec's own text: §8 Worker, §12 steps 1-2, workspace AGENTS.md. Known consequence to report: `USAGE_ANALYTICS_AVAILABLE = true` ships a consent row whose opt-in POSTs fail silently until the Worker exists — the spec's own dead-Worker-indistinguishable rule, but the owner must sequence the Worker session.
