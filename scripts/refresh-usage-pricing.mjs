#!/usr/bin/env node

/**
 * Rewrite `src/lib/usage-pricing-snapshot.ts` from LiteLLM's published price
 * catalog.
 *
 * Run by hand — `npm run refresh:pricing`. NEVER from `predev`, `prebuild` or
 * CI: a build that can reach the network is a build that can change what
 * ships without a code change, and the checked-in snapshot is the only
 * pricing the app ever reads.
 *
 * Nothing is written unless the response parsed, the filter kept a plausible
 * number of models, and every model in `REQUIRED_MODELS` survived. An
 * upstream field rename would otherwise produce a snapshot that parses,
 * typechecks, passes its own tests and silently prices nothing.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const OUTPUT_URL = new URL('../src/lib/usage-pricing-snapshot.ts', import.meta.url);

/**
 * Which catalog entries are worth shipping. Anthropic's whole `claude-*` line
 * is 24 entries, so it is kept whole; OpenAI publishes 219, of which only the
 * GPT-5, o-series and codex families are reachable from the Codex CLI.
 * Matching is by family prefix rather than by the exact ids seen on one
 * machine, because pricing lookup is exact-match only — a model missing from
 * the snapshot shows no dollars at all, and the next CLI release picks a new
 * default model without asking.
 */
const MODEL_SELECTORS = [
  { provider: 'anthropic', pattern: /^claude-/u },
  { provider: 'openai', pattern: /^(?:gpt-5|o[134](?:-|$)|codex-)/u },
];

/**
 * Every model id Claude Code and Codex had actually written into their
 * transcripts on this machine as of 2026-08-10. These must survive the
 * filter; if one stops doing so, the catalog changed shape and a human has to
 * look before anything is written.
 */
const REQUIRED_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'gpt-5.1-codex-mini',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
];

/** 84 models survived on 2026-08-10. Half that means the filter broke. */
const MIN_SELECTED_MODELS = 40;

/** LiteLLM's own schema placeholder, not a model. */
const SCHEMA_SAMPLE_KEY = 'sample_spec';

function finiteRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One catalog entry as `ModelPricing`, or null when it carries no usable
 * input and output rate — a model we cannot price at all is worse in the
 * snapshot than out of it, because presence is what `isPricedModel` reads.
 */
export function toModelPricing(entry) {
  if (entry === null || typeof entry !== 'object') {
    return null;
  }
  const inputPerToken = finiteRate(entry.input_cost_per_token);
  const outputPerToken = finiteRate(entry.output_cost_per_token);
  if (inputPerToken === null || outputPerToken === null) {
    return null;
  }
  return {
    inputPerToken,
    outputPerToken,
    cacheReadPerToken: finiteRate(entry.cache_read_input_token_cost),
    cacheWritePerToken: finiteRate(entry.cache_creation_input_token_cost),
  };
}

function isSelectedId(id, entry) {
  if (entry === null || typeof entry !== 'object') {
    return false;
  }
  return MODEL_SELECTORS.some(
    (selector) => entry.litellm_provider === selector.provider && selector.pattern.test(id),
  );
}

/** The catalog reduced to sorted `[id, ModelPricing]` pairs. */
export function selectModels(catalog) {
  if (catalog === null || typeof catalog !== 'object') {
    throw new Error('Pricing catalog is not a JSON object');
  }
  const selected = [];
  for (const id of Object.keys(catalog).sort()) {
    if (id === SCHEMA_SAMPLE_KEY) {
      continue;
    }
    const entry = catalog[id];
    if (!isSelectedId(id, entry)) {
      continue;
    }
    const pricing = toModelPricing(entry);
    if (pricing !== null) {
      selected.push([id, pricing]);
    }
  }
  return selected;
}

function rate(value) {
  // String() gives the shortest literal that round-trips exactly, so
  // 5e-7 stays 5e-7 and no precision is lost writing it out.
  return value === null ? 'null' : String(value);
}

