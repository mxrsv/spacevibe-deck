//! Codex rollout ingestion, and the dispatcher that routes one line to its
//! agent's parser.

use super::claude::{add_total, ingest_claude_line, sort_totals, u64_field, LineOutcome};
use super::reader::parse_rfc3339_ms;
use super::{
    bucket_start, CodexTotals, Contribution, FileRecord, UsageAgent, UsageCounters,
    CODEX_EVENT_TYPE, CODEX_TOKEN_COUNT_TYPE, CODEX_TURN_CONTEXT_TYPE, UNKNOWN_MODEL,
};

/// Re-attribute a file's unattributed roll-ups to the first model it declares.
///
/// A rollout's `token_count` events do not have to wait for its first
/// `turn_context`: two real files on the dev machine emit them at lines 4, 5, 7
/// and 8 and only name a model further down. "The most recent preceding
/// `turn_context`" has nothing to look back at there, so those deltas landed on
/// `UNKNOWN_MODEL` — 6 179 898 tokens, unpriced, which blanked the Codex dollar
/// column entirely.
///
/// `turn_context` is written per turn, so the first one names the model the
/// session started with, which is the right answer for everything ahead of it.
/// Only the attribution moves: each delta keeps its value and its bucket.
fn backfill_unknown_model(totals: &mut Vec<Contribution>, model: &str) {
    if !totals.iter().any(|entry| entry.model == UNKNOWN_MODEL) {
        return;
    }
    // A fresh vector rather than an in-place rewrite (C1), and through
    // `add_total` so a back-filled bucket merges with an existing one for the
    // same model instead of becoming a second entry.
    for entry in std::mem::take(totals) {
        let target = if entry.model == UNKNOWN_MODEL {
            model
        } else {
            entry.model.as_str()
        };
        add_total(totals, entry.bucket_start_ms, target, entry.counters);
    }
    sort_totals(totals);
}

/// One line of a Codex rollout.
///
/// `token_count` events carry **cumulative** totals for the whole session, so
/// each one contributes `max(0, cumulative - previous)` per counter, attributed
/// to the event's own timestamp and to the model from the most recent
/// `turn_context`. Last-snapshot ingestion is wrong here: real sessions carry
/// hundreds of snapshots, span multiple UTC days and switch models mid-session
/// (spec, blocker B1).
fn ingest_codex_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return LineOutcome::Skipped;
    };
    let kind = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let Some(payload) = value.get("payload") else {
        return LineOutcome::Ignored;
    };
    if kind == CODEX_TURN_CONTEXT_TYPE {
        if let Some(model) = payload.get("model").and_then(serde_json::Value::as_str) {
            // Only the FIRST declaration back-fills. On a resumed scan
            // `last_model` is already restored from the cache, so the window an
            // earlier scan resolved is never revisited and a mid-file model
            // switch cannot drag it along.
            if record.last_model.is_none() {
                backfill_unknown_model(&mut record.totals, model);
            }
            record.last_model = Some(model.to_string());
        }
        return LineOutcome::Ignored;
    }
    if kind != CODEX_EVENT_TYPE
        || payload.get("type").and_then(serde_json::Value::as_str) != Some(CODEX_TOKEN_COUNT_TYPE)
    {
        return LineOutcome::Ignored;
    }
    // §0.4 erratum 1: `payload.info.total_token_usage`, NOT
    // `payload.total_token_usage`. Reading the shallow path finds nothing and
    // reports zero Codex usage while looking perfectly healthy.
    let Some(totals) = payload
        .get("info")
        .and_then(|info| info.get("total_token_usage"))
    else {
        return LineOutcome::Skipped;
    };
    let Some(bucket_start_ms) = value
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_rfc3339_ms)
        .map(bucket_start)
    else {
        return LineOutcome::Skipped;
    };
    let seen = CodexTotals {
        input_tokens: u64_field(totals, "input_tokens"),
        cached_input_tokens: u64_field(totals, "cached_input_tokens"),
        cache_write_input_tokens: u64_field(totals, "cache_write_input_tokens"),
        output_tokens: u64_field(totals, "output_tokens"),
    };
    let previous = record.cumulative.unwrap_or_default();
    let delta = CodexTotals {
        input_tokens: seen.input_tokens.saturating_sub(previous.input_tokens),
        cached_input_tokens: seen
            .cached_input_tokens
            .saturating_sub(previous.cached_input_tokens),
        cache_write_input_tokens: seen
            .cache_write_input_tokens
            .saturating_sub(previous.cache_write_input_tokens),
        output_tokens: seen.output_tokens.saturating_sub(previous.output_tokens),
    };
    // High-water mark, not last-seen. A resumed or forked session replays
    // inherited totals; storing the lower number would turn the later climb
    // back to the old high into tokens nobody spent.
    record.cumulative = Some(CodexTotals {
        input_tokens: previous.input_tokens.max(seen.input_tokens),
        cached_input_tokens: previous.cached_input_tokens.max(seen.cached_input_tokens),
        cache_write_input_tokens: previous
            .cache_write_input_tokens
            .max(seen.cache_write_input_tokens),
        output_tokens: previous.output_tokens.max(seen.output_tokens),
    });
    let counters = UsageCounters {
        // `cached_input_tokens` is a SUBSET of `input_tokens` (spec, blocker
        // B4), so the uncached part is the difference, never the whole input.
        input_uncached: delta.input_tokens.saturating_sub(delta.cached_input_tokens),
        cache_read: delta.cached_input_tokens,
        // Codex has no 5m/1h tier split; its cache writes are one counter.
        cache_create_5m: 0,
        cache_create_1h: 0,
        cache_write: delta.cache_write_input_tokens,
        // Already includes reasoning tokens; adding
        // `reasoning_output_tokens` would double-count them.
        output: delta.output_tokens,
    };
    if counters == UsageCounters::default() {
        // A non-advancing or regressing total contributes nothing.
        return LineOutcome::Ignored;
    }
    let model = record
        .last_model
        .clone()
        .unwrap_or_else(|| UNKNOWN_MODEL.to_string());
    add_total(&mut record.totals, bucket_start_ms, &model, counters);
    LineOutcome::Counted
}

