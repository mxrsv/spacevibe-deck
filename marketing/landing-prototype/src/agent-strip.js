/**
 * The band under the hero that names what Deck actually runs.
 *
 * Until 2026-08-19 the page never printed the word "claude" or "codex"
 * anywhere: a visitor could read the whole landing and still not know which
 * CLIs it launches, which is the first question the product raises. This is
 * that answer, in the shape a SaaS logo wall usually takes.
 *
 * The list is the app's OWN data, imported rather than copied: `ACTIVE_AGENTS`
 * (every built-in agent not withdrawn, in the registry's order) and
 * `AGENT_LOGOS` (id -> brand file). A hand-written list drifted once already —
 * it kept advertising Cursor after the app withdrew it and missed seven agents
 * the app gained. Both modules are pure data (the registry imports only
 * `src/lib/agents/`, the logo map only `src/assets/`), so they cost this
 * bundle nothing beyond the data itself.
 */

import { AGENT_LOGOS } from "../../../src/lib/agent-logos.ts";
import { ACTIVE_AGENTS } from "../../../src/lib/agents/agent-registry.ts";

/**
 * Exported because the panel scenes draw the same marks — the catalog scene
 * lists every agent, the ⌘T menu scene leads each agent row with one. Two
 * copies of this table would let the strip and the scenes disagree about what
 * `codex` looks like.
 *
 * `mark` is `null` for an active agent the logo map has no file for, which the
 * app draws as a letter avatar; `renderAgentMark` does the same.
 */
export const AGENT_MARKS = ACTIVE_AGENTS.map(({ id, label }) => ({
  id,
  label,
  mark: AGENT_LOGOS[id] ?? null,
}));

/** First alphanumeric character of a string, uppercased; `?` when it has none. */
function monogramLetter(id) {
  for (const char of id.trim()) {
    if (/[a-z0-9]/i.test(char)) {
      return char.toUpperCase();
    }
  }

  return "?";
}

/**
 * One mark for every call site, brand file or not.
 *
 * Three renderers wrote `<img src="${agent.mark}">` by hand — this strip, the
 * tour's `agentMark`, and the retired quick-picker scene's row map — and every one
 * of them prints the literal string `src="null"` for an agent with no file.
 * This is the single branch they collapse onto. Every active agent has a file
 * today; the branch serves an id a scene fixture names that the registry does
 * not know, and the day a new agent lands before its logo does.
 *
 * The fallback is the app's own: `letterAvatar` takes the first alphanumeric
 * of the id and uppercases it (`src/lib/letter-avatar.ts:11-18`), so an id
 * `foo-bar` becomes an "F". The app also tints that disc with a `TAB_DOT_COLORS`
 * token hashed from the id — but nothing under `marketing/` carries that
 * table, and choosing a colour for a vendor here would be a brand claim in its
 * own right. The monogram is therefore neutral ink on a neutral disc: a
 * knowing simplification, not an oversight.
 *
 * `className` is the caller's own base class and the monogram appends
 * `--mono` to it, so one helper serves the 20px strip, the 18px scenes and the
 * 15px catalog rows without owning a line of any of their CSS.
 *
 * @param {{ id: string, label: string, mark: string | null }} agent
 * @param {string} className base class, carried by both branches
 * @param {number} size intrinsic size in px, written to the image's attributes
 * @returns {string} the HTML for one mark
 */
export function renderAgentMark(agent, className, size) {
  if (!agent.mark) {
    return `<span class="${className} ${className}--mono">${monogramLetter(agent.id)}</span>`;
  }

  return `<img class="${className}" src="${agent.mark}" alt="" width="${size}" height="${size}" loading="lazy" />`;
}

/**
 * Two centred rows of chips, the note on its own line under them. The rows are
 * separate lists so the split is the same at every width; each wraps by itself
 * where the viewport is too narrow for six chips.
 */
export function renderAgentStrip(copy) {
  const chips = AGENT_MARKS.map(
    (agent) => `
      <li class="agent-strip__chip">
        ${renderAgentMark(agent, "agent-strip__mark", 20)}
        <span>${agent.label}</span>
      </li>
    `,
  );
  const split = Math.ceil(chips.length / 2);
  const rows = [chips.slice(0, split), chips.slice(split)]
    .map((row) => `<ul class="agent-strip__row">${row.join("")}</ul>`)
    .join("");

  return `
    <div class="agent-strip">
      ${rows}
      <p class="agent-strip__any" data-copy="agentStripTail">${copy.agentStripTail}</p>
    </div>
  `;
}
