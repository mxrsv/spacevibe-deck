//! The incremental pass over the corpus, the reconciliation rules and the
//! aggregation into the payload's bucket list.

use super::claude::{add_total, sort_totals, LineOutcome};
use super::codex::ingest;
use super::discover::{discover_claude, discover_codex, file_identity, DiscoveryState};
use super::reader::{LineEvent, LineReader};
use super::{
    add_counters, mtime_ms, Contribution, FileRecord, UsageAgent, UsageBucket, UsageCache,
    UsageCounters, UsageSnapshot, UsageSource, UsageSourceState, COMPACT_AFTER_MS,
    USAGE_CACHE_VERSION,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// What one file contributed to this pass.
enum FileScan {
    /// The file was accounted for. Its record replaces whatever was cached.
    Updated(FileRecord),
    /// The file could not be statted or opened. The caller keeps the previous
    /// record: a transient permission error must not delete a scan's worth of
    /// contributions.
    Failed,
}

/// Roll a stale file's per-message map into its totals.
///
/// Bounds the cache (spec, "the contribution map is unbounded as specified;
/// the implementation plan must bound it"). Age, not scan count (§0.3
/// decision 2): with a 5 s poll a session paused for two minutes would compact
/// and then force a full re-read the moment the user typed again. Correctness
/// survives because a compacted file that changes is rescanned from zero, and
/// reappearing dedupe keys only matter in files that grow.
fn compacted(mut record: FileRecord, now_ms: u64) -> FileRecord {
    if record.compacted || now_ms.saturating_sub(record.mtime_ms) <= COMPACT_AFTER_MS {
        return record;
    }
    let entries = std::mem::take(&mut record.entries);
    for contribution in entries.values() {
        add_total(
            &mut record.totals,
            contribution.bucket_start_ms,
            &contribution.model,
            contribution.counters,
        );
    }
    sort_totals(&mut record.totals);
    record.cumulative = None;
    record.compacted = true;
    record
}

/// One transcript file, resumed or rescanned as the scan rules require.
fn scan_file(
    agent: UsageAgent,
    path: &Path,
    previous: Option<&FileRecord>,
    now_ms: u64,
) -> FileScan {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return FileScan::Failed;
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return FileScan::Failed;
    }
    let size = meta.len();
    let mtime = mtime_ms(&meta);

    // Warm path. Nothing about the file moved, so nothing is opened — this is
    // what keeps a 5 s poll over ~2.5 GB of transcripts to one stat per file.
    // The compaction check still runs: a file scanned fresh today only crosses
    // the 48 h line on a later poll where nothing moved.
    if let Some(record) = previous {
        if record.mtime_ms == mtime && record.size == size {
            return FileScan::Updated(compacted(record.clone(), now_ms));
        }
    }

    let Some(identity) = file_identity(path) else {
        return FileScan::Failed;
    };
    // Resume only when the same session is still there, the file has not
    // shrunk, and there is still a contribution map to resume into.
    let resumable = previous
        .filter(|record| record.identity == identity && record.size <= size && !record.compacted);
    let mut record = match resumable {
        Some(record) => FileRecord {
            mtime_ms: mtime,
            size,
            ..record.clone()
        },
        None => FileRecord::empty(agent, identity, mtime, size),
    };

    let Ok(mut file) = std::fs::File::open(path) else {
        return FileScan::Failed;
    };
    if record.offset > 0 {
        use std::io::Seek;
        if file.seek(std::io::SeekFrom::Start(record.offset)).is_err() {
            return FileScan::Failed;
        }
    }
    let mut reader = LineReader::new(file, record.offset);
    loop {
        match reader.next_line() {
            Ok(LineEvent::Line(bytes, offset)) => {
                if ingest(agent, &bytes, &mut record) == LineOutcome::Skipped {
                    record.skipped_lines = record.skipped_lines.saturating_add(1);
                }
                record.offset = offset;
            }
            Ok(LineEvent::Oversized(offset)) => {
                record.skipped_lines = record.skipped_lines.saturating_add(1);
                record.offset = offset;
            }
            Ok(LineEvent::End) => break,
            // A read error mid-file: commit the lines already ingested and let
            // the next scan resume from there rather than losing them.
            Err(_) => break,
        }
    }
    sort_totals(&mut record.totals);
    FileScan::Updated(compacted(record, now_ms))
}

