import { unreadAgent } from "./agent-definition";

/**
 * Mistral Vibe CLI. It installs through `uv`, so classifying its process by
 * binary name is unverified. Added 2026-10-03 without its CLI installed, so no
 * flag is read off `vibe --help`: see `unreadAgent`.
 */
export const VIBE = unreadAgent({
  id: "vibe",
  label: "Mistral Vibe",
  url: "https://docs.mistral.ai/vibe/code/cli/",
});
