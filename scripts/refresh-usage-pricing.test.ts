import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  refreshPricingSnapshot,
  renderSnapshotModule,
  selectModels,
  toModelPricing,
} from './refresh-usage-pricing.mjs';
import { PRICING_SNAPSHOT, PRICING_SNAPSHOT_DATE } from '../src/lib/usage-pricing-snapshot';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'deck-refresh-pricing-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'usage-pricing-snapshot.ts');
  writeFileSync(path, contents, 'utf8');
  return path;
}

function anthropicEntry(overrides: Record<string, unknown> = {}) {
  return {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_read_input_token_cost: 5e-7,
    cache_creation_input_token_cost: 0.00000625,
    ...overrides,
  };
}

function openaiEntry(overrides: Record<string, unknown> = {}) {
  return {
    litellm_provider: 'openai',
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.00003,
    cache_read_input_token_cost: 5e-7,
    ...overrides,
  };
}

/**
 * The script's own `REQUIRED_MODELS` list, restated. If someone edits that
 * list, this fixture goes stale and every write test below fails loudly —
 * which is the intended forcing function, not an accident.
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

/** A catalog big enough to clear the script's minimum-count floor. */
function usableCatalog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const catalog: Record<string, unknown> = {};
  for (const id of REQUIRED_MODELS) {
    catalog[id] = id.startsWith('claude-') ? anthropicEntry() : openaiEntry();
  }
  for (let index = 0; index < 40; index += 1) {
    catalog[`gpt-5.9-filler-${index}`] = openaiEntry();
  }
  return { ...catalog, ...overrides };
}

function respondWith(catalog: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(catalog),
  });
}

describe('toModelPricing', () => {
  it('maps the four LiteLLM cost keys', () => {
    expect(toModelPricing(anthropicEntry())).toEqual({
      inputPerToken: 0.000005,
      outputPerToken: 0.000025,
      cacheReadPerToken: 5e-7,
      cacheWritePerToken: 0.00000625,
    });
  });

  it('nulls the cache rates the catalog omits', () => {
    expect(toModelPricing(openaiEntry())).toEqual({
      inputPerToken: 0.000005,
      outputPerToken: 0.00003,
      cacheReadPerToken: 5e-7,
      cacheWritePerToken: null,
    });
  });

  it('rejects an entry with no usable input or output rate', () => {
    expect(toModelPricing(anthropicEntry({ input_cost_per_token: undefined }))).toBeNull();
    expect(toModelPricing(anthropicEntry({ output_cost_per_token: 'free' }))).toBeNull();
    expect(toModelPricing(anthropicEntry({ input_cost_per_token: -1 }))).toBeNull();
    expect(toModelPricing(null)).toBeNull();
  });
});

describe('selectModels', () => {
  it('keeps the Anthropic and OpenAI families these CLIs emit, sorted', () => {
    const models = selectModels({
      'gpt-5.6-sol': openaiEntry(),
      'claude-opus-5': anthropicEntry(),
      'o3-mini': openaiEntry(),
      'codex-mini-latest': openaiEntry(),
    });

    expect(models.map(([id]: [string, unknown]) => id)).toEqual([
      'claude-opus-5',
      'codex-mini-latest',
      'gpt-5.6-sol',
      'o3-mini',
    ]);
  });

  it('drops other providers, unrelated ids and the schema sample', () => {
    const models = selectModels({
      'gemini-3-pro': { ...openaiEntry(), litellm_provider: 'vertex_ai' },
      'gpt-4o': openaiEntry(),
      'claude-opus-5': { ...anthropicEntry(), litellm_provider: 'bedrock' },
      sample_spec: openaiEntry(),
      'gpt-5.6-sol': openaiEntry(),
    });

    expect(models.map(([id]: [string, unknown]) => id)).toEqual(['gpt-5.6-sol']);
  });

  it('refuses a catalog that is not a JSON object', () => {
    expect(() => selectModels(null)).toThrow('Pricing catalog is not a JSON object');
  });
});

