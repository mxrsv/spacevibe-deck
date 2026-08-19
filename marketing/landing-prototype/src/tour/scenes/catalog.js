/**
 * Panel 6 — Settings → Agents, the agent catalog.
 *
 * Every agent Deck knows, split by whether the discovery probe found its
 * binary, each row stating the exact command that agent will launch with. The
 * commands are the catalog's own `defaultCommand` values
 * (`src/lib/agent-catalog.ts`), not invented ones: the whole point of the
 * panel is that a reader can check them against the CLI they already run, so
 * a plausible-looking flag would be worse than no panel at all.
 *
 * Two things this scene deliberately does NOT draw, because the app stopped
 * drawing them on 2026-08-19 (`launch-profile-editor.tsx:42-46`): a star or
 * any "Set default" control, and the ↗ link to each agent's website.
 * `Settings.defaultAgent` and `BuiltinAgent.url` survive as data with no
 * control reading them. The Enabled/Disabled segmented radiogroup is the only
 * control a row carries.
 *
 * Settings covers the whole window in the app — frame row included, since
 * DL-11.1 was amended — so this scene passes `rail: null` and the catalog has
 * the window to itself. Drawing the agent rail beside Settings would be a
 * picture of a state the product does not have, and it would spend a third of
 * a 546.7px panel on chrome this panel is not about.
 */

import { AGENT_MARKS, renderAgentMark } from "../../agent-strip.js";
import { STAGE_ICONS, renderChromeIcon } from "../../appwin.js";
import { frame } from "./chrome.js";

/**
 * The commands the catalog ships, verbatim from `BUILTIN_AGENTS`.
 *
 * `opencode` is ABSENT on purpose. `agent-catalog.ts:66` carries no
 * `defaultCommand` for it — its `--auto` is opt-in per session — and
 * `catalogLaunchCommand` falls back to the bare binary id, so the app prints
 * the bare word `opencode`. Adding a key here to make the table look complete
 * would put a flag on screen that the app never types.
 */
const DEFAULT_COMMANDS = {
  claude: "claude --dangerously-skip-permissions",
  codex: "codex --dangerously-bypass-approvals-and-sandbox",
  agy: "agy --dangerously-skip-permissions",
  gemini: "gemini --yolo",
  "cursor-agent": "cursor-agent --force",
};

/**
 * Which agents this drawing's probe found on `$PATH`.
 *
 * A `Set` filtered over `AGENT_MARKS` — which is `BUILTIN_AGENTS`' order —
 * exactly as `LaunchProfileEditor` filters the catalog (`:162-168`). That is
 * what keeps BOTH groups in catalog order without either being re-sorted, and
 * it is why `cursor-agent` stays last: the order is the digit-key contract.
 */
const INSTALLED_IDS = new Set(["claude", "codex", "opencode"]);

const INSTALLED = AGENT_MARKS.filter((agent) => INSTALLED_IDS.has(agent.id));
const AVAILABLE = AGENT_MARKS.filter((agent) => !INSTALLED_IDS.has(agent.id));

/**
 * The two groups, in the order `LaunchProfileEditor` emits them.
 *
 * The counts are read off the arrays rather than written out, so the pill can
 * never disagree with the rows under it. The strings around them are verbatim:
 * `{n} detected` and `{n} agents`.
 */
const GROUPS = [
  {
    title: "Installed",
    count: `${INSTALLED.length} detected`,
    refresh: true,
    agents: INSTALLED,
  },
  {
    title: "Available to install",
    count: `${AVAILABLE.length} agents`,
    refresh: false,
    agents: AVAILABLE,
  },
];

/** Reveal stagger, one running count over heads and rows in document order. */
const REVEAL_START = 160;
const REVEAL_STEP = 80;

/** The command a row prints: the catalog's, else the bare binary. */
function launchCommand(agent) {
  return DEFAULT_COMMANDS[agent.id] ?? agent.id;
}

/**
 * One command, split so the binary and its flags can be toned apart.
 *
 * The flags span is emitted even when it is EMPTY, which is the one place the
 * mock parts company with `CommandLine` (`launch-profile-editor.tsx:67-75`):
 * the app skips the span entirely for a bare command, and a scene that did the
 * same would let opencode's row measure differently from the five around it.
 * An empty span costs nothing and keeps the six rows one shape.
 *
 * The separating space lives INSIDE the flags span, as it does in the app, so
 * that a bare command carries no trailing space of its own. It is ordinary
 * collapsible whitespace, which means `.scene-catalog__command` has to stay an
 * inline box — the app leaves `.lp-command` inline for the same reason. Turn
 * it into a flex row and the space collapses at the item edge, gluing the
 * binary to its flags.
 */
function renderCommand(command) {
  const cut = command.indexOf(" ");
  const binary = cut === -1 ? command : command.slice(0, cut);
  const flags = cut === -1 ? "" : command.slice(cut);

  return `<span class="scene-catalog__command"><span class="scene-catalog__binary">${binary}</span><span class="scene-catalog__flags">${flags}</span></span>`;
}

/**
 * One agent row: mark, name over command, then the enable control.
 *
 * Every row draws `Enabled` as the chosen segment. The whole scene is a fresh
 * install — that premise is what makes the printed commands the catalog's
 * defaults rather than somebody's presets — and on a fresh install
 * `settings.disabledAgents` is empty, so no row is off. Drawing one row off to
 * demonstrate the control would contradict the commands beside it.
 */
function renderAgentRow(agent, delay) {
  return `
    <div class="scene-catalog__agent" style="--scene-delay: ${delay}ms">
      ${renderAgentMark(agent, "scene-catalog__mark", 15)}
      <div class="scene-catalog__text">
        <span class="scene-catalog__name">${agent.label}</span>
        ${renderCommand(launchCommand(agent))}
      </div>
      <div
        class="scene-catalog__enabled"
        role="radiogroup"
        aria-label="${agent.label} availability"
      >
        <span class="scene-catalog__option is-active" role="radio" aria-checked="true">Enabled</span>
        <span class="scene-catalog__option" role="radio" aria-checked="false">Disabled</span>
      </div>
    </div>
  `;
}

/**
 * A group heading: its title, the count pill, and — on `Installed` only — the
 * Refresh control, which is what answers "can Deck run this one" on screen.
 */
function renderHead(group, delay) {
  const refresh = group.refresh
    ? `<span class="scene-catalog__refresh"><span class="scene-catalog__refreshicon">${renderChromeIcon(STAGE_ICONS.refresh)}</span>Refresh</span>`
    : "";

  return `
    <div class="scene-catalog__head" style="--scene-delay: ${delay}ms">
      <span class="scene-catalog__title">${group.title}</span>
      <span class="scene-catalog__count">${group.count}</span>
      ${refresh}
    </div>
  `;
}

export function catalog() {
  let order = 0;

  function nextDelay() {
    order += 1;

    return REVEAL_START + order * REVEAL_STEP;
  }

  const groups = GROUPS.map((group) => {
    const head = renderHead(group, nextDelay());
    const rows = group.agents
      .map((agent) => renderAgentRow(agent, nextDelay()))
      .join("");

    return head + rows;
  }).join("");

  return frame(
    `
      <div class="scene scene-catalog">
        <div class="scene-catalog__list">${groups}</div>
      </div>
    `,
    { rail: null },
  );
}
