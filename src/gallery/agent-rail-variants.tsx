import { AgentGlyph } from '../ui/controls/agent-glyph';
import type { PaneAgent } from '../lib/process-info';
import type { RailState } from '../ui/agent-rail-model';
import { RailStatusMark } from '../ui/agent-rail';

/**
 * Gallery-only COMPARISON of candidate row structures for the agent rail —
 * proposals, not the shipped surface (`src/ui/agent-rail.tsx` stays the one
 * source of the real rail, mounted by `agent-status-rail.tsx`).
 *
 * Motivation (2026-08-16): with few agents the then-shipping shape read sparse —
 * every row spends two lines to say "claude / 6m", and an unnamed single-agent
 * tab says its agent twice, as the bold name on the left and as the trailing
 * chip on the right. One fixture drives every candidate below so the
 * comparison stays about composition, the same discipline `SEED_WORKBENCH`
 * records.
 *
 * Candidate D deliberately renders an uppercase, tracked header. DL-4.3 bans
 * that in shipping chrome with no exceptions since 2026-08-16; this file is a
 * gallery harness outside `src/styles/`, drawn so the owner can eye-judge
 * whether reopening that rule would even be worth it. Shipping any candidate
 * is a separate, DL-touching decision.
 */

interface VariantAgent {
  readonly agent: PaneAgent;
  readonly state: RailState;
}

interface VariantTab {
  readonly id: string;
  /** What the row calls itself: agent name, custom name, or project name. */
  readonly name: string;
  readonly agents: readonly VariantAgent[];
  /** Folded rollup, loudest pane wins — same precedence the real model uses. */
  readonly state: RailState;
  readonly age: string;
  /** A real newest-turn line; only the shapes that earn a second line show it. */
  readonly message?: string;
  readonly active?: boolean;
}

interface VariantCluster {
  readonly project: string;
  /** Mirrors the shipped rule: a cluster of one prints no header. */
  readonly labelled: boolean;
  readonly tabs: readonly VariantTab[];
}

/**
 * The sparse picture from the owner's screenshot — two identical claude tabs
 * and a codex one under one project — plus one multi-agent named tab and one
 * single-tab project, the two cases any candidate grammar must also survive.
 */
const CLUSTERS: readonly VariantCluster[] = [
  {
    project: 'spacevibe-active',
    labelled: true,
    tabs: [
      {
        id: 'active-claude-1',
        name: 'claude',
        agents: [{ agent: 'claude', state: 'working' }],
        state: 'working',
        age: '6m',
      },
      {
        id: 'active-claude-2',
        name: 'claude',
        agents: [{ agent: 'claude', state: 'working' }],
        state: 'working',
        age: '2m',
        active: true,
      },
      {
        id: 'active-codex',
        name: 'codex',
        agents: [{ agent: 'codex', state: 'done' }],
        state: 'done',
        age: '5m',
      },
      {
        id: 'active-sweep',
        name: 'test sweep',
        agents: [
          { agent: 'opencode', state: 'working' },
          { agent: 'codex', state: 'idle' },
          { agent: 'gemini', state: 'idle' },
        ],
        state: 'working',
        age: 'now',
        message: '42 tests passed, wiring the dock next',
      },
    ],
  },
  {
    project: 'spacevibe-academy',
    labelled: false,
    tabs: [
      {
        id: 'academy',
        name: 'spacevibe-academy',
        agents: [{ agent: 'claude', state: 'idle' }],
        state: 'idle',
        age: '',
      },
    ],
  },
];

type VariantKind = 'archive' | 'inline' | 'card' | 'upper';

