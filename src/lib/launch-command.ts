/**
 * Which command a launch actually types. Pure.
 *
 * Every string that leaves this module has already passed
 * `launch-profile.ts`'s `COMMAND_SAFE` gate, so nothing here quotes or
 * escapes — that is the invariant, and it is why profiles are validated at the
 * door rather than sanitised at each call site.
 */
import {
  commandAgentId,
  commandFlags,
  findLaunchProfile,
  profilesForAgent,
  type LaunchProfile,
} from "./launch-profile";
import { catalogLaunchCommand, type CustomAgent } from "./agent-catalog";

/**
 * The command a chosen profile contributes, or null. A profile whose binary is
 * not this agent is refused rather than typed: ids are stable but a caller may
 * hold one across an agent change, and codex flags typed at claude's prompt
 * would just fail.
 */
export function resolveLaunchCommand(
  agentId: string | null,
  profileId: string | null,
  profiles: readonly LaunchProfile[],
): string | null {
  if (agentId === null) {
    return null;
  }
  const profile = findLaunchProfile(profileId, profiles);
  if (profile === null || commandAgentId(profile.command) !== agentId) {
    return null;
  }
  return profile.command;
}

/** The agent's starred profile's command, or null when it has none. */
export function defaultLaunchCommand(
  agentId: string | null,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): string | null {
  if (agentId === null) {
    return null;
  }
  return resolveLaunchCommand(agentId, defaults[agentId] ?? null, profiles);
}

/**
 * The command an agent id ACTUALLY launches with, in one resolution order:
 * the starred preset, then any preset the user wrote for this agent, then the
 * catalog's shipped recommendation, then the bare binary.
 *
 * This exists because those last two steps had no code. `defaultLaunchCommand`
 * above answers null when the user declared nothing, and every launch path
 * fell through to `resolveAgentCommand`, which returns the BARE id for a
 * built-in — so a fresh install saw `claude --dangerously-skip-permissions` in
 * Settings and typed `claude`. The row's own `effectiveCommand` reads through
 * here too, so the sentence Settings prints and the string a pane types are
 * the same function rather than two lists that agreed for one afternoon.
 *
 * Null in, null out: no agent means an empty shell, not a guess.
 */
export function agentLaunchCommand(
  agentId: string | null,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
  customAgents: readonly CustomAgent[] = [],
): string | null {
  if (agentId === null) {
    return null;
  }
  const starred = defaultLaunchCommand(agentId, profiles, defaults);
  if (starred !== null) {
    return starred;
  }
  // A preset written but never starred still beats the shipped command: the
  // user typed it for this agent, which is the whole signal `add()` acts on
  // when it stars a new one.
  const own = profilesForAgent(agentId, profiles);
  if (own.length > 0) {
    return own[0].command;
  }
  return catalogLaunchCommand(agentId, customAgents);
}

/**
 * Session restore: put the pane's flags back on the command that resumes its
 * conversation. Only `claude` is handled, and only when both commands are
 * claude's own — its flags are global options that sit beside `--resume`,
 * whereas `codex resume` and `opencode -s` take theirs in positions this
 * module does not model, so those are returned untouched rather than guessed
 * at.
 *
 * Not runtime-verified: the compatibility claim comes from `claude --help`,
 * not from an observed resume with both sets of flags present.
 */
export function applyResumeFlags(
  resumeCommand: string,
  launchCommand: string | null,
): string {
  if (launchCommand === null) {
    return resumeCommand;
  }
  if (commandAgentId(launchCommand) !== "claude") {
    return resumeCommand;
  }
  if (commandAgentId(resumeCommand) !== "claude") {
    return resumeCommand;
  }
  const flags = commandFlags(launchCommand);
  return flags === "" ? resumeCommand : `${resumeCommand} ${flags}`;
}
