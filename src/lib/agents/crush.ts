import { unreadAgent, type AgentDefinition } from "./agent-definition";

/**
 * Charm's Crush. Added 2026-10-03 without its CLI installed, so no flag is
 * read off `crush --help`: see `unreadAgent`.
 *
 * **Withdrawn on 2026-10-04** on the owner's ask, for now. Deleting the
 * `withdrawn` line brings it back.
 */
export const CRUSH: AgentDefinition = {
  ...unreadAgent({
    id: "crush",
    label: "Crush",
    url: "https://github.com/charmbracelet/crush",
  }),
  withdrawn: true,
};
