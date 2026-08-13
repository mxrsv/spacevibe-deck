//! Machine-wide token usage, read out of the Claude Code and Codex CLI
//! transcripts this OS user has on disk.
//!
//! **Privacy contract.** The scanner necessarily reads file bytes that include
//! conversation content, but the parse loop keeps and returns **only** usage
//! counters, model strings, timestamps, session/message ids and file paths.
//! Conversation content never leaves this loop: it never enters the cache, it
//! never crosses the Tauri IPC boundary, and the one place a raw byte range
//! could have escaped — the session-identity fallback — hashes the bytes
//! instead of storing them.
//!
//! Not one of the R4 load-bearing seams: this is a leaf module with one
//! command. Every failure is fail-soft and in-band, the convention
//! `prompt_assets.rs` and `agents.rs` already follow — a missing directory, an
//! unreadable file or a malformed line degrades the answer instead of
//! returning an error.
//!
//! Zero new crates. No `chrono` (timestamps are parsed by hand), no `walkdir`
//! (`std::fs::read_dir` recursion with a depth cap), no `memchr`
//! (`slice::iter().position()`), no `tempfile` (tests build fixtures in the OS
//! temp dir). All three are in `Cargo.lock` as transitive Tauri dependencies
//! and none of them is importable.
//!
//! The module is a directory rather than one file because the whole scanner
//! runs past the repo's 800-line ceiling: `reader` holds the capped line
//! reader and the hand-rolled RFC3339 parser, `claude` and `codex` the two
//! per-agent line parsers, `cache` the on-disk cache, `discover` the two
//! source walks, and `scan` the incremental pass and the aggregation. This
//! file keeps the payload shapes, the frozen constants and the command.

mod cache;
mod claude;
mod codex;
mod discover;
mod reader;
mod scan;

use cache::{load_cache, write_cache};
use scan::{build_snapshot, scan_all};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::Manager;

/// Parser/schema version of the on-disk cache. A mismatch discards the cache
/// and forces a full rescan (spec, major M1) — bump it whenever a field's
/// meaning changes, not merely when one is added.
///
/// **2 (2026-08-10)** — version 1 attributed a Codex file's `token_count`
/// events that precede its first `turn_context` to `UNKNOWN_MODEL` and left
/// them there. On the dev machine two rollouts put 6 179 898 tokens on
/// `unknown`, which is unpriced, which blanked the Codex dollar column and the
/// headline total (§0.3 decision 8, "null wins"). `codex::backfill_unknown_model`
/// fixes new scans; nothing fixes a cache already on disk, so the bump throws
/// those buckets away.
const USAGE_CACHE_VERSION: u32 = 2;

/// Cache file name, inside `app.path().app_data_dir()` beside the plugin
/// stores. Written temp-file-plus-rename, never truncate-in-place.
const USAGE_CACHE_FILE: &str = "usage-cache.json";

/// Suffix of the same-directory temp file the cache is written through.
const CACHE_TEMP_SUFFIX: &str = ".tmp";

/// Fifteen-minute UTC buckets. Not hourly: real-world offsets include :30 and
/// :45 (India, Nepal, Chatham), where an hourly bucket puts boundary-hour
/// usage on the wrong local day once the frontend re-buckets into local days.
const BUCKET_MS: u64 = 15 * 60 * 1000;

/// A file whose mtime is older than this loses its per-message contribution
/// map and keeps only its rolled-up counters (§0.3 decision 2). Age, not scan
/// count: with a 5 s poll a session merely paused for two minutes would
/// compact and then force a full re-read the moment the user typed again.
const COMPACT_AFTER_MS: u64 = 48 * 60 * 60 * 1000;

/// Separator inside the Claude dedupe key. `\u{1}` cannot occur in either id,
/// so `a\u{1}bc` and `ab\u{1}c` can never collide.
const DEDUPE_SEPARATOR: &str = "\u{1}";

/// Model string used when a transcript records usage without naming a model.
/// It stays raw and visible: the frontend prices only exact matches, so an
/// unpriced row shows tokens and a dash rather than a guessed dollar figure.
const UNKNOWN_MODEL: &str = "unknown";

/// Bytes read when resolving a file's session identity. Bounded because a
/// subagent transcript opens with a `type: "user"` line that can carry a
/// pasted blob — the same reason the line reader has a cap.
const IDENTITY_HEAD_BYTES: usize = 64 * 1024;