const VARIANTS = [
  {
    kind: 'archive',
    index: 'A',
    label: 'Archived two-line shape',
    note: 'Retired 2026-08-16 · trailing chips · historical baseline',
  },
  {
    kind: 'inline',
    index: 'B',
    label: 'One line, glyph leads',
    note: 'Logo opens the row · age beside the mark · a second line only when a turn exists',
  },
  {
    kind: 'card',
    index: 'C',
    label: 'Cluster as inset card',
    note: "B's rows · a labelled project stands in a recessed frame",
  },
  {
    kind: 'upper',
    index: 'D',
    label: 'B + uppercase header',
    note: 'Needs a DL-4.3 exception to ship — drawn to judge, not to keep',
  },
] as const satisfies readonly {
  readonly kind: VariantKind;
  readonly index: string;
  readonly label: string;
  readonly note: string;
}[];

function Mark({ state }: { readonly state: RailState }) {
  return <RailStatusMark state={state} />;
}

function Logos({ agents }: { readonly agents: readonly VariantAgent[] }) {
  return (
    <span class="gxa-logos">
      {agents.map((entry) => (
        <AgentGlyph key={entry.agent} agent={entry.agent} className="gxa-logo" />
      ))}
    </span>
  );
}

/** The retired two-line shape, redrawn over the shared fixture. */
function ArchivedRow({ tab }: { readonly tab: VariantTab }) {
  return (
    <div class="gxa-item gxa-item--archive" data-active={tab.active === true}>
      <div class="gxa-archive-line">
        <strong class="gxa-name">{tab.name}</strong>
        <Logos agents={tab.agents} />
        <Mark state={tab.state} />
      </div>
      {tab.age !== '' && <span class="gxa-archive-meta">{tab.age}</span>}
    </div>
  );
}

/** Candidates B/C/D share one row: glyphs lead, the age sits by the mark. */
function InlineRow({ tab }: { readonly tab: VariantTab }) {
  return (
    <div class="gxa-item gxa-item--inline" data-active={tab.active === true}>
      <div class="gxa-inline-line">
        <Logos agents={tab.agents} />
        <strong class="gxa-name">{tab.name}</strong>
        <span class="gxa-age">{tab.age}</span>
        <Mark state={tab.state} />
      </div>
      {tab.message !== undefined && <span class="gxa-msg">{tab.message}</span>}
    </div>
  );
}

function ClusterBlock({
  cluster,
  kind,
}: {
  readonly cluster: VariantCluster;
  readonly kind: VariantKind;
}) {
  const Row = kind === 'archive' ? ArchivedRow : InlineRow;
  const head =
    kind === 'archive'
      ? 'gxa-head gxa-head--archive'
      : kind === 'upper'
        ? 'gxa-head gxa-head--upper'
        : 'gxa-head gxa-head--label';
  const rows = cluster.tabs.map((tab) => <Row key={tab.id} tab={tab} />);
  if (kind === 'card' && cluster.labelled) {
    return (
      <section class="gxa-card">
        <span class={head}>{cluster.project}</span>
        {rows}
      </section>
    );
  }
  return (
    <section class="gxa-cluster">
      {cluster.labelled && <span class={head}>{cluster.project}</span>}
      {rows}
    </section>
  );
}

