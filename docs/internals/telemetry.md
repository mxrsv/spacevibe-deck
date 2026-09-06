# Usage analytics

Deck sends one small usage snapshot per day. Since 2026-09-06 it is MANDATORY: there is no
switch, no consent question, and an "off" recorded by an earlier build is overridden rather
than honoured. The one state that still stops a send is a `telemetry.json` Deck cannot read.
This page is the contract: what leaves the machine, who owns the state, and when a POST
fires. Electron only: the Tauri host sends nothing.

## The payload

[`src/telemetry/payload.ts`](../../src/telemetry/payload.ts) is the one readable statement of
what a participating install sends, and its snapshot test is the privacy contract in
executable form: adding a field turns it red. `schemaVersion` is 1.

| Field              | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `dailyId`          | A fresh random UUID v4 per local day, unrelated to every other day      |
| `day`              | The client's local calendar day, `YYYY-MM-DD`, not a timestamp          |
| `version`          | Deck's version                                                          |
| `platform`, `arch` | `darwin` / `win32`, `arm64` / `x64`                                     |
| `agents`           | Launches that day keyed by the closed set `claude`, `codex`, `opencode`, `agy`, `gemini`, `cursor-agent`, `custom` |
| `surfaces`         | Times the `browser`, `explorer` and `usage` surfaces went from hidden to visible |
| `maxTabs`, `maxPanes` | The busiest single window's high-water marks that day                |
| `restoredSessions` | Whether boot restore materialized at least one pane                     |

Deliberately absent: a permanent install identifier, file paths, repository names, branch
names, file names, terminal output, prompts, agent replies, hostname, username, locale,
timezone, and any per-action timestamp. Every custom agent folds into the single `custom`
bucket in the renderer before anything leaves it, because a custom agent's name is a string
the user typed. Public copy never calls the payload "anonymous"; the copy test pins that word
out.

## Ownership

- **Consent lives in main, in `telemetry.json`,** not in the settings schema, so a copied
  `settings.json` can never carry a consent choice, and the file is outside the renderer's
  store allowlist so no daily id is ever one `store_get` away.
  [`electron/telemetry/model.ts`](../../electron/telemetry/model.ts) and
  [`service.ts`](../../electron/telemetry/service.ts) own it.
- **Main re-validates every count** against the same closed key sets the renderer uses; a
  parity test pins the two lists together. The renderer is not the trust boundary.
- **The renderer counts edges.** [`usage-counters.ts`](../../src/telemetry/usage-counters.ts)
  treats surface visibility as a transition with a seeded first tick, so a dock that was
  persisted open reads as state, not as an open; tabs and panes are gauges folded into a
  per-day maximum.
- Three flat channels: `telemetry_count` (fire and forget), `telemetry_state` (also the
  "a window is ready" signal) and `telemetry_set_enabled`; one broadcast event,
  `telemetry:state-changed`. The event outlived the switch it synchronized: nothing in
  Settings moves on it now, and it is kept because it is what a restored switch would need.

## State

- `EMPTY_STATE` is `enabled`, and `parsePersisted` folds EVERY stored spelling into
  `enabled` while `USAGE_ANALYTICS_MANDATORY` holds — `declined` included. That last fold is
  the sharpest edge of the mandatory policy, so it is stated rather than implied: a recorded
  refusal is overridden. It reaches almost nobody in practice, because analytics has never
  shipped in a release (`cdc07a0` postdates 1.0.0), so a `declined` file exists only on
  machines that ran a development build.
- **Two constants, both in [`usage-notice.ts`](../../src/telemetry/usage-notice.ts), and both
  the whole reversal.** `USAGE_CONSENT_ASKED` is `false`, so the consent modal mounts nowhere;
  `USAGE_ANALYTICS_MANDATORY` is `true`, so there is nothing to answer. Neither surface was
  deleted — the modal stays in the tree, and the opt-out machinery below stays in
  `service.ts`, covered by tests that pass `mandatory: false`. `TelemetryDeps.mandatory`
  defaults to the constant and exists so both policies stay testable.
- **Unreadable fails closed, under either policy.** When `telemetry.json` exists but cannot be
  read, consent reports `unreadable`, nothing counts, nothing sends, `setEnabled` throws, and
  Deck neither guesses nor overwrites the file. A disk Deck cannot read is not a disk it may
  assume anything from. Settings → Privacy says so and tells the user to repair the file and
  restart, because it is read once at launch.
- **`setEnabled(false)` is refused in main**, not merely unreachable from the UI. Settings
  renders no switch, but `telemetry_set_enabled` is still a registered channel and the
  renderer is not the trust boundary — the refusal is what makes "cannot be turned off" a
  property of the app rather than of the current UI. With the constant flipped back, the
  original behaviour returns: stop the timer, replace the state with `declined` and an empty
  day map (every unsent buffer and daily id deleted), then flush.
- Counters cap at 1,000,000 so a runaway loop cannot push the body past the server's 4 KB
  limit. Days are keyed by the local calendar day, and at most 7 pending days are kept.

## When a POST fires

The endpoint is `https://api.deck.spacevibe.dev/v1/ping`, POSTed as JSON with a 5-second
timeout by [`register-telemetry.ts`](../../electron/ipc/register-telemetry.ts).

- At boot when enabled, and once when the first window reports ready.
- On a 15-minute timer (`unref`'d, so it never keeps the process alive): a dirty buffer sends
  after 15 minutes since the last send; an unchanged one sends as a 6-hour heartbeat.
- Immediately on `setEnabled(true)`.
- On quit and before an update install, as a best-effort final snapshot bounded by the
  timeout, so quit cannot hang on a dead Worker.

Every send replaces the whole day row server-side, so a retry cannot double-count. A network
failure keeps the buffer and waits for the next check, with no backoff and no fast retry.
A 2xx clears `dirty` only if the buffer object was not replaced mid-flight; a past day is
deleted outright. A 400 or 413 marks the buffer terminal and it is never resent; every other
status keeps it under the seven-day cap.

## Privacy surface

Settings → Privacy ([`privacy-section.tsx`](../../src/ui/settings/sections/privacy-section.tsx))
is a view over `telemetry.json` reached through `telemetry_state`. It carries NO control: the
disclosure in plain words, the `unreadable` alert, and a link to `USAGE_PRIVACY_URL`. A switch
would be a lie in either position — working, it would contradict main's refusal; disabled, it
would be a dead thing to keep pressing.

The disclosure did not go with the switch, and that is the shape of the whole decision: taking
the choice away is not a licence to stop saying what is taken. The copy states that analytics
is always on and cannot be turned off, lists what is sent and what never is, and — pinned by
the copy test — never calls the payload "anonymous" and never implies the collection is
optional. The category therefore has text to read and nothing to set, which is why the
settings-screen row inventory counts 18 rows rather than 19.
