//! Claude Code transcript ingestion, plus the small pieces both agents share:
//! the per-line outcome, the numeric field reader and the per-`{bucket, model}`
//! roll-up.

use super::reader::parse_rfc3339_ms;
use super::{
    add_counters, bucket_start, Contribution, FileRecord, UsageCounters, CLAUDE_ASSISTANT_TYPE,
    CLAUDE_TIER_1H, CLAUDE_TIER_5M, DEDUPE_SEPARATOR, UNKNOWN_MODEL,
};

/// What one parsed line did to a file record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LineOutcome {
    /// Usage was recorded.
    Counted,
    /// A well-formed line that carries no usage. Not an error, not counted.
    Ignored,
    /// Unparseable, or usage that cannot be attributed. Counted for the UI.
    Skipped,
}

/// A numeric field, defaulting to zero. Missing counters are genuinely zero in
/// both formats — an absent `cache_write_input_tokens` means none were written.
pub(crate) fn u64_field(node: &serde_json::Value, key: &str) -> u64 {
    node.get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}

/// Add `counters` into the `{bucket, model}` slot, creating it if new.
///
/// A linear scan on purpose: one file holds a handful of buckets per hour of
/// work, and a map here would have to be re-sorted into a `Vec` for the cache
/// anyway.
pub(crate) fn add_total(
    totals: &mut Vec<Contribution>,
    bucket_start_ms: u64,
    model: &str,
    counters: UsageCounters,
) {
    if let Some(slot) = totals
        .iter_mut()
        .find(|entry| entry.bucket_start_ms == bucket_start_ms && entry.model == model)
    {
        slot.counters = add_counters(slot.counters, counters);
        return;
    }
    totals.push(Contribution {
        bucket_start_ms,
        model: model.to_string(),
        counters,
    });
}

/// Deterministic order, so the serialized cache does not churn between scans
/// that produced identical numbers.
pub(crate) fn sort_totals(totals: &mut [Contribution]) {
    totals.sort_by(|left, right| {
        left.bucket_start_ms
            .cmp(&right.bucket_start_ms)
            .then_with(|| left.model.cmp(&right.model))
    });
}

/// The cache-creation tier split, with ccusage's documented fallback.
///
/// When `cache_creation` is present it is authoritative and the flat
/// `cache_creation_input_tokens` is ignored — adding both would double-count
/// every cache write. When it is absent, everything falls into the 5-minute
/// tier, which is the cheaper of the two and therefore the conservative guess.
fn claude_cache_creation(usage: &serde_json::Value) -> (u64, u64) {
    if let Some(split) = usage.get("cache_creation") {
        if split.get(CLAUDE_TIER_5M).is_some() || split.get(CLAUDE_TIER_1H).is_some() {
            return (
                u64_field(split, CLAUDE_TIER_5M),
                u64_field(split, CLAUDE_TIER_1H),
            );
        }
    }
    (u64_field(usage, "cache_creation_input_tokens"), 0)
}

