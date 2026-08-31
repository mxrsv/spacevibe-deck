import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import {
  ArrowsSplit,
  ColumnsPlusRight,
  FolderOpen,
  GitBranch,
  GitFork,
  Layout,
  Path,
  Plus,
  SquareHalf,
  SquareHalfBottom,
  TerminalWindow,
} from "@phosphor-icons/react";
import { SectionHead, Specimen } from "../specimen";
import "./action-glyph-variants.css";

/**
 * Action-glyph direction review (2026-08-30).
 *
 * The owner flagged two rows of the worktree card's actions menu as wearing
 * the wrong picture:
 *
 * - **`New split here`** draws `ColumnsPlusRight` — two columns and a plus,
 *   which reads as adding a column of CHROME rather than splitting the pane
 *   the row is about.
 * - **`Create branch from here`** draws `GitBranch`, which is the SAME glyph
 *   the card's own branch badge draws two tiers above it, so the menu row and
 *   the thing it acts on are one picture.
 *
 * Everything here is a candidate, not shipping chrome: the rows are the real
 * `.asr-act` markup on the real `.asr-pop--actions` surface (only `position`
 * is neutralised, since the shipped surface is `fixed` off a trigger that does
 * not exist in a gallery), and only the glyph varies. Every candidate is a
 * `@phosphor-icons/react` name at `DeckIcon`'s own weight, so DL-14.1 does not
 * move whichever one wins.
 *
 * The third specimen is the reason this is a comparison and not a preference:
 * a glyph has to survive the COLUMN it lives in. `GitBranch`, `TerminalWindow`,
 * `FolderOpen` and `Plus` are all already drawn within ~40px of these rows —
 * on the card head's badge, on a shell row, on the Finder row and on the strip's
 * launcher — so a candidate that resembles one of them has not solved the
 * problem, it has moved it.
 */

interface GlyphCandidate {
  readonly id: string;
  readonly icon: typeof GitBranch;
  readonly note: string;
}

const SPLIT_CANDIDATES: readonly GlyphCandidate[] = [
  {
    id: "ColumnsPlusRight",
    icon: ColumnsPlusRight,
    note: "incumbent — kept in the comparison so 'no change' stays choosable",
  },
  { id: "SquareHalf", icon: SquareHalf, note: "a pane divided down the middle — the outcome" },
  { id: "SquareHalfBottom", icon: SquareHalfBottom, note: "the same, split horizontally" },
  { id: "Layout", icon: Layout, note: "a pane beside a pane, no plus" },
];

const BRANCH_CANDIDATES: readonly GlyphCandidate[] = [
  {
    id: "GitBranch",
    icon: GitBranch,
    note: "incumbent — the same picture as the card's own branch badge",
  },
  { id: "GitFork", icon: GitFork, note: "forking off, which is what the row does" },
  { id: "ArrowsSplit", icon: ArrowsSplit, note: "one path becoming two, no git vocabulary" },
  { id: "Path", icon: Path, note: "a route taken, quietest of the four" },
];

/** The neighbours a candidate must not be mistaken for. */
const NEIGHBOURS: readonly GlyphCandidate[] = [
  { id: "GitBranch", icon: GitBranch, note: "the card head's branch badge" },
  { id: "TerminalWindow", icon: TerminalWindow, note: "a shell row, and the terminal action" },
  { id: "FolderOpen", icon: FolderOpen, note: "the Finder action" },
  { id: "Plus", icon: Plus, note: "the strip's launcher and the New agent row" },
];

/** One real menu row, with the candidate in the glyph track. */
function ActionRow({
  icon,
  title,
  detail,
}: {
  readonly icon: typeof GitBranch;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <button type="button" class="asr-act">
      <span class="asr-act__glyph" aria-hidden="true">
        <DeckIcon icon={icon} size={CHROME_ICON} />
      </span>
      <span class="asr-act__title">{title}</span>
      <span class="asr-act__detail">{detail}</span>
    </button>
  );
}

/**
 * The whole menu, with ONE row's glyph swapped for a candidate.
 *
 * A glyph is judged beside the rows it will actually sit between, never on its
 * own: the agent rows above it carry brand marks, and the two OS rows below it
 * carry the folder and terminal pictures the candidate must stay distinct from.
 */
