// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section imports the usage store, whose client reaches `invoke`; stub it
// so the tree mounts under jsdom (the workspace-sidebar.test.tsx idiom).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { EMPTY_COUNTERS } from "../../../lib/usage-snapshot";
import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { PRICING_SNAPSHOT_DATE } from "../../../lib/usage-pricing-snapshot";
import { dotColor } from "../../../lib/process-info";
import { usageSnapshot } from "../../../usage/usage-store";
import { OverviewSection, startOfLocalDay } from "./overview-section";
import { EM_DASH } from "../usage-format";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

const bucket = (patch: Partial<UsageBucket>): UsageBucket => ({
  bucketStartMs: NOW,
  agent: "claude",
  model: "claude-opus-4-5-20251101",
  counters: { ...EMPTY_COUNTERS, inputUncached: 100, output: 50 },
  ...patch,
});

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 3 },
    { agent: "codex", state: "ok", filesScanned: 2 },
  ],
  skippedLines: 0,
});

describe("startOfLocalDay", () => {
  it("returns local midnight, not UTC midnight", () => {
    const midnight = startOfLocalDay(NOW);
    const asDate = new Date(midnight);
    expect(asDate.getHours()).toBe(0);
    expect(asDate.getMinutes()).toBe(0);
    expect(asDate.getSeconds()).toBe(0);
    expect(asDate.getDate()).toBe(new Date(NOW).getDate());
  });

  it("lands on a 15-minute boundary for every offset, so the filter is exact", () => {
    // BUCKET_MS is 15 minutes precisely so this holds (§0.2.4).
    expect(startOfLocalDay(NOW) % (15 * 60 * 1000)).toBe(0);
  });
});

