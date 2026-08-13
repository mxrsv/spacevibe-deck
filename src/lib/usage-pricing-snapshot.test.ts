import { describe, expect, it } from "vitest";
import {
  PRICING_SNAPSHOT,
  PRICING_SNAPSHOT_DATE,
  PRICING_SOURCE_URL,
} from "./usage-pricing-snapshot";

/**
 * Every model id the Claude Code and Codex CLIs on the dev machine had
 * actually written into their transcripts as of 2026-08-10 — with the single
 * exception of `<synthetic>`, which is Claude Code's marker for a locally
 * produced message and is deliberately unpriced (it always carries zero
 * tokens; see `usage-pricing.ts`).
 *
 * This list is the tripwire for a refresh that drops a provider tag or
 * renames a cost field upstream: the regenerated snapshot would still parse,
 * still typecheck, and quietly price nothing.
 */
const OBSERVED_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.1-codex-mini",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];

/** A refresh that halves the catalog is a bug, not a price change. */
const MIN_MODELS = 40;

describe("PRICING_SNAPSHOT", () => {
  it("prices every model these two CLIs have actually emitted here", () => {
    const missing = OBSERVED_MODELS.filter(
      (model) => PRICING_SNAPSHOT[model] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it("still holds a plausible number of models", () => {
    expect(Object.keys(PRICING_SNAPSHOT).length).toBeGreaterThanOrEqual(
      MIN_MODELS,
    );
  });

  it("gives every model a finite, non-negative input and output rate", () => {
    const broken = Object.entries(PRICING_SNAPSHOT).filter(
      ([, pricing]) =>
        !Number.isFinite(pricing.inputPerToken) ||
        !Number.isFinite(pricing.outputPerToken) ||
        pricing.inputPerToken < 0 ||
        pricing.outputPerToken < 0,
    );

    expect(broken.map(([model]) => model)).toEqual([]);
  });

  it("keeps cache rates either null or a finite, non-negative number", () => {
    const broken = Object.entries(PRICING_SNAPSHOT).filter(([, pricing]) =>
      [pricing.cacheReadPerToken, pricing.cacheWritePerToken].some(
        (rate) => rate !== null && (!Number.isFinite(rate) || rate < 0),
      ),
    );

    expect(broken.map(([model]) => model)).toEqual([]);
  });

  it("never prices output below input or a cache read above input", () => {
    // Both hold for all 84 models as fetched. A violation means the renderer
    // mixed two models' fields up, which no other assertion here would catch.
    const suspicious = Object.entries(PRICING_SNAPSHOT).filter(
      ([, pricing]) =>
        pricing.outputPerToken < pricing.inputPerToken ||
        (pricing.cacheReadPerToken !== null &&
          pricing.cacheReadPerToken > pricing.inputPerToken),
    );

    expect(suspicious.map(([model]) => model)).toEqual([]);
  });

  it("is sorted by model id, so a hand-appended row is visible", () => {
    const ids = Object.keys(PRICING_SNAPSHOT);

    expect(ids).toEqual([...ids].sort());
  });
});

describe("snapshot provenance", () => {
  it("records the retrieval date as YYYY-MM-DD", () => {
    expect(PRICING_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("records where the numbers came from", () => {
    expect(PRICING_SOURCE_URL).toBe(
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    );
  });
});