pub(crate) struct ScanOutcome {
    pub(crate) cache: UsageCache,
    /// Whether anything about the contributions moved. The cache file is
    /// rewritten only when this is true — an unchanged poll does no
    /// serialization at all.
    pub(crate) changed: bool,
    pub(crate) claude: UsageSourceState,
    pub(crate) codex: UsageSourceState,
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Scan every path for one agent into `files`, returning how many were
/// accounted for.
///
/// "Accounted for" means the stat succeeded, not that bytes were read: the
/// warm path opens nothing, and counting content-opens would make every
/// healthy warm poll look unreadable.
fn scan_into(
    agent: UsageAgent,
    paths: &[PathBuf],
    previous: &UsageCache,
    now_ms: u64,
    files: &mut BTreeMap<String, FileRecord>,
) -> u32 {
    let mut accounted: u32 = 0;
    for path in paths {
        let key = path_key(path);
        let prior = previous
            .files
            .get(&key)
            .filter(|record| record.agent == agent);
        match scan_file(agent, path, prior, now_ms) {
            FileScan::Updated(record) => {
                files.insert(key, record);
                accounted = accounted.saturating_add(1);
            }
            FileScan::Failed => {
                if let Some(record) = prior {
                    files.insert(key, record.clone());
                }
            }
        }
    }
    accounted
}

/// Carry every record for one agent across unchanged. Used when a root exists
/// but cannot be listed: the data is still on disk, this scan simply could not
/// look at it.
fn carry_over(previous: &UsageCache, agent: UsageAgent, files: &mut BTreeMap<String, FileRecord>) {
    for (key, record) in &previous.files {
        if record.agent == agent {
            files.insert(key.clone(), record.clone());
        }
    }
}

/// `Ok` unless every candidate failed, which means the root is listable but
/// nothing inside it is.
fn source_state(accounted: u32, candidates: usize) -> UsageSourceState {
    if accounted == 0 && candidates > 0 {
        return UsageSourceState::Unreadable;
    }
    UsageSourceState::Ok
}

/// A whole incremental scan. `home` is injected, so no test reads a real home
/// directory — the `prompt_assets.rs:351` seam.
pub(crate) fn scan_all(previous: &UsageCache, home: &Path, now_ms: u64) -> ScanOutcome {
    let mut files: BTreeMap<String, FileRecord> = BTreeMap::new();

    let claude_found = discover_claude(home);
    let claude = match claude_found.state {
        // The root is gone: so is the data it described.
        DiscoveryState::Missing => UsageSourceState::Missing,
        DiscoveryState::Unreadable => {
            carry_over(previous, UsageAgent::Claude, &mut files);
            UsageSourceState::Unreadable
        }
        DiscoveryState::Present => {
            let accounted = scan_into(
                UsageAgent::Claude,
                &claude_found.files,
                previous,
                now_ms,
                &mut files,
            );
            source_state(accounted, claude_found.files.len())
        }
    };

    let codex_found = discover_codex(home);
    let codex = match codex_found.state {
        DiscoveryState::Missing => UsageSourceState::Missing,
        DiscoveryState::Unreadable => {
            carry_over(previous, UsageAgent::Codex, &mut files);
            UsageSourceState::Unreadable
        }
        DiscoveryState::Present => {
            let mut accounted = scan_into(
                UsageAgent::Codex,
                &codex_found.active,
                previous,
                now_ms,
                &mut files,
            );
            // An archived copy of a session that is still active would be
            // counted twice, so it is dropped rather than scanned.
            let active_ids: std::collections::HashSet<String> = codex_found
                .active
                .iter()
                .filter_map(|path| {
                    files
                        .get(&path_key(path))
                        .map(|record| record.identity.clone())
                })
                .collect();
            let archived: Vec<PathBuf> = codex_found
                .archived
                .into_iter()
                .filter(|path| match cached_identity(path, previous) {
                    Some(identity) => !active_ids.contains(&identity),
                    None => true,
                })
                .collect();
            accounted = accounted.saturating_add(scan_into(
                UsageAgent::Codex,
                &archived,
                previous,
                now_ms,
                &mut files,
            ));
            source_state(
                accounted,
                codex_found.active.len().saturating_add(archived.len()),
            )
        }
    };

    // A fresh map, never an accumulation into the cached one (C1): the whole
    // point of comparing against `previous` is that the previous value is
    // still intact to compare with.
    let changed = files != previous.files;
    ScanOutcome {
        cache: UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        },
        changed,
        claude,
        codex,
    }
}