/// One line of a Claude Code transcript.
///
/// Only the top-level counters of `message.usage` are read. `usage.iterations`
/// repeats the same counters once per inference iteration (§0.4 erratum 4);
/// summing it would roughly double every number on multi-iteration turns.
pub(crate) fn ingest_claude_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return LineOutcome::Skipped;
    };
    if value.get("type").and_then(serde_json::Value::as_str) != Some(CLAUDE_ASSISTANT_TYPE) {
        return LineOutcome::Ignored;
    }
    let Some(usage) = value
        .get("message")
        .and_then(|message| message.get("usage"))
    else {
        return LineOutcome::Ignored;
    };
    let message = value.get("message").expect("checked just above");
    let Some(bucket_start_ms) = value
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_rfc3339_ms)
        .map(bucket_start)
    else {
        return LineOutcome::Skipped;
    };
    let message_id = message
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let request_id = value
        .get("requestId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if message_id.is_empty() && request_id.is_empty() {
        // With neither id every such line collapses onto one key and the last
        // write silently discards all the others.
        return LineOutcome::Skipped;
    }
    let model = message
        .get("model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(UNKNOWN_MODEL)
        .to_string();
    let (cache_create_5m, cache_create_1h) = claude_cache_creation(usage);
    let counters = UsageCounters {
        input_uncached: u64_field(usage, "input_tokens"),
        cache_read: u64_field(usage, "cache_read_input_tokens"),
        cache_create_5m,
        cache_create_1h,
        // Claude has no equivalent of Codex's separate cache-write counter.
        cache_write: 0,
        output: u64_field(usage, "output_tokens"),
    };
    // Last entry wins: streaming writes several growing snapshots of the same
    // response, so a re-seen key REPLACES its contribution rather than adding a
    // second one (spec, blocker B2). Summing overcounts roughly 2x.
    record.entries.insert(
        format!("{message_id}{DEDUPE_SEPARATOR}{request_id}"),
        Contribution {
            bucket_start_ms,
            model,
            counters,
        },
    );
    LineOutcome::Counted
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::usage::UsageAgent;

    pub(crate) fn claude_record() -> FileRecord {
        FileRecord::empty(UsageAgent::Claude, "sess-1".into(), 0, 0)
    }

    /// One assistant line in the exact shape verified on disk 2026-08-10,
    /// including the `iterations` array that must NOT be summed (§0.4
    /// erratum 4) and the `server_tool_use` / `service_tier` noise.
    pub(crate) fn claude_line(
        message_id: &str,
        request_id: &str,
        timestamp: &str,
        output: u64,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": timestamp,
            "requestId": request_id,
            "sessionId": "sess-1",
            "message": {
                "id": message_id,
                "role": "assistant",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_creation_input_tokens": 44_316,
                    "cache_read_input_tokens": 23_190,
                    "output_tokens": output,
                    "service_tier": "standard",
                    "server_tool_use": { "web_search_requests": 0 },
                    "cache_creation": {
                        "ephemeral_1h_input_tokens": 44_316,
                        "ephemeral_5m_input_tokens": 0,
                    },
                    "iterations": [
                        {
                            "input_tokens": 2,
                            "cache_read_input_tokens": 23_190,
                            "output_tokens": output,
                        },
                    ],
                },
            },
        }))
        .unwrap()
    }

    #[test]
    fn claude_dedupe_keeps_the_last_of_several_growing_snapshots() {
        let mut record = claude_record();
        // Streaming writes the same response three times, each larger.
        for output in [10u64, 60, 116] {
            assert!(matches!(
                ingest_claude_line(
                    &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", output),
                    &mut record
                ),
                LineOutcome::Counted
            ));
        }
        assert_eq!(record.entries.len(), 1);
        let contribution = record.entries.get("msg_1\u{1}req_1").unwrap();
        // Last wins: summing would give 186, keeping the first would give 10.
        assert_eq!(contribution.counters.output, 116);
        assert_eq!(contribution.bucket_start_ms, 1_786_338_000_000);
        assert_eq!(contribution.model, "claude-opus-5");
    }

    #[test]
    fn claude_keys_on_both_the_message_id_and_the_request_id() {
        let mut record = claude_record();
        ingest_claude_line(
            &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 1),
            &mut record,
        );
        // Same message id, different request: a retried request is separate work.
        ingest_claude_line(
            &claude_line("msg_1", "req_2", "2026-08-10T05:06:00.351Z", 2),
            &mut record,
        );
        assert_eq!(record.entries.len(), 2);
        // 3 of 6941 real assistant lines carry no requestId; the id alone
        // still keys them, it does not skip them.
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "message": {
                "id": "msg_3",
                "model": "<synthetic>",
                "usage": { "input_tokens": 5, "output_tokens": 6 },
            },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&line, &mut record),
            LineOutcome::Counted
        ));
        assert_eq!(
            record.entries.get("msg_3\u{1}").unwrap().model,
            "<synthetic>"
        );
    }

    #[test]
    fn claude_reads_the_five_minute_and_one_hour_cache_tiers_separately() {
        let mut record = claude_record();
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "requestId": "req_1",
            "message": {
                "id": "msg_1",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_read_input_tokens": 23_190,
                    "cache_creation_input_tokens": 44_316,
                    "output_tokens": 116,
                    "cache_creation": {
                        "ephemeral_5m_input_tokens": 300,
                        "ephemeral_1h_input_tokens": 44_016,
                    },
                },
            },
        }))
        .unwrap();
        ingest_claude_line(&line, &mut record);
        let counters = record.entries.values().next().unwrap().counters;
        assert_eq!(counters.input_uncached, 2);
        assert_eq!(counters.cache_read, 23_190);
        assert_eq!(counters.cache_create_5m, 300);
        assert_eq!(counters.cache_create_1h, 44_016);
        // The flat total is ignored once the split is present; adding both
        // would double-count the whole cache write.
        assert_eq!(counters.cache_create_5m + counters.cache_create_1h, 44_316);
        assert_eq!(counters.cache_write, 0);
        assert_eq!(counters.output, 116);
    }

    #[test]
    fn claude_falls_back_to_the_five_minute_tier_when_the_split_is_absent() {
        let mut record = claude_record();
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "requestId": "req_1",
            "message": {
                "id": "msg_1",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 44_316,
                    "output_tokens": 116,
                },
            },
        }))
        .unwrap();
        ingest_claude_line(&line, &mut record);
        let counters = record.entries.values().next().unwrap().counters;
        assert_eq!(counters.cache_create_5m, 44_316);
        assert_eq!(counters.cache_create_1h, 0);
    }

    #[test]
    fn claude_ignores_the_iterations_array_entirely() {
        let mut record = claude_record();
        ingest_claude_line(
            &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116),
            &mut record,
        );
        let counters = record.entries.values().next().unwrap().counters;
        // The fixture's single iteration repeats every counter. Summing it in
        // would double input, cache_read and output.
        assert_eq!(counters.input_uncached, 2);
        assert_eq!(counters.cache_read, 23_190);
        assert_eq!(counters.output, 116);
    }

    #[test]
    fn claude_skips_only_what_it_cannot_attribute() {
        let mut record = claude_record();
        assert!(matches!(
            ingest_claude_line(b"{ not json", &mut record),
            LineOutcome::Skipped
        ));
        // Right shape, unparseable timestamp.
        let bad_time = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "yesterday",
            "requestId": "req_1",
            "message": { "id": "msg_1", "usage": { "output_tokens": 1 } },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&bad_time, &mut record),
            LineOutcome::Skipped
        ));
        // Right shape, no ids at all: one key would swallow every such line.
        let no_ids = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "message": { "usage": { "output_tokens": 1 } },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&no_ids, &mut record),
            LineOutcome::Skipped
        ));
        assert!(record.entries.is_empty());
    }

    #[test]
    fn claude_ignores_lines_that_are_simply_not_usage() {
        let mut record = claude_record();
        for line in [
            serde_json::to_vec(&serde_json::json!({
                "type": "user", "sessionId": "sess-1"
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({
                "type": "last-prompt", "sessionId": "sess-1", "leafUuid": "u"
            }))
            .unwrap(),
            // An assistant line from a version that carried no usage block.
            serde_json::to_vec(&serde_json::json!({
                "type": "assistant",
                "timestamp": "2026-08-10T05:06:00.351Z",
                "message": { "id": "msg_1", "role": "assistant" },
            }))
            .unwrap(),
        ] {
            assert!(matches!(
                ingest_claude_line(&line, &mut record),
                LineOutcome::Ignored
            ));
        }
        assert!(record.entries.is_empty());
    }

    #[test]
    fn totals_accumulate_per_bucket_and_model_and_sort_stably() {
        let mut totals: Vec<Contribution> = Vec::new();
        let one = UsageCounters {
            output: 1,
            ..UsageCounters::default()
        };
        add_total(&mut totals, 2_000, "b", one);
        add_total(&mut totals, 1_000, "a", one);
        add_total(&mut totals, 1_000, "a", one);
        add_total(&mut totals, 1_000, "b", one);
        sort_totals(&mut totals);
        assert_eq!(totals.len(), 3);
        assert_eq!(
            (totals[0].bucket_start_ms, totals[0].model.as_str()),
            (1_000, "a")
        );
        assert_eq!(totals[0].counters.output, 2);
        assert_eq!(
            (totals[1].bucket_start_ms, totals[1].model.as_str()),
            (1_000, "b")
        );
        assert_eq!(
            (totals[2].bucket_start_ms, totals[2].model.as_str()),
            (2_000, "b")
        );
    }
}