/// Route one line to its agent's parser.
///
/// A blank line is ignored before either parser sees it: a trailing newline at
/// the end of every transcript must not inflate the "n lines skipped" note the
/// UI shows.
pub(crate) fn ingest(agent: UsageAgent, bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return LineOutcome::Ignored;
    }
    match agent {
        UsageAgent::Claude => ingest_claude_line(bytes, record),
        UsageAgent::Codex => ingest_codex_line(bytes, record),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::usage::claude::sort_totals;
    use crate::usage::claude::tests::claude_record;

    pub(crate) fn codex_record() -> FileRecord {
        FileRecord::empty(UsageAgent::Codex, "019fe9fd".into(), 0, 0)
    }

    pub(crate) fn turn_context(timestamp: &str, model: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": { "model": model, "cwd": "/tmp", "effort": "high" },
        }))
        .unwrap()
    }

    /// The exact envelope observed in
    /// `rollout-2026-08-10T11-45-40-019fe9fd-9d9e-7b30-be60-3ac6783e56f0.jsonl`:
    /// totals nested under `payload.info`, with `rate_limits` alongside.
    pub(crate) fn token_count(
        timestamp: &str,
        input: u64,
        cached: u64,
        cache_write: u64,
        output: u64,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": input,
                        "cached_input_tokens": cached,
                        "cache_write_input_tokens": cache_write,
                        "output_tokens": output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": input + output,
                    },
                    "model_context_window": 258_400,
                },
                "rate_limits": { "limit_id": "codex" },
            },
        }))
        .unwrap()
    }

    #[test]
    fn codex_reads_the_cumulative_totals_from_payload_info() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"),
            &mut record,
        );
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:45:59.358Z", 33_328, 6_912, 0, 587),
                &mut record
            ),
            LineOutcome::Counted
        ));
        assert_eq!(record.totals.len(), 1);
        let entry = &record.totals[0];
        assert_eq!(entry.bucket_start_ms, 1_786_337_100_000);
        assert_eq!(entry.model, "gpt-5.6-sol");
        // cached_input_tokens is a SUBSET of input_tokens (spec, blocker B4).
        assert_eq!(entry.counters.input_uncached, 33_328 - 6_912);
        assert_eq!(entry.counters.cache_read, 6_912);
        assert_eq!(entry.counters.cache_write, 0);
        assert_eq!(entry.counters.output, 587);
        assert_eq!(entry.counters.cache_create_5m, 0);
        assert_eq!(entry.counters.cache_create_1h, 0);
    }

    /// §0.4 erratum 2: `payload.info.last_token_usage` exists and equals the
    /// per-event delta. It is never the ingestion path — it does not survive an
    /// offset resume — but it is a free oracle for the delta arithmetic.
    #[test]
    fn codex_deltas_agree_with_the_observed_last_token_usage() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 33_328, 6_912, 0, 587),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 74_619, 39_424, 0, 1_226),
            &mut record,
        );
        // Real file, event 2: last_token_usage = input 41291, cached 32512,
        // cache_write 0, output 639.
        assert_eq!(record.totals.len(), 1);
        let counters = record.totals[0].counters;
        assert_eq!(counters.cache_read, 6_912 + 32_512);
        assert_eq!(
            counters.input_uncached,
            (33_328 - 6_912) + (41_291 - 32_512)
        );
        assert_eq!(counters.output, 587 + 639);
    }

    #[test]
    fn codex_attributes_deltas_to_the_model_in_effect_at_the_time() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100),
            &mut record,
        );
        ingest_codex_line(
            &turn_context("2026-08-10T04:46:00.000Z", "gpt-5.6-mini"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 1_500, 0, 0, 160),
            &mut record,
        );
        sort_totals(&mut record.totals);
        assert_eq!(record.totals.len(), 2);
        // Same 15-minute bucket, two models, split by the turn_context switch.
        assert_eq!(record.totals[0].model, "gpt-5.6-mini");
        assert_eq!(record.totals[0].counters.input_uncached, 500);
        assert_eq!(record.totals[0].counters.output, 60);
        assert_eq!(record.totals[1].model, "gpt-5.6-sol");
        assert_eq!(record.totals[1].counters.input_uncached, 1_000);
        assert_eq!(record.totals[1].counters.output, 100);
    }

    #[test]
    fn codex_splits_one_session_across_a_utc_day_boundary() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T23:00:00.000Z", "gpt-5.6-sol"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T23:59:59.999Z", 1_000, 0, 0, 10),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-11T00:00:00.000Z", 3_000, 0, 0, 30),
            &mut record,
        );
        sort_totals(&mut record.totals);
        assert_eq!(record.totals.len(), 2);
        assert_eq!(record.totals[0].bucket_start_ms, 1_786_405_500_000);
        assert_eq!(record.totals[0].counters.input_uncached, 1_000);
        assert_eq!(record.totals[1].bucket_start_ms, 1_786_406_400_000);
        assert_eq!(record.totals[1].counters.input_uncached, 2_000);
    }

    #[test]
    fn codex_never_lowers_its_high_water_mark() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"),
            &mut record,
        );
        // 100 -> 50 -> 120 must contribute 100 then nothing then 20.
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 0),
            &mut record,
        );
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:46:13.066Z", 50, 0, 0, 0),
                &mut record
            ),
            LineOutcome::Ignored
        ));
        ingest_codex_line(
            &token_count("2026-08-10T04:46:25.314Z", 120, 0, 0, 0),
            &mut record,
        );
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.input_uncached, 120);
        assert_eq!(
            record.cumulative.unwrap().input_tokens,
            120,
            "the stored total is the high-water mark, not the last value seen"
        );
    }

    #[test]
    fn codex_ignores_a_repeated_identical_total() {
        let mut record = codex_record();
        ingest_codex_line(
            &turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 10),
            &mut record,
        );
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:46:13.066Z", 100, 0, 0, 10),
                &mut record
            ),
            LineOutcome::Ignored
        ));
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 10);
    }

    /// Two real rollouts on the dev machine
    /// (`rollout-2026-08-04T12-12-{08,17}-019fcb2f-…`) open with `token_count`
    /// events at lines 4, 5, 7, 8 and only declare a model further down. Before
    /// back-fill those two files alone put 6 179 898 tokens on `unknown`, which
    /// blanked the whole Codex dollar column (§0.3 decision 8, "null wins").
    #[test]
    fn codex_backfills_a_token_count_that_precedes_the_first_turn_context() {
        let mut record = codex_record();
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 1_500, 0, 0, 160),
            &mut record,
        );
        assert_eq!(
            record.totals[0].model, UNKNOWN_MODEL,
            "unattributed while the file has declared no model"
        );

        ingest_codex_line(
            &turn_context("2026-08-10T04:46:20.000Z", "gpt-5.6-sol"),
            &mut record,
        );
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].model, "gpt-5.6-sol");
        // Back-fill moves the attribution and nothing else: the deltas and the
        // bucket they landed in are untouched.
        assert_eq!(record.totals[0].bucket_start_ms, 1_786_337_100_000);
        assert_eq!(record.totals[0].counters.input_uncached, 1_500);
        assert_eq!(record.totals[0].counters.output, 160);
    }

    #[test]
    fn codex_backfills_only_to_the_first_turn_context_model() {
        let mut record = codex_record();
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100),
            &mut record,
        );
        ingest_codex_line(
            &turn_context("2026-08-10T04:46:00.000Z", "gpt-5.6-sol"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 1_500, 0, 0, 160),
            &mut record,
        );
        // A later switch must not drag the back-filled window along with it.
        ingest_codex_line(
            &turn_context("2026-08-10T04:46:20.000Z", "gpt-5.6-mini"),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:25.314Z", 1_800, 0, 0, 200),
            &mut record,
        );
        sort_totals(&mut record.totals);
        assert_eq!(record.totals.len(), 2);
        assert_eq!(record.totals[0].model, "gpt-5.6-mini");
        assert_eq!(record.totals[0].counters.input_uncached, 300);
        assert_eq!(record.totals[0].counters.output, 40);
        assert_eq!(record.totals[1].model, "gpt-5.6-sol");
        assert_eq!(record.totals[1].counters.input_uncached, 1_500);
        assert_eq!(record.totals[1].counters.output, 160);
        assert!(record
            .totals
            .iter()
            .all(|entry| entry.model != UNKNOWN_MODEL));
    }

    #[test]
    fn codex_attributes_to_the_unknown_model_before_any_turn_context() {
        let mut record = codex_record();
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 10),
            &mut record,
        );
        // Still the last resort: this file declares no model at all, so there
        // is nothing for the back-fill above to resolve it to.
        assert_eq!(record.totals[0].model, UNKNOWN_MODEL);
    }

    #[test]
    fn codex_skips_a_token_count_it_cannot_read() {
        let mut record = codex_record();
        assert!(matches!(
            ingest_codex_line(b"{ not json", &mut record),
            LineOutcome::Skipped
        ));
        let no_info = serde_json::to_vec(&serde_json::json!({
            "timestamp": "2026-08-10T04:45:59.358Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "rate_limits": {} },
        }))
        .unwrap();
        assert!(matches!(
            ingest_codex_line(&no_info, &mut record),
            LineOutcome::Skipped
        ));
        // The spec's shallow path must NOT be read (§0.4 erratum 1).
        let shallow = serde_json::to_vec(&serde_json::json!({
            "timestamp": "2026-08-10T04:45:59.358Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "total_token_usage": { "input_tokens": 999 },
            },
        }))
        .unwrap();
        assert!(matches!(
            ingest_codex_line(&shallow, &mut record),
            LineOutcome::Skipped
        ));
        assert!(record.totals.is_empty());
    }

    #[test]
    fn codex_ignores_the_events_that_are_not_token_counts() {
        let mut record = codex_record();
        for line in [
            serde_json::to_vec(&serde_json::json!({
                "timestamp": "2026-08-10T04:45:41.202Z",
                "type": "session_meta",
                "payload": { "id": "019fe9fd", "session_id": "019fe9fd" },
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({
                "timestamp": "2026-08-10T04:45:50.000Z",
                "type": "event_msg",
                "payload": { "type": "agent_message", "message": "hi" },
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({ "type": "response_item" })).unwrap(),
        ] {
            assert!(matches!(
                ingest_codex_line(&line, &mut record),
                LineOutcome::Ignored
            ));
        }
        assert!(record.totals.is_empty());
    }

    #[test]
    fn a_blank_line_is_ignored_by_either_agent() {
        let mut claude = claude_record();
        let mut codex = codex_record();
        for bytes in [b"".as_slice(), b"   ", b"\t"] {
            assert!(matches!(
                ingest(UsageAgent::Claude, bytes, &mut claude),
                LineOutcome::Ignored
            ));
            assert!(matches!(
                ingest(UsageAgent::Codex, bytes, &mut codex),
                LineOutcome::Ignored
            ));
        }
    }
}
