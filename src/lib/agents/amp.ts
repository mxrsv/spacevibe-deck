import { unreadAgent } from "./agent-definition";

/**
 * Amp, Sourcegraph's coding agent. Added 2026-10-03 without its CLI installed,
 * so no flag is read off `amp --help`: see `unreadAgent`.
 */
export const AMP = unreadAgent({
  id: "amp",
  label: "Amp",
  url: "https://ampcode.com",
});