const CLAUDE_DIR: &str = ".claude";
const CLAUDE_PROJECTS_DIR: &str = "projects";
const CLAUDE_SUBAGENTS_DIR: &str = "subagents";
const CODEX_DIR: &str = ".codex";
const CODEX_SESSIONS_DIR: &str = "sessions";
const CODEX_ARCHIVED_DIR: &str = "archived_sessions";
const CODEX_ROLLOUT_PREFIX: &str = "rollout-";
const TRANSCRIPT_EXTENSION: &str = "jsonl";

/// Directory depth the Codex walk will descend. `sessions/YYYY/MM/DD/file` is
/// three levels; six bounds a pathological tree without a symlink loop being
/// able to run the scan forever.
const MAX_WALK_DEPTH: usize = 6;

const CLAUDE_ASSISTANT_TYPE: &str = "assistant";
const CLAUDE_TIER_5M: &str = "ephemeral_5m_input_tokens";
const CLAUDE_TIER_1H: &str = "ephemeral_1h_input_tokens";
const CODEX_TURN_CONTEXT_TYPE: &str = "turn_context";
const CODEX_EVENT_TYPE: &str = "event_msg";
const CODEX_TOKEN_COUNT_TYPE: &str = "token_count";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCounters {
    pub input_uncached: u64,
    pub cache_read: u64,
    pub cache_create_5m: u64,
    pub cache_create_1h: u64,
    pub cache_write: u64,
    pub output: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageAgent {
    Claude,
    Codex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSourceState {
    Ok,
    Missing,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSource {
    pub agent: UsageAgent,
    pub state: UsageSourceState,
    pub files_scanned: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// Unix ms at the start of the 15-minute UTC bucket.
    pub bucket_start_ms: u64,
    pub agent: UsageAgent,
    /// The raw model string, verbatim — no canonicalization in Rust.
    pub model: String,
    pub counters: UsageCounters,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Unix ms when this scan finished.
    pub scanned_at_ms: u64,
    /// Sorted by (bucket_start_ms, agent, model) so the payload is stable.
    pub buckets: Vec<UsageBucket>,
    /// Exactly two entries, Claude then Codex.
    pub sources: Vec<UsageSource>,
    pub skipped_lines: u64,
}

/// One `{bucket, model}` worth of counters. Used twice: as a Claude message's
/// individual contribution (keyed by its dedupe key) and as an entry in a
/// file's rolled-up totals.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contribution {
    bucket_start_ms: u64,
    model: String,
    counters: UsageCounters,
}

/// The last cumulative totals seen in a Codex rollout, so delta ingestion
/// resumes from the stored numbers instead of re-deriving them from the top of
/// the file.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexTotals {
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
}

/// Everything the cache remembers about one transcript file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileRecord {
    agent: UsageAgent,
    /// Session identity read from the first line. A file whose identity
    /// changed is a different session at the same path, so it is rescanned
    /// from zero even when its size did not move.
    identity: String,
    mtime_ms: u64,
    size: u64,
    /// Byte offset just past the last complete line ingested.
    offset: u64,
    /// Cumulative for this file across scans, so the number the UI shows does
    /// not flicker on a poll that read nothing.
    #[serde(default)]
    skipped_lines: u64,
    /// Set once the file aged past `COMPACT_AFTER_MS`: `entries` was rolled
    /// into `totals` and dropped.
    #[serde(default)]
    compacted: bool,
    /// Claude only, and only while uncompacted: dedupe key → contribution.
    /// Last-wins survives an offset resume because a re-seen key REPLACES its
    /// previous contribution instead of adding a second one (spec, blocker B2).
    #[serde(default)]
    entries: BTreeMap<String, Contribution>,
    /// Codex's accumulated per-`{bucket, model}` deltas, and where a compacted
    /// file's roll-up lives for either agent.
    #[serde(default)]
    totals: Vec<Contribution>,
    /// Codex only: the model from the most recent `turn_context` line. Stored
    /// because that line is usually behind the resume offset.
    #[serde(default)]
    last_model: Option<String>,
    /// Codex only: the high-water cumulative totals seen so far.
    #[serde(default)]
    cumulative: Option<CodexTotals>,
}

impl FileRecord {
    fn empty(agent: UsageAgent, identity: String, mtime_ms: u64, size: u64) -> Self {
        Self {
            agent,
            identity,
            mtime_ms,
            size,
            offset: 0,
            skipped_lines: 0,
            compacted: false,
            entries: BTreeMap::new(),
            totals: Vec::new(),
            last_model: None,
            cumulative: None,
        }
    }
}

