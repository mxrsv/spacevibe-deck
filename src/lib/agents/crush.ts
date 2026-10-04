import { unreadAgent } from "./agent-definition";

/**
 * Charm's Crush. Added 2026-10-03 without its CLI installed, so no flag is
 * read off `crush --help`: see `unreadAgent`.
 */
export const CRUSH = unreadAgent({
  id: "crush",
  label: "Crush",
  url: "https://github.com/charmbracelet/crush",
});
