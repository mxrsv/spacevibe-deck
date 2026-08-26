import { useSignal } from "@preact/signals";
import { Folder, GitBranch, Plus, PlusSquare, X } from "@phosphor-icons/react";
import type { PaneAgent } from "../lib/process-info";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "../ui/controls/deck-icon";

/**
 * Gallery-only candidate: the rail's worktree tier drawn as a CARD that opens
 * to its agents, from the owner's two mockups (2026-08-25).
 *
 * Proposal, not chrome. `src/ui/agent-rail.tsx` remains the one shipped rail
 * and nothing here may move into `src/styles/`: shipping this restates DL §27
 * — DL-27.23/27.24 (the worktree tier is a bare LABEL with one launcher, no
 * caret, no frame), DL-27.15 (a row's one line carries the agent's newest
 * turn) and DL-27.3 (the state vocabulary and its three painted hues) all
 * change at once, and the status words below need a rule of their own.
 *
 * What the shipped rail draws today, for comparison:
 *
 *   project cluster header
 *     worktree sub-header  (branch, a `+`, no box)
 *       tab row            (mark · agent chip · the agent's newest sentence · age)
 *         agent leaf rows  (multi-agent tabs only, inside DL-27.19's frame)
 *
 * What this candidate draws:
 *
 *   project cluster header
 *     bare worktree label  (a checkout with no agents — `main` in the mockup)
 *     worktree CARD        (mark · checkout name · branch badge · caret)
 *       meta line          (age, muted)
 *       collapsed: agent chips in one row
 *       open:      a list of agent rows under its count, plus `New agent`
 *
 * Three divergences from the current app are deliberate and unresolved — they
 * are what the picture exists to decide, so they are drawn rather than
 * silently normalised:
 *
 *  1. **The unit.** A card is a CHECKOUT and its rows are agents, so the tab
 *     tier disappears from the rail. Deck's model has project → worktree → tab
 *     → pane; the mockup flattens the middle two. `Claude (Split)` in the
 *     mockup is a pane label, which is why the reading here is "every pane
 *     running in this checkout", not "one tab".
 *  2. **The state vocabulary.** `Running` / `Thinking` / `Idle` are new words:
 *     the rail's five states are `failed` / `asked` / `working` / `done` /
 *     `idle`, nothing distinguishes thinking from working, and `--magenta` has
 *     not painted chrome since the neutral-ink pass (DL-3.6, 2026-08-17). The
 *     card's own dot is green for a live checkout, and green is not one of the
 *     three hues DL-27.3 admits.
 *  3. **What the row says.** The agent's newest sentence is gone from the row,
 *     which DL-27.15 put there on the owner's ask. The row is glyph, name and
 *     the agent's MODEL; state survives as the 5px dot alone.
 *  4. **The active checkout is framed in ACCENT.** DL-21.1 gives the selected
 *     item a neutral `--hair-strong` frame; the owner's second reference wraps
 *     the whole active card in the state's own green, so selection and liveness
 *     share one hue. That is a fourth rule to settle, not a styling detail.
 *  5. **The group label.** The reference prints `AGENTS`, and DL-4.3 bans
 *     uppercase as a styling device — an exception §16 used to grant and which
 *     is CLOSED. The label reads `Agents` here rather than silently reopening
 *     it; making it faithful is one `text-transform` and a rule change.
 *  6. **The branch is a badge beside the checkout's name.** Two facts on one
 *     row where DL-27.23 prints one, and they are near-duplicates in a real
 *     checkout (`bench.ai-terminal` beside `feature/ai-terminal`) — which is
 *     also why the row is so tight that the caret had to go. The badge is
 *     monospace in the reference, which DL-4.1 reserves for the terminal.
 *
 * One more open question, left exactly as the mockups drew it: in the second
 * image the two closed cards collapse to a SINGLE line — no meta, no chips —
 * while in the first they keep all three. Both are rendered, so the choice is
 * visible: either an open card compacts its siblings (an accordion), or the
 * mockups simply disagree.
 *
 * Prefix `gxwc-`, its own file and stylesheet, because `gxa-`
 * (`agent-rail-variants`) and `gxs-` (`rail-structure-variants`) are taken and
 * this is a third question: not how a row is painted, and not what a row IS,
 * but which LEVEL of the hierarchy carries the box.
 */

