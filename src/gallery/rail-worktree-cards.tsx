import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import type { PaneAgent } from "../lib/process-info";
import { type RailCardPane, type RailState, type RailWorktreeGroup } from "../ui/agent-rail-model";
import { WorktreeCard } from "../ui/worktree-card";
import { NOOP } from "./chrome-fixtures";

/**
 * Gallery specimens for the rail's worktree card — the SHIPPED `WorktreeCard`
 * (`src/ui/worktree-card.tsx`), not a drawing of it.
 *
 * Until 2026-08-26 this file carried a hand-built copy of the owner's two
 * mockups: its own `CardStatus` / `CardPane` / `WorktreeCard` / `BareWorktree`
 * types, its own markup and an 800-line `gxwc-` stylesheet that restated the
 * production sheet one selector at a time. That was the right shape while the
 * card was still a proposal being decided; now that `worktree-card.tsx` and
 * `src/styles/04c-rail-worktree-card.css` are what ships, keeping a parallel
 * copy here would mean a later change to the real component could leave this
 * page drawing something the app no longer renders — exactly the failure
 * `agent-status-rail.tsx` already fixed for the rail as a whole (see its own
 * header comment). So this file now keeps only the FIXTURE as data
 * (`WORKTREES` below, built from the model's own `RailWorktreeGroup` /
 * `RailCardPane` types) and mounts the real component against it.
 *
 * Two specimens:
 *
 *  - `railWorktreeCardsSpecimen`: the card closed and open, side by side, at
 *    the rail's real width — a focused, uncluttered view for judging the
 *    card's own states without the rest of the rail around it. The full rail
 *    driven by `seed-data.ts` (`agentStatusRailSpecimen`, below this one in
 *    `navigation-section.tsx`) is the end-to-end picture; this one exists so
 *    a reviewer can look at nothing else.
 *  - `railColorRuleSpecimen`: the one value the card sheet still leaves open
 *    (`docs/specs/2026-08-25-rail-worktree-card-design.md` §13, Task 10's
 *    gate) — which hue `--asr-card-busy` takes. `neutral` is the shipped
 *    default and needs no override; `magenta`/`cyan` are compared by
 *    restating that one custom property under a `[data-busy]` attribute, in
 *    `src/gallery/gallery.css` (see the comment there) rather than in a
 *    stylesheet of this file's own — the production sheet pins the variable
 *    directly on `.asr-card` / `.asr-bare` / `.asr-card__row`, so an ancestor
 *    override has to target those same classes to win.
 *
 * `ai-terminal`'s five panes are deliberately spread across THREE tabs (a
 * split holding claude+codex, a lone cursor-agent, a split holding
 * opencode+gemini) rather than one — the card's load-bearing claim is that it
 * flattens every pane of a checkout regardless of which tab holds it (design
 * §3), and that is invisible in a fixture where a card's panes all come from
 * a single tab. `sidebar-ui` repeats the same claim at a smaller scale: its
 * two panes sit in two SEPARATE tabs, not a split within one.
 */

const PROJECT = "spacevibe-bench";
const REPO_ROOT = "/Users/deck/spacevibe-bench";
const WORKTREES_ROOT = "/Users/deck/bench-worktrees";

function cardPane(fields: {
  readonly paneId: number;
  readonly agent: PaneAgent;
  readonly label: string;
  readonly state: RailState;
  readonly model: string;
  readonly tabIndex: number;
  readonly focused?: boolean;
}): RailCardPane {
  return {
    kind: "agent",
    paneId: fields.paneId,
    agent: fields.agent,
    state: fields.state,
    // `WorktreeCard` never reads a pane's turn sentence — dropped from every
    // row on purpose (design §9.1) — so this stays empty; kept only because
    // `RailPaneRow` requires the field.
    message: "",
    age: "",
    changedAt: 0,
    focused: fields.focused ?? false,
    tabIndex: fields.tabIndex,
    model: fields.model,
    label: fields.label,
  };
}

/**
 * `live` and `active` are DERIVED from `panes`, exactly as
 * `agent-rail-model.ts` derives them — never set by hand, so this fixture
 * cannot drift into a state the real model would never produce (a card
 * marked active with no focused pane, or live with nothing working).
 */
function worktreeGroup(fields: {
  readonly key: string;
  readonly branch: string;
  readonly name: string;
  readonly age?: string;
  readonly primary?: boolean;
  readonly panes?: readonly RailCardPane[];
}): RailWorktreeGroup {
  const panes = fields.panes ?? [];
  return {
    key: fields.key,
    branch: fields.branch,
    name: fields.name,
    path: fields.key,
    // The specimen draws one repository per card, so a checkout is its own
    // repository here; the production model resolves the primary worktree.
    repositoryPath: fields.key,
    primary: fields.primary ?? false,
    labelled: true,
    entries: panes,
    panes,
    live: panes.some((pane) => pane.state === "working"),
    age: fields.age ?? "",
    active: panes.some((pane) => pane.focused),
    rows: [],
  };
}

const AI_TERMINAL_KEY = `${WORKTREES_ROOT}/ai-terminal`;

