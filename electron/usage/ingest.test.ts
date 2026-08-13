import { describe, expect, it } from "vitest";
import { ingestClaudeLine } from "./claude";
import { ingest, ingestCodexLine } from "./codex";
import {
  DEDUPE_SEPARATOR,
  UNKNOWN_MODEL,
  emptyRecord,
  type FileRecord,
} from "./model";

/**
 * The two per-agent parsers, mirroring the behaviors the Rust tests pin:
 * Claude's last-wins dedupe and cache-tier split, Codex's cumulative-to-delta
 * conversion, high-water resume, model backfill, and the in-band accounting
 * of malformed lines.
 */

function claudeRecord(): FileRecord {
  return emptyRecord("claude", "sess-1", 0, 0);
}

function codexRecord(): FileRecord {
  return emptyRecord("codex", "codex-sess-1", 0, 0);
}

function claudeLine(
  messageId: string,
  requestId: string,
  timestamp: string,
  output: number,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: "assistant",
      timestamp,
      requestId,
      sessionId: "sess-1",
      message: {
        id: messageId,
        role: "assistant",
        model: "claude-opus-5",
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 44_316,
          cache_read_input_tokens: 23_190,
          output_tokens: output,
          service_tier: "standard",
          cache_creation: {
            ephemeral_1h_input_tokens: 44_316,
            ephemeral_5m_input_tokens: 0,
          },
          // Must NOT be summed — it repeats the top-level counters.
          iterations: [{ input_tokens: 2, output_tokens: output }],
        },
      },
    }),
  );
}

function tokenCount(
  timestamp: string,
  totals: Record<string, number>,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: totals } },
    }),
  );
}

function turnContext(timestamp: string, model: string): Buffer {
  return Buffer.from(
    JSON.stringify({ timestamp, type: "turn_context", payload: { model } }),
  );
}

describe("ingestClaudeLine", () => {
  it("keeps the last of several growing snapshots of the same response", () => {
    const record = claudeRecord();
    for (const output of [10, 60, 116]) {
      expect(
        ingestClaudeLine(
          claudeLine("msg_1", "req_1", "2026-08-10T05:06:00.351Z", output),
          record,
        ),
      ).toBe("counted");
    }
    expect(record.entries.size).toBe(1);
    const contribution = record.entries.get(`msg_1${DEDUPE_SEPARATOR}req_1`)!;
    expect(contribution.counters.output).toBe(116);
    expect(contribution.bucketStartMs).toBe(1_786_338_000_000);
    expect(contribution.model).toBe("claude-opus-5");
  });

  it("keys on both the message id and the request id", () => {
    const record = claudeRecord();
    ingestClaudeLine(
      claudeLine("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 1),
      record,
    );
    ingestClaudeLine(
      claudeLine("msg_1", "req_2", "2026-08-10T05:06:00.351Z", 2),
      record,
    );
    expect(record.entries.size).toBe(2);
  });

  it("reads the five-minute and one-hour cache tiers separately", () => {
    const record = claudeRecord();
    const line = Buffer.from(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-10T05:06:00.351Z",
        requestId: "req_1",
        message: {
          id: "msg_1",
          model: "claude-opus-5",
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 23_190,
            cache_creation_input_tokens: 44_316,
            output_tokens: 116,
            cache_creation: {
              ephemeral_5m_input_tokens: 300,
              ephemeral_1h_input_tokens: 44_016,
            },
          },
        },
      }),
    );
    ingestClaudeLine(line, record);
    const counters = [...record.entries.values()][0].counters;
    expect(counters.cacheCreate5m).toBe(300);
    expect(counters.cacheCreate1h).toBe(44_016);
    // The flat total is ignored once the split is present.
    expect(counters.cacheCreate5m + counters.cacheCreate1h).toBe(44_316);
  });

  it("falls back to the five-minute tier when the split is absent", () => {
    const record = claudeRecord();
    const line = Buffer.from(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-10T05:06:00.351Z",
        requestId: "req_1",
        message: {
          id: "msg_1",
          model: "claude-opus-5",
          usage: { cache_creation_input_tokens: 500, output_tokens: 1 },
        },
      }),
    );
    ingestClaudeLine(line, record);
    const counters = [...record.entries.values()][0].counters;
    expect(counters.cacheCreate5m).toBe(500);
    expect(counters.cacheCreate1h).toBe(0);
  });

  it("skips a line with neither id, an unparseable timestamp, or bad JSON", () => {
    const record = claudeRecord();
    const noIds = Buffer.from(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-10T05:06:00.351Z",
        message: { model: "m", usage: { output_tokens: 9 } },
      }),
    );
    expect(ingestClaudeLine(noIds, record)).toBe("skipped");
    expect(
      ingestClaudeLine(
        claudeLine("msg", "req", "2026-08-10T05:06:00+07:00", 1),
        record,
      ),
    ).toBe("skipped");
    expect(ingestClaudeLine(Buffer.from("not json"), record)).toBe("skipped");
    expect(record.entries.size).toBe(0);
  });

  it("ignores non-assistant lines and assistant lines without usage", () => {
    const record = claudeRecord();
    expect(
      ingestClaudeLine(
        Buffer.from(JSON.stringify({ type: "user", message: {} })),
        record,
      ),
    ).toBe("ignored");
    expect(
      ingestClaudeLine(
        Buffer.from(
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-08-10T05:06:00.351Z",
            message: { id: "msg" },
          }),
        ),
        record,
      ),
    ).toBe("ignored");
  });
});

