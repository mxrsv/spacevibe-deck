/**
 * Claude Code transcript ingestion. Port of `src-tauri/src/usage/claude.rs`.
 */
import { parseRfc3339Ms } from './reader';
import {
  CLAUDE_ASSISTANT_TYPE,
  CLAUDE_TIER_1H,
  CLAUDE_TIER_5M,
  DEDUPE_SEPARATOR,
  UNKNOWN_MODEL,
  bucketStart,
  type FileRecord,
  type UsageCounters,
} from './model';

/** What one parsed line did to a file record. */
export type LineOutcome = 'counted' | 'ignored' | 'skipped';

/**
 * A numeric field, defaulting to zero. Missing counters are genuinely zero in
 * both formats — an absent `cache_write_input_tokens` means none were written.
 */
export function u64Field(node: unknown, key: string): number {
  if (node === null || typeof node !== 'object') {
    return 0;
  }
  const value = (node as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(node: unknown, key: string): string | null {
  const object = asObject(node);
  const value = object?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The cache-creation tier split, with ccusage's documented fallback.
 *
 * When `cache_creation` is present it is authoritative and the flat
 * `cache_creation_input_tokens` is ignored — adding both would double-count
 * every cache write. When it is absent, everything falls into the 5-minute
 * tier, the cheaper of the two and therefore the conservative guess.
 */
function claudeCacheCreation(usage: unknown): [number, number] {
  const split = asObject(usage)?.cache_creation;
  const splitObject = asObject(split);
  if (splitObject !== null && (CLAUDE_TIER_5M in splitObject || CLAUDE_TIER_1H in splitObject)) {
    return [u64Field(splitObject, CLAUDE_TIER_5M), u64Field(splitObject, CLAUDE_TIER_1H)];
  }
  return [u64Field(usage, 'cache_creation_input_tokens'), 0];
}

/**
 * One line of a Claude Code transcript.
 *
 * Only the top-level counters of `message.usage` are read: `usage.iterations`
 * repeats the same counters once per inference iteration, and summing it
 * would roughly double every number on multi-iteration turns.
 */
export function ingestClaudeLine(bytes: Buffer, record: FileRecord): LineOutcome {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return 'skipped';
  }
  const line = asObject(value);
  if (line === null || stringField(line, 'type') !== CLAUDE_ASSISTANT_TYPE) {
    return 'ignored';
  }
  const message = asObject(line.message);
  const usage = message === null ? null : asObject(message.usage);
  if (usage === null) {
    return 'ignored';
  }
  const timestamp = stringField(line, 'timestamp');
  const parsedMs = timestamp === null ? null : parseRfc3339Ms(timestamp);
  if (parsedMs === null) {
    return 'skipped';
  }
  const bucketStartMs = bucketStart(parsedMs);
  const messageId = stringField(message, 'id') ?? '';
  const requestId = stringField(line, 'requestId') ?? '';
  if (messageId === '' && requestId === '') {
    // With neither id every such line collapses onto one key and the last
    // write silently discards all the others.
    return 'skipped';
  }
  const model = stringField(message, 'model') ?? UNKNOWN_MODEL;
  const [cacheCreate5m, cacheCreate1h] = claudeCacheCreation(usage);
  const counters: UsageCounters = {
    inputUncached: u64Field(usage, 'input_tokens'),
    cacheRead: u64Field(usage, 'cache_read_input_tokens'),
    cacheCreate5m,
    cacheCreate1h,
    // Claude has no equivalent of Codex's separate cache-write counter.
    cacheWrite: 0,
    output: u64Field(usage, 'output_tokens'),
  };
  // Last entry wins: streaming writes several growing snapshots of the same
  // response, so a re-seen key REPLACES its contribution rather than adding a
  // second one. Summing overcounts roughly 2x.
  record.entries.set(`${messageId}${DEDUPE_SEPARATOR}${requestId}`, {
    bucketStartMs,
    model,
    counters,
  });
  return 'counted';
}
