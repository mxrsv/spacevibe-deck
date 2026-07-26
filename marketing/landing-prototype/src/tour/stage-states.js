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
 * Aurora palette per chapter — every stop comes from the app's own Tokyo
 * Night theme so each chapter reads distinct while staying on-brand:
 * ① calm blue (the app's UI accent, "ready") → ② the three agent brand
 * colors as agents launch → ③ hot magenta-into-violet around the focused
 * pane (the climax; deliberately away from the hero's ambient violet).
 */
export const AURORA_SCENES = deepFreeze({
  1: { colorStops: ["#3d59a1", "#7aa2f7", "#2a3f7e"], amplitude: 1.0 },
  2: { colorStops: ["#bb9af7", "#9ece6a", "#7dcfff"], amplitude: 1.15 },
  3: { colorStops: ["#f7768e", "#bb9af7", "#8d27e6"], amplitude: 1.25 },
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