/** The mockup's words. `asked`/`failed` are Deck's own, kept so the loud states can be drawn. */
type CardStatus = "running" | "thinking" | "idle" | "asked" | "failed";

const STATUS_WORD: Readonly<Record<CardStatus, string>> = {
  running: "Running",
  thinking: "Thinking",
  idle: "Idle",
  asked: "Needs you",
  failed: "Failed",
};

interface CardPane {
  readonly agent: PaneAgent;
  /**
   * What the row calls this pane. The mockup's `Claude (Split)` is why this is
   * a field and not `agent`: two panes of one agent in one checkout have to be
   * told apart, and today's rail does that with the turn text instead.
   */
  readonly label: string;
  readonly status: CardStatus;
  /**
   * The model this agent is on, as the trailing pill — the reference's own
   * trailing slot. Deck knows it: `agentModels` in the settings schema.
   */
  readonly model: string;
  /**
   * Holds the window's keyboard, drawn as a stronger wash. Same fact DL-27.22
   * already marks in the shipped rail, and the reference's own second row.
   */
  readonly focused: boolean;
}

interface WorktreeCard {
  /**
   * The checkout's own directory basename — the card's title since the branch
   * moved into a badge (owner, 2026-08-25).
   *
   * These are two facts, and the shipped rail prints only ONE: DL-27.23 labels
   * a worktree group by its branch, falling back to the basename when git
   * reports none. Naming both puts near-duplicate text on one row, and at
   * 275px it is a hard fit: the fixture uses `git worktree add ../ai-terminal
   * feature/ai-terminal`'s own short basenames, which fit. A checkout named
   * after its project — `bench.ai-terminal`, the shape the reference itself
   * shows — is MEASURED to truncate both strings, even with the caret gone.
   * That is the question this arrangement asks, not a detail to tune away.
   */
  readonly name: string;
  /** The branch, drawn as the trailing badge on the same row as `name`. */
  readonly branch: string;
  readonly age: string;
  /** The head's dot: green when work is moving here, neutral otherwise. */
  readonly live: boolean;
  /**
   * The checkout the window is currently working in — the accent frame wraps
   * the WHOLE card for it (owner, 2026-08-25, from a second reference).
   *
   * Deliberately independent of `open`: the two coincide in the fixture, but
   * expanding a card is a disclosure and being active is a fact about the
   * window, and one flag standing for both would make the frame read as "this
   * is the one you clicked open".
   */
  readonly active: boolean;
  readonly panes: readonly CardPane[];
}

/** A checkout with nothing running: the card's head row, minus the card. */
interface BareWorktree {
  readonly name: string;
  readonly branch: string;
}

interface ClusterFixture {
  readonly project: string;
  readonly bare: readonly BareWorktree[];
  readonly cards: readonly WorktreeCard[];
}

/** The owner's mockup, transcribed: one repository, four checkouts, six agents. */
const CLUSTER: ClusterFixture = {
  project: "spacevibe-bench",
  bare: [{ name: "bench", branch: "main" }],
  cards: [
    {
      name: "ai-terminal",
      branch: "feature/ai-terminal",
      age: "now",
      live: true,
      active: true,
      panes: [
        {
          agent: "claude",
          label: "Claude",
          status: "running",
          model: "Sonnet 4.5",
          focused: true,
        },
        { agent: "codex", label: "Codex", status: "thinking", model: "GPT-5.1", focused: false },
        {
          agent: "cursor-agent",
          label: "Cursor CLI",
          status: "idle",
          model: "Composer",
          focused: false,
        },
        // Two past `STRIP_VISIBLE`, so the collapsed strip's `+N` tail is a real
        // case in the picture rather than a branch nothing exercises.
        {
          agent: "opencode",
          label: "OpenCode",
          status: "asked",
          model: "Sonnet 4.5",
          focused: false,
        },
        { agent: "gemini", label: "Gemini", status: "idle", model: "2.5 Pro", focused: false },
      ],
    },
    {
      name: "sidebar-ui",
      branch: "bugfix/sidebar-ui",
      age: "2m",
      live: false,
      active: false,
      panes: [
        { agent: "claude", label: "Claude", status: "asked", model: "Sonnet 4.5", focused: false },
        {
          agent: "codex",
          label: "Claude (Split)",
          status: "asked",
          model: "Sonnet 4.5",
          focused: false,
        },
      ],
    },
    {
      name: "docs-update",
      branch: "chore/docs-update",
      age: "4m",
      live: false,
      active: false,
      panes: [
        { agent: "codex", label: "Codex", status: "asked", model: "GPT-5.1", focused: false },
      ],
    },
  ],
};

