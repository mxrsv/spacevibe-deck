import { AgentGlyph } from "../ui/controls/agent-glyph";
import type { PaneAgent } from "../lib/process-info";
import type { RailState } from "../ui/agent-rail-model";
import { RailStatusMark } from "../ui/agent-rail";

/**
 * Gallery-only STRUCTURAL candidates for the agent rail — what a row IS, not
 * how it is painted. Proposals; `src/ui/agent-rail.tsx` remains the one source
 * of the shipped rail.
 *
 * Motivation (2026-08-19): the shipped rail lists one flat row per agent pane,
 * so a tab split across three agents reads as three unrelated tabs. Grouping
 * marks were prototyped first (`multiAgentGroupingSpecimen`, the A/B1/B2
 * columns) and the owner still read the result as cluttered — which resolves
 * the open question those columns were built to ask: the complaint is the
 * rail's GEOMETRY, not a missing separator. So these candidates change the
 * unit instead.
 *
 * **That reading was superseded on 2026-08-20.** A fourth grouping mark — a
 * rounded neutral frame, drawn from the owner's own sketch — shipped as
 * DL-27.19, so a separator did answer it after all. These candidates stay
 * unselected proposals: they change what a row IS, which the frame did not.
 *
 * Split from `agent-rail-variants.tsx` rather than appended to it: that file
 * was already at 753 lines, and these are a different question — the row's
 * STRUCTURE, not its composition. Its `gxa-` harness stays where it is; this
 * one owns `gxs-`.
 *
 * Neither candidate is selected. Shipping either restates DL §27, and the map
 * would need a rule of its own: nothing in the language draws topology today.
 */

interface MapPane {
  readonly agent: PaneAgent;
  readonly state: RailState;
}

interface MapTab {
  /** A name a person typed, else "" — the map carries identity without one. */
  readonly name: string;
  /**
   * Panes as ROWS of panes, which is how the split reads on the stage: one row
   * of three is a three-way column split, two rows of two is a 2x2. The real
   * layout is a nested tree; this is the shape a card has to be able to draw,
   * flattened to the two levels a fixture needs.
   */
  readonly rows: readonly (readonly MapPane[])[];
  /** The newest turn, through the same precedence `tabTail` already applies. */
  readonly message: string;
  readonly age: string;
  readonly active?: boolean;
}

interface MapCluster {
  readonly project: string;
  readonly tabs: readonly MapTab[];
}

/**
 * One fixture for both candidates, carrying the three shapes a card must
 * survive: an unsplit tab, a three-way split, and a 2x2. Two split tabs sit
 * back to back for the same reason the grouping columns put them there.
 */
const CLUSTERS: readonly MapCluster[] = [
  {
    project: "spacevibe-active",
    tabs: [
      {
        name: "",
        rows: [[{ agent: "claude", state: "working" }]],
        message: "Reading the rail model to see where the turn is built",
        age: "6m",
        active: true,
      },
      {
        name: "test sweep",
        rows: [
          [
            { agent: "opencode", state: "working" },
            { agent: "codex", state: "asked" },
            { agent: "gemini", state: "done" },
          ],
        ],
        message: "Which fixture should the 200px case use?",
        age: "now",
      },
      {
        name: "",
        rows: [
          [
            { agent: "claude", state: "asked" },
            { agent: "codex", state: "done" },
          ],
          [
            { agent: "agy", state: "idle" },
            { agent: "gemini", state: "failed" },
          ],
        ],
        message: "Ready to run the migration on 14 files",
        age: "1m",
      },
      {
        // The collision the quiet shapes have to survive: a SECOND unnamed
        // claude tab in the same project. DL-27.15 exists because three such
        // rows were told apart by nothing but their sentence, so a ladder that
        // drops the sentence has to be judged against this pair, not around it.
        name: "",
        rows: [[{ agent: "claude", state: "idle" }]],
        message: "Waiting on you: overwrite the fixture?",
        age: "44m",
      },
    ],
  },
  {
    project: "spacevibe-academy",
    tabs: [
      {
        name: "",
        rows: [[{ agent: "codex", state: "idle" }]],
        message: "",
        age: "",
      },
    ],
  },
];

