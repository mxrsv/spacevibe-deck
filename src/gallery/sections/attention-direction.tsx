import type { ComponentChildren } from "preact";
import type { PaneAgent } from "../../lib/process-info";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { RailStatusMark } from "../../ui/agent-rail";
import type { RailState } from "../../ui/agent-rail-model";
import { agentRailNavigationSpecimen } from "../chrome-fixtures";
import { SectionHead, Specimen } from "../specimen";
import "./attention-direction.css";

/**
 * Attention-first direction review (2026-08-17). PROPOSALS ONLY — nothing in
 * this file is shipping chrome, and none of its CSS is imported by the
 * renderer. The thesis under review: Deck's wedge is the loop
 * "see who needs you → jump → intervene", so the chrome must say three things
 * the current build keeps quiet — which agent is waiting, what it just said,
 * and which pane owns the keyboard.
 *
 * The rail variants are DRAWINGS on the real rail's anatomy (real
 * `AgentGlyph`, real `RailStatusMark`, same cluster/row grammar) holding the
 * seeded content constant so only the treatment varies. The removed pinned
 * `Needs you` block (owner, 2026-08-16) is deliberately NOT re-proposed:
 * both variants keep project clusters in place and change emphasis, not
 * order.
 */

interface AttentionRow {
  readonly agent: PaneAgent | null;
  /** The row's one strong word — tab identity, or the project when unnamed. */
  readonly name: string;
  readonly age: string;
  readonly state: RailState;
  /** The agent's newest turn — the tier-3 `session_tail` this proposes. */
  readonly tail: string;
}

interface AttentionCluster {
  readonly project: string;
  readonly rows: readonly AttentionRow[];
}

/** Mirrors the seeded rail content so current and proposed compare honestly. */
const CLUSTERS: readonly AttentionCluster[] = [
  {
    project: "spacevibe-deck",
    rows: [
      {
        agent: "claude",
        name: "claude",
        age: "3m",
        state: "working",
        tail: "Running the vitest suite — 214 of 2619",
      },
      {
        agent: "codex",
        name: "architecture review",
        age: "8m",
        state: "asked",
        tail: "Plan ready — approve the R4 fork before I refactor?",
      },
      {
        agent: "opencode",
        name: "test sweep",
        age: "30s",
        state: "working",
        tail: "Bisecting the flaky pane resize test",
      },
    ],
  },
  {
    project: "spacevibe-api",
    rows: [
      {
        agent: "codex",
        name: "review",
        age: "4m",
        state: "asked",
        tail: "Permission needed: prisma migrate dev",
      },
      {
        agent: "claude",
        name: "claude",
        age: "1m",
        state: "asked",
        tail: "Which module owns the vote write path?",
      },
    ],
  },
  {
    project: "spacevibe-hub",
    rows: [
      {
        agent: "agy",
        name: "agy",
        age: "12m",
        state: "failed",
        tail: "npm install failed — lockfile conflict on preact",
      },
    ],
  },
  {
    project: "scratch",
    rows: [{ agent: null, name: "zsh", age: "", state: "idle", tail: "" }],
  },
];

const ACTIONABLE: ReadonlySet<RailState> = new Set(["asked", "failed"]);

function RowGlyph({ agent }: { readonly agent: PaneAgent | null }) {
  return agent === null ? (
    <span class="gxa-glyph gxa-glyph--shell" aria-hidden="true">
      $
    </span>
  ) : (
    <AgentGlyph agent={agent} className="gxa-glyph" />
  );
}

/**
 * One drawn rail. `variant` picks the treatment:
 * - `tail`: every row spends a second line on its newest turn; quiet rows
 *   carry it faint, actionable rows carry it strong.
 * - `dim`: no new information — quiet rows drop to the muted tone whole,
 *   actionable rows keep full strength plus the message line that already
 *   exists (DL-27.4).
 */
