/**
 * The band under the hero that names what Deck actually runs.
 *
 * Until 2026-08-19 the page never printed the word "claude" or "codex"
 * anywhere: a visitor could read the whole landing and still not know which
 * CLIs it launches, which is the first question the product raises. This is
 * that answer, in the shape a SaaS logo wall usually takes.
 *
 * The marks are the app's OWN files (`src/assets/agent-*`), imported rather
 * than copied — the landing already reaches the repo root for `package.json`,
 * and a second copy of them would drift the moment the catalog moves. The list
 * mirrors `src/lib/agent-catalog.ts`'s `BUILTIN_AGENTS`, including its order,
 * which is reach rather than history — and, since 2026-08-19, including one
 * agent that ships no brand file at all.
 */

import agyMark from "../../../src/assets/agent-agy.png";
import claudeMark from "../../../src/assets/agent-claude.svg";
import codexMark from "../../../src/assets/agent-codex.svg";
import geminiMark from "../../../src/assets/agent-gemini.svg";
import opencodeMark from "../../../src/assets/agent-opencode.svg";

/**
 * Exported because the panel scenes draw the same marks — the quick-picker
 * scene lists all six, the rail scene leads each row with one. Two copies of
 * this table would let the strip and the scenes disagree about what `codex`
 * looks like.
 */
export const AGENT_MARKS = [
  { id: "claude", label: "Claude Code", mark: claudeMark },
  { id: "codex", label: "Codex", mark: codexMark },
  { id: "opencode", label: "OpenCode", mark: opencodeMark },
  { id: "agy", label: "Antigravity", mark: agyMark },
  { id: "gemini", label: "Gemini CLI", mark: geminiMark },
  // `cursor-agent`, not `cursor`: the id is the binary name, as it is for
  // every built-in. Last for the reason the catalog appends it last — the
  // order is the digit-key contract, so a new agent never moves the key an
  // existing one already answered to. `mark: null` because `src/assets/`
  // holds five brand files and none of them is this one; drawing a logo the
  // vendor never shipped would be a brand claim, so the monogram stands in.
  { id: "cursor-agent", label: "Cursor", mark: null },
];

const AGENTS = AGENT_MARKS;

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
 * tour's `agentMark`, and the quick-picker scene's own row map — and every one
 * of them prints the literal string `src="null"` for an agent with no file.
 * This is the single branch they collapse onto.
 *
 * The fallback is the app's own: `letterAvatar` takes the first alphanumeric
 * of the id and uppercases it (`src/lib/letter-avatar.ts:11-18`), which makes
 * `cursor-agent` a "C". The app also tints that disc with a `TAB_DOT_COLORS`
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

export function renderAgentStrip(copy) {
  const chips = AGENTS.map(
    (agent) => `
      <li class="agent-strip__chip">
        ${renderAgentMark(agent, "agent-strip__mark", 20)}
        <span>${agent.label}</span>
      </li>
    `,
  ).join("");

  return `
    <div class="agent-strip">
      <ul class="agent-strip__row">
        ${chips}
        <li class="agent-strip__any" data-copy="agentStripTail">${copy.agentStripTail}</li>
      </ul>
    </div>
  `;
}
