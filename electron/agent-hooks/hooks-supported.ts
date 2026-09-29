/**
 * Whether this host can register agent hooks at all — the one answer both
 * integrations default their `supported` flag to and `agent_signal_config`
 * reports to the renderer, so Settings can say so instead of offering a switch
 * that does nothing.
 *
 * POSIX only: the hook script is `sh` + `curl`, and Windows keeps the
 * output-timing fallback (spec §8) until a PowerShell script exists.
 */
export function hooksSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}