describe("ingestCodexLine", () => {
  it("converts cumulative totals to deltas and treats cached input as a subset", () => {
    const record = codexRecord();
    ingestCodexLine(turnContext("2026-08-10T04:45:00.000Z", "gpt-5-codex"), record);
    ingestCodexLine(
      tokenCount("2026-08-10T04:46:10.000Z", {
        input_tokens: 1000,
        cached_input_tokens: 600,
        cache_write_input_tokens: 50,
        output_tokens: 40,
      }),
      record,
    );
    ingestCodexLine(
      tokenCount("2026-08-10T04:46:20.000Z", {
        input_tokens: 1500,
        cached_input_tokens: 900,
        cache_write_input_tokens: 50,
        output_tokens: 90,
      }),
      record,
    );
    expect(record.totals).toHaveLength(1);
    const counters = record.totals[0].counters;
    // 1500-1000 input, of which 900-600 cached → 200 uncached in the delta,
    // plus the first event's 400.
    expect(counters.inputUncached).toBe(600);
    expect(counters.cacheRead).toBe(900);
    expect(counters.cacheWrite).toBe(50);
    expect(counters.output).toBe(90);
  });

  it("ignores a regressing total and keeps the high-water mark", () => {
    const record = codexRecord();
    ingestCodexLine(turnContext("2026-08-10T04:45:00.000Z", "gpt-5-codex"), record);
    ingestCodexLine(
      tokenCount("2026-08-10T04:50:00.000Z", {
        input_tokens: 2500,
        cached_input_tokens: 1400,
        cache_write_input_tokens: 80,
        output_tokens: 150,
      }),
      record,
    );
    // A replayed lower total contributes nothing…
    expect(
      ingestCodexLine(
        tokenCount("2026-08-10T04:55:00.000Z", {
          input_tokens: 2000,
          cached_input_tokens: 1200,
          cache_write_input_tokens: 70,
          output_tokens: 120,
        }),
        record,
      ),
    ).toBe("ignored");
    // …and the later climb back to the old high is not spent tokens either.
    expect(
      ingestCodexLine(
        tokenCount("2026-08-10T04:58:00.000Z", {
          input_tokens: 2500,
          cached_input_tokens: 1400,
          cache_write_input_tokens: 80,
          output_tokens: 150,
        }),
        record,
      ),
    ).toBe("ignored");
    expect(record.cumulative).toEqual({
      inputTokens: 2500,
      cachedInputTokens: 1400,
      cacheWriteInputTokens: 80,
      outputTokens: 150,
    });
  });

  it("backfills unknown-model deltas from the FIRST turn_context only", () => {
    const record = codexRecord();
    ingestCodexLine(
      tokenCount("2026-08-10T04:46:10.000Z", {
        input_tokens: 1000,
        cached_input_tokens: 600,
        cache_write_input_tokens: 0,
        output_tokens: 40,
      }),
      record,
    );
    expect(record.totals[0].model).toBe(UNKNOWN_MODEL);
    ingestCodexLine(turnContext("2026-08-10T04:46:30.000Z", "gpt-5-codex"), record);
    expect(record.totals[0].model).toBe("gpt-5-codex");
    // A later model switch moves attribution forward, never backward.
    ingestCodexLine(turnContext("2026-08-10T05:01:00.000Z", "gpt-5"), record);
    expect(record.totals[0].model).toBe("gpt-5-codex");
  });

  it("skips a token_count without info and counts it in-band", () => {
    const record = codexRecord();
    expect(
      ingestCodexLine(
        Buffer.from(
          JSON.stringify({
            timestamp: "2026-08-10T05:03:00.000Z",
            type: "event_msg",
            payload: { type: "token_count" },
          }),
        ),
        record,
      ),
    ).toBe("skipped");
  });

  it("preserves an unknown model when no turn_context ever names one", () => {
    const record = codexRecord();
    ingestCodexLine(
      tokenCount("2026-08-10T04:46:10.000Z", {
        input_tokens: 10,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 5,
      }),
      record,
    );
    expect(record.totals[0].model).toBe(UNKNOWN_MODEL);
  });
});

describe("ingest dispatcher", () => {
  it("treats a blank line as ignored for both agents", () => {
    expect(ingest("claude", Buffer.from("   \t"), claudeRecord())).toBe(
      "ignored",
    );
    expect(ingest("codex", Buffer.from(""), codexRecord())).toBe("ignored");
  });
});
