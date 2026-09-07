# Usage analytics

Deck sends one small usage snapshot per day, on by default, and the only state it never
infers away is an explicit "off". This page is the contract: what leaves the machine, who
owns the state, and when a POST fires. Electron only: the Tauri host sends nothing.

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
  `telemetry:state-changed`, so every window's Privacy switch moves together.

## State

- `EMPTY_STATE` is `enabled`. `parsePersisted` folds every stored spelling except
  `declined` into `enabled`: a missing field, garbage, or an opt-in-era `unanswered` all
  read as on. `USAGE_CONSENT_ASKED` in
  [`usage-notice.ts`](../../src/telemetry/usage-notice.ts) is `false`, so the consent modal
  mounts nowhere; it stays in the tree behind that constant.
- **Unreadable fails closed.** When `telemetry.json` exists but cannot be read, consent reports
  `unreadable`, nothing counts, nothing sends, `setEnabled` throws, and Deck neither guesses
  nor overwrites the file. Settings → Privacy says so and tells the user to repair the file
  and restart, because it is read once at launch.
- **Off means off.** `setEnabled(false)` stops the timer, replaces the state with
  `declined` and an empty day map (every unsent buffer and daily id deleted), then flushes.
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
is a view over `telemetry.json` reached through `telemetry_state`: one switch, "Share usage
stats", disabled while loading, unavailable or unreadable, plus the disclosure in plain words
and a link to `USAGE_PRIVACY_URL`. A failed write surfaces through the persist-error bar; the
UI never claims a change main did not keep.