const WORKTREES: readonly RailWorktreeGroup[] = [
  // A checkout with nothing running: the head row alone, no card, no strip —
  // `BareCheckout`, the same branch `WorktreeCard` takes for every project
  // git does not know.
  worktreeGroup({ key: REPO_ROOT, branch: "main", name: "bench", primary: true }),
  worktreeGroup({
    key: AI_TERMINAL_KEY,
    branch: "feature/ai-terminal",
    name: "ai-terminal",
    age: "now",
    panes: [
      cardPane({
        paneId: 901,
        agent: "claude",
        label: "Claude",
        state: "working",
        model: "Sonnet 4.5",
        tabIndex: 0,
        focused: true,
      }),
      // Same tab as the pane above — a split, which is why a plain agent name
      // has to survive two panes of one checkout without a tab row to tell
      // them apart on screen.
      cardPane({
        paneId: 902,
        agent: "codex",
        label: "Codex",
        state: "working",
        model: "GPT-5.1",
        tabIndex: 0,
      }),
      cardPane({
        paneId: 903,
        agent: "cursor-agent",
        label: "Cursor CLI",
        state: "done",
        model: "Composer",
        tabIndex: 1,
      }),
      cardPane({
        paneId: 904,
        agent: "opencode",
        label: "OpenCode",
        state: "asked",
        model: "Sonnet 4.5",
        tabIndex: 2,
      }),
      // Second pane of the third tab's split.
      cardPane({
        paneId: 905,
        agent: "gemini",
        label: "Gemini",
        state: "idle",
        model: "2.5 Pro",
        tabIndex: 2,
      }),
    ],
  }),
  worktreeGroup({
    key: `${WORKTREES_ROOT}/sidebar-ui`,
    branch: "bugfix/sidebar-ui",
    name: "sidebar-ui",
    age: "2m",
    panes: [
      cardPane({
        paneId: 906,
        agent: "claude",
        label: "Claude",
        state: "asked",
        model: "Sonnet 4.5",
        tabIndex: 0,
      }),
      // A SEPARATE tab from the pane above, not a split of it.
      cardPane({
        paneId: 907,
        agent: "codex",
        label: "Codex",
        state: "asked",
        model: "Sonnet 4.5",
        tabIndex: 1,
      }),
    ],
  }),
  worktreeGroup({
    key: `${WORKTREES_ROOT}/docs-update`,
    branch: "chore/docs-update",
    name: "docs-update",
    age: "4m",
    panes: [
      cardPane({
        paneId: 908,
        agent: "codex",
        label: "Codex",
        state: "asked",
        model: "GPT-5.1",
        tabIndex: 0,
      }),
    ],
  }),
];

/**
 * One project's worth of cards, standing alone rather than under
 * `AgentRail`'s own cluster header: that header is `agent-rail.tsx`'s own
 * markup, already rendered faithfully by the `SEED_TABS`-driven specimens
 * below this one, and hand-copying it here a second time would reintroduce
 * exactly the staleness risk this rewrite exists to remove. The classes below
 * (`asr-rail`, `asr-rail__list`, `asr-stream`, `asr-cluster`) are the real
 * ones the shipped rail nests `WorktreeCard` inside, reused so the spacing
 * around each card matches the app without a line of gallery-only CSS.
 */
function CardRail({ initialOpenKey }: { readonly initialOpenKey: string | null }) {
  const openKeys = useSignal<ReadonlySet<string>>(
    initialOpenKey === null ? new Set() : new Set([initialOpenKey]),
  );

  function toggle(key: string): void {
    const next = new Set(openKeys.value);
    if (!next.delete(key)) {
      next.add(key);
    }
    openKeys.value = next;
  }

  return (
    <nav class="asr-rail asr-rail--mounted" aria-label="Agents (worktree card specimen)">
      <div class="asr-rail__list">
        <section class="asr-stream" aria-label="Open agents">
          <div class="asr-cluster">
            {WORKTREES.map((group) => (
              <WorktreeCard
                key={group.key}
                project={PROJECT}
                group={group}
                open={openKeys.value.has(group.key)}
                onToggle={toggle}
                onFocusPane={NOOP}
                onClosePane={NOOP}
                onCloseTab={NOOP}
                onSelectTab={NOOP}
                onNewTabIn={NOOP}
              />
            ))}
          </div>
        </section>
      </div>
    </nav>
  );
}

/**
 * The rail's own standalone-study frame (`.asr-study` / `.asr-study__stage`,
 * `agent-status-rail.css`): one rail at the width the window shell actually
 * gives it, bordered and backed since nothing here stands inside the real
 * sidebar column. Reused rather than reinvented for the same reason the rail
 * classes above are.
 */
function studyRail(initialOpenKey: string | null, dataBusy?: string) {
  return (
    <div class="asr-study" data-busy={dataBusy}>
      <div class="asr-study__stage">
        <CardRail initialOpenKey={initialOpenKey} />
      </div>
    </div>
  );
}