/** The whole `usage-pricing-snapshot.ts` file, as text. */
export function renderSnapshotModule(models, snapshotDate) {
  const rows = models.map(
    ([id, pricing]) =>
      `  ${JSON.stringify(id)}: { inputPerToken: ${rate(pricing.inputPerToken)}, outputPerToken: ${rate(pricing.outputPerToken)}, cacheReadPerToken: ${rate(pricing.cacheReadPerToken)}, cacheWritePerToken: ${rate(pricing.cacheWritePerToken)} },`,
  );
  return [
    '/**',
    ' * GENERATED FILE — rewritten wholesale by `npm run refresh:pricing`',
    ' * (`scripts/refresh-usage-pricing.mjs`). Do not edit by hand.',
    ' *',
    ' * Data only. The pricing math lives in `usage-pricing.ts`, so a script that',
    ' * overwrites a whole file can never destroy hand-written logic — the same',
    ' * discipline `menu_registry.rs` already uses.',
    ' *',
    " * USD per token, from LiteLLM's published catalog, filtered to the Anthropic",
    ' * and OpenAI model families the Claude Code and Codex CLIs can emit. These',
    ' * are list prices for direct API use; a subscription user does not pay them,',
    ' * which is why every figure on screen is labelled an estimate and carries',
    ' * `PRICING_SNAPSHOT_DATE`.',
    ' */',
    '',
    'export interface ModelPricing {',
    '  /** USD per uncached input token. */',
    '  readonly inputPerToken: number;',
    '  /** USD per output token, reasoning tokens included. */',
    '  readonly outputPerToken: number;',
    '  /** USD per cache-read token; null when the provider publishes no cache rate. */',
    '  readonly cacheReadPerToken: number | null;',
    '  /** USD per cache-write token; null when the provider publishes no cache rate. */',
    '  readonly cacheWritePerToken: number | null;',
    '}',
    '',
    '/** Retrieval date of the table below. Shown beside every dollar figure. */',
    `export const PRICING_SNAPSHOT_DATE = ${JSON.stringify(snapshotDate)};`,
    '',
    '/** Where the numbers came from, so a reader can check them. */',
    'export const PRICING_SOURCE_URL =',
    `  ${JSON.stringify(SOURCE_URL)};`,
    '',
    '/** Exact model-id match only — no aliasing, no prefix fallback (spec §Pricing). */',
    'export const PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>> = {',
    ...rows,
    '};',
    '',
  ].join('\n');
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchCatalog(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(SOURCE_URL);
  } catch (error) {
    throw new Error(`Could not reach the pricing catalog: ${describeError(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Pricing catalog request failed: HTTP ${response.status}`);
  }
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Pricing catalog is not valid JSON: ${describeError(error)}`);
  }
}

function assertUsable(models) {
  if (models.length < MIN_SELECTED_MODELS) {
    throw new Error(
      `Only ${models.length} models survived the filter; expected at least ${MIN_SELECTED_MODELS}`,
    );
  }
  const present = new Set(models.map(([id]) => id));
  const missing = REQUIRED_MODELS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(`Pricing catalog no longer prices: ${missing.join(', ')}`);
  }
}

/**
 * Fetch, filter, validate, then write. `fetchImpl`, `outputPath` and `now`
 * are injectable so the tests cover the whole path without a network call.
 */
export async function refreshPricingSnapshot(options = {}) {
  const { fetchImpl = fetch, outputPath = fileURLToPath(OUTPUT_URL), now = new Date() } = options;
  const catalog = await fetchCatalog(fetchImpl);
  const models = selectModels(catalog);
  assertUsable(models);
  const snapshotDate = now.toISOString().slice(0, 'YYYY-MM-DD'.length);
  writeFileSync(outputPath, renderSnapshotModule(models, snapshotDate), 'utf8');
  return { modelCount: models.length, snapshotDate, outputPath };
}

function summarize(result) {
  return [
    `refresh-usage-pricing: wrote ${result.modelCount} models`,
    `  date:   ${result.snapshotDate}`,
    `  source: ${SOURCE_URL}`,
    `  output: ${result.outputPath}`,
    '',
  ].join('\n');
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.stdout.write(summarize(await refreshPricingSnapshot()));
  } catch (error) {
    process.stderr.write(`refresh-usage-pricing: ${describeError(error)}\n`);
    process.exitCode = 1;
  }
}
