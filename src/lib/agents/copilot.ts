import { unreadAgent } from "./agent-definition";

/**
 * GitHub Copilot CLI (npm `@github/copilot`). Not `gh copilot`, which is a
 * different tool. Added 2026-10-03 without its CLI installed, so no flag is
 * read off `copilot --help`: see `unreadAgent`.
 */
export const COPILOT = unreadAgent({
  id: "copilot",
  label: "GitHub Copilot",
  url: "https://docs.github.com/copilot/concepts/agents/about-copilot-cli",
});
