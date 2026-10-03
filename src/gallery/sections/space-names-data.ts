import {
  spaceCounts,
  spaceLabel,
  type Space,
  type SpacePane,
  type SpacePaneState,
} from "../../ui/spaces/space-model";

/**
 * Fixture and label rules for the space-name study (registered 2026-09-29).
 * A `Space` is the shipping projection; the name is gallery-side state,
 * because the real feature would persist it per tab in the journal and this
 * study only compares how a name is drawn.
 */

export type NameVariant = "A" | "B" | "C";

/** A space's user-given name, or null while it is still called by its folder. */
export type SpaceNames = Readonly<Record<number, string | null>>;

export const INITIAL_NAMES: SpaceNames = {
  1: "auth",
  3: "landing page hero rewrite for launch week",
  5: "scroll fix",
};

const DECK_PATH = "/work/spacevibe-deck";

function panes(key: number, states: readonly SpacePaneState[]): readonly SpacePane[] {
  return states.map((state, at) => ({
    paneId: key * 10 + at,
    agent: state === "shell" ? null : "claude",
    state,
  }));
}

function fixture(
  key: number,
  folder: string,
  path: string,
  index: number | null,
  branch: string | null,
  states: readonly SpacePaneState[],
): Space {
  const asked = states.filter((state) => state === "asked").length;
  const failed = states.filter((state) => state === "failed").length;
  return {
    tabIndex: key - 1,
    key,
    folder,
    // The study keeps names in its own state and passes them beside the space.
    name: null,
    index,
    path,
    group: path,
    groupLabel: folder,
    branch,
    panes: panes(key, states),
    agentCount: states.filter((state) => state !== "shell").length,
    needsCount: asked + failed,
    failedCount: failed,
    current: false,
  };
}

/**
 * Two same-folder spaces (one named, one not), a third with a long name, a
 * space in another folder that failed, and a worktree that shows its branch.
 */
export const SPACES: readonly Space[] = [
  fixture(1, "spacevibe-deck", DECK_PATH, 1, "main", ["working", "asked", "shell"]),
  fixture(2, "spacevibe-deck", DECK_PATH, 2, "main", ["working", "idle"]),
  fixture(3, "spacevibe-deck", DECK_PATH, 3, "main", ["working", "working"]),
  fixture(4, "spacevibe-academy", "/work/spacevibe-academy", null, "main", ["failed", "shell"]),
  fixture(5, "rail-overflow", "/work/wt/rail-overflow", null, "fix/rail-overflow", ["idle"]),
];

export function withCurrent(spaces: readonly Space[], key: number): readonly Space[] {
  return spaces.map((space) => ({ ...space, current: space.key === key }));
}

/** The pieces a label draws, so every surface tones them the same way. */
export interface NameParts {
  /** The folder, shown ahead of the name. Null when the name stands alone. */
  readonly lead: string | null;
  /** The name, or the folder-and-index label while the space is unnamed. */
  readonly main: string;
  readonly named: boolean;
  /** Secondary text after the name; only B and C place a branch on the strip. */
  readonly trail: string | null;
}

/** What the strip's current-space label says (DL-35.3's name cell). */
export function stripParts(variant: NameVariant, space: Space, name: string | null): NameParts {
  const named = name !== null;
  const trail = variant === "A" ? null : space.branch === "main" ? null : space.branch;
  if (variant === "B" && named) return { lead: space.folder, main: name, named, trail };
  return { lead: null, main: name ?? spaceLabel(space), named, trail };
}

/** What a shelf thumbnail's label says. */
export function shelfParts(variant: NameVariant, space: Space, name: string | null): NameParts {
  const named = name !== null;
  if (variant === "A") {
    // The set's header already names the folder, so the thumb carries only the
    // name, or today's bare index.
    return {
      lead: null,
      main: name ?? (space.index === null ? "" : String(space.index)),
      named,
      trail: null,
    };
  }
  if (variant === "B") {
    // A 124px thumbnail cannot hold folder, name and count on one line, so the
    // address stacks: the name on top, the folder (and a branch) beneath it.
    const branch = space.branch === "main" ? null : space.branch;
    const under = [named ? space.folder : null, branch].filter((part) => part !== null);
    return {
      lead: null,
      main: name ?? spaceLabel(space),
      named,
      trail: under.length === 0 ? null : under.join(" · "),
    };
  }
  return { lead: null, main: name ?? spaceLabel(space), named, trail: null };
}

export interface CardText {
  readonly title: string;
  readonly meta: string;
}

/** The hover card's two lines; the counts line is the shipping one. */
export function cardText(variant: NameVariant, space: Space, name: string | null): CardText {
  const counts = spaceCounts(space);
  const where = spaceLabel(space);
  const branch = space.branch === null ? "" : `${space.branch} · `;
  if (name === null) return { title: where, meta: `${branch}${counts}` };
  if (variant === "B") return { title: `${space.folder} · ${name}`, meta: `${branch}${counts}` };
  return { title: name, meta: `${where} · ${branch}${counts}` };
}

/** One-line caption per candidate, shown in the specimen note. */
export const CAPTIONS: Readonly<Record<NameVariant, { name: string; note: string }>> = {
  A: {
    name: "A · Name replaces the folder",
    note: "The strip and thumbnail show the name instead of the folder; an unnamed space keeps today's folder-and-index label. Branch stays in the hover card only. Least text.",
  },
  B: {
    name: "B · Folder · name",
    note: "The label is always the full address: folder in a muted tone, then the name; a branch trails in a secondary tone. The shelf drops its folder header and stacks the folder under each name.",
  },
  C: {
    name: "C · Names ride on the marks",
    note: "Every named space keeps its name beside its dot, so all names are visible without hover. The folder leaves the strip and the shelf header and lives in the tooltip.",
  },
};
