import { RailStatusMark } from "../../ui/agent-rail";
import type { RailState } from "../../ui/agent-rail-model";
import type { SignalConfidence } from "../../terminal/agent-attention";
import { agentRailNavigationSpecimen } from "../chrome-fixtures";
import { SectionHead, Specimen, SpecimenRow } from "../specimen";
import "./signal-mark-variants.css";

/**
 * Signal-mark direction review (2026-09-03) — the agent-signal contract
 * layer's stage 0 drawings, for the owner's eye.
 *
 * Two questions, both about ink DL-27.3 did not carry before:
 *
 * 1. **How does an INFERRED state look beside an explicit one?** The tracker
 *    has always known whether an `asked`/`done` came from the CLI's own OSC
 *    9;4 or from "3 s of silence after a streak" (`confidence`), and the rail
 *    drew both with one pen — so every yellow mark on a codex/opencode/gemini
 *    row was a guess wearing the certainty of a fact (trust audit §4.8).
 * 2. **How does an agent that ENDED look?** A working agent that died latched
 *    an inferred `completed` and wore `asked`'s yellow (§4.3); it is the
 *    rail's sixth word now, and needs a drawing that is neither a failure
 *    (`--red` is the CLI's own error) nor a question.
 *
 * The spec (`docs/specs/2026-09-03-agent-signal-contract-layer-design.md`
 * stage 0) names the default — hollow for inferred — and asks for candidates
 * to be DRAWN rather than described, per the owner's standing rule that ink is
 * chosen by eye. Variant A is what ships in `04a-agent-rail.css` today; B and
 * C are alternatives under a wrapper class, on the REAL `RailStatusMark` and
 * the REAL `AgentRail`, so the comparison is honest and every other state is
 * the control. When the owner picks, this section is parked the way
 * `unread-mark-variants` was.
 */

interface MarkSpec {
  readonly state: RailState;
  readonly confidence: SignalConfidence;
  readonly word: string;
}

/** Every drawn state, explicit and inferred side by side where both exist. */
const MARKS: readonly MarkSpec[] = [
  { state: "failed", confidence: "explicit", word: "failed" },
  { state: "asked", confidence: "explicit", word: "asked" },
  { state: "asked", confidence: "inferred", word: "asked · inferred" },
  { state: "ended", confidence: "explicit", word: "ended" },
  { state: "working", confidence: "explicit", word: "working" },
  { state: "done", confidence: "explicit", word: "done" },
  { state: "done", confidence: "inferred", word: "done · inferred" },
  { state: "idle", confidence: "unknown", word: "idle" },
];

type SignalVariant = "hollow" | "small" | "dashed";

interface VariantSpec {
  readonly id: SignalVariant;
  readonly title: string;
  readonly note: string;
}

const CONFIDENCE_VARIANTS: readonly VariantSpec[] = [
  {
    id: "hollow",
    title: "A · hollow ring (ships)",
    note: "the 9px dot becomes a 1.5px ring in the same hue — same footprint, same colour, the fill is what says 'a fact'",
  },
  {
    id: "small",
    title: "B · smaller dot",
    note: "a 6px filled dot instead of 9px — reads as 'less' rather than 'unsure', and shifts the eye's centre a hair",
  },
  {
    id: "dashed",
    title: "C · dashed ring",
    note: "a 1.5px dashed ring — says 'guess' loudest, at the cost of a texture nothing else in the chrome uses",
  },
];

type EndedVariant = "square" | "ring" | "slash";

interface EndedSpec {
  readonly id: EndedVariant;
  readonly title: string;
  readonly note: string;
}

const ENDED_VARIANTS: readonly EndedSpec[] = [
  {
    id: "square",
    title: "A · stop square (ships)",
    note: "a 7px square in the quiet gray — the stop glyph; the one non-round mark in the column, so it is seen before it is read",
  },
  {
    id: "ring",
    title: "B · hollow gray ring",
    note: "the `done` dot hollowed — 'was here, is gone' — but it collides with an inferred `done`, which is also a hollow gray ring",
  },
  {
    id: "slash",
    title: "C · slashed dot",
    note: "the gray dot with a diagonal cut through it — unambiguous, and the only mark drawn from two shapes",
  },
];

