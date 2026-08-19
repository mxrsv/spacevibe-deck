/**
 * The closing band's proof-terminal script, and nothing else.
 *
 * This module used to carry the Open board's fixtures too — agent chips,
 * recent rows, preset thumbnails and the sidebar's status map — because one
 * panel still hand-rolled the board and a pane grid out of the shared stage
 * renderers. That chain went with the six-panel rewrite, and every panel scene
 * now holds its own fixture beside its own body in `./scenes/`. What is left
 * is the one piece of tour state no scene owns. English-only, like everything
 * rendered inside terminal chrome.
 */

import { deepFreeze } from "../product-stage.js";
import { REPO_URL } from "../release-data.js";

// Derived rather than spelled out: the proof terminal must quote the same repo
// the page's own links point at, or one of the two goes stale on a rename.
const REPO_SLUG = new URL(REPO_URL).pathname.slice(1);
const REPO_DIR = REPO_SLUG.split("/").at(-1);

/**
 * Closing-band proof terminal: each exchange proves one claim and lights the
 * matching proof chip (`chip` = the proof key in renderFinale).
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
