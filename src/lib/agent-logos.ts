/**
 * Brand marks for the built-in agents, keyed by agent id. Pure data — the URLs
 * are resolved by Vite at build time, so importing this module costs the asset
 * references and nothing else.
 *
 * This lived inside `open-board/open-board.tsx` until 2026-08-10, when the
 * token usage overview needed the same marks. One map, two call sites: a
 * second copy would drift the moment a sixth agent ships, and the failure mode
 * is silent (a chip with a logo beside a usage row without one).
 *
 * Keys are agent **ids**, which for a built-in equal the binary name — the
 * invariant `lib/agent-catalog.ts` documents. Declared agents are deliberately
 * absent: they ship no brand mark and wear a letter avatar instead.
 */

import claudeLogo from "../assets/agent-claude.svg";
import codexLogo from "../assets/agent-codex.svg";
import geminiLogo from "../assets/agent-gemini.svg";
import opencodeLogo from "../assets/agent-opencode.svg";
// The only raster mark here: Google ships the Antigravity icon as PNG. Stored
// at 96px — the chip renders it at 15px (styles.css `.achip__logo`), so this
// still has headroom at 3x while staying a fraction of the source file.
import agyLogo from "../assets/agent-agy.png";

export const AGENT_LOGOS: Readonly<Record<string, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo,
  opencode: opencodeLogo,
  agy: agyLogo,
};
