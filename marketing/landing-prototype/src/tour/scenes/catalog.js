/**
 * Panel 6 — Settings → Agents, the agent catalog.
 *
 * Placeholder: the chrome with an empty stage. The body is the catalog's two
 * groups — Installed with its count and Refresh, then Available to install —
 * each row stating the command it will launch with and carrying the
 * Enabled/Disabled radiogroup, and it is written by its own task, which owns
 * this file from here on.
 */

import { frame } from "./chrome.js";

export function catalog() {
  return frame("");
}
