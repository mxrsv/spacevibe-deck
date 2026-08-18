/**
 * GENERATED FILE — rewritten wholesale by `npm run refresh:pricing`
 * (`scripts/refresh-usage-pricing.mjs`). Do not edit by hand.
 *
 * Data only. The pricing math lives in `usage-pricing.ts`, so a script that
 * overwrites a whole file can never destroy hand-written logic — the same
 * discipline `menu_registry.rs` already uses.
 *
 * USD per token, from LiteLLM's published catalog, filtered to the Anthropic
 * and OpenAI model families the Claude Code and Codex CLIs can emit. These
 * are list prices for direct API use; a subscription user does not pay them,
 * which is why every figure on screen is labelled an estimate and carries
 * `PRICING_SNAPSHOT_DATE`.
 */

export interface ModelPricing {
  /** USD per uncached input token. */
  readonly inputPerToken: number;
  /** USD per output token, reasoning tokens included. */
  readonly outputPerToken: number;
  /** USD per cache-read token; null when the provider publishes no cache rate. */
  readonly cacheReadPerToken: number | null;
  /** USD per cache-write token; null when the provider publishes no cache rate. */
  readonly cacheWritePerToken: number | null;
}

/** Retrieval date of the table below. Shown beside every dollar figure. */
export const PRICING_SNAPSHOT_DATE = '2026-08-10';

