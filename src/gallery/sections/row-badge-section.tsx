import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { DECK_DARK_ID, DECK_LIGHT_ID, resolveTheme } from "../../settings/themes";
import type { RailCardPane, RailState, RailWorktreeGroup } from "../../ui/agent-rail-model";
import { WorktreeCard } from "../../ui/worktree-card";
import { NOOP } from "../chrome-fixtures";
import { SectionHead, Specimen } from "../specimen";
import "./row-badge-section.css";

/**
 * The agent row's leading edge, for the owner to size by eye (owner decision 6,
 * 2026-10-06: a state badge on the logo's corner, quiet logos for every row that
 * does not need the user; DL-27.21 as amended that day).
 *
 * Every rail is the shipped `WorktreeCard`, so its rows are the shipped
 * `CardAgentRow` on the shipped sheet, opened onto one row per state. A column
 * is a variant class on the scope around the rail (`row-badge-section.css`),
 * never a redrawn row. Each column is drawn on the dark and the light theme at
 * once: a scope per theme publishes that theme's variables on its own element
 * (`applyThemeVars`, as the matrix does), so the gallery's picker moves neither.
 */

const PROJECT = "spacevibe-bench";
const FIXTURE_ROOT = "/Users/deck/bench-worktrees/row-badge";

function pane(fields: {
  readonly paneId: number;
  readonly agent: string;
  readonly label: string;
  readonly state: RailState;
  readonly model: string;
}): RailCardPane {
  return {
    kind: "agent",
    paneId: fields.paneId,
    agent: fields.agent,
    state: fields.state,
    message: "",
    age: "",
    changedAt: 0,
    focused: false,
    tabIndex: fields.paneId,
    model: fields.model,
    label: fields.label,
  };
}

/** One row per state; Claude and Gemini are colour images, Codex and Droid ink marks. */
function fiveRows(focusedId: number | null): readonly RailCardPane[] {
  const rows = [
    pane({ paneId: 1, agent: "claude", label: "Claude", state: "asked", model: "Sonnet 4.5" }),
    pane({ paneId: 2, agent: "codex", label: "Codex", state: "failed", model: "GPT-5.1" }),
    pane({ paneId: 3, agent: "droid", label: "Droid", state: "done", model: "GLM-4.6" }),
    pane({ paneId: 4, agent: "gemini", label: "Gemini", state: "working", model: "2.5 Pro" }),
    pane({ paneId: 5, agent: "claude", label: "Claude", state: "idle", model: "Sonnet 4.5" }),
  ];
  return rows.map((row) => ({ ...row, focused: row.paneId === focusedId }));
}

/** Claude and Codex, each once at full ink and once quiet — the contrast check. */
function contrastRows(): readonly RailCardPane[] {
  return [
    pane({ paneId: 1, agent: "claude", label: "Claude", state: "asked", model: "Sonnet 4.5" }),
    pane({ paneId: 2, agent: "claude", label: "Claude", state: "done", model: "Sonnet 4.5" }),
    pane({ paneId: 3, agent: "codex", label: "Codex", state: "failed", model: "GPT-5.1" }),
    pane({ paneId: 4, agent: "codex", label: "Codex", state: "done", model: "GPT-5.1" }),
  ];
}

function group(panes: readonly RailCardPane[]): RailWorktreeGroup {
  return {
    key: FIXTURE_ROOT,
    branch: "feature/row-badge",
    name: "row-badge",
    path: FIXTURE_ROOT,
    repositoryPath: FIXTURE_ROOT,
    primary: false,
    labelled: true,
    entries: panes,
    panes,
    live: panes.some((row) => row.state === "working"),
    age: "",
    active: panes.some((row) => row.focused),
    rows: [],
  };
}

/** A theme scope: `applyThemeVars` on one element's style publishes a theme to its subtree only. */
function ThemeScope({
  themeId,
  className,
  children,
}: {
  readonly themeId: string;
  readonly className: string;
  readonly children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) {
      applyThemeVars(node.style, resolveTheme({ ...settings.peek(), themeId, colorOverrides: {} }));
    }
  }, [themeId]);
  return (
    <div ref={ref} class={`gxrb ${className}`} data-theme-id={themeId}>
      {children}
    </div>
  );
}

/** The rail frame the shipped sheet expects around a card, as in the navigation section. */
function Rail({ panes }: { readonly panes: readonly RailCardPane[] }) {
  const focused = panes.some((row) => row.focused);
  return (
    <div class="asr-study">
      <div class="asr-study__stage">
        <nav class="asr-rail asr-rail--mounted" aria-label="Agents (row badge specimen)">
          <div class="asr-rail__list">
            <section class="asr-stream" aria-label="Open agents">
              {/* The cluster holding the keyboard is the active one, and its surface grounds the ring. */}
              <div class="asr-cluster" data-active={focused ? "true" : undefined}>
                <WorktreeCard
                  project={PROJECT}
                  group={group(panes)}
                  onFocusPane={NOOP}
                  onClosePane={NOOP}
                  onCloseTab={NOOP}
                  onSelectTab={NOOP}
                />
              </div>
            </section>
          </div>
        </nav>
      </div>
    </div>
  );
}

interface Variant {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  /** Variant class on the scope; see `row-badge-section.css`. */
  readonly className: string;
  readonly panes: readonly RailCardPane[];
}

