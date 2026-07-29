/**
 * Tour stage data — English-only, mirroring the released app just like the
 * hero stage. Pane transcripts and the workspace sidebar are shared with the
 * hero (product-stage.js); this module holds only tour-specific state.
 */

import { BRAND } from "../../../stage/brand.js";
import { deepFreeze } from "../product-stage.js";

/** Agent identity chips on the Open board rows. */
export const AGENTS = deepFreeze({
  claude: { monogram: "C", tint: "#bb9af7" },
  codex: { monogram: "X", tint: "#9ece6a" },
  opencode: { monogram: "O", tint: "#7dcfff" },
});

/** Open board recent rows — the top one carries the remembered combo. */
export const boardRecents = deepFreeze([
  {
    id: BRAND.slug,
    label: BRAND.slug,
    path: `…evibe-workspace/${BRAND.slug}`,
    highlighted: true,
    preset: "trio",
    agents: ["claude", "codex", "opencode"],
  },
  {
    id: "spacevibe-arena",
    label: "spacevibe-arena",
    path: "…rkspace/spacevibe-arena",
    highlighted: false,
    preset: "duo",
    agents: ["claude"],
  },
  {
    id: "spacevibe-api",
    label: "spacevibe-api",
    path: "…rkspace/spacevibe-api",
    highlighted: false,
    preset: "quad",
    agents: ["codex"],
  },
]);

/** Cells per preset thumbnail; the layouts themselves live in tour.css. */
export const PRESET_CELLS = deepFreeze({ duo: 2, trio: 3, quad: 4 });

/**
 * Sidebar avatar indicators, as in the released app: "busy" = spinning ring
 * (agent working on a prompt), "unread" = yellow dot (new output not seen).
 */
export const SIDEBAR_STATUS = deepFreeze({
  [BRAND.slug]: "busy",
  "spacevibe-arena": "unread",
  "spacevibe-api": "busy",
});

/**
 * Aurora palette per chapter. These used to be Tokyo Night hues — blue, then
 * the three agent brand colours, then hot magenta — which no longer belongs on
 * a page whose light is achromatic end to end (the hero's beams field set that
 * rule; see marketing/landing-prototype/src/beams.js).
 *
 * The chapters still have to read as three distinct moments, so the axis moved
 * from HUE to TEMPERATURE: ① cool steel grey → ② neutral grey, the brightest
 * of the three → ③ warm ivory grey. Saturation is 3–10%, low enough that
 * nobody can name a colour, high enough that consecutive chapters do not look
 * like a repeat. Amplitude keeps climbing alongside it so the curtain also
 * moves harder as the story escalates.
 *
 * Each triple is left → middle → right across the curtain's gradient.
 *
 * The stops are much LIGHTER than the violet ones they replaced, and that is
 * deliberate: the shader multiplies the ramp by a fractional intensity
 * (`auroraColor = intensity * rampColor` in aurora.js), so a saturated violet
 * still separated from black at low intensity where an equally-dark grey just
 * vanished. With no chroma to carry it, the curtain has to be read on value.
 */
export const AURORA_SCENES = deepFreeze({
  1: { colorStops: ["#646f7d", "#d7dbdf", "#4b535d"], amplitude: 1.0 },
  2: { colorStops: ["#7c7e83", "#eff0f0", "#5c5d61"], amplitude: 1.15 },
  3: { colorStops: ["#84796c", "#e8e6e3", "#625a50"], amplitude: 1.25 },
});

/**
 * Closing-band proof terminal: each exchange proves one claim and lights the
 * matching proof chip (`chip` = the proof key in renderFinale). English-only,
 * like everything rendered inside terminal chrome.
 */
export const PROOF_TERM_STEPS = deepFreeze([
  {
    cmd: "echo $SHELL && alias claude",
    out: ["/bin/zsh", "claude='~/.claude/local/claude'"],
    chip: "Pty",
  },
  {
    cmd: 'echo "box-drawing ├─┬─┐ │ └─┴─┘ renders clean ✓"',
    out: ["box-drawing ├─┬─┐ │ └─┴─┘ renders clean ✓"],
    chip: "Pty",
  },
  {
    cmd: `grep -ri telemetry ${BRAND.bundlePath}`,
    out: ["(no matches)"],
    chip: "Local",
  },
  {
    cmd: `du -sh ${BRAND.bundlePath}`,
    out: [` 18M\t${BRAND.bundlePath}`],
    chip: "Native",
  },
]);