/// The whole cache. Keyed by path string so the map is ordered, which makes
/// both the serialized bytes and the cross-file merge deterministic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageCache {
    cache_version: u32,
    files: BTreeMap<String, FileRecord>,
}

impl Default for UsageCache {
    /// A fresh cache is stamped with the CURRENT version, never zero — a
    /// default that claimed version 0 would be discarded by its own loader.
    fn default() -> Self {
        Self {
            cache_version: USAGE_CACHE_VERSION,
            files: BTreeMap::new(),
        }
    }
}

fn bucket_start(unix_ms: u64) -> u64 {
    unix_ms - unix_ms % BUCKET_MS
}

/// Saturating throughout: a corrupt transcript claiming `u64::MAX` tokens must
/// degrade to a wrong-but-finite number, never panic a release build's
/// neighbour in debug.
fn add_counters(left: UsageCounters, right: UsageCounters) -> UsageCounters {
    UsageCounters {
        input_uncached: left.input_uncached.saturating_add(right.input_uncached),
        cache_read: left.cache_read.saturating_add(right.cache_read),
        cache_create_5m: left.cache_create_5m.saturating_add(right.cache_create_5m),
        cache_create_1h: left.cache_create_1h.saturating_add(right.cache_create_1h),
        cache_write: left.cache_write.saturating_add(right.cache_write),
        output: left.output.saturating_add(right.output),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// A file's modification time in Unix ms. An unreadable or pre-epoch mtime
/// reads as 0, which makes the file look permanently stale — it is compacted
/// and never resumed, which is the safe direction.
fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// The in-memory half of the cache, plus the single-flight lock.
///
/// A module static rather than Tauri managed state: §0.6 gives this feature
/// exactly two lines in `lib.rs`, and `.manage(…)` would be a third. Nothing
/// outside this module reads it. `platform/windows/shell.rs:30` is the
/// existing precedent for a module-level static in this crate.
struct ScanState {
    /// `None` until the first scan has loaded the cache from disk.
    cache: Option<UsageCache>,
}

static SCAN: std::sync::Mutex<ScanState> = std::sync::Mutex::new(ScanState { cache: None });

/// The last snapshot handed to the frontend. Read only when a scan is already
/// in flight, so a poll arriving mid-scan gets an answer instead of queueing a
/// second pass over the same corpus.
static LAST: std::sync::Mutex<Option<UsageSnapshot>> = std::sync::Mutex::new(None);

/// Lock, recovering from poisoning.
///
/// Deliberately not the repo's usual bail-on-poison style: the guarded value
/// is a rebuildable cache, and refusing it forever would leave the Usage
/// screen dead for the rest of the process's life over one unrelated panic.
fn lock<T>(mutex: &'static std::sync::Mutex<T>) -> std::sync::MutexGuard<'static, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The answer when the home directory cannot be resolved at all.
///
/// `unreadable`, never `missing` (spec, major M7): nothing was looked at, so
/// "no data yet" would be a claim this code is in no position to make.
fn unreadable_snapshot(scanned_at_ms: u64) -> UsageSnapshot {
    UsageSnapshot {
        scanned_at_ms,
        buckets: Vec::new(),
        sources: vec![
            UsageSource {
                agent: UsageAgent::Claude,
                state: UsageSourceState::Unreadable,
                files_scanned: 0,
            },
            UsageSource {
                agent: UsageAgent::Codex,
                state: UsageSourceState::Unreadable,
                files_scanned: 0,
            },
        ],
        skipped_lines: 0,
    }
}

/// One whole scan, on a blocking worker.
///
/// Single-flight: `SCAN` is held for the duration. A caller that finds it busy
/// takes the last published snapshot rather than waiting, unless nothing has
/// been published yet — on the very first cold scan there is nothing better to
/// return, so it waits.
fn snapshot_blocking(home: Option<PathBuf>, cache_path: Option<PathBuf>) -> UsageSnapshot {
    let Some(home) = home else {
        return unreadable_snapshot(now_ms());
    };
    let mut state = match SCAN.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(std::sync::TryLockError::WouldBlock) => {
            let published = lock(&LAST).as_ref().cloned();
            match published {
                Some(snapshot) => return snapshot,
                None => lock(&SCAN),
            }
        }
    };
    if state.cache.is_none() {
        state.cache = Some(load_cache(cache_path.as_deref()));
    }
    let previous = state.cache.take().unwrap_or_default();
    let outcome = scan_all(&previous, &home, now_ms());
    if outcome.changed {
        if let Some(path) = cache_path.as_deref() {
            // A failed write costs the next cold start some time and nothing
            // else, so it is not worth surfacing.
            let _ = write_cache(path, &outcome.cache);
        }
    }
    let snapshot = build_snapshot(&outcome, now_ms());
    state.cache = Some(outcome.cache);
    *lock(&LAST) = Some(snapshot.clone());
    snapshot
}

/// The one command behind the Usage screen.
///
/// Reading and parsing run on a blocking worker — the `info.rs:195` precedent —
/// because this machine holds ~2.5 GB of transcripts and the cold scan must
/// never touch the UI thread. `Err` is returned **only** when that worker
/// panics (§0.3 decision 5): every ordinary failure is in-band through
/// `sources[].state` and `skippedLines`, which is what lets the frontend's
/// poll have exactly one "keep the last good data, mark it stale" trigger.
#[tauri::command]
pub async fn usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshot, String> {
    let home = crate::platform::user_home().ok();
    let cache_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(USAGE_CACHE_FILE));
    tauri::async_runtime::spawn_blocking(move || snapshot_blocking(home, cache_path))
        .await
        .map_err(|error| format!("the usage scan worker failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::cache::tests::fixture;
    use crate::usage::claude::tests::claude_line;
    use crate::usage::discover::tests::write_file;
    use crate::usage::scan::tests::{append, claude_first_line, claude_transcript, line};

    #[test]
    fn buckets_floor_to_fifteen_minute_utc_boundaries() {
        assert_eq!(bucket_start(1_786_337_159_358), 1_786_337_100_000);
        assert_eq!(bucket_start(1_786_338_360_351), 1_786_338_000_000);
        assert_eq!(bucket_start(1_786_320_000_000), 1_786_320_000_000);
        assert_eq!(bucket_start(0), 0);
        assert_eq!(BUCKET_MS, 15 * 60 * 1000);
    }

    #[test]
    fn counters_add_without_overflowing() {
        let left = UsageCounters {
            input_uncached: 1,
            cache_read: 2,
            cache_create_5m: 3,
            cache_create_1h: 4,
            cache_write: 5,
            output: 6,
        };
        let right = UsageCounters {
            input_uncached: 10,
            cache_read: 20,
            cache_create_5m: 30,
            cache_create_1h: 40,
            cache_write: 50,
            output: 60,
        };
        let sum = add_counters(left, right);
        assert_eq!(sum.input_uncached, 11);
        assert_eq!(sum.cache_read, 22);
        assert_eq!(sum.cache_create_5m, 33);
        assert_eq!(sum.cache_create_1h, 44);
        assert_eq!(sum.cache_write, 55);
        assert_eq!(sum.output, 66);

        let huge = UsageCounters {
            input_uncached: u64::MAX,
            ..UsageCounters::default()
        };
        assert_eq!(add_counters(huge, huge).input_uncached, u64::MAX);
    }

    #[test]
    fn the_frozen_constants_hold_their_frozen_values() {
        // 2, not the 1 §0.2.4 froze: every version-1 cache on disk was written
        // by a parser that left a Codex file's pre-`turn_context` window on
        // `unknown`, and the bump is what discards those buckets instead of
        // letting them survive every future warm poll.
        assert_eq!(USAGE_CACHE_VERSION, 2);
        assert_eq!(USAGE_CACHE_FILE, "usage-cache.json");
        assert_eq!(COMPACT_AFTER_MS, 48 * 60 * 60 * 1000);
    }

    /// The one thing that catches a serde rename drifting away from
    /// `src/lib/usage-snapshot.ts` (§0.2.3). Modelled on the contract test at
    /// `src-tauri/src/info.rs:320-340`. Fully populated on purpose: both
    /// sources, both states, a nonzero skipped count.
    #[test]
    fn serializes_the_snapshot_contract() {
        let snapshot = UsageSnapshot {
            scanned_at_ms: 1_786_338_360_351,
            buckets: vec![
                UsageBucket {
                    bucket_start_ms: 1_786_337_100_000,
                    agent: UsageAgent::Claude,
                    model: "claude-opus-5".into(),
                    counters: UsageCounters {
                        input_uncached: 2,
                        cache_read: 23_190,
                        cache_create_5m: 0,
                        cache_create_1h: 44_316,
                        cache_write: 0,
                        output: 116,
                    },
                },
                UsageBucket {
                    bucket_start_ms: 1_786_337_100_000,
                    agent: UsageAgent::Codex,
                    model: "gpt-5.6-sol".into(),
                    counters: UsageCounters {
                        input_uncached: 26_416,
                        cache_read: 6_912,
                        cache_create_5m: 0,
                        cache_create_1h: 0,
                        cache_write: 0,
                        output: 587,
                    },
                },
            ],
            sources: vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Ok,
                    files_scanned: 1_410,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
            ],
            skipped_lines: 7,
        };

        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            serde_json::json!({
                "scannedAtMs": 1_786_338_360_351u64,
                "buckets": [
                    {
                        "bucketStartMs": 1_786_337_100_000u64,
                        "agent": "claude",
                        "model": "claude-opus-5",
                        "counters": {
                            "inputUncached": 2,
                            "cacheRead": 23_190,
                            "cacheCreate5m": 0,
                            "cacheCreate1h": 44_316,
                            "cacheWrite": 0,
                            "output": 116,
                        },
                    },
                    {
                        "bucketStartMs": 1_786_337_100_000u64,
                        "agent": "codex",
                        "model": "gpt-5.6-sol",
                        "counters": {
                            "inputUncached": 26_416,
                            "cacheRead": 6_912,
                            "cacheCreate5m": 0,
                            "cacheCreate1h": 0,
                            "cacheWrite": 0,
                            "output": 587,
                        },
                    },
                ],
                "sources": [
                    { "agent": "claude", "state": "ok", "filesScanned": 1_410 },
                    { "agent": "codex", "state": "unreadable", "filesScanned": 0 },
                ],
                "skippedLines": 7,
            })
        );
    }

    #[test]
    fn a_cache_round_trips_through_json_with_camel_case_keys() {
        let mut entries = std::collections::BTreeMap::new();
        entries.insert(
            "msg_1\u{1}req_1".to_string(),
            Contribution {
                bucket_start_ms: 1_786_337_100_000,
                model: "claude-opus-5".into(),
                counters: UsageCounters {
                    output: 116,
                    ..UsageCounters::default()
                },
            },
        );
        let mut files = std::collections::BTreeMap::new();
        files.insert(
            "/tmp/a.jsonl".to_string(),
            FileRecord {
                entries,
                ..FileRecord::empty(UsageAgent::Claude, "sess-1".into(), 10, 20)
            },
        );
        let cache = UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        };

        let encoded = serde_json::to_vec(&cache).unwrap();
        let text = String::from_utf8(encoded.clone()).unwrap();
        assert!(text.contains("\"cacheVersion\":2"));
        assert!(text.contains("\"bucketStartMs\""));
        assert_eq!(
            serde_json::from_slice::<UsageCache>(&encoded).unwrap(),
            cache
        );
    }

    #[test]
    fn an_unresolvable_home_still_answers_with_exactly_two_sources() {
        let snapshot = unreadable_snapshot(1_786_338_360_351);
        assert_eq!(snapshot.scanned_at_ms, 1_786_338_360_351);
        assert!(snapshot.buckets.is_empty());
        assert_eq!(snapshot.skipped_lines, 0);
        assert_eq!(
            snapshot.sources,
            vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
            ]
        );
        // A home that cannot be resolved is an error, never "no data yet".
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap()["sources"][0]["state"],
            serde_json::json!("unreadable")
        );
    }

    #[test]
    fn the_blocking_entry_point_scans_writes_and_republishes() {
        let home = fixture("blocking-entry");
        let cache_dir = fixture("blocking-entry-cache");
        let cache_path = cache_dir.join(USAGE_CACHE_FILE);
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                116,
            )),
        );

        let snapshot = snapshot_blocking(Some(home.clone()), Some(cache_path.clone()));
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(snapshot.buckets[0].counters.output, 116);
        assert!(cache_path.is_file(), "a changed scan writes the cache");
        assert_eq!(load_cache(Some(&cache_path)).files.len(), 1);

        // The second call re-uses the in-memory cache and republishes the same
        // numbers. It is also what proves the statics survive a second entry.
        let again = snapshot_blocking(Some(home.clone()), Some(cache_path.clone()));
        assert_eq!(again.buckets, snapshot.buckets);
        assert_eq!(again.sources, snapshot.sources);

        // A home that cannot be resolved is in-band, never an error.
        let empty = snapshot_blocking(None, Some(cache_path.clone()));
        assert_eq!(empty.sources[0].state, UsageSourceState::Unreadable);

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&cache_dir);
    }
}