/**
 * The map itself: one region per pane, laid out the way the panes are laid out
 * on the stage. A region is FILLED by its own pane's state — that is the whole
 * idea, state read off a shape rather than off a mark at the end of a row —
 * and carries the agent's brand glyph so the picture still says who is in it.
 *
 * Every region is a button in the shipped design; here they are plain elements,
 * because a specimen that focuses nothing has nothing to focus.
 */
function TabMap({ tab }: { readonly tab: MapTab }) {
  return (
    <span class="gxs-map" aria-hidden="true">
      {tab.rows.map((row, rowIndex) => (
        <span key={rowIndex} class="gxs-map__row">
          {row.map((pane) => (
            <span key={pane.agent} class="gxs-map__pane" data-state={pane.state}>
              <AgentGlyph agent={pane.agent} className="gxs-map__logo" />
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The loudest pane's state, the rollup the row mark already speaks with. */
const STATE_ORDER: readonly RailState[] = ["failed", "asked", "working", "done", "idle"];

function rollup(tab: MapTab): RailState {
  const states = tab.rows.flat().map((pane) => pane.state);
  return STATE_ORDER.find((state) => states.includes(state)) ?? ("idle" as RailState);
}

/**
 * Candidate 1 — the tab is a map, not a row. Left: the split drawn small.
 * Right: one line of text, the tab's own name when a person typed one, else
 * the newest turn. The trailing mark stays, because the map says WHERE and the
 * mark says HOW LOUD without the eye having to decode colours.
 */
function MapColumn({
  width,
  carrier,
}: {
  readonly width: number;
  /**
   * WHERE state is said, which DL-27.2 allows exactly one answer to: a second
   * signifier for the same state is the rule's named mistake. `map` fills each
   * region by its pane's state and drops the trailing mark; `row` leaves the
   * map as bare topology and keeps the mark the shipped row already has.
   */
  readonly carrier: "map" | "row";
}) {
  return (
    <div class="gxs-rail" data-carrier={carrier} style={{ width: `${width}px` }}>
      {CLUSTERS.map((cluster) => (
        <section key={cluster.project} class="gxs-cluster">
          <span class="gxs-head">{cluster.project}</span>
          {cluster.tabs.map((tab, index) => (
            <div
              key={`${cluster.project}-${index}`}
              class="gxs-card"
              data-active={tab.active === true}
            >
              <TabMap tab={tab} />
              <span class="gxs-card__body">
                <span class="gxs-card__line">
                  {tab.name !== "" && <strong class="gxs-card__name">{tab.name}</strong>}
                  <span class="gxs-card__msg">
                    {tab.message !== "" ? tab.message : tab.rows.flat()[0].agent}
                  </span>
                </span>
                {tab.age !== "" && <span class="gxs-card__age">{tab.age}</span>}
              </span>
              {carrier === "row" && <RailStatusMark state={rollup(tab)} />}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** How a collapsed project summarises itself: counts, loudest state first. */
function summarise(cluster: MapCluster): string {
  const states = cluster.tabs.flatMap((tab) => tab.rows.flat().map((pane) => pane.state));
  const count = (state: RailState) => states.filter((each) => each === state).length;
  const parts = [
    count("failed") > 0 ? `${count("failed")} failed` : "",
    count("asked") > 0 ? `${count("asked")} asks` : "",
    count("working") > 0 ? `${count("working")} running` : "",
    count("done") > 0 ? `${count("done")} done` : "",
    count("idle") > 0 ? `${count("idle")} idle` : "",
  ].filter((part) => part !== "");
  return parts.join(" · ");
}

/** The one pane a collapsed project names: the loudest, with its own sentence. */
function loudestOf(cluster: MapCluster): {
  readonly agent: PaneAgent;
  readonly state: RailState;
  readonly age: string;
} | null {
  for (const state of STATE_ORDER) {
    for (const tab of cluster.tabs) {
      const pane = tab.rows.flat().find((each) => each.state === state);
      if (pane !== undefined && (state === "failed" || state === "asked")) {
        return { agent: pane.agent, state, age: tab.age };
      }
    }
  }
  return null;
}

/**
 * Candidate 2 — the project is the row, and its panes live behind a
 * disclosure. The header carries the count line so the collapsed state still
 * answers "what is running"; the line under it NAMES the agent that wants the
 * user, which is the objection DL-27.13 raised against every folded identity
 * before it ("it hid which agent was in which state").
 */
function DashboardColumn() {
  return (
    <div class="gxs-rail" style={{ width: "275px" }}>
      {CLUSTERS.map((cluster, index) => {
        const loudest = loudestOf(cluster);
        const open = index === 0;
        return (
          <section key={cluster.project} class="gxs-project" data-open={open}>
            <div class="gxs-project__head">
              <strong class="gxs-project__name">{cluster.project}</strong>
              <span class="gxs-project__count">{summarise(cluster)}</span>
            </div>
            {loudest !== null && !open && (
              <div class="gxs-project__loudest">
                <AgentGlyph agent={loudest.agent} className="gxs-project__logo" />
                <span class="gxs-project__agent">{loudest.agent}</span>
                <span class="gxs-card__age">{loudest.age}</span>
                <RailStatusMark state={loudest.state} />
              </div>
            )}
            {open &&
              cluster.tabs.map((tab, tabIndex) => (
                <div
                  key={`${cluster.project}-${tabIndex}`}
                  class="gxs-card"
                  data-active={tab.active === true}
                >
                  <TabMap tab={tab} />
                  <span class="gxs-card__body">
                    <span class="gxs-card__line">
                      <span class="gxs-card__msg">
                        {tab.message !== "" ? tab.message : tab.rows.flat()[0].agent}
                      </span>
                    </span>
                    {tab.age !== "" && <span class="gxs-card__age">{tab.age}</span>}
                  </span>
                  <RailStatusMark state={rollup(tab)} />
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The two structural directions, side by side, at the widths the sidebar
 * actually takes: the map is shown at BOTH ends of its range because the
 * argument against it is entirely about width — 200px is the floor
 * `clampSidebarWidth` allows, 275px the default.
 */
export function railStructureSpecimen() {
  return (
    <div class="gxs-variants">
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">M1</span>
          <span class="gxs-variant__title">tab map — 275px (default)</span>
          <span class="gxs-variant__note">
            the split drawn small; a region per pane, filled by its own state
          </span>
        </div>
        <MapColumn width={275} carrier="map" />
      </article>
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">M2</span>
          <span class="gxs-variant__title">tab map — 200px (floor)</span>
          <span class="gxs-variant__note">
            the same card where the sidebar is narrowest — the case the map has to survive
          </span>
        </div>
        <MapColumn width={200} carrier="map" />
      </article>
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">M3</span>
          <span class="gxs-variant__title">tab map, uncoloured — 275px</span>
          <span class="gxs-variant__note">
            topology only; state stays on the one row mark, so no state is said twice (DL-27.2)
          </span>
        </div>
        <MapColumn width={275} carrier="row" />
      </article>
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">P</span>
          <span class="gxs-variant__title">project dashboard</span>
          <span class="gxs-variant__note">
            one row per project, counts in the header, the loudest agent named; the open project
            shows its tabs
          </span>
        </div>
        <DashboardColumn />
      </article>
    </div>
  );
}

/* ------------------------------------------- the simplicity ladder (L1-L3) */

/**
 * Three rungs of REMOVAL, built after the map and the dashboard both read as
 * cluttered too (owner, 2026-08-19). Every candidate before this one added
 * structure; the owner's word was "đơn giản" — simpler — so this ladder takes
 * things away instead, and it is diagnostic by construction:
 *
 * - **L1 removes INK.** Same one row per pane the rail ships, minus the
 *   sentence and the age. Stopping here means the problem was text density.
 * - **L2 removes ROWS.** One row per TAB, its agents as glyphs, each badged
 *   only when its own pane is loud. Stopping here means the problem was row
 *   count. This is not a new shape: it is the rail spec's own §2.1 row, whose
 *   selective badge is the answer DL-27.13 asked for when it rejected the
 *   folded identity for hiding which agent was in which state.
 * - **L3 removes EVERYTHING else.** Tab name and mark, nothing more; per-pane
 *   state is only discoverable by opening the tab. Past any recorded shape.
 *
 * L0 is not drawn here — the shipped rail is mounted one specimen up, and a
 * hand-built copy of it is the failure mode this gallery already named.
 *
 * The cost of L1 is explicit: it reverts DL-27.15 (2026-08-17), whose reason
 * was that three `claude` rows in one project were told apart by nothing else.
 * L1 alone does not answer that; L2 does, by there being fewer rows and a tab
 * usually carrying a name.
 */
function LadderColumn({ level }: { readonly level: 1 | 2 | 3 }) {
  return (
    <div class="gxs-rail gxs-rail--ladder" style={{ width: "275px" }}>
      {CLUSTERS.map((cluster) => (
        <section key={cluster.project} class="gxs-cluster">
          <span class="gxs-head">{cluster.project}</span>
          {level === 1
            ? cluster.tabs.flatMap((tab, tabIndex) =>
                tab.rows.flat().map((pane) => (
                  <div
                    key={`${cluster.project}-${tabIndex}-${pane.agent}`}
                    class="gxs-lad"
                    data-active={tab.active === true}
                  >
                    <AgentGlyph agent={pane.agent} className="gxs-lad__logo" />
                    <span class="gxs-lad__name">{pane.agent}</span>
                    <RailStatusMark state={pane.state} />
                  </div>
                )),
              )
            : cluster.tabs.map((tab, tabIndex) => {
                const panes = tab.rows.flat();
                const label = tab.name !== "" ? tab.name : panes.length === 1 ? panes[0].agent : "";
                return (
                  <div
                    key={`${cluster.project}-${tabIndex}`}
                    class="gxs-lad"
                    data-active={tab.active === true}
                  >
                    {level === 2 && (
                      <span class="gxs-lad__glyphs">
                        {panes.map((pane) => (
                          <span
                            key={pane.agent}
                            class="gxs-lad__glyph"
                            data-badge={
                              pane.state === "asked" || pane.state === "failed"
                                ? pane.state
                                : undefined
                            }
                          >
                            <AgentGlyph agent={pane.agent} className="gxs-lad__logo" />
                          </span>
                        ))}
                      </span>
                    )}
                    <span class="gxs-lad__name">
                      {level === 3 && label === "" ? "3 agents" : label}
                    </span>
                    <RailStatusMark state={rollup(tab)} />
                  </div>
                );
              })}
        </section>
      ))}
    </div>
  );
}

/**
 * The ladder as one picture: same fixture, same width, three amounts of the
 * same information. The question it asks is not which is prettiest — it is
 * where the owner wants to stop taking things away.
 */
export function railSimplicityLadderSpecimen() {
  return (
    <div class="gxs-variants">
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">L1</span>
          <span class="gxs-variant__title">less ink — one row per pane</span>
          <span class="gxs-variant__note">
            the sentence and the age are gone; the row is glyph, agent, mark. Reverts DL-27.15
          </span>
        </div>
        <LadderColumn level={1} />
      </article>
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">L2</span>
          <span class="gxs-variant__title">fewer rows — one row per tab</span>
          <span class="gxs-variant__note">
            agents as glyphs, badged only when that pane is loud — the rail spec's own §2.1 row
          </span>
        </div>
        <LadderColumn level={2} />
      </article>
      <article class="gxs-variant">
        <div class="gxs-variant__head">
          <span class="gxs-variant__index">L3</span>
          <span class="gxs-variant__title">name and mark only</span>
          <span class="gxs-variant__note">
            the floor: which agent is where is answered by opening the tab
          </span>
        </div>
        <LadderColumn level={3} />
      </article>
    </div>
  );
}
