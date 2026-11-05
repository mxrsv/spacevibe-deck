import { ArrowDown01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import { WorkspaceIcon } from "../../ui/workspace-icon";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { DeckIcon, GLYPH_INLINE } from "../../ui/controls/deck-icon";
import { STATE_NEEDS_YOU, stateClasses } from "../../ui/blocks/recipe-classes";
import type { MockAgent, MockLogo, MockWorkspace } from "./rail-hierarchy-data";
import { FoldedCluster, HierarchyMark } from "./rail-hierarchy-marks";
import "./rail-hierarchy-section.css";

/** The words a screen reader gets in place of the mark (RH-16). */
const STATUS_WORDS: Readonly<Record<string, string>> = {
  "needs-input": "needs you",
  unread: "unread",
  working: "working",
  failed: "failed",
  done: "done",
  ended: "ended",
  idle: "idle",
};

/**
 * The workspace's logo in its fixed 16 box (RL-10). A workspace without one gets the real
 * fallback glyph; the others a flat stand-in the box clips.
 */
function LogoBox({ logo }: { readonly logo: MockLogo }) {
  if (logo === "folder") {
    return (
      <WorkspaceIcon
        path={null}
        marks
        size={16}
        className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) text-(--text-muted)"
      />
    );
  }
  return (
    <span className="rh-logo" data-logo={logo}>
      {logo === "dark" ? "N" : null}
    </span>
  );
}

/**
 * The proposed agent row (RH-2, RH-8, RH-11, RH-12): 36 high, a 12 mark slot, the 28 logo box,
 * a 12px title over a 12px faint meta line. Unread and needs-you titles are 600; only needs-you
 * is tinted.
 */
export function AfterRow({ agent }: { readonly agent: MockAgent }) {
  const loud = agent.status === "needs-input" || agent.status === "unread";
  return (
    <div className="rh-row-wrap">
      {/* raw-control: a whole-row click target, as the shipped rail's row */}
      <button
        type="button"
        aria-current={agent.focused === true ? "true" : undefined}
        className={cn(
          "rh-row",
          stateClasses(agent.focused === true),
          agent.status === "needs-input" && agent.focused !== true && STATE_NEEDS_YOU,
        )}
      >
        <HierarchyMark status={agent.status} />
        <span className="rh-row__logo">
          <AgentGlyph agent="claude" className="size-(--icon-16) shrink-0" />
        </span>
        <span className="rh-row__main">
          <span
            className={cn("rh-row__title", loud && "rh-row__title--loud")}
            data-failed={agent.status === "failed" ? "" : undefined}
          >
            {agent.title}
          </span>
          <span className={cn("rh-row__meta", agent.status === "failed" && "rh-row__meta--fail")}>
            <DeckIcon icon={GitBranchIcon} size={GLYPH_INLINE} class="shrink-0" />
            <span className="rh-row__branch">{agent.branch}</span>
            <span className="rh-row__age">{agent.age}</span>
          </span>
        </span>
        <span className="sr-only">{`Claude, ${STATUS_WORDS[agent.status]}`}</span>
      </button>
    </div>
  );
}

/**
 * One workspace (RH-7, RH-9, RH-10, RH-15): a sticky header in secondary ink, then its rows
 * indented behind a guide line. Folded, the header carries the cluster; empty, one line and a
 * muted 0.
 */
export function AfterWorkspace({ workspace }: { readonly workspace: MockWorkspace }) {
  const { agents, folded } = workspace;
  return (
    <section aria-label={workspace.name} className="rh-ws">
      {/* raw-control: a whole-row disclosure target, as the shipped header */}
      <button type="button" aria-expanded={!folded} className={cn("rh-head", stateClasses(false))}>
        <LogoBox logo={workspace.logo} />
        <span className="rh-head__name">{workspace.name}</span>
        <DeckIcon
          icon={ArrowDown01Icon}
          size={GLYPH_INLINE}
          class={cn("shrink-0 text-(--text-faint)", folded && "-rotate-90")}
        />
        <span className="rh-head__end">
          {folded ? <FoldedCluster agents={agents} /> : null}
          {folded || agents.length === 0 ? (
            <span className="rh-head__count">{agents.length}</span>
          ) : null}
        </span>
      </button>
      {folded || agents.length === 0 ? null : (
        <div className="rh-rows">
          {agents.map((agent) => (
            <AfterRow key={agent.title} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}
