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
  // Clone first, read second: `grep -ri telemetry src` stopped returning
  // nothing when the opt-in analytics landed (spec 2026-08-22), so the honest
  // proof moved from an absence to a CONTRACT — the payload file is written to
  // be read by a person, and `cat`ing it shows the client's whole field list.
  // It proves the client contract, not server retention; the privacy notice
  // covers the rest.
  {
    cmd: `gh repo clone ${REPO_SLUG}`,
    out: [`Cloning into '${REPO_DIR}'... done.`],
    chip: "Open",
  },
  {
    cmd: `cat ${REPO_DIR}/src/telemetry/payload.ts`,
    out: [
      "// The usage-analytics payload contract — one small",
      "// daily snapshot. Deliberately absent: file",
      "// paths, repo names, prompts, terminal output, any",
      "// permanent id. dailyId is a fresh random UUID per day.",
    ],
    chip: "Local",
  },
]);
