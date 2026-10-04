import { unreadAgent } from "./agent-definition";

/**
 * xAI's Grok Build. Its installer also links a second command, `agent`, to the
 * same binary; Deck probes only `grok`. Added 2026-10-03 without its CLI
 * installed, so no flag is read off `grok --help`: see `unreadAgent`.
 */
export const GROK = unreadAgent({
  id: "grok",
  label: "Grok Build",
  url: "https://x.ai/cli",
});