/**
 * All eight drawn states in one row: the question "does an inferred mark
 * read as a guess, and does ended read as neither failure nor question" is
 * answered by one glance along the line.
 */
function MarkStrip({ variant }: { readonly variant: string }) {
  return (
    <div class={`gxs-strip gxs-v--${variant}`}>
      {MARKS.map((mark) => (
        <div class="gxs-cell" key={`${mark.state}-${mark.confidence}`}>
          <RailStatusMark state={mark.state} confidence={mark.confidence} />
          <span class="gxs-cell__word">{mark.word}</span>
        </div>
      ))}
    </div>
  );
}

/** One mark at 4x — the choice is 1-2px of ink, which no 1x still settles. */
function ZoomedMark({
  variant,
  state,
  confidence,
}: {
  readonly variant: string;
  readonly state: RailState;
  readonly confidence: SignalConfidence;
}) {
  return (
    <div class="gxs-zoom">
      <div class={`gxs-zoom__box gxs-v--${variant}`}>
        <RailStatusMark state={state} confidence={confidence} />
      </div>
      <span class="gxs-zoom__word">{variant}</span>
    </div>
  );
}

/** The real rail on the seeded stores, which carry an inferred asked, an inferred done and an ended pane. */
function VariantRail({ variant }: { readonly variant: string }) {
  return (
    <div class={`gxs-rail gxs-v--${variant}`}>
      {agentRailNavigationSpecimen({ showFooter: false })}
    </div>
  );
}

export function SignalMarkVariantsSection() {
  return (
    <>
      <SectionHead
        title="Signal mark direction"
        blurb="Stage 0 of the agent-signal contract layer. The rail's mark now says how much to trust itself (DL-27.3, amended 2026-09-03): an asked or done that Deck INFERRED from output timing is drawn differently from one the CLI SAID, and an agent whose process left the pane is a sixth word, ended. Variant A of each row is what ships; B and C are drawn for the owner's eye on the real RailStatusMark and the real AgentRail."
      />
      <Specimen
        name="Inferred vs explicit — three treatments"
        note="scan each row: does the inferred asked/done read as a guess beside its explicit twin, without reading as a different STATE"
        surface="chrome-1"
      >
        <div class="gxs-compare">
          {CONFIDENCE_VARIANTS.map((variant) => (
            <div class="gxs-compare__row" key={variant.id}>
              <span class="gxs-compare__title">{variant.title}</span>
              <MarkStrip variant={variant.id} />
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        name="Ended — three treatments"
        note="scan each row: does ended read as neither a failure (red) nor a question (yellow) nor a quiet done, at a glance"
        surface="chrome-1"
      >
        <div class="gxs-compare">
          {ENDED_VARIANTS.map((variant) => (
            <div class="gxs-compare__row" key={variant.id}>
              <span class="gxs-compare__title">{variant.title}</span>
              <MarkStrip variant={variant.id} />
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        name="The inferred asked and the ended mark at 4x"
        note="the same marks magnified — a transform, so it is the shipped geometry at another size, not a redrawing"
        surface="chrome-1"
      >
        <div class="gxs-zooms">
          {CONFIDENCE_VARIANTS.map((variant) => (
            <ZoomedMark key={variant.id} variant={variant.id} state="asked" confidence="inferred" />
          ))}
          {ENDED_VARIANTS.map((variant) => (
            <ZoomedMark key={variant.id} variant={variant.id} state="ended" confidence="explicit" />
          ))}
        </div>
      </Specimen>
      <Specimen
        name="Side by side on the real rail"
        note="the seeded rail carries an inferred asked (codex), an inferred done (codex, test sweep) and an ended agy — judged in the column they ship in"
        surface="none"
      >
        <SpecimenRow>
          {CONFIDENCE_VARIANTS.map((variant) => (
            <div class="gxs-study" key={variant.id}>
              <span class="gxs-study__title">{variant.title}</span>
              <span class="gxs-study__note">{variant.note}</span>
              <VariantRail variant={variant.id} />
            </div>
          ))}
        </SpecimenRow>
      </Specimen>
    </>
  );
}