/** A labelled column: candidate title, its note, then the rail underneath. */
function CardColumn({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div style={{ display: "grid", gap: "8px", maxWidth: "320px" }}>
      <p style={{ margin: 0, color: "var(--gx-bright)" }}>{title}</p>
      <p style={{ margin: 0, color: "var(--gx-dim)", fontSize: "11px", lineHeight: 1.45 }}>
        {note}
      </p>
      {children}
    </div>
  );
}

export function railWorktreeCardsSpecimen() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
      <CardColumn
        title="closed — every checkout"
        note="mark · checkout name · branch badge, then the age alone, then the closed agents as one segmented strip capped at three with the rest folded into `+N` (stripSegments, DL-27.3's own precedence). `bench`, the main checkout, has nothing running: the head row alone, no card, no strip. `ai-terminal`'s five panes come from three different tabs, flattened onto one card."
      >
        {studyRail(null)}
      </CardColumn>
      <CardColumn
        title="open — one checkout, one row per agent"
        note="`ai-terminal` opened onto its agent list: glyph · name · model pill · loading mark, closed by a `New agent` row. `sidebar-ui` stays closed beside it — its two panes sit in two separate tabs, the same flattening claim on a smaller card."
      >
        {studyRail(AI_TERMINAL_KEY)}
      </CardColumn>
    </div>
  );
}

/** The focused-row candidates, in the order they escalate. */
const FOCUS_MARKS: readonly {
  readonly id: string;
  readonly title: string;
  readonly note: string;
}[] = [
  {
    id: "wash",
    title: "A — a louder wash (shipped default)",
    note: "one signifier, just legible: the focused row's wash goes from `--tone` 11% to 20% against a 5% rest and a 9% hover. DL-27.22 is untouched — this is the rule it already states, at a step you can see next to a rim glow. Costs nothing and reads weakest of the three when the row above it is busy.",
  },
  {
    id: "tint",
    title: "B — the wash takes --accent",
    note: "still one signifier, so DL-27.22 stands: the wash is `--accent` at 24% instead of neutral white, which means the focused row is the only COLOURED plane in the column rather than the lightest one. Spends `--accent`, which the card's colour rule currently reserves for the strip's `+N`.",
  },
  {
    id: "bar",
    title: "C — wash + a leading accent bar",
    note: 'a 16% neutral wash plus a 3px `--accent` bar down the row\'s left edge. The only candidate that answers "which row" without comparing one row to its neighbours, and the only one still readable at a glance down a full rail. Spends `--accent` too, and amends DL-27.22\'s "never a second signifier".',
  },
];

/**
 * The focused row, drawn three ways (owner, 2026-08-26, after a screenshot of
 * four agent rows with no readable answer to "which one am I typing into").
 *
 * Every column is the SHIPPED component and the SHIPPED sheet — each candidate
 * is one override of the production sheet's own pinned custom properties
 * (`gallery.css`), never a second drawing of the row. `ai-terminal`'s first
 * pane is the focused one in the fixture, and it is deliberately `working`:
 * the busy rim is what the focus mark has to survive, and judging it on a
 * still row would flatter all three.
 */
export function railFocusMarkSpecimen() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
      {FOCUS_MARKS.map((mark) => (
        <CardColumn key={mark.id} title={mark.title} note={mark.note}>
          <div data-focus={mark.id}>{studyRail(AI_TERMINAL_KEY)}</div>
        </CardColumn>
      ))}
    </div>
  );
}

/** The busy-hue candidates, in the order they escalate. */
const BUSY_HUES: readonly { readonly id: string; readonly title: string; readonly note: string }[] =
  [
    {
      id: "neutral",
      title: "A — busy is NEUTRAL (shipped default)",
      note: "the quietest option: colour stays reserved for the two states that want your eyes, and the loading bars still carry the motion. `--green` means the active checkout, `--status-unread` means asked, `--red` means failed, `--accent` is the strip's `+N` — busy shares none of them.",
    },
    {
      id: "magenta",
      title: "B — busy is --magenta",
      note: "spends a hue to make busy loud. `--magenta` has been out of chrome since the neutral-ink pass (DL-3.6, 2026-08-17), so picking this reopens that rule rather than just a token.",
    },
    {
      id: "cyan",
      title: "C — busy is --cyan",
      note: "the same trade in a cooler hue, closer to `--accent` than magenta is — a busy segment and the strip's own `+N` sit nearer each other than they should.",
    },
  ];

/**
 * The colour rule, drawn three ways (owner, 2026-08-25, asking for a
 * documented rule after seeing green and magenta on two rows that meant the
 * same thing).
 *
 * Two faults that report surfaced are already fixed in the production sheet
 * rather than offered as candidates here: `running` and `thinking` now share
 * one state (`working`) and one hue, and `--green` stopped doing double duty
 * as both the busy hue and the active card's frame — it now means the active
 * checkout and nothing else. What is left to choose is WHICH hue `working`
 * itself takes, so that is what these three columns vary — one
 * `--asr-card-busy` override each (`gallery.css`), everything else identical.
 */
export function railColorRuleSpecimen() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
      {BUSY_HUES.map((hue) => (
        <CardColumn key={hue.id} title={hue.title} note={hue.note}>
          {studyRail(AI_TERMINAL_KEY, hue.id)}
        </CardColumn>
      ))}
    </div>
  );
}