/** Four candidate rails over one fixture, side by side. */
export function agentRailVariantsSpecimen() {
  return (
    <div class="gxa-variants">
      {VARIANTS.map((variant) => (
        <article key={variant.kind} class="gxa-variant">
          <header class="gxa-variant__head">
            <span class="gxa-variant__index">{variant.index}</span>
            <span class="gxa-variant__title">{variant.label}</span>
            <span class="gxa-variant__note">{variant.note}</span>
          </header>
          <div class="gxa-rail">
            {CLUSTERS.map((cluster) => (
              <ClusterBlock key={cluster.project} cluster={cluster} kind={variant.kind} />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------ resting mark candidates */

type MarkKind = 'ring' | 'dot' | 'presence' | 'core' | 'breathe';

const MARKS = [
  {
    kind: 'ring',
    index: 'R1',
    label: 'Hairline ring',
    note: 'Earlier bare-ring direction — retired by R4',
  },
  {
    kind: 'dot',
    index: 'R2',
    label: 'Soft dot',
    note: 'Filled and neutral: present rather than hollow',
  },
  {
    kind: 'presence',
    index: 'R3',
    label: 'Presence green',
    note: "Conflicts with done's green — cannot ship without reopening the closed palette",
  },
  {
    kind: 'core',
    index: 'R4',
    label: 'Ring with a core',
    note: 'Shipping — the ring keeps a small neutral core',
  },
  {
    kind: 'breathe',
    index: 'R5',
    label: 'Breathing ring',
    note: 'Slow opacity pulse — judge it LIVE, a still cannot show it; needs a DL-1.2 exception like the working arc',
  },
] as const satisfies readonly {
  readonly kind: MarkKind;
  readonly index: string;
  readonly label: string;
  readonly note: string;
}[];

/** One resting row drawn in candidate B's shape, with the mark swapped. */
function MarkRow({
  kind,
  agent,
  name,
}: {
  readonly kind: MarkKind;
  readonly agent: PaneAgent;
  readonly name: string;
}) {
  return (
    <div class="gxa-item gxa-item--inline">
      <div class="gxa-inline-line">
        <span class="gxa-logos">
          <AgentGlyph agent={agent} className="gxa-logo" />
        </span>
        <strong class="gxa-name">{name}</strong>
        <span class={`gxa-mark gxa-mark--${kind}`} data-state="idle" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * The rail's shipping state vocabulary (owner, 2026-08-16), loudest first.
 * The lifecycle reads from the dev's side, not the agent's: working → asked
 * (needs your eyes — a question, a permission wait, OR a finished run you
 * have not checked; the separate unread state was folded in here as a
 * TEMPORARY owner call) → done (checked), with idle reserved for a pane that
 * has never run anything. DL-27.3, spec §3 and the attention tracker carry the
 * same vocabulary; this specimen isolates the marks for comparison.
 */
export function statePaletteSpecimen() {
  const rows = [
    {
      state: 'failed' as RailState,
      agent: 'agy' as PaneAgent,
      note: 'filled red dot — crashed; the loudest, and no halo: it is not asking',
    },
    {
      state: 'asked' as RailState,
      agent: 'claude' as PaneAgent,
      note: 'yellow dot with a halo — needs your eyes: asking, waiting for permission, OR finished and unchecked (unread folded in here for now, owner 2026-08-16)',
    },
    {
      state: 'working' as RailState,
      agent: 'opencode' as PaneAgent,
      note: 'open arc, turning — the one animated mark (scoped DL-1.2 exception)',
    },
    {
      state: 'done' as RailState,
      agent: 'gemini' as PaneAgent,
      note: 'green Phosphor check — it ran and you checked it',
    },
    {
      state: 'idle' as RailState,
      agent: 'claude' as PaneAgent,
      note: "R4 ring with a core — alive at the prompt, nothing run yet (the owner's idle pick; the bare ring is retired)",
    },
  ];
  return (
    <div class="gxa-variants gxa-variants--marks">
      <article class="gxa-variant">
        <div class="gxa-rail gxa-rail--marks">
          {rows.map((row) => (
            <div key={row.state} class="gxa-item gxa-item--inline">
              <div class="gxa-inline-line">
                <span class="gxa-logos">
                  <AgentGlyph agent={row.agent} className="gxa-logo" />
                </span>
                <strong class="gxa-name">{row.state}</strong>
                <RailStatusMark state={row.state} />
              </div>
              <span class="gxa-msg">{row.note}</span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

/**
 * Five treatments for the `resting` mark, each on the same two quiet rows.
 * Every candidate must stay QUIETER than the working arc and carry no
 * attention colour: resting sits at the bottom of DL-27.3's precedence, and a
 * pretty idle mark that outshouts `asked` would invert the rail's grammar.
 */
export function restingMarkVariantsSpecimen() {
  return (
    <div class="gxa-variants gxa-variants--marks">
      {MARKS.map((mark) => (
        <article key={mark.kind} class="gxa-variant gxa-variant--marks">
          <header class="gxa-variant__head">
            <span class="gxa-variant__index">{mark.index}</span>
            <span class="gxa-variant__title">{mark.label}</span>
            <span class="gxa-variant__note">{mark.note}</span>
          </header>
          <div class="gxa-rail gxa-rail--marks">
            <MarkRow kind={mark.kind} agent="claude" name="claude" />
            <MarkRow kind={mark.kind} agent="codex" name="spacevibe-academy" />
          </div>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- pane tree (multi) */

type PaletteState = RailState;

/** A mark in the shipping five-state vocabulary (see statePaletteSpecimen). */
function PaletteMark({ state }: { readonly state: PaletteState }) {
  return <RailStatusMark state={state} />;
}

interface TreePane {
  readonly agent: PaneAgent;
  readonly state: PaletteState;
  readonly age: string;
}

function TreeLeaf({ pane }: { readonly pane: TreePane }) {
  return (
    <div class="gxa-item gxa-item--inline gxa-tree__leaf">
      <div class="gxa-inline-line">
        <span class="gxa-logos">
          <AgentGlyph agent={pane.agent} className="gxa-logo" />
        </span>
        <strong class="gxa-name">{pane.agent}</strong>
        <span class="gxa-age">{pane.age}</span>
        <PaletteMark state={pane.state} />
      </div>
    </div>
  );
}

function TreeParent({
  name,
  age,
  state,
  panes,
}: {
  readonly name: string;
  readonly age: string;
  readonly state: PaletteState;
  readonly panes: readonly TreePane[];
}) {
  return (
    <div class="gxa-tree">
      <div class="gxa-item gxa-item--inline gxa-tree__parent">
        <div class="gxa-inline-line">
          <strong class="gxa-name">{name}</strong>
          <span class="gxa-age">{age}</span>
          <PaletteMark state={state} />
        </div>
      </div>
      {panes.map((pane) => (
        <TreeLeaf key={pane.agent} pane={pane} />
      ))}
    </div>
  );
}

/**
 * Tree UI for a tab running several agent panes (owner ask, 2026-08-16): the
 * panes stay vertical rows in the one-line grammar, and connector guides say
 * which tab owns them — replacing the folded "claude + codex + agy" identity
 * the multi-agent row prints today. The parent carries the tab's name (custom
 * name, else a count), the rollup state and the newest age; each leaf carries
 * its own glyph, age and mark. Single-agent tabs are untouched.
 */
export function paneTreeSpecimen() {
  return (
    <div class="gxa-variants">
      <article class="gxa-variant">
        <div class="gxa-rail">
          <section class="gxa-cluster">
            <span class="gxa-head gxa-head--label">spacevibe-active</span>
            <div class="gxa-item gxa-item--inline">
              <div class="gxa-inline-line">
                <span class="gxa-logos">
                  <AgentGlyph agent="claude" className="gxa-logo" />
                </span>
                <strong class="gxa-name">claude</strong>
                <span class="gxa-age">6m</span>
                <PaletteMark state="working" />
              </div>
            </div>
            <TreeParent
              name="test sweep"
              age="now"
              state="working"
              panes={[
                { agent: 'opencode', state: 'working', age: 'now' },
                { agent: 'codex', state: 'asked', age: '18m' },
                { agent: 'gemini', state: 'done', age: '26m' },
              ]}
            />
            <TreeParent
              name="3 agents"
              age="1m"
              state="asked"
              panes={[
                { agent: 'claude', state: 'asked', age: '1m' },
                { agent: 'codex', state: 'done', age: '9m' },
                { agent: 'agy', state: 'idle', age: '' },
              ]}
            />
          </section>
          <section class="gxa-cluster">
            <div class="gxa-item gxa-item--inline">
              <div class="gxa-inline-line">
                <span class="gxa-logos">
                  <AgentGlyph agent="codex" className="gxa-logo" />
                </span>
                <strong class="gxa-name">spacevibe-academy</strong>
                <PaletteMark state="idle" />
              </div>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