describe('renderSnapshotModule', () => {
  const module = renderSnapshotModule(
    [
      [
        'claude-opus-5',
        {
          inputPerToken: 0.000005,
          outputPerToken: 0.000025,
          cacheReadPerToken: 5e-7,
          cacheWritePerToken: 0.00000625,
        },
      ],
      [
        'gpt-5.5',
        {
          inputPerToken: 0.000005,
          outputPerToken: 0.00003,
          cacheReadPerToken: 5e-7,
          cacheWritePerToken: null,
        },
      ],
    ],
    '2026-02-03',
  );

  it('marks the file generated and stamps the retrieval date', () => {
    expect(module).toContain('GENERATED FILE');
    expect(module).toContain('export const PRICING_SNAPSHOT_DATE = "2026-02-03";');
  });

  it('records the source URL', () => {
    expect(module).toContain(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    );
  });

  it('emits one row per model with null for an absent rate', () => {
    expect(module).toContain(
      '  "claude-opus-5": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },',
    );
    expect(module).toContain(
      '  "gpt-5.5": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: null },',
    );
  });

  it('ends with a newline, like every other file in the tree', () => {
    expect(module.endsWith('};\n')).toBe(true);
  });
});

describe('refreshPricingSnapshot', () => {
  it('writes the module and reports what it wrote', async () => {
    const outputPath = temporaryFile('stale\n');

    const result = await refreshPricingSnapshot({
      fetchImpl: respondWith(usableCatalog()),
      outputPath,
      now: new Date('2026-02-03T09:00:00Z'),
    });

    expect(result.modelCount).toBe(REQUIRED_MODELS.length + 40);
    expect(result.snapshotDate).toBe('2026-02-03');
    expect(readFileSync(outputPath, 'utf8')).toContain('"claude-opus-5": { inputPerToken:');
  });

  it('leaves the file alone when the request fails', async () => {
    const outputPath = temporaryFile('keep me\n');

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          text: async () => '',
        }),
        outputPath,
      }),
    ).rejects.toThrow('HTTP 503');
    expect(readFileSync(outputPath, 'utf8')).toBe('keep me\n');
  });

  it('leaves the file alone when the network throws', async () => {
    const outputPath = temporaryFile('keep me\n');

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => {
          throw new Error('getaddrinfo ENOTFOUND');
        },
        outputPath,
      }),
    ).rejects.toThrow('Could not reach the pricing catalog');
    expect(readFileSync(outputPath, 'utf8')).toBe('keep me\n');
  });

  it('leaves the file alone when the body is not JSON', async () => {
    const outputPath = temporaryFile('keep me\n');

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html>404</html>',
        }),
        outputPath,
      }),
    ).rejects.toThrow('Pricing catalog is not valid JSON');
    expect(readFileSync(outputPath, 'utf8')).toBe('keep me\n');
  });

  it('refuses a catalog that no longer prices a model we depend on', async () => {
    const outputPath = temporaryFile('keep me\n');
    const catalog = usableCatalog();
    delete catalog['claude-opus-5'];

    await expect(
      refreshPricingSnapshot({ fetchImpl: respondWith(catalog), outputPath }),
    ).rejects.toThrow('no longer prices: claude-opus-5');
    expect(readFileSync(outputPath, 'utf8')).toBe('keep me\n');
  });

  it('refuses a catalog that shrank below the floor', async () => {
    const outputPath = temporaryFile('keep me\n');

    await expect(
      refreshPricingSnapshot({
        fetchImpl: respondWith({ 'claude-opus-5': anthropicEntry() }),
        outputPath,
      }),
    ).rejects.toThrow('expected at least');
    expect(readFileSync(outputPath, 'utf8')).toBe('keep me\n');
  });
});

describe('the checked-in snapshot', () => {
  it('is exactly what the renderer would write for the same data', () => {
    // Offline round trip: re-render from the module the app actually imports.
    // A hand edit, a reordered row or a renderer change that was not applied
    // to the checked-in file all show up here, and a real refresh's diff stays
    // limited to prices that genuinely moved.
    const path = fileURLToPath(new URL('../src/lib/usage-pricing-snapshot.ts', import.meta.url));

    expect(readFileSync(path, 'utf8')).toBe(
      renderSnapshotModule(Object.entries(PRICING_SNAPSHOT), PRICING_SNAPSHOT_DATE),
    );
  });
});
