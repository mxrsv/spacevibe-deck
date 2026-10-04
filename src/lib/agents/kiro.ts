import { unreadAgent } from "./agent-definition";

/**
 * Kiro CLI, successor to Amazon Q Developer CLI. The binary is `kiro-cli`. Added 2026-10-03 without its CLI installed, so
 * no flag is read off `kiro-cli --help`: see `unreadAgent`.
 */
export const KIRO = unreadAgent({
  id: "kiro-cli",
  label: "Kiro",
  url: "https://kiro.dev/cli",
});