/** Where the numbers came from, so a reader can check them. */
export const PRICING_SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Exact model-id match only — no aliasing, no prefix fallback (spec §Pricing). */
export const PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>> = {
  'claude-3-7-sonnet-20250219': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-3-haiku-20240307': {
    inputPerToken: 2.5e-7,
    outputPerToken: 0.00000125,
    cacheReadPerToken: 3e-8,
    cacheWritePerToken: 3e-7,
  },
  'claude-3-opus-20240229': {
    inputPerToken: 0.000015,
    outputPerToken: 0.000075,
    cacheReadPerToken: 0.0000015,
    cacheWritePerToken: 0.00001875,
  },
  'claude-4-opus-20250514': {
    inputPerToken: 0.000015,
    outputPerToken: 0.000075,
    cacheReadPerToken: 0.0000015,
    cacheWritePerToken: 0.00001875,
  },
  'claude-4-sonnet-20250514': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-fable-5': {
    inputPerToken: 0.00001,
    outputPerToken: 0.00005,
    cacheReadPerToken: 0.000001,
    cacheWritePerToken: 0.0000125,
  },
  'claude-haiku-4-5': {
    inputPerToken: 0.000001,
    outputPerToken: 0.000005,
    cacheReadPerToken: 1e-7,
    cacheWritePerToken: 0.00000125,
  },
  'claude-haiku-4-5-20251001': {
    inputPerToken: 0.000001,
    outputPerToken: 0.000005,
    cacheReadPerToken: 1e-7,
    cacheWritePerToken: 0.00000125,
  },
  'claude-opus-4-1': {
    inputPerToken: 0.000015,
    outputPerToken: 0.000075,
    cacheReadPerToken: 0.0000015,
    cacheWritePerToken: 0.00001875,
  },
  'claude-opus-4-1-20250805': {
    inputPerToken: 0.000015,
    outputPerToken: 0.000075,
    cacheReadPerToken: 0.0000015,
    cacheWritePerToken: 0.00001875,
  },
  'claude-opus-4-20250514': {
    inputPerToken: 0.000015,
    outputPerToken: 0.000075,
    cacheReadPerToken: 0.0000015,
    cacheWritePerToken: 0.00001875,
  },
  'claude-opus-4-5': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-5-20251101': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-6': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-6-20260205': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-7': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-7-20260416': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-4-8': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-opus-5': {
    inputPerToken: 0.000005,
    outputPerToken: 0.000025,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'claude-sonnet-4-20250514': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-sonnet-4-5': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-sonnet-4-5-20250929': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-sonnet-4-6': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 3e-7,
    cacheWritePerToken: 0.00000375,
  },
  'claude-sonnet-5': {
    inputPerToken: 0.000002,
    outputPerToken: 0.00001,
    cacheReadPerToken: 2e-7,
    cacheWritePerToken: 0.0000025,
  },
  'codex-mini-latest': {
    inputPerToken: 0.0000015,
    outputPerToken: 0.000006,
    cacheReadPerToken: 3.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-2025-08-07': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-chat': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-chat-latest': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-codex': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-mini': {
    inputPerToken: 2.5e-7,
    outputPerToken: 0.000002,
    cacheReadPerToken: 2.5e-8,
    cacheWritePerToken: null,
  },
  'gpt-5-mini-2025-08-07': {
    inputPerToken: 2.5e-7,
    outputPerToken: 0.000002,
    cacheReadPerToken: 2.5e-8,
    cacheWritePerToken: null,
  },
  'gpt-5-nano': {
    inputPerToken: 5e-8,
    outputPerToken: 4e-7,
    cacheReadPerToken: 5e-9,
    cacheWritePerToken: null,
  },
  'gpt-5-nano-2025-08-07': {
    inputPerToken: 5e-8,
    outputPerToken: 4e-7,
    cacheReadPerToken: 5e-9,
    cacheWritePerToken: null,
  },
  'gpt-5-pro': {
    inputPerToken: 0.000015,
    outputPerToken: 0.00012,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'gpt-5-pro-2025-10-06': {
    inputPerToken: 0.000015,
    outputPerToken: 0.00012,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'gpt-5-search-api': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5-search-api-2025-10-14': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1-2025-11-13': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1-chat-latest': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1-codex': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1-codex-max': {
    inputPerToken: 0.00000125,
    outputPerToken: 0.00001,
    cacheReadPerToken: 1.25e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.1-codex-mini': {
    inputPerToken: 2.5e-7,
    outputPerToken: 0.000002,
    cacheReadPerToken: 2.5e-8,
    cacheWritePerToken: null,
  },
  'gpt-5.2': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.2-2025-12-11': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.2-chat-latest': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.2-codex': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.2-pro': {
    inputPerToken: 0.000021,
    outputPerToken: 0.000168,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'gpt-5.2-pro-2025-12-11': {
    inputPerToken: 0.000021,
    outputPerToken: 0.000168,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'gpt-5.3-chat-latest': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.3-codex': {
    inputPerToken: 0.00000175,
    outputPerToken: 0.000014,
    cacheReadPerToken: 1.75e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.4': {
    inputPerToken: 0.0000025,
    outputPerToken: 0.000015,
    cacheReadPerToken: 2.5e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.4-2026-03-05': {
    inputPerToken: 0.0000025,
    outputPerToken: 0.000015,
    cacheReadPerToken: 2.5e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.4-mini': {
    inputPerToken: 7.5e-7,
    outputPerToken: 0.0000045,
    cacheReadPerToken: 7.5e-8,
    cacheWritePerToken: null,
  },
  'gpt-5.4-mini-2026-03-17': {
    inputPerToken: 7.5e-7,
    outputPerToken: 0.0000045,
    cacheReadPerToken: 7.5e-8,
    cacheWritePerToken: null,
  },
  'gpt-5.4-nano': {
    inputPerToken: 2e-7,
    outputPerToken: 0.00000125,
    cacheReadPerToken: 2e-8,
    cacheWritePerToken: null,
  },
  'gpt-5.4-nano-2026-03-17': {
    inputPerToken: 2e-7,
    outputPerToken: 0.00000125,
    cacheReadPerToken: 2e-8,
    cacheWritePerToken: null,
  },
  'gpt-5.4-pro': {
    inputPerToken: 0.00003,
    outputPerToken: 0.00018,
    cacheReadPerToken: 0.000003,
    cacheWritePerToken: null,
  },
  'gpt-5.4-pro-2026-03-05': {
    inputPerToken: 0.00003,
    outputPerToken: 0.00018,
    cacheReadPerToken: 0.000003,
    cacheWritePerToken: null,
  },
  'gpt-5.5': {
    inputPerToken: 0.000005,
    outputPerToken: 0.00003,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.5-2026-04-23': {
    inputPerToken: 0.000005,
    outputPerToken: 0.00003,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
  'gpt-5.5-pro': {
    inputPerToken: 0.00003,
    outputPerToken: 0.00018,
    cacheReadPerToken: 0.000003,
    cacheWritePerToken: null,
  },
  'gpt-5.5-pro-2026-04-23': {
    inputPerToken: 0.00003,
    outputPerToken: 0.00018,
    cacheReadPerToken: 0.000003,
    cacheWritePerToken: null,
  },
  'gpt-5.6': {
    inputPerToken: 0.000005,
    outputPerToken: 0.00003,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'gpt-5.6-luna': {
    inputPerToken: 2e-7,
    outputPerToken: 0.0000012,
    cacheReadPerToken: 2e-8,
    cacheWritePerToken: 2.5e-7,
  },
  'gpt-5.6-sol': {
    inputPerToken: 0.000005,
    outputPerToken: 0.00003,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: 0.00000625,
  },
  'gpt-5.6-terra': {
    inputPerToken: 0.000002,
    outputPerToken: 0.000012,
    cacheReadPerToken: 2e-7,
    cacheWritePerToken: 0.0000025,
  },
  o1: {
    inputPerToken: 0.000015,
    outputPerToken: 0.00006,
    cacheReadPerToken: 0.0000075,
    cacheWritePerToken: null,
  },
  'o1-2024-12-17': {
    inputPerToken: 0.000015,
    outputPerToken: 0.00006,
    cacheReadPerToken: 0.0000075,
    cacheWritePerToken: null,
  },
  'o1-pro': {
    inputPerToken: 0.00015,
    outputPerToken: 0.0006,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'o1-pro-2025-03-19': {
    inputPerToken: 0.00015,
    outputPerToken: 0.0006,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  o3: {
    inputPerToken: 0.000002,
    outputPerToken: 0.000008,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
  'o3-2025-04-16': {
    inputPerToken: 0.000002,
    outputPerToken: 0.000008,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
  'o3-deep-research': {
    inputPerToken: 0.00001,
    outputPerToken: 0.00004,
    cacheReadPerToken: 0.0000025,
    cacheWritePerToken: null,
  },
  'o3-deep-research-2025-06-26': {
    inputPerToken: 0.00001,
    outputPerToken: 0.00004,
    cacheReadPerToken: 0.0000025,
    cacheWritePerToken: null,
  },
  'o3-mini': {
    inputPerToken: 0.0000011,
    outputPerToken: 0.0000044,
    cacheReadPerToken: 5.5e-7,
    cacheWritePerToken: null,
  },
  'o3-mini-2025-01-31': {
    inputPerToken: 0.0000011,
    outputPerToken: 0.0000044,
    cacheReadPerToken: 5.5e-7,
    cacheWritePerToken: null,
  },
  'o3-pro': {
    inputPerToken: 0.00002,
    outputPerToken: 0.00008,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'o3-pro-2025-06-10': {
    inputPerToken: 0.00002,
    outputPerToken: 0.00008,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
  'o4-mini': {
    inputPerToken: 0.0000011,
    outputPerToken: 0.0000044,
    cacheReadPerToken: 2.75e-7,
    cacheWritePerToken: null,
  },
  'o4-mini-2025-04-16': {
    inputPerToken: 0.0000011,
    outputPerToken: 0.0000044,
    cacheReadPerToken: 2.75e-7,
    cacheWritePerToken: null,
  },
  'o4-mini-deep-research': {
    inputPerToken: 0.000002,
    outputPerToken: 0.000008,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
  'o4-mini-deep-research-2025-06-26': {
    inputPerToken: 0.000002,
    outputPerToken: 0.000008,
    cacheReadPerToken: 5e-7,
    cacheWritePerToken: null,
  },
};