function CandidateMenu({
  candidate,
  target,
}: {
  readonly candidate: GlyphCandidate;
  readonly target: "split" | "branch";
}) {
  return (
    <div class="gxag-menu">
      <div class="asr-pop asr-pop--actions gxag-pop">
        <button type="button" class="asr-act">
          <span class="asr-act__glyph" aria-hidden="true">
            <AgentGlyph agent="claude" className="asr-act__logo" />
          </span>
          <span class="asr-act__title">Run Claude</span>
          <span class="asr-act__detail">Sonnet 4.5</span>
        </button>
        <div class="asr-pop__sep" />
        <ActionRow
          icon={target === "split" ? candidate.icon : ColumnsPlusRight}
          title="New split here"
          detail="Open a pane beside this tab"
        />
        <ActionRow
          icon={target === "branch" ? candidate.icon : GitBranch}
          title="Create branch from here"
          detail="Branch off main"
        />
        <div class="asr-pop__sep" />
        <ActionRow icon={FolderOpen} title="Open in Finder" detail="Reveal this folder" />
        <ActionRow icon={TerminalWindow} title="Open terminal here" detail="Terminal" />
      </div>
      <p class="gxag-menu__word">
        <strong>{candidate.id}</strong>
        <span>{candidate.note}</span>
      </p>
    </div>
  );
}

/** The glyphs alone, magnified, for the shapes a 13px row cannot settle. */
function GlyphStrip({ items }: { readonly items: readonly GlyphCandidate[] }) {
  return (
    <div class="gxag-strip">
      {items.map((item) => (
        <div class="gxag-cell" key={item.id}>
          <span class="gxag-cell__zoom">
            <DeckIcon icon={item.icon} size={CHROME_ICON} />
          </span>
          <strong>{item.id}</strong>
          <span class="gxag-cell__note">{item.note}</span>
        </div>
      ))}
    </div>
  );
}

export function ActionGlyphVariantsSection() {
  return (
    <>
      <SectionHead
        title="Actions menu glyph direction"
        blurb="Proposals only — none of this is shipping chrome. Two rows of the worktree card's actions menu wear a picture that says the wrong thing: New split here draws two columns and a plus, and Create branch from here draws the same GitBranch the card's own badge draws. Every candidate is a Phosphor name at DeckIcon's weight, so DL-14.1 does not move whichever wins."
      />
      <Specimen
        name="New split here — four candidates, in the menu"
        note="the row is the real .asr-act on the real .asr-pop--actions surface; only this row's glyph varies, so the neighbours are the control"
        surface="bg"
      >
        <div class="gxag-compare">
          {SPLIT_CANDIDATES.map((candidate) => (
            <CandidateMenu key={candidate.id} candidate={candidate} target="split" />
          ))}
        </div>
      </Specimen>
      <Specimen
        name="Create branch from here — four candidates, in the menu"
        note="the incumbent is the card badge's own picture; the question is which of the other three says 'fork a new branch off this checkout' at 13px"
        surface="bg"
      >
        <div class="gxag-compare">
          {BRANCH_CANDIDATES.map((candidate) => (
            <CandidateMenu key={candidate.id} candidate={candidate} target="branch" />
          ))}
        </div>
      </Specimen>
      <Specimen
        name="The glyphs alone, magnified"
        note="13px of ink is not something an eye review settles at 1x — the zoom is a transform on the shipped size, not a redraw at another one"
        surface="chrome-1"
      >
        <div class="gxag-zoomrow">
          <div>
            <p class="gxag-zoomrow__head">split candidates</p>
            <GlyphStrip items={SPLIT_CANDIDATES} />
          </div>
          <div>
            <p class="gxag-zoomrow__head">branch candidates</p>
            <GlyphStrip items={BRANCH_CANDIDATES} />
          </div>
        </div>
      </Specimen>
      <Specimen
        name="What it must not be mistaken for"
        note="every one of these is already drawn within ~40px of the menu — a candidate that resembles one has moved the collision, not solved it"
        surface="chrome-1"
      >
        <GlyphStrip items={NEIGHBOURS} />
      </Specimen>
    </>
  );
}
