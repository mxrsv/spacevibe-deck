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
import { OverviewSection } from "./overview-section";
import { activeUsageRange } from "../active-usage-view-store";
import {
  DEFAULT_USAGE_RANGE,
  startOfLocalDay,
  USAGE_RANGES,
} from "../usage-ranges";
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

describe("OverviewSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
    activeUsageRange.value = DEFAULT_USAGE_RANGE;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
    activeUsageRange.value = DEFAULT_USAGE_RANGE;
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

    // Sentence-case microcopy, no text-transform, no tracking (DL-4.3, DL-16.2).
    expect(text(".usage-hero__eyebrow")).toBe("Raw token cost");
    // claude 1M input @ $5/M = $5.00, codex 1M @ $1.25/M = $1.25 → $6.25.
    expect(text(".usage-hero__figure")).toBe("$6.25*");
    expect(text(".usage-hero__footnote")).toBe("* if billed at full API rate");
  });

  it("carries exactly one display figure (DL-16.1)", () => {
    usageSnapshot.value = priced();
    mount();
    expect(host.querySelectorAll(".usage-hero__figure")).toHaveLength(1);
  });

  it("drops the standalone today line — the range selector states it now", () => {
    usageSnapshot.value = priced();
    mount();
    // Two totals on one screen contradict each other the moment they differ.
    // "today" is one click away instead (DL-16.7).
    expect(host.querySelector(".usage-hero__today")).toBeNull();
    expect(host.querySelector(".usage-range")).not.toBeNull();
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

  it("keeps the accounting itself non-interactive (DL-16.6)", () => {
    usageSnapshot.value = priced();
    mount();
    // DL-16.7 permits exactly one control on a metric screen; DL-15.2 and
    // DL-16.6 still govern everything else, so the agent blocks and their
    // bars stay inert.
    expect(
      host.querySelectorAll(
        '.usage-hero__agents button, .usage-hero__agents a, .usage-hero__agents [role="button"], .usage-hero__agents [tabindex]',
      ),
    ).toHaveLength(0);
  });

  it("permits the range selector and nothing else to be interactive (DL-16.7)", () => {
    usageSnapshot.value = priced();
    mount();
    const interactive = [
      ...host.querySelectorAll(
        'button, a, input, select, [role="button"], [tabindex]',
      ),
    ];
    // Every focusable thing here is a range option — one control, with no
    // second one smuggled in beside it.
    expect(interactive.length).toBeGreaterThan(0);
    for (const node of interactive) {
      expect(node.classList.contains("usage-range__option")).toBe(true);
    }
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

  describe("the range selector", () => {
    const DAY = 24 * HOUR;
    /** Midday on the local day `n` days before today. */
    const daysAgo = (n: number): number =>
      startOfLocalDay(NOW) - n * DAY + 12 * HOUR;

    const claudeAt = (atMs: number): UsageBucket =>
      bucket({
        agent: "claude",
        model: "claude-opus-4-5-20251101",
        bucketStartMs: atMs,
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
      });

    /** $5 today, $5 three days back, $5 ten days back, $1.25 forty days back. */
    const spread = (): UsageSnapshot =>
      snapshot([
        claudeAt(NOW),
        claudeAt(daysAgo(3)),
        claudeAt(daysAgo(10)),
        bucket({
          agent: "codex",
          model: "gpt-5-codex",
          bucketStartMs: daysAgo(40),
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
        }),
      ]);

    const pick = (label: string): void => {
      const option = [
        ...host.querySelectorAll<HTMLButtonElement>(".usage-range__option"),
      ].find((node) => node.textContent === label) as HTMLButtonElement;
      act(() => {
        option.click();
      });
    };

    it("offers every period and defaults to the whole history", () => {
      usageSnapshot.value = spread();
      mount();
      expect(
        [...host.querySelectorAll(".usage-range__option")].map(
          (node) => node.textContent,
        ),
      ).toEqual(USAGE_RANGES.map((range) => range.label));
      expect(text(".usage-hero__figure")).toBe("$16.25*");
    });

    it("recomputes the figure on local calendar-day boundaries", () => {
      usageSnapshot.value = spread();
      mount();

      pick("Today");
      expect(text(".usage-hero__figure")).toBe("$5.00*");

      pick("7 days");
      expect(text(".usage-hero__figure")).toBe("$10.00*");

      pick("30 days");
      expect(text(".usage-hero__figure")).toBe("$15.00*");

      pick("All");
      expect(text(".usage-hero__figure")).toBe("$16.25*");
    });

    it("recomputes each agent's amount, share and token count", () => {
      usageSnapshot.value = spread();
      mount();

      // Over everything, Codex is present and holds 1.25 of 16.25.
      expect(blocks().map((b) => blockText(b, ".usage-agent__label"))).toEqual([
        "Claude Code",
        "Codex",
      ]);

      pick("7 days");
      // Codex's only usage is 40 days old, so it leaves the accounting.
      expect(blocks().map((b) => blockText(b, ".usage-agent__label"))).toEqual([
        "Claude Code",
      ]);
      expect(blockText(blocks()[0], ".usage-agent__amount")).toBe("$10.00");
      expect(blockText(blocks()[0], ".usage-agent__sub")).toBe(
        "100% of cost · 2M tokens",
      );
    });

    it("keeps shares summing to 100 inside the chosen range", () => {
      usageSnapshot.value = spread();
      mount();
      pick("All");
      const shares = blocks().map((block) => {
        const match = blockText(block, ".usage-agent__sub").match(
          /^([\d.]+)% of cost/,
        );
        return match === null ? 0 : Number(match[1]);
      });
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(
        100,
        10,
      );
    });

    it("names only the models left unpriced INSIDE the range", () => {
      usageSnapshot.value = snapshot([
        claudeAt(NOW),
        bucket({
          agent: "codex",
          model: "gpt-6-preview-2026-08",
          bucketStartMs: daysAgo(40),
          counters: { ...EMPTY_COUNTERS, inputUncached: 1_000 },
        }),
      ]);
      mount();
      // Over all history the old unpriced model is disclosed...
      expect(text(".usage-hero__footnote")).toContain("excludes 1 model");

      pick("7 days");
      // ...but inside 7 days it did not happen, so naming it would be a lie.
      expect(text(".usage-hero__footnote")).toBe(
        "* if billed at full API rate",
      );
    });

    describe("when the chosen range holds nothing", () => {
      const onlyOld = (): UsageSnapshot => snapshot([claudeAt(daysAgo(40))]);

      it("dashes the figure instead of claiming $0.00", () => {
        usageSnapshot.value = onlyOld();
        mount();
        pick("Today");
        expect(text(".usage-hero__figure")).toBe(EM_DASH);
        expect(host.textContent).not.toContain("$0.00");
        expect(
          host
            .querySelector(".usage-hero__figure")
            ?.classList.contains("usage-hero__figure--absent"),
        ).toBe(true);
      });

      it("drops the agent blocks and says WHICH period is empty", () => {
        usageSnapshot.value = onlyOld();
        mount();
        pick("Today");
        expect(blocks()).toHaveLength(0);
        expect(text(".usage-hero__empty")).toBe("No usage today");

        pick("7 days");
        expect(text(".usage-hero__empty")).toBe(
          "No usage in the last 7 local days",
        );
      });

      it("prints no dangling footnote — there are no models to name", () => {
        usageSnapshot.value = onlyOld();
        mount();
        pick("Today");
        // `no price for ` with nothing after it was a real bug: an empty
        // range has no models at all, priced or otherwise.
        expect(host.querySelector(".usage-hero__footnote")).toBeNull();
        expect(host.textContent).not.toContain("no price for");
      });

      it("keeps the selector reachable so the reader is not stranded", () => {
        usageSnapshot.value = onlyOld();
        mount();
        pick("Today");
        expect(host.querySelectorAll(".usage-range__option")).toHaveLength(
          USAGE_RANGES.length,
        );
        pick("All");
        expect(text(".usage-hero__figure")).toBe("$5.00*");
      });
    });
  });

  it("shows the no-data treatment rather than a $0.00 hero", () => {
    mount();
    expect(text(".usage-hero__empty")).toBe("No data yet");
    expect(host.querySelector(".usage-hero__figure")).toBeNull();
    expect(host.textContent).not.toContain("$0.00");
  });
});