/// A file's identity, reusing the cached one when the file has not moved.
/// Saves re-reading the head of every archived rollout on every poll.
fn cached_identity(path: &Path, previous: &UsageCache) -> Option<String> {
    if let Some(record) = previous.files.get(&path_key(path)) {
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if record.size == meta.len() && record.mtime_ms == mtime_ms(&meta) {
                return Some(record.identity.clone());
            }
        }
    }
    file_identity(path)
}

/// Every file's contributions merged into one sorted bucket list.
///
/// Two passes on purpose. Claude's live per-message entries are collapsed
/// globally first, so the same message appearing in a resumed or forked
/// session's second file is counted once (spec, blocker B2); the fold into
/// buckets happens afterwards. `files` is a `BTreeMap`, so "last write wins"
/// is decided by path order and the result is deterministic.
///
/// Documented limit: a **compacted** file no longer has per-message entries,
/// so a duplicate shared with a compacted file cannot be collapsed. That is
/// the spec's own reasoning — "reappearing keys only matter in files that
/// grow" — and a compacted file is by definition one that has not.
fn aggregate_buckets(cache: &UsageCache) -> Vec<UsageBucket> {
    let mut claude_entries: BTreeMap<&str, &Contribution> = BTreeMap::new();
    let mut totals: BTreeMap<(u64, UsageAgent, &str), UsageCounters> = BTreeMap::new();
    for record in cache.files.values() {
        for (key, contribution) in &record.entries {
            claude_entries.insert(key.as_str(), contribution);
        }
        for contribution in &record.totals {
            let slot = totals
                .entry((
                    contribution.bucket_start_ms,
                    record.agent,
                    contribution.model.as_str(),
                ))
                .or_default();
            *slot = add_counters(*slot, contribution.counters);
        }
    }
    for contribution in claude_entries.values() {
        let slot = totals
            .entry((
                contribution.bucket_start_ms,
                UsageAgent::Claude,
                contribution.model.as_str(),
            ))
            .or_default();
        *slot = add_counters(*slot, contribution.counters);
    }
    // `BTreeMap` iteration is already (bucket_start_ms, agent, model) order —
    // `UsageAgent` derives `Ord` in declaration order, Claude before Codex.
    totals
        .into_iter()
        .map(|((bucket_start_ms, agent, model), counters)| UsageBucket {
            bucket_start_ms,
            agent,
            model: model.to_string(),
            counters,
        })
        .collect()
}