/** An icon-only chrome control. `padding: 0` is in the sheet — see the known trap on `.iconbtn`. */
function IconButton({
  icon,
  label,
  size = CHROME_ICON,
}: {
  readonly icon: typeof X;
  readonly label: string;
  readonly size?: typeof CHROME_ICON | typeof FEATURE_ICON;
}) {
  return (
    <button type="button" class="gxwc-iconbtn" aria-label={label} title={label}>
      <DeckIcon icon={icon} size={size} />
    </button>
  );
}

/**
 * One agent, as a list row.
 *
 * The whole row is the button — the reference draws no trailing control, and
 * once the row itself is pressable the separate focus glyph was an affordance
 * for something already pressable. `title` carries the state word the row no
 * longer prints, so `Thinking` is still reachable (DL-27.2's rule that the mark
 * is never the only read).
 */
/**
 * The branch, as a badge (owner, 2026-08-25, from two crops of a reference).
 *
 * `accent` is the active checkout's branch: the reference draws that one in
 * green ink on a green wash and every other one neutral, so the badge carries
 * the same fact the card's frame does.
 *
 * The reference sets it in MONOSPACE. It is drawn in `--ui-font` here because
 * DL-4.1 reserves the monospace face for the terminal and chrome declares no
 * `--mono` token at all — making it faithful is one `font-family` and a rule
 * change, the same shape as the `AGENTS` casing question above.
 */
function BranchBadge({ branch, accent }: { readonly branch: string; readonly accent: boolean }) {
  return (
    <span class="gxwc-branch" data-accent={accent}>
      <DeckIcon icon={GitBranch} size={CHROME_ICON} />
      <span class="gxwc-branch__name">{branch}</span>
    </span>
  );
}

/** How many segments the strip prints before it collapses the rest into `+N`. */
const STRIP_VISIBLE = 3;

/** Statuses that mean the machine is busy, and therefore wear the loading mark. */
const BUSY: ReadonlySet<CardStatus> = new Set<CardStatus>(["running", "thinking"]);

/**
 * The live mark inside a strip segment.
 *
 * **One loading shape for every busy agent** (owner, 2026-08-25): the bars —
 * Claude's own waveform in the reference. The reference actually draws two, a
 * waveform for one agent and a dotted ring for the other, and that was built
 * first; two shapes made a running agent and a thinking one look like different
 * KINDS of thing when the only difference is which state they are in. The ring
 * and its rotation are deleted.
 *
 * Tint comes from the STATE, not the agent. The reference colours each mark to
 * its agent's brand (orange by the Claude glyph, purple by the Codex one) and
 * Deck has no brand-colour token — `AGENT_LOGOS` are images, and DL-3.6 took
 * hue out of chrome ink on purpose. State hue also keeps a segment agreeing
 * with the glow on that same agent's open row.
 *
 * `idle` draws nothing, the way the rail paints nothing for `done`/`idle`.
 */