describe("OverviewSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
    vi.useRealTimers();
  });

  const mount = (): void => {
    act(() => {
      render(<OverviewSection />, host);
    });
  };

  const text = (selector: string): string =>
    host.querySelector(selector)?.textContent ?? "";

  const blocks = (): HTMLElement[] => [
    ...host.querySelectorAll<HTMLElement>(".usage-agent"),
  ];

  const blockText = (block: HTMLElement, selector: string): string =>
    block.querySelector(selector)?.textContent ?? "";

  /** Two priced agents, Claude an order of magnitude ahead of Codex. */
  const priced = (): UsageSnapshot =>
    snapshot([
      bucket({
        agent: "claude",
        bucketStartMs: NOW,
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000, output: 0 },
      }),
      bucket({
        agent: "codex",
        model: "gpt-5-codex",
        bucketStartMs: NOW,
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000, output: 0 },
      }),
    ]);

  it("states the figure it exists to state, with the eyebrow above it", () => {
    usageSnapshot.value = priced();
    mount();

    // Literal uppercase in the markup, never `text-transform` (DL-16.2) — so
    // the one sanctioned uppercase is greppable in the source.
    expect(text(".usage-hero__eyebrow")).toBe("RAW TOKEN COST");
    // claude 1M input @ $5/M = $5.00, codex 1M @ $1.25/M = $1.25 → $6.25.
    expect(text(".usage-hero__figure")).toBe("$6.25*");
    expect(text(".usage-hero__footnote")).toBe("* if billed at full API rate");
  });

  it("carries exactly one display figure (DL-16.1)", () => {
    usageSnapshot.value = priced();
    mount();
    expect(host.querySelectorAll(".usage-hero__figure")).toHaveLength(1);
  });

  it("keeps 'today' without building a second hero for it", () => {
    usageSnapshot.value = snapshot([
      bucket({
        bucketStartMs: NOW,
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
      }),
      bucket({
        bucketStartMs: startOfLocalDay(NOW) - HOUR,
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
      }),
    ]);
    mount();

    // Today is one of the two buckets: $5.00 of the $10.00 recorded.
    expect(text(".usage-hero__today")).toBe("today · $5.00 · 1M tokens");
    expect(text(".usage-hero__figure")).toBe("$10.00*");
  });

  it("says so plainly when nothing has been used today", () => {
    usageSnapshot.value = snapshot([
      bucket({ bucketStartMs: startOfLocalDay(NOW) - HOUR }),
    ]);
    mount();
    expect(text(".usage-hero__today")).toBe("today · no usage yet");
  });

  it("carries the estimate disclaimer and the pricing snapshot date", () => {
    usageSnapshot.value = priced();
    mount();
    const note = text(".usage-hero__estimate");
    expect(note).toContain("estimated at API prices");
    expect(note).toContain(PRICING_SNAPSHOT_DATE);
  });

  it("orders agent blocks by cost, largest first", () => {
    usageSnapshot.value = priced();
    mount();
    expect(blocks().map((b) => blockText(b, ".usage-agent__label"))).toEqual([
      "Claude Code",
      "Codex",
    ]);
  });

  it("fills each bar with that agent's own established colour (DL-16.4)", () => {
    usageSnapshot.value = priced();
    mount();
    const [claude, codex] = blocks();
    const fill = (block: HTMLElement): string =>
      (block.querySelector(".usage-agent__fill") as HTMLElement).style
        .background;

    // The theme colour the agent already wears on its pane dot — not a brand
    // colour sampled from the logo.
    expect(fill(claude)).toContain(dotColor("claude"));
    expect(fill(codex)).toContain(dotColor("codex"));
  });

  it("writes the share in text and hides the bar from assistive tech (DL-16.6)", () => {
    usageSnapshot.value = priced();
    mount();
    const [claude] = blocks();
    expect(
      claude.querySelector(".usage-agent__bar")?.getAttribute("aria-hidden"),
    ).toBe("true");
    // $5.00 of $6.25 is 80%.
    expect(blockText(claude, ".usage-agent__sub")).toBe(
      "80% of cost · 1M tokens",
    );
  });

  it("keeps the printed shares summing to exactly 100%", () => {
    // Three-way split of a total that does not divide evenly: independent
    // rounding would print 33.3 + 33.3 + 33.3 = 99.9.
    usageSnapshot.value = snapshot([
      bucket({
        agent: "claude",
        model: "claude-opus-4-5-20251101",
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
      }),
      bucket({
        agent: "codex",
        model: "gpt-5-codex",
        counters: { ...EMPTY_COUNTERS, inputUncached: 4_000_000 },
      }),
    ]);
    mount();

    const shares = blocks().map((block) => {
      const match = blockText(block, ".usage-agent__sub").match(
        /^([\d.]+)% of cost/,
      );
      return Number(match?.[1]);
    });
    expect(shares.every((share) => Number.isFinite(share))).toBe(true);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100, 10);
  });

  it("contains nothing interactive (DL-16.6)", () => {
    usageSnapshot.value = priced();
    mount();
    expect(
      host.querySelectorAll(
        'button, a, input, select, [role="button"], [tabindex]',
      ),
    ).toHaveLength(0);
  });

  it("never overclaims what the numbers cover", () => {
    usageSnapshot.value = priced();
    mount();
    expect(host.textContent).not.toContain("machine-wide");
    expect(host.textContent).not.toContain("all-time");
  });

  describe("when only some of an agent's models are priced", () => {
    // The real-corpus bug: Codex ran one unrecognised id holding 0.2% of its
    // tokens, which nulled the agent, nulled the grand total and blanked a
    // correct $13,372.98. The priced part must survive the sliver.
    const partly = (): UsageSnapshot =>
      snapshot([
        bucket({
          agent: "claude",
          model: "claude-opus-4-5-20251101",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
        bucket({
          agent: "codex",
          model: "gpt-5-codex",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
        bucket({
          agent: "codex",
          model: "gpt-6-preview-2026-08",
          counters: { ...EMPTY_COUNTERS, inputUncached: 500_000 },
        }),
      ]);

    it("reports the priced total instead of blanking the screen", () => {
      usageSnapshot.value = partly();
      mount();
      // $5.00 of Claude + $1.25 of priced Codex.
      expect(text(".usage-hero__figure")).toBe("$6.25*");
    });

    it("discloses the gap in the footnote", () => {
      usageSnapshot.value = partly();
      mount();
      expect(text(".usage-hero__footnote")).toBe(
        "* if billed at full API rate · excludes 1 model with no published price",
      );
    });

    it("pluralises the footnote clause honestly", () => {
      usageSnapshot.value = snapshot([
        bucket({
          agent: "claude",
          model: "claude-opus-4-5-20251101",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
        bucket({
          agent: "claude",
          model: "mystery-one",
          counters: { ...EMPTY_COUNTERS, inputUncached: 10 },
        }),
        bucket({
          agent: "codex",
          model: "mystery-two",
          counters: { ...EMPTY_COUNTERS, inputUncached: 10 },
        }),
      ]);
      mount();
      expect(text(".usage-hero__footnote")).toBe(
        "* if billed at full API rate · excludes 2 models with no published price",
      );
    });

    it("shows the agent's priced amount and names the omitted tokens", () => {
      usageSnapshot.value = partly();
      mount();
      const codex = blocks().find(
        (block) => blockText(block, ".usage-agent__label") === "Codex",
      ) as HTMLElement;
      expect(blockText(codex, ".usage-agent__amount")).toBe("$1.25");
      expect(blockText(codex, ".usage-agent__sub")).toBe(
        "20% of cost · 1.5M tokens · 500K unpriced",
      );
    });

    it("keeps shares as proportions of the priced total, still summing to 100", () => {
      usageSnapshot.value = partly();
      mount();
      const shares = blocks().map((block) => {
        const match = blockText(block, ".usage-agent__sub").match(
          /^([\d.]+)% of cost/,
        );
        return match === null ? 0 : Number(match[1]);
      });
      expect(shares).toEqual([80, 20]);
    });
  });

  describe("when an agent has no priced model at all", () => {
    const noneForCodex = (): UsageSnapshot =>
      snapshot([
        bucket({
          agent: "claude",
          model: "claude-opus-4-5-20251101",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
        bucket({
          agent: "codex",
          model: "gpt-6-preview-2026-08",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
      ]);

    it("dashes that agent's amount and says why", () => {
      usageSnapshot.value = noneForCodex();
      mount();
      const codex = blocks().find(
        (block) => blockText(block, ".usage-agent__label") === "Codex",
      ) as HTMLElement;
      expect(blockText(codex, ".usage-agent__amount")).toBe(EM_DASH);
      expect(blockText(codex, ".usage-agent__sub")).toBe(
        "unpriced · 1M tokens",
      );
    });

    it("still reports the rest of the machine's cost", () => {
      usageSnapshot.value = noneForCodex();
      mount();
      expect(text(".usage-hero__figure")).toBe("$5.00*");
      const claude = blocks().find(
        (block) => blockText(block, ".usage-agent__label") === "Claude Code",
      ) as HTMLElement;
      expect(blockText(claude, ".usage-agent__amount")).toBe("$5.00");
    });

    it("sorts unpriced agents last, behind every priced one", () => {
      usageSnapshot.value = noneForCodex();
      mount();
      expect(blocks().map((b) => blockText(b, ".usage-agent__label"))).toEqual([
        "Claude Code",
        "Codex",
      ]);
    });
  });

  describe("when nothing at all is priced", () => {
    const nothing = (): UsageSnapshot =>
      snapshot([
        bucket({
          agent: "claude",
          model: "mystery-one",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000 },
        }),
        bucket({
          agent: "codex",
          model: "mystery-two",
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000 },
        }),
      ]);

    it("dashes the headline and names the models in the footnote", () => {
      usageSnapshot.value = nothing();
      mount();
      // There is no priced part to stand behind, so there is no figure.
      expect(text(".usage-hero__figure")).toBe(EM_DASH);
      expect(text(".usage-hero__footnote")).toBe(
        "no price for mystery-one, mystery-two",
      );
    });

    it("marks the absent figure faint so it does not read as a rule (DL-15.6)", () => {
      usageSnapshot.value = nothing();
      mount();
      expect(
        host
          .querySelector(".usage-hero__figure")
          ?.classList.contains("usage-hero__figure--absent"),
      ).toBe(true);
    });

    it("prints no percentage anywhere and leaves every track empty (DL-16.5)", () => {
      usageSnapshot.value = nothing();
      mount();
      expect(host.textContent).not.toContain("% of cost");
      for (const block of blocks()) {
        const fill = block.querySelector(".usage-agent__fill") as HTMLElement;
        expect(fill.style.width).toBe("0%");
      }
    });
  });

  it("leaves a real figure at full strength", () => {
    usageSnapshot.value = priced();
    mount();
    expect(
      host
        .querySelector(".usage-hero__figure")
        ?.classList.contains("usage-hero__figure--absent"),
    ).toBe(false);
  });

  it("shows the no-data treatment rather than a $0.00 hero", () => {
    mount();
    expect(text(".usage-hero__empty")).toBe("no data yet");
    expect(host.querySelector(".usage-hero__figure")).toBeNull();
    expect(host.textContent).not.toContain("$0.00");
  });
});