fn count_files(cache: &UsageCache, agent: UsageAgent) -> u32 {
    let count = cache
        .files
        .values()
        .filter(|record| record.agent == agent)
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

pub(crate) fn build_snapshot(outcome: &ScanOutcome, scanned_at_ms: u64) -> UsageSnapshot {
    UsageSnapshot {
        scanned_at_ms,
        buckets: aggregate_buckets(&outcome.cache),
        sources: vec![
            UsageSource {
                agent: UsageAgent::Claude,
                state: outcome.claude,
                files_scanned: count_files(&outcome.cache, UsageAgent::Claude),
            },
            UsageSource {
                agent: UsageAgent::Codex,
                state: outcome.codex,
                files_scanned: count_files(&outcome.cache, UsageAgent::Codex),
            },
        ],
        // Cumulative across the cache, not per scan: a poll that read nothing
        // must not blank out the "n lines skipped" note the UI is showing.
        skipped_lines: outcome.cache.files.values().fold(0u64, |total, record| {
            total.saturating_add(record.skipped_lines)
        }),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::usage::cache::tests::fixture;
    use crate::usage::cache::{load_cache, write_cache};
    use crate::usage::claude::tests::claude_line;
    use crate::usage::codex::tests::{token_count, turn_context};
    use crate::usage::discover::tests::write_file;
    use crate::usage::reader::MAX_LINE_BYTES;
    use crate::usage::{
        now_ms, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, CLAUDE_SUBAGENTS_DIR, CODEX_ARCHIVED_DIR,
        CODEX_DIR, CODEX_ROLLOUT_PREFIX, CODEX_SESSIONS_DIR, USAGE_CACHE_FILE,
    };

    const DAY_MS: u64 = 24 * 60 * 60 * 1000;

    /// `now` for tests that must not depend on the wall clock. Well inside
    /// `COMPACT_AFTER_MS` of a file written right now, because a fixture file
    /// carries the real current mtime.
    fn scan_now() -> u64 {
        now_ms()
    }

    pub(crate) fn claude_transcript(home: &Path, project: &str, session: &str) -> PathBuf {
        home.join(CLAUDE_DIR)
            .join(CLAUDE_PROJECTS_DIR)
            .join(project)
            .join(format!("{session}.jsonl"))
    }

    fn codex_transcript(home: &Path, name: &str) -> PathBuf {
        home.join(CODEX_DIR)
            .join(CODEX_SESSIONS_DIR)
            .join("2026/08/10")
            .join(format!("{CODEX_ROLLOUT_PREFIX}{name}.jsonl"))
    }

    pub(crate) fn claude_first_line(session: &str) -> String {
        format!("{{\"type\":\"mode\",\"sessionId\":\"{session}\",\"mode\":\"x\"}}\n")
    }

    fn codex_first_line(session: &str) -> String {
        format!(
            "{{\"timestamp\":\"2026-08-10T04:45:41.202Z\",\"type\":\"session_meta\",\
             \"payload\":{{\"id\":\"{session}\",\"session_id\":\"{session}\"}}}}\n"
        )
    }

    pub(crate) fn line(bytes: Vec<u8>) -> String {
        let mut text = String::from_utf8(bytes).unwrap();
        text.push('\n');
        text
    }

    pub(crate) fn append(path: &Path, text: &str) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    fn bucket_of<'a>(
        snapshot: &'a UsageSnapshot,
        agent: UsageAgent,
        model: &str,
    ) -> Option<&'a UsageBucket> {
        snapshot
            .buckets
            .iter()
            .find(|bucket| bucket.agent == agent && bucket.model == model)
    }

    fn snapshot_of(cache: &UsageCache, home: &Path, now: u64) -> (UsageSnapshot, ScanOutcome) {
        let outcome = scan_all(cache, home, now);
        let snapshot = build_snapshot(&outcome, now);
        (snapshot, outcome)
    }

    #[test]
    fn scans_a_fresh_corpus_and_aggregates_both_agents() {
        let home = fixture("scan-fresh");
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
        // A subagent transcript beside it. Subagent files are ~47% of this
        // machine's Claude history by size (spec, blocker B3), so this asserts
        // their usage reaches a bucket, not merely that discovery lists them.
        let subagent = home
            .join(CLAUDE_DIR)
            .join(CLAUDE_PROJECTS_DIR)
            .join("-Users-dev-repo")
            .join("sess-1")
            .join(CLAUDE_SUBAGENTS_DIR)
            .join("agent-a.jsonl");
        write_file(&subagent, &claude_first_line("sess-1"));
        append(
            &subagent,
            &line(claude_line(
                "msg_sub",
                "req_sub",
                "2026-08-10T05:06:00.351Z",
                44,
            )),
        );
        let codex = codex_transcript(&home, "2026-08-10T11-45-40-019fe9fd");
        write_file(&codex, &codex_first_line("019fe9fd"));
        append(
            &codex,
            &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")),
        );
        append(
            &codex,
            &line(token_count(
                "2026-08-10T04:45:59.358Z",
                33_328,
                6_912,
                0,
                587,
            )),
        );

        let (snapshot, outcome) = snapshot_of(&UsageCache::default(), &home, scan_now());
        assert!(outcome.changed);
        assert_eq!(snapshot.skipped_lines, 0);
        assert_eq!(
            snapshot.sources,
            vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Ok,
                    // The session transcript AND its subagent transcript.
                    files_scanned: 2,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Ok,
                    files_scanned: 1,
                },
            ]
        );
        assert_eq!(snapshot.buckets.len(), 2);
        // Sorted by (bucket, agent, model): the Codex bucket at 04:45 comes
        // before the Claude bucket at 05:06.
        assert_eq!(snapshot.buckets[0].bucket_start_ms, 1_786_337_100_000);
        assert_eq!(snapshot.buckets[0].agent, UsageAgent::Codex);
        assert_eq!(snapshot.buckets[1].bucket_start_ms, 1_786_338_000_000);
        assert_eq!(snapshot.buckets[1].agent, UsageAgent::Claude);
        assert_eq!(
            bucket_of(&snapshot, UsageAgent::Claude, "claude-opus-5")
                .unwrap()
                .counters
                .output,
            // 116 from the session transcript + 44 from its subagent.
            160
        );
        assert_eq!(
            bucket_of(&snapshot, UsageAgent::Codex, "gpt-5.6-sol")
                .unwrap()
                .counters
                .cache_read,
            6_912
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_unchanged_second_scan_changes_nothing() {
        let home = fixture("scan-warm");
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

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        assert!(first.changed);
        let second = scan_all(&first.cache, &home, now);
        assert!(
            !second.changed,
            "an unchanged poll must not rewrite the cache"
        );
        assert_eq!(second.cache, first.cache);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn resumes_from_the_committed_offset_when_a_file_grows() {
        let home = fixture("scan-resume");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                10,
            )),
        );
        // A partial trailing line: written, but not terminated.
        let partial = claude_line("msg_2", "req_2", "2026-08-10T05:06:00.351Z", 20);
        append(&claude, &String::from_utf8(partial.clone()).unwrap());

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        let record = first.cache.files.get(&key).unwrap();
        assert_eq!(record.entries.len(), 1, "the partial line is not ingested");
        let committed = record.offset;
        assert_eq!(
            committed as usize,
            claude_first_line("sess-1").len()
                + claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 10).len()
                + 1
        );

        // Finish the line and add one more.
        append(&claude, "\n");
        append(
            &claude,
            &line(claude_line(
                "msg_3",
                "req_3",
                "2026-08-10T05:06:00.351Z",
                30,
            )),
        );
        let second = scan_all(&first.cache, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert!(second.changed);
        assert_eq!(record.entries.len(), 3);
        assert!(record.offset > committed);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rescans_a_shrunken_file_from_zero() {
        let home = fixture("scan-shrink");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        for id in ["msg_1", "msg_2", "msg_3"] {
            append(
                &claude,
                &line(claude_line(id, "req", "2026-08-10T05:06:00.351Z", 10)),
            );
        }
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        assert_eq!(first.cache.files.get(&key).unwrap().entries.len(), 3);

        // Truncated back to the header plus one message.
        let mut shrunk = claude_first_line("sess-1");
        shrunk.push_str(&line(claude_line(
            "msg_1",
            "req",
            "2026-08-10T05:06:00.351Z",
            10,
        )));
        std::fs::write(&claude, &shrunk).unwrap();

        let second = scan_all(&first.cache, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert_eq!(record.offset, shrunk.len() as u64);
        assert_eq!(
            record.entries.len(),
            1,
            "a shrunken file is rescanned from zero, not resumed"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rescans_a_same_size_replacement_caught_by_the_identity_check() {
        let home = fixture("scan-replace");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let original = format!(
            "{}{}",
            claude_first_line("sess-1"),
            line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                10
            ))
        );
        write_file(&claude, &original);
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();

        // A different session of exactly the same byte length. The mtime in
        // the cached record is aged by hand so the test does not depend on
        // filesystem timestamp resolution.
        let replacement = format!(
            "{}{}",
            claude_first_line("sess-2"),
            line(claude_line(
                "msg_9",
                "req_9",
                "2026-08-10T05:06:00.351Z",
                99
            ))
        );
        assert_eq!(replacement.len(), original.len());
        std::fs::write(&claude, &replacement).unwrap();
        let mut aged = first.cache.clone();
        aged.files.get_mut(&key).unwrap().mtime_ms = 1;

        let second = scan_all(&aged, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert_eq!(record.identity, "sess-2");
        assert_eq!(record.entries.len(), 1);
        assert!(record.entries.contains_key("msg_9\u{1}req_9"));
        assert!(!record.entries.contains_key("msg_1\u{1}req_1"));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn drops_the_contributions_of_a_deleted_file() {
        let home = fixture("scan-delete");
        let one = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let two = claude_transcript(&home, "-Users-dev-repo", "sess-2");
        for (path, session, id) in [(&one, "sess-1", "msg_1"), (&two, "sess-2", "msg_2")] {
            write_file(path, &claude_first_line(session));
            append(
                path,
                &line(claude_line(id, "req", "2026-08-10T05:06:00.351Z", 10)),
            );
        }
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        assert_eq!(build_snapshot(&first, now).buckets[0].counters.output, 20);

        std::fs::remove_file(&two).unwrap();
        let second = scan_all(&first.cache, &home, now);
        assert!(second.changed);
        assert_eq!(second.cache.files.len(), 1);
        let snapshot = build_snapshot(&second, now);
        assert_eq!(snapshot.buckets[0].counters.output, 10);
        assert_eq!(snapshot.sources[0].files_scanned, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn keeps_every_record_when_a_root_turns_unreadable() {
        let home = fixture("scan-unreadable");
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
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);

        // Replace the whole projects tree with a regular file.
        let projects = home.join(CLAUDE_DIR).join(CLAUDE_PROJECTS_DIR);
        std::fs::remove_dir_all(&projects).unwrap();
        std::fs::write(&projects, "not a directory").unwrap();

        let second = scan_all(&first.cache, &home, now);
        assert_eq!(second.claude, UsageSourceState::Unreadable);
        assert!(!second.changed, "an unreadable root must not discard data");
        let snapshot = build_snapshot(&second, now);
        assert_eq!(snapshot.buckets[0].counters.output, 116);
        assert_eq!(snapshot.sources[0].state, UsageSourceState::Unreadable);
        assert_eq!(snapshot.sources[0].files_scanned, 1);

        // A root that vanishes entirely is a different story: the data is gone.
        std::fs::remove_file(&projects).unwrap();
        let third = scan_all(&second.cache, &home, now);
        assert_eq!(third.claude, UsageSourceState::Missing);
        assert!(third.cache.files.is_empty());
        assert!(build_snapshot(&third, now).buckets.is_empty());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn compacts_a_stale_file_and_rescans_it_from_zero_when_it_regrows() {
        let home = fixture("scan-compact");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                10,
            )),
        );
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        assert!(!first.cache.files.get(&key).unwrap().compacted);

        // Three days later, nothing about the file has moved.
        let later = now + 3 * DAY_MS;
        let second = scan_all(&first.cache, &home, later);
        let record = second.cache.files.get(&key).unwrap();
        assert!(second.changed, "compaction is itself a cache change");
        assert!(record.compacted);
        assert!(record.entries.is_empty());
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 10);
        // The numbers the UI sees are unchanged by compaction.
        assert_eq!(
            build_snapshot(&second, later).buckets[0].counters.output,
            10
        );

        // It grows again: rescanned from zero, and the rebuilt map must not
        // double the contribution that is already in `totals`.
        append(
            &claude,
            &line(claude_line(
                "msg_2",
                "req_2",
                "2026-08-10T05:06:00.351Z",
                20,
            )),
        );
        let third = scan_all(&second.cache, &home, later);
        let record = third.cache.files.get(&key).unwrap();
        assert!(record.compacted, "still older than the compaction window");
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 30);
        assert_eq!(build_snapshot(&third, later).buckets[0].counters.output, 30);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn collapses_a_duplicate_claude_key_across_two_files() {
        let home = fixture("scan-fork");
        // A forked session copies the parent's messages into a second file.
        let parent = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let fork = claude_transcript(&home, "-Users-dev-repo", "sess-2");
        let shared = line(claude_line(
            "msg_1",
            "req_1",
            "2026-08-10T05:06:00.351Z",
            116,
        ));
        write_file(&parent, &claude_first_line("sess-1"));
        append(&parent, &shared);
        write_file(&fork, &claude_first_line("sess-2"));
        append(&fork, &shared);

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.sources[0].files_scanned, 2);
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(
            snapshot.buckets[0].counters.output, 116,
            "the same message in two files is counted once"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn skips_an_archived_rollout_whose_active_copy_still_exists() {
        let home = fixture("scan-archived");
        let active = codex_transcript(&home, "2026-08-10T11-45-40-019fe9fd");
        write_file(&active, &codex_first_line("019fe9fd"));
        append(
            &active,
            &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")),
        );
        append(
            &active,
            &line(token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100)),
        );

        // The same session, also sitting in the flat archived directory.
        let archived = home
            .join(CODEX_DIR)
            .join(CODEX_ARCHIVED_DIR)
            .join("rollout-2026-08-10T11-45-40-019fe9fd.jsonl");
        std::fs::create_dir_all(archived.parent().unwrap()).unwrap();
        std::fs::copy(&active, &archived).unwrap();

        // And one archived session with no active copy, which must be kept.
        let orphan = home
            .join(CODEX_DIR)
            .join(CODEX_ARCHIVED_DIR)
            .join("rollout-2026-04-27T12-16-52-019dcd5e.jsonl");
        write_file(&orphan, &codex_first_line("019dcd5e"));
        append(
            &orphan,
            &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")),
        );
        append(
            &orphan,
            &line(token_count("2026-08-10T04:45:59.358Z", 500, 0, 0, 50)),
        );

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.sources[1].files_scanned, 2);
        assert!(!outcome
            .cache
            .files
            .contains_key(&archived.to_string_lossy().into_owned()));
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(
            snapshot.buckets[0].counters.output, 150,
            "the archived duplicate must not be counted a second time"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn counts_a_malformed_and_an_oversized_line_and_keeps_reading() {
        let home = fixture("scan-skipped");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(&claude, "{ not json at all\n");
        append(&claude, "\n");
        append(
            &claude,
            &line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                116,
            )),
        );

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&first, now);
        assert_eq!(
            snapshot.skipped_lines, 1,
            "the blank line is ignored, not skipped"
        );
        assert_eq!(snapshot.buckets[0].counters.output, 116);

        // The count is cumulative: a poll that read nothing keeps it.
        let second = scan_all(&first.cache, &home, now);
        assert_eq!(build_snapshot(&second, now).skipped_lines, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_oversized_line_is_skipped_and_the_following_line_still_parses() {
        let home = fixture("scan-oversized");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        // One line past MAX_LINE_BYTES. Built as a JSON string so the file is
        // shaped like a real transcript, and written once so the test stays
        // under a second.
        let huge = format!(
            "{{\"type\":\"user\",\"text\":\"{}\"}}\n",
            "x".repeat(MAX_LINE_BYTES)
        );
        append(&claude, &huge);
        append(
            &claude,
            &line(claude_line(
                "msg_1",
                "req_1",
                "2026-08-10T05:06:00.351Z",
                116,
            )),
        );

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.skipped_lines, 1);
        assert_eq!(snapshot.buckets[0].counters.output, 116);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_cache_version_mismatch_discards_and_rescans_the_whole_corpus() {
        let home = fixture("scan-version");
        let dir = fixture("scan-version-cache");
        let cache_path = dir.join(USAGE_CACHE_FILE);
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

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        write_cache(&cache_path, &first.cache).unwrap();

        // Rewrite the file on disk with a version this build cannot read.
        let stale = UsageCache {
            cache_version: USAGE_CACHE_VERSION + 1,
            files: first.cache.files.clone(),
        };
        write_cache(&cache_path, &stale).unwrap();
        let reloaded = load_cache(Some(&cache_path));
        assert!(reloaded.files.is_empty());

        // The rescan from the discarded cache reproduces the same numbers.
        let second = scan_all(&reloaded, &home, now);
        assert_eq!(second.cache.files, first.cache.files);
        assert!(second.changed);

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
