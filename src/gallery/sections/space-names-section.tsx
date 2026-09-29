import { useSignal } from "@preact/signals";
import { SectionHead, Specimen, StateLabel } from "../specimen";
import { CAPTIONS, INITIAL_NAMES, SPACES, type NameVariant } from "./space-names-data";
import { StaticCard } from "./space-names-label";
import { RAIL_CAPTIONS } from "./space-names-rail-data";
import { RailFrame } from "./space-names-rail";
import { ShelfRow, StripRow } from "./space-names-surfaces";
import "./space-names.css";

/**
 * Space-name study, registered 2026-09-29. Three ways to draw a user-given
 * space name on DL-35.3's strip and Mission Control's shelf, over one fixture.
 * Names are local state per candidate — nothing reaches a tab or the journal.
 * Marks stay dots in every candidate; only the text around them changes.
 */

const VARIANTS: readonly NameVariant[] = ["A", "B", "C"];

/** Fixture keys: named, unnamed same-folder, long name, other folder, worktree. */
const STRIP_KEYS = SPACES.map((space) => space.key);
const [NAMED, UNNAMED, LONG, , WORKTREE] = STRIP_KEYS;

/** Rail pane ids are `tab key * 10 + pane position`: `auth`'s first agent, then the unnamed tab's. */
const RAIL_NAMED_PANE = NAMED * 10;
const RAIL_UNNAMED_PANE = UNNAMED * 10;

function Candidate({ variant }: { variant: NameVariant }) {
  const names = useSignal(INITIAL_NAMES);
  const rename = (key: number, name: string | null): void => {
    names.value = { ...names.value, [key]: name };
  };
  const surface = { variant, names: names.value, onRename: rename };
  const caption = CAPTIONS[variant];
  return (
    <Specimen name={caption.name} note={caption.note}>
      <div class="spn spn-candidate">
        <StateLabel>strip · one row per current space</StateLabel>
        <div class="spn-strips">
          {STRIP_KEYS.map((key) => (
            <StripRow key={key} {...surface} currentKey={key} />
          ))}
        </div>
        <StateLabel>Mission Control shelf</StateLabel>
        <ShelfRow {...surface} currentKey={NAMED} />
        <StateLabel>renaming in place · named, unnamed, long draft</StateLabel>
        <div class="spn-strips">
          <StripRow {...surface} currentKey={NAMED} editKey={NAMED} />
          <StripRow {...surface} currentKey={UNNAMED} editKey={UNNAMED} />
          <StripRow {...surface} currentKey={LONG} editKey={LONG} />
        </div>
        <div class="spn-shelfpair">
          <ShelfRow
            {...surface}
            currentKey={UNNAMED}
            editKey={UNNAMED}
            only={[NAMED, UNNAMED, LONG]}
          />
        </div>
        <StateLabel>hover card · named, worktree</StateLabel>
        <div class="spn-cards">
          <StaticCard variant={variant} space={SPACES[0]} name={names.value[NAMED] ?? null} />
          <StaticCard
            variant={variant}
            space={SPACES[WORKTREE - 1]}
            name={names.value[WORKTREE] ?? null}
          />
        </div>
        <StateLabel>sidebar · rest, renaming a named row, renaming an unnamed row</StateLabel>
        <p class="spn-railnote">{RAIL_CAPTIONS[variant]}</p>
        <div class="asr-study spn-rails">
          <RailFrame {...surface} />
          <RailFrame {...surface} editPaneId={RAIL_NAMED_PANE} />
          <RailFrame {...surface} editPaneId={RAIL_UNNAMED_PANE} />
        </div>
      </div>
    </Specimen>
  );
}

export function SpaceNamesSection() {
  return (
    <div class="spn-study">
      <SectionHead
        title="Space names"
        blurb="Three ways to show a name on a space. Double-click a label or the current mark to rename in place; Enter saves, Esc cancels, an empty name returns to the default."
      />
      {VARIANTS.map((variant) => (
        <Candidate key={variant} variant={variant} />
      ))}
    </div>
  );
}