function AgentActivity({ status }: { readonly status: CardStatus }) {
  if (BUSY.has(status)) {
    return (
      <span class="gxwc-act gxwc-act--bars" data-status={status} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (status === "idle") {
    return null;
  }
  return <span class="gxwc-act gxwc-act--dot" data-status={status} aria-hidden="true" />;
}

/**
 * A collapsed card's agents, as one segmented bar (owner, 2026-08-25).
 *
 * It replaces the wrapping chip row, and **the agent name is gone with it** —
 * the owner's ask. A segment is the brand glyph plus a live mark, which is what
 * makes three of them fit in the width two named chips used, and what makes the
 * `+N` tail possible at all: the strip caps at `STRIP_VISIBLE` and folds the
 * rest into one segment rather than wrapping to a second line.
 *
 * The name has to keep existing somewhere, so every segment carries it in
 * `title` alongside the state word — DL-27.2's rule that the mark is the fast
 * read and never the only read.
 */
function AgentStrip({ panes }: { readonly panes: readonly CardPane[] }) {
  const visible = panes.slice(0, STRIP_VISIBLE);
  const hidden = panes.length - visible.length;
  return (
    <div class="gxwc-strip">
      {visible.map((pane) => (
        <span
          key={pane.label}
          class="gxwc-strip__seg"
          title={`${pane.label} — ${STATUS_WORD[pane.status]}`}
        >
          <AgentGlyph agent={pane.agent} className="gxwc-strip__logo" />
          <AgentActivity status={pane.status} />
        </span>
      ))}
      {hidden > 0 && (
        <span class="gxwc-strip__more" title={`${hidden} more in this checkout`}>
          +{hidden}
        </span>
      )}
    </div>
  );
}

function AgentRow({ pane }: { readonly pane: CardPane }) {
  return (
    <button
      type="button"
      class="gxwc-agent"
      data-status={pane.status}
      data-focused={pane.focused}
      aria-current={pane.focused}
      title={`${pane.label} — ${STATUS_WORD[pane.status]}`}
    >
      {/* The dot BADGES the glyph's corner rather than taking a leading track of
          its own (owner, 2026-08-25). Same idiom the simplicity-ladder specimen
          uses (`gxs-lad__glyph[data-badge]`) and the one the deleted chips had:
          the state belongs TO the agent, so it reads better attached to the
          agent's own mark than as a bullet a column away from it. */}
      <span class="gxwc-agent__mark">
        <AgentGlyph agent={pane.agent} className="gxwc-agent__logo" />
        <span class="gxwc-agent__dot" data-status={pane.status} aria-hidden="true" />
      </span>
      <span class="gxwc-agent__name">{pane.label}</span>
      <span class="gxwc-agent__model">{pane.model}</span>
      {/* After the model pill (owner, 2026-08-25) — the SAME mark the collapsed
          strip uses, so an agent looks the same whichever state the card is in.
          The track it sits in is reserved whether or not this row draws one, so
          the model pills stay on one right edge down the list.
          BUSY only: `asked`/`failed` are already stated by the dot at the head of
          this row, and a second disc at its tail would say it twice. */}
      {BUSY.has(pane.status) && <AgentActivity status={pane.status} />}
    </button>
  );
}

/**
 * One checkout. `open` draws the agent rows; `compact` is the single-line
 * shape the second mockup gives a closed card while a sibling is open.
 *
 * A compact card is the head ALONE — no age either. It carried one while the
 * head still had room, and the branch badge took that room: `chore/docs-update`
 * is a 124px badge, which left 61px for a name needing 84 and clipped
 * `docs-update` to `docs-up…`. The age lives on the meta line, and a compact row
 * only exists while a sibling is open, so it is the cheaper thing to drop.
 *
 * The head's trailing slot is EMPTY, and that was forced by measurement rather
 * than chosen. It held the loudest agent's brand mark (from the first mockup),
 * the owner took that off, and a caret replaced it. Then the branch became a
 * badge on the same row as the checkout name — and at the real 275px a mark, a
 * name, a branch and a caret do not fit: with the caret present every name
 * truncated (`bench.ai...`, `benc...`) and two of three branches truncated too.
 * The caret's 19px is almost exactly the deficit, and the reference's own
 * worktree row carries no caret either — the whole card is the button. So the
 * disclosure has no glyph now, which is a real loss of affordance and the
 * cheapest thing on the row to give up.
 *
 * The open block carries NO TREE and no frame (owner, 2026-08-25, third
 * reference). The stem, the branches and DL-27.19's surrounding hairline are
 * deleted, not hidden: the rows are a plain LIST — each one its own washed
 * block, separated by 2px of the card showing through — under an `Agents`
 * header that states the count, and closed by a `New agent` row. What the tree
 * was drawing (these rows belong to that checkout) the card's own frame already
 * says, which is why it could go without anything replacing it.
 */
function Card({
  card,
  open,
  compact,
  onToggle,
}: {
  readonly card: WorktreeCard;
  readonly open: boolean;
  readonly compact: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <article class="gxwc-card" data-open={open} data-compact={compact} data-active={card.active}>
      <button type="button" class="gxwc-card__head" aria-expanded={open} onClick={onToggle}>
        <span class="gxwc-card__mark" data-live={card.live} aria-hidden="true" />
        <span class="gxwc-card__name">{card.name}</span>
        <BranchBadge branch={card.branch} accent={card.active} />
      </button>

      {/* The age alone. The path and the agent count stood here and the owner
          cut both (2026-08-25): the count is said again two rows down by
          `N active`, and the path is derivable from the checkout name beside a
          project header that already names the repository. */}
      {!compact && <p class="gxwc-card__meta">{card.age}</p>}

      {!compact &&
        (open ? (
          <div class="gxwc-agents">
            {/* The count alone — no `Agents` label (owner, 2026-08-25). The
                rows below are self-evidently agents, and dropping it also
                sidesteps DL-4.3's closed uppercase exception, which the
                reference's own `AGENTS` would have reopened. */}
            <div class="gxwc-agents__head">
              <span class="gxwc-agents__count">{card.panes.length} active</span>
            </div>
            {card.panes.map((pane) => (
              <AgentRow key={pane.label} pane={pane} />
            ))}
            <button type="button" class="gxwc-agent gxwc-agent--new">
              <span class="gxwc-agent__plus" aria-hidden="true">
                <DeckIcon icon={Plus} size={CHROME_ICON} />
              </span>
              <span class="gxwc-agent__name">New agent</span>
            </button>
          </div>
        ) : (
          <AgentStrip panes={card.panes} />
        ))}
    </article>
  );
}

/**
 * The rail at the width the window shell actually gives it (275px), so the
 * three-line card can be judged against the space it has rather than against
 * the mockup's own canvas.
 *
 * `initialOpen` decides which mockup this column is: `null` draws the first
 * image (every card closed and three lines tall), an index draws the second
 * (that card open, its siblings compacted to one line). Both are live — the
 * heads are real buttons, so the transition between the two pictures is what
 * the pointer sees, not two frozen drawings.
 */
function CardRail({ initialOpen }: { readonly initialOpen: number | null }) {
  const open = useSignal<number | null>(initialOpen);
  return (
    <nav class="gxwc-rail" aria-label="Agents (candidate)">
      <div class="gxwc-cluster">
        <div class="gxwc-cluster__head">
          <span class="gxwc-cluster__folder" aria-hidden="true">
            <DeckIcon icon={Folder} size={FEATURE_ICON} />
          </span>
          <span class="gxwc-cluster__name">{CLUSTER.project}</span>
          <IconButton
            icon={PlusSquare}
            label={`New agent in ${CLUSTER.project}`}
            size={FEATURE_ICON}
          />
          <IconButton icon={X} label={`Close ${CLUSTER.project}`} />
        </div>

        {CLUSTER.bare.length > 0 && (
          <>
            {CLUSTER.bare.map((worktree) => (
              <div key={worktree.name} class="gxwc-bare">
                <span class="gxwc-bare__mark" aria-hidden="true" />
                <span class="gxwc-bare__name">{worktree.name}</span>
                <BranchBadge branch={worktree.branch} accent={false} />
              </div>
            ))}
          </>
        )}

        <div class="gxwc-cards">
          {CLUSTER.cards.map((card, index) => (
            <Card
              key={card.branch}
              card={card}
              open={open.value === index}
              compact={open.value !== null && open.value !== index}
              onToggle={() => {
                open.value = open.value === index ? null : index;
              }}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

/**
 * Both mockups side by side, at rail width, live.
 *
 * Left is the first image: nothing open, so every checkout states its agents.
 * Right is the second: one checkout open onto its agent list, its siblings down
 * to one line each.
 */
export function railWorktreeCardsSpecimen() {
  return (
    <div class="gxwc-variants">
      <article class="gxwc-variant">
        <div class="gxwc-variant__head">
          <span class="gxwc-variant__index">1</span>
          <span class="gxwc-variant__title">closed — every checkout, three lines</span>
          <span class="gxwc-variant__note">
            mark · checkout name · branch badge; then the age alone; then the agents as ONE
            segmented strip — glyph plus a live mark per segment, NO NAME, capped at three with the
            rest folded into `+N`. A busy agent wears the same loading mark in the same ONE hue
            whichever busy state it is in; `idle` draws none. A checkout with nothing running
            (`bench`) is the same row minus the card — no tree, no guide; column alignment alone
            puts it under the project. The ACTIVE checkout is wrapped whole in accent AND takes the
            green branch badge, visible here on a card that is not open, which is the point of
            keeping active and open apart. Two radii only: 6px on every box, 3px on the two small
            pills. Measured at the real 275px: the head has 213px for a name and a branch, so
            `ai-terminal` + `feature/ai-terminal` fit with nothing cut — but only after the caret
            came off (its 19px was the whole deficit) and only for short worktree basenames. A
            checkout named after its project, `bench.ai-terminal`, truncates BOTH strings, which is
            the reference's own shape. Three segments plus the `+2` tail come to 155px of 239.
          </span>
        </div>
        <CardRail initialOpen={null} />
      </article>
      <article class="gxwc-variant">
        <div class="gxwc-variant__head">
          <span class="gxwc-variant__index">2</span>
          <span class="gxwc-variant__title">open — one checkout, one row per agent</span>
          <span class="gxwc-variant__note">
            no tree and no frame: the agents are a plain list under a header that states the count,
            closed by a `New agent` row, and the whole row is the button. Each row is glyph · name ·
            model pill, with state down to the 5px dot and the focused agent taking a stronger wash
            (DL-27.22). The closed siblings drop to one line — drawn as the mockup drew it, and an
            open question.
          </span>
        </div>
        <CardRail initialOpen={0} />
      </article>
    </div>
  );
}

/** The busy-hue candidates, in the order they escalate. */
const BUSY_HUES: readonly { readonly id: string; readonly title: string; readonly note: string }[] =
  [
    {
      id: "neutral",
      title: "busy is NEUTRAL",
      note: "the quietest option: colour stays reserved for the two states that want your eyes, and the bars still carry the motion. It is NOT rule-free — DL-27.3 does not say neutral means working, it says working is not a dot at all (it is WorkspaceSpinner in a 14px box) and that done/idle share the gray one. AGENTS.md's summary line says otherwise and is stale.",
    },
    {
      id: "magenta",
      title: "busy is --magenta",
      note: "spends a hue to make busy loud. --magenta has been out of chrome since DL-3.6 went neutral (2026-08-17), so this is a rule change, not a token pick.",
    },
    {
      id: "cyan",
      title: "busy is --cyan",
      note: "the same trade in a cooler hue. Closer to --accent than magenta is, so a segment and the +N tail sit nearer each other than they should.",
    },
  ];

/**
 * The colour rule, drawn three ways (owner, 2026-08-25: "phải có quy định về
 * color").
 *
 * The report was green and purple on two rows that mean the same thing, and it
 * turned out to be two faults at once. **Both are fixed in the stylesheet, not
 * offered here:** `running` and `thinking` now share one hue, and `--green`
 * stopped doing double duty — it was the running hue AND the active card's
 * frame, so "this agent is working" and "this is the checkout you are in" were
 * one colour. Green now means the active checkout and nothing else.
 *
 * What is left to choose is WHICH hue busy takes, so that is what these three
 * columns vary — one `--gxwc-busy` line each, everything else identical. Each
 * candidate is checked against the rest of the vocabulary: none of them is the
 * active card's green, `asked`'s yellow, `failed`'s red, or the `+N` accent.
 */
export function railColorRuleSpecimen() {
  return (
    <div class="gxwc-variants">
      {BUSY_HUES.map((hue, index) => (
        <article key={hue.id} class="gxwc-variant">
          <div class="gxwc-variant__head">
            <span class="gxwc-variant__index">{String.fromCharCode(65 + index)}</span>
            <span class="gxwc-variant__title">{hue.title}</span>
            <span class="gxwc-variant__note">{hue.note}</span>
          </div>
          <div class="gxwc-pal" data-busy={hue.id}>
            <CardRail initialOpen={0} />
          </div>
        </article>
      ))}
    </div>
  );
}
