import { RailStatusMark } from "../../ui/agent-rail";
import type { RailState } from "../../ui/agent-rail-model";
import { agentRailNavigationSpecimen } from "../chrome-fixtures";
import { SectionHead, Specimen, SpecimenRow } from "../specimen";
import "./unread-mark-variants.css";

/**
 * Unread mark direction review (2026-08-25). PARKED THE SAME DAY: the owner
 * chose candidate C, it shipped into `04a-agent-rail.css`, and this section
 * left `section-registry.ts` — the `current` column stopped being current the
 * moment it did. Nothing here is imported by anything; the file is the record
 * of what the choice was made against, and re-registering it is how a future
 * reversal gets its comparison back.
 *
 * Read the variants below as candidates, not as shipping chrome: none of this
 * CSS is loaded by the renderer, and `ripple` here is the drawing the shipped
 * rule was written from, not the rule itself.
 *
 * The question the owner asked: the unread dot has to RADIATE, so it reads
 * apart from the other states in the same column. `asked` is the rail's unread
 * state (`agent-rail-model` folds `completed` into it), painted in
 * `--status-unread` by `.asr-row__mark[data-state="asked"]::before`.
 *
 * Every variant is the REAL `RailStatusMark` and the REAL `AgentRail` under a
 * wrapper class; only the `asked` treatment varies, so the comparison is
 * honest and the other four states are the control.
 *
 * DL cost, stated per variant because it is the thing being chosen:
 * - `ring`  restores the shape DL-27.3 retired. A border, not a shadow, so
 *   DL-1.2 and DL-1.3 are untouched; it amends DL-27.3 alone.
 * - `glow`  a NON-blurred, non-offset `box-shadow` spread. DL-1.3 bans the
 *   blurred/offset kind and permits the inset hairline; a spread ring is
 *   neither, so it is new territory the amendment has to name rather than
 *   slip past.
 * - `ripple` is the literal reading and the expensive one: DL-1.2 bans
 *   infinite animation AND animation while the user is idle — which is
 *   exactly when an unread dot exists. It needs a scoped exception on
 *   DL-18.11's precedent.
 */

/** The five DL-27.3 states in the rail's own severity order. */
const STATES: readonly RailState[] = ["failed", "asked", "working", "done", "idle"];

type UnreadVariant = "current" | "ring" | "glow" | "ripple";

interface VariantSpec {
  readonly id: UnreadVariant;
  readonly title: string;
  readonly note: string;
}

const VARIANTS: readonly VariantSpec[] = [
  {
    id: "current",
    title: "current",
    note: "what ships: a flat 9px dot in --status-unread, the same shape done/idle/failed wear",
  },
  {
    id: "ring",
    title: "A · hairline ring",
    note: "the retired halo, restored: one 1px ring 2px off the dot, 15px total — a border, so DL-1.2/DL-1.3 do not move",
  },
  {
    id: "glow",
    title: "B · layered glow",
    note: "two non-blurred box-shadow spreads at 32%/14%, 17px total — no compositing layer, but a non-inset shadow is new under DL-1.3",
  },
  {
    id: "ripple",
    title: "C · ripple",
    note: "a 13px disc — variant A's diameter — expanding to 2.1x on a 1.8s loop, so the mark still reads separated at the instant the cycle restarts",
  },
];

/**
 * All five states in one row, so the question "does unread stand apart from
 * the others" is answered by looking at one line rather than by memory.
 */
function MarkStrip({ variant }: { readonly variant: UnreadVariant }) {
  return (
    <div class={`gxu-strip gxu-v--${variant}`}>
      {STATES.map((state) => (
        <div class="gxu-cell" key={state}>
          <RailStatusMark state={state} />
          <span class="gxu-cell__word">{state}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The `asked` mark alone, magnified 4x.
 *
 * The differences being chosen between are 1-4px of ink at rest, which is
 * exactly the size an eye review cannot settle at 1x on a screenshot. The
 * zoom is a `transform: scale`, so it magnifies the SHIPPED geometry rather
 * than restating it at another size — a variant that looks wrong here is
 * wrong in the rail too.
 */
function ZoomedMark({ variant }: { readonly variant: UnreadVariant }) {
  return (
    <div class="gxu-zoom">
      <div class={`gxu-zoom__box gxu-v--${variant}`}>
        <RailStatusMark state="asked" />
      </div>
      <span class="gxu-zoom__word">{variant}</span>
    </div>
  );
}

/**
 * The real rail on the seeded stores. The seed carries every DL-27.3 state at
 * once, which a screenshot of the running app rarely does — so the variant is
 * judged in the column it will live in, beside a red `failed` and a working
 * ring, not on its own.
 */
function VariantRail({ variant }: { readonly variant: UnreadVariant }) {
  return (
    <div class={`gxu-rail gxu-v--${variant}`}>
      {agentRailNavigationSpecimen({ showFooter: false })}
    </div>
  );
}

export function UnreadMarkVariantsSection() {
  return (
    <>
      <SectionHead
        title="Unread mark direction"
        blurb="Proposals only — none of this is shipping chrome. The unread state (asked) has to read apart from the four states sharing its column. Each variant is the real RailStatusMark and the real AgentRail under a wrapper class, so only the asked treatment varies. DL-27.3 currently retires the asked halo, so every variant here amends it; the ripple amends DL-1.2 as well."
      />
      <Specimen
        name="Five states, four treatments"
        note="the fast read — scan each row and ask which unread mark separates from failed/working/done/idle without shouting louder than failed"
        surface="chrome-1"
      >
        <div class="gxu-compare">
          {VARIANTS.map((variant) => (
            <div class="gxu-compare__row" key={variant.id}>
              <span class="gxu-compare__title">{variant.title}</span>
              <MarkStrip variant={variant.id} />
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        name="The unread mark at 4x"
        note="the same four marks magnified — the choice is 1-4px of ink at rest, which no 1x screenshot settles; the ripple is caught mid-cycle in a still"
        surface="chrome-1"
      >
        <div class="gxu-zooms">
          {VARIANTS.map((variant) => (
            <ZoomedMark key={variant.id} variant={variant.id} />
          ))}
        </div>
      </Specimen>
      <Specimen
        name="Side by side on the real rail"
        note="the same four treatments in the column they ship in — seeded clusters hold every state at once, so unread is judged beside a red failed and a working ring"
        surface="none"
      >
        <SpecimenRow>
          {VARIANTS.map((variant) => (
            <div class="gxu-study" key={variant.id}>
              <span class="gxu-study__title">{variant.title}</span>
              <span class="gxu-study__note">{variant.note}</span>
              <VariantRail variant={variant.id} />
            </div>
          ))}
        </SpecimenRow>
      </Specimen>
    </>
  );
}
