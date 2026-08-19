/**
 * Tour stage data — English-only, mirroring the released app just like the
 * hero stage. Pane transcripts and the workspace sidebar are shared with the
 * hero (product-stage.js); this module holds only tour-specific state.
 */

import { BRAND } from "../../../stage/brand.js";
import { deepFreeze } from "../product-stage.js";
import { REPO_URL } from "../release-data.js";

// Derived rather than spelled out: the proof terminal must quote the same repo
// the page's own links point at, or one of the two goes stale on a rename.
const REPO_SLUG = new URL(REPO_URL).pathname.slice(1);
const REPO_DIR = REPO_SLUG.split("/").at(-1);

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
  // Clone first, grep second: the telemetry claim used to be proved against the
  // installed bundle, which stopped being a clean read once the app shipped a
  // Chromium runtime. The source tree is where the claim actually lives, and
  // pointing at it is only honest because the repo is public — which is the
  // proof the clone line carries.
  {
    cmd: `gh repo clone ${REPO_SLUG}`,
    out: [`Cloning into '${REPO_DIR}'... done.`],
    chip: "Open",
  },
  {
    cmd: `grep -ri telemetry ${REPO_DIR}/src`,
    out: ["(no matches)"],
    chip: "Local",
  },
]);