function DrawnRail({ variant }: { readonly variant: "tail" | "dim" }) {
  return (
    <div class={`gxa-rail gxa-rail--${variant}`}>
      {CLUSTERS.map((cluster) => (
        <div class="gxa-cluster" key={cluster.project}>
          <div class="gxa-cluster__head">{cluster.project}</div>
          {cluster.rows.map((row) => {
            const loud = ACTIONABLE.has(row.state);
            const showTail = row.tail !== "" && (variant === "tail" || loud);
            return (
              <div
                class={`gxa-row ${loud ? "gxa-row--loud" : "gxa-row--quiet"}`}
                key={`${cluster.project}-${row.name}`}
              >
                <RowGlyph agent={row.agent} />
                <span class="gxa-row__name">{row.name}</span>
                {row.age !== "" && <span class="gxa-row__age">{row.age}</span>}
                <RailStatusMark state={row.state} />
                {showTail && <span class="gxa-row__tail">{row.tail}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface FakePaneLine {
  readonly text: string;
  readonly tone?: "ok" | "warn" | "err" | "dim";
}

interface FakePane {
  readonly agent: PaneAgent | null;
  readonly title: string;
  readonly focused: boolean;
  readonly lines: readonly FakePaneLine[];
}

const FAKE_PANES: readonly FakePane[] = [
  {
    agent: "claude",
    title: "claude",
    focused: true,
    lines: [
      { text: "❯ claude" },
      { text: "reading src/terminal/pane.ts", tone: "dim" },
      { text: "⚠ transcript saving is off", tone: "warn" },
      { text: "3 files changed, 128 insertions", tone: "ok" },
      { text: "waiting for review" },
    ],
  },
  {
    agent: "codex",
    title: "codex",
    focused: false,
    lines: [
      { text: "❯ codex review" },
      { text: "42 tests, 42 passed in 3.1s", tone: "ok" },
      { text: "suggested order of attack: #1 → #2", tone: "dim" },
      { text: "API error: connection reset", tone: "err" },
    ],
  },
  {
    agent: null,
    title: "zsh",
    focused: false,
    lines: [
      { text: "❯ git status --short" },
      { text: " M src/ui/app.tsx", tone: "dim" },
      { text: "❯ npm run electron:dev", tone: "dim" },
    ],
  },
];

/**
 * One drawn three-pane stage. `treatment`:
 * - `current`: what ships — flush panes, 1px dividers, the 55% inset accent
 *   hairline on the focused pane, no pane bar (the shipped default).
 * - `dim`: the unfocused panes drop to half strength; nothing else changes.
 * - `bar`: milder dim plus a named pane bar on every pane, the focused one
 *   carrying the accent-marked name (DL-3.1: accent = the focused state).
 */
function DrawnStage({ treatment }: { readonly treatment: "current" | "dim" | "bar" }) {
  return (
    <div class={`gxa-stage gxa-stage--${treatment}`}>
      {FAKE_PANES.map((pane, index) => (
        <>
          {index > 0 && <span class="gxa-stage__divider" />}
          <div key={pane.title} class={`gxa-pane ${pane.focused ? "gxa-pane--focused" : ""}`}>
            {treatment === "bar" && (
              <div class="gxa-pane__bar">
                <RowGlyph agent={pane.agent} />
                <span class="gxa-pane__title">{pane.title}</span>
              </div>
            )}
            <div class="gxa-pane__term">
              {pane.lines.map((line) => (
                <span
                  key={line.text}
                  class={`gxa-line ${line.tone ? `gxa-line--${line.tone}` : ""}`}
                >
                  {line.text}
                </span>
              ))}
            </div>
          </div>
        </>
      ))}
    </div>
  );
}

interface QueueEntry {
  readonly agent: PaneAgent;
  readonly where: string;
  readonly tail: string;
  readonly age: string;
}

/** The needs-you queue both switcher shapes list, severity first. */
const QUEUE: readonly QueueEntry[] = [
  {
    agent: "agy",
    where: "spacevibe-hub",
    tail: "npm install failed — lockfile conflict on preact",
    age: "12m",
  },
  {
    agent: "codex",
    where: "spacevibe-api · review",
    tail: "Permission needed: prisma migrate dev",
    age: "4m",
  },
  {
    agent: "codex",
    where: "spacevibe-deck · architecture review",
    tail: "Plan ready — approve the R4 fork?",
    age: "8m",
  },
];

/** A fake stage behind the switcher shots, quiet enough to read as ground. */
function ShotGround({ children }: { readonly children?: ComponentChildren }) {
  return (
    <div class="gxa-shot">
      <div class="gxa-shot__ground" aria-hidden="true">
        <DrawnStage treatment="current" />
      </div>
      {children}
    </div>
  );
}

/** Variant A: a modal queue on the DL §29 scrim, driven by digits. */
function SwitcherModal() {
  return (
    <ShotGround>
      <div class="gxa-scrim">
        <div class="gxa-switcher">
          <div class="gxa-switcher__head">
            <span>Needs you</span>
            <span class="gxa-switcher__count">3</span>
          </div>
          {QUEUE.map((entry, index) => (
            <div class={`gxa-switcher__row ${index === 0 ? "is-active" : ""}`} key={entry.where}>
              <AgentGlyph agent={entry.agent} className="gxa-glyph" />
              <span class="gxa-switcher__where">{entry.where}</span>
              <span class="gxa-switcher__tail">{entry.tail}</span>
              <span class="gxa-switcher__key">{index + 1}</span>
            </div>
          ))}
          <div class="gxa-switcher__hint">↵ jump · 1–3 pick · ⌘J cycles · esc</div>
        </div>
      </div>
    </ShotGround>
  );
}

/** Variant B: a non-modal peek under the strip — one row and a count. */
function SwitcherPeek() {
  const top = QUEUE[1];
  return (
    <ShotGround>
      <div class="gxa-peek">
        <AgentGlyph agent={top.agent} className="gxa-glyph" />
        <span class="gxa-peek__where">{top.where}</span>
        <span class="gxa-peek__tail">{top.tail}</span>
        <span class="gxa-peek__more">2 more · ⌘J</span>
      </div>
    </ShotGround>
  );
}

export function AttentionDirectionSection() {
  return (
    <>
      <SectionHead
        title="Attention direction"
        blurb="Proposals only — none of this is shipping chrome. The thesis: Deck's job is 'see who needs you → jump → intervene', so the rail must say what each agent just said, the stage must say where the keyboard is, and one chord must reach the agent that is waiting. Rail variants hold the seeded content constant and never reorder rows — the pinned Needs-you block stays removed (owner, 2026-08-16)."
      />
      <Specimen
        name="Attention rail · current"
        note="the shipped AgentRail on the seeded stores — the baseline the variants below are judged against; every row is one line and the newest turn is absent unless a state is actionable"
        surface="none"
      >
        <div class="gxa-study">{agentRailNavigationSpecimen({ showFooter: false })}</div>
      </Specimen>
      <Specimen
        name="Attention rail · A — every row says its turn"
        note="drawing — the tier-3 session_tail on every row: actionable rows carry it strong, working rows carry it faint; same clusters, same order"
        surface="none"
      >
        <div class="gxa-study">
          <DrawnRail variant="tail" />
        </div>
      </Specimen>
      <Specimen
        name="Attention rail · B — dim the quiet"
        note="drawing — no new information: quiet rows take the archived row's faint treatment whole, actionable rows keep full strength plus the DL-27.4 message line they already have"
        surface="none"
      >
        <div class="gxa-study">
          <DrawnRail variant="dim" />
        </div>
      </Specimen>
      <Specimen
        name="Pane focus · current vs proposed"
        note="drawings — left is the shipped treatment (55% inset hairline, bars hidden by default); middle dims unfocused panes to half strength; right adds a named pane bar with the accent-marked focused name (DL-3.1)"
        surface="none"
      >
        <div class="gxa-stages">
          <figure class="gxa-tile">
            <figcaption class="gxa-tile__label">current</figcaption>
            <DrawnStage treatment="current" />
          </figure>
          <figure class="gxa-tile">
            <figcaption class="gxa-tile__label">A · dim the unfocused</figcaption>
            <DrawnStage treatment="dim" />
          </figure>
          <figure class="gxa-tile">
            <figcaption class="gxa-tile__label">B · dim + pane bar</figcaption>
            <DrawnStage treatment="bar" />
          </figure>
        </div>
      </Specimen>
      <Specimen
        name="Jump switcher (⌘J) · A — modal queue"
        note="drawing — the needs-you queue on the DL §29 scrim, severity first, digits pick; the modal genre AgentQuickPicker already established"
        surface="none"
      >
        <SwitcherModal />
      </Specimen>
      <Specimen
        name="Jump switcher (⌘J) · B — edge peek"
        note="drawing — non-modal: the top waiting agent as one row under the strip with a count; ⌘J cycles through without covering the stage"
        surface="none"
      >
        <SwitcherPeek />
      </Specimen>
    </>
  );
}
