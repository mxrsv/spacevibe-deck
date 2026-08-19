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
 * and a second copy of five brand marks would drift the moment a sixth agent
 * ships. The list mirrors `src/lib/agent-catalog.ts`'s `BUILTIN_AGENTS`,
 * including its order, which is reach rather than history.
 */

import agyMark from "../../../src/assets/agent-agy.png";
import claudeMark from "../../../src/assets/agent-claude.svg";
import codexMark from "../../../src/assets/agent-codex.svg";
import geminiMark from "../../../src/assets/agent-gemini.svg";
import opencodeMark from "../../../src/assets/agent-opencode.svg";

/**
 * Exported because the panel scenes draw the same marks — the quick-picker
 * scene lists all five, the rail scene leads each row with one. Two copies of
 * this table would let the strip and the scenes disagree about what `codex`
 * looks like.
 */
export const AGENT_MARKS = [
  { id: "claude", label: "Claude Code", mark: claudeMark },
  { id: "codex", label: "Codex", mark: codexMark },
  { id: "opencode", label: "OpenCode", mark: opencodeMark },
  { id: "agy", label: "Antigravity", mark: agyMark },
  { id: "gemini", label: "Gemini CLI", mark: geminiMark },
];

const AGENTS = AGENT_MARKS;

export function renderAgentStrip(copy) {
  const chips = AGENTS.map(
    (agent) => `
      <li class="agent-strip__chip">
        <img
          class="agent-strip__mark"
          src="${agent.mark}"
          alt=""
          width="20"
          height="20"
          loading="lazy"
        />
        <span>${agent.label}</span>
      </li>
    `,
  ).join("");

  return `
    <div class="agent-strip">
      <p class="band-label" data-copy="agentStripLabel">${copy.agentStripLabel}</p>
      <ul class="agent-strip__row">
        ${chips}
        <li class="agent-strip__any" data-copy="agentStripTail">${copy.agentStripTail}</li>
      </ul>
    </div>
  `;
}
