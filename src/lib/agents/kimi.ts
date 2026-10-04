import { unreadAgent } from "./agent-definition";

/**
 * Moonshot AI's Kimi Code CLI. Added 2026-10-03 without its CLI installed, so
 * no flag is read off `kimi --help`: see `unreadAgent`.
 */
export const KIMI = unreadAgent({
  id: "kimi",
  label: "Kimi Code",
  url: "https://www.kimi.com/code",
});
