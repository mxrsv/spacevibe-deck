/**
 * One agent's brand mark, or its letter when it ships none.
 *
 * Lived inside `agent-rail.tsx` until 2026-08-16, when the tab strip's chips
 * became glyph-led too (DL-18.6): a rail row and a strip chip must never
 * disagree about what `claude` looks like, and the fallback for a declared
 * agent — a letter, not an empty circle — is exactly the kind of rule that
 * rots when it exists twice.
 *
 * Presentational only. The caller passes the class it wants so each surface
 * keeps its own sizing and layout; this decides the CONTENT, never the box.
 */
import { AGENT_INK_MARKS, AGENT_LOGOS } from "../../lib/agent-logos";
import { letterAvatar } from "../../lib/letter-avatar";
import type { PaneAgent } from "../../lib/process-info";

export interface AgentGlyphProps {
  readonly agent: PaneAgent;
  /** Base class; the letter fallback also gets `${className}--letter`. */
  readonly className: string;
}

export function AgentGlyph({ agent, className }: AgentGlyphProps) {
  const ink = AGENT_INK_MARKS[agent];
  // A single-colour mark is drawn inline in `currentColor` (2026-09-18,
  // design review F1): as an `<img>` its white fill vanished on the light
  // theme. The box is still the caller's class; only the paint changed.
  if (ink !== undefined) {
    return (
      <svg class={className} viewBox={ink.viewBox} fill="currentColor" aria-hidden="true">
        <path d={ink.path} fill-rule={ink.fillRule} />
      </svg>
    );
  }
  const logo = AGENT_LOGOS[agent];
  // A declared agent ships no brand mark, so it wears a letter instead of an
  // empty circle — the same fallback the workspace rows have always used.
  return logo === undefined ? (
    <span class={`${className} ${className}--letter`} aria-hidden="true">
      {letterAvatar(agent, agent).letter}
    </span>
  ) : (
    <img class={className} src={logo} alt="" />
  );
}