/** A labelled column: the variant's title and note, then the rail on dark and on light. */
function VariantColumn({ variant }: { readonly variant: Variant }) {
  return (
    <div class="gxrb-column">
      <p class="gxrb-column__title">{variant.title}</p>
      <p class="gxrb-column__note">{variant.note}</p>
      {[DECK_DARK_ID, DECK_LIGHT_ID].map((themeId) => (
        <ThemeScope key={themeId} themeId={themeId} className={variant.className}>
          <Rail panes={variant.panes} />
        </ThemeScope>
      ))}
    </div>
  );
}

function Columns({ variants }: { readonly variants: readonly Variant[] }) {
  return (
    <div class="gxrb-columns">
      {variants.map((variant) => (
        <VariantColumn key={variant.id} variant={variant} />
      ))}
    </div>
  );
}

const SIZES: readonly Variant[] = [
  {
    id: "today",
    title: "Today — dot in the trailing cell, full logos",
    note: "the row as it shipped before 2026-10-06, restated by this section's own CSS because the shipped row no longer draws it: a 5px dot in the cell close takes, every logo at full ink. Asked and failed read only by that small dot.",
    className: "gxrb--today",
    panes: fiveRows(null),
  },
  {
    id: "b6",
    title: "Badge 6px, quiet logos",
    note: "6px dot, 2px ring. The least of the three that covers the logo; the ring is the part that costs the mark its corner.",
    className: "gxrb--b6",
    panes: fiveRows(null),
  },
  {
    id: "b7",
    title: "Badge 7px, quiet logos (the shipped start)",
    note: "7px dot, 2px ring, 3px outset: the values the row sheet starts at. The working row carries no dot — its bars sit in the trailing cell — and idle carries none either.",
    className: "gxrb--b7",
    panes: fiveRows(null),
  },
  {
    id: "b8",
    title: "Badge 8px, quiet logos",
    note: "8px dot, 2px ring. The loudest; on a 14px logo the badge and its ring cover about half the mark.",
    className: "gxrb--b8",
    panes: fiveRows(null),
  },
];

const FOCUSED: readonly Variant[] = [
  {
    id: "focus-b6",
    title: "Focused asked row · 6px",
    note: "the inverted fill (DL-27.22) with the ring painted in that fill. Asked keeps its yellow and the logo its full colour.",
    className: "gxrb--b6",
    panes: fiveRows(1),
  },
  {
    id: "focus-b7",
    title: "Focused asked row · 7px",
    note: "the same row at the shipped start.",
    className: "gxrb--b7",
    panes: fiveRows(1),
  },
  {
    id: "focus-b8",
    title: "Focused asked row · 8px",
    note: "the same row at 8px.",
    className: "gxrb--b8",
    panes: fiveRows(1),
  },
  {
    id: "focus-quiet",
    title: "Focused quiet row · 7px",
    note: "a done row holding the keyboard: its ink mark is the fill's own ink at reduced alpha, and its neutral dot flips to that ink like the pill and the bars do. The two rows above and below it stay quiet.",
    className: "gxrb--b7",
    panes: fiveRows(3),
  },
];

const STRENGTHS: readonly Variant[] = [
  {
    id: "q30",
    title: "Quiet at 30%",
    note: "colour images at opacity 0.3, a focused ink mark at 35% of the fill's ink. An ink mark at rest is `--text-faint` in every column — it is a token, not a value this section varies.",
    className: "gxrb--b7 gxrb--q30",
    panes: contrastRows(),
  },
  {
    id: "q40",
    title: "Quiet at 40% (the shipped start)",
    note: "opacity 0.4, focused ink at 45%. Claude is full above, quiet below; Codex is full above, quiet below, so each pair is one logo twice.",
    className: "gxrb--b7",
    panes: contrastRows(),
  },
  {
    id: "q55",
    title: "Quiet at 55%",
    note: "opacity 0.55, focused ink at 60%. The fade a colour logo can take before it stops reading as quiet and starts reading as the logo.",
    className: "gxrb--b7 gxrb--q55",
    panes: contrastRows(),
  },
];

export function RowBadgeSection() {
  return (
    <>
      <SectionHead
        title="Row badge and quiet logos"
        blurb="Owner decision 6 (2026-10-06): the state mark moves from the trailing cell onto the agent logo's corner, and the logos of rows that do not need the user go quiet, so the rows that do are the only full-colour logos in the column. The owner picks the badge size and the quiet strength here by eye. Every rail is the shipped worktree card; every column is a variant class on the scope around it."
      />
      <Specimen
        name="Badge size"
        note="today, then 6, 7 and 8px, each with quiet logos on. Dark above, light below. Rows from the top: asked (Claude), failed (Codex), done (Droid), working (Gemini), idle (Claude). Hover a row to see its ring take the hover wash."
        surface="none"
      >
        <Columns variants={SIZES} />
      </Specimen>
      <Specimen
        name="Focused row"
        note="the keyboard's row is the inverted fill; the ring and the quiet ink both have to survive it. The badge stays on the logo while the pointer is on a row; only the trailing cell yields to close."
        surface="none"
      >
        <Columns variants={FOCUSED} />
      </Specimen>
      <Specimen
        name="Quiet strength"
        note="how far a quiet logo steps back, at the 7px badge. A quiet logo has to read clearly apart from a full one in both themes, and a colour logo faded too far reads as disabled rather than as quiet."
        surface="none"
      >
        <Columns variants={STRENGTHS} />
      </Specimen>
    </>
  );
}
