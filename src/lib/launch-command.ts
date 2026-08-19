/**
 * The only place launch options become a command line. Pure.
 *
 * Every value that reaches a flag here has already passed `launch-profile.ts`'s
 * validation — a closed enum or a `LAUNCH_TOKEN`. Nothing in this module
 * quotes or escapes, because nothing that needs quoting can arrive: that is
 * the invariant, and it is why the whole feature has one composition point
 * rather than one per call site.
 *
 * Flag spellings are the long forms from each CLI's own `--help` (checked
 * 2026-08-19). Long forms on purpose: the row prints this string, and
 * `--permission-mode plan` says what it does where `-p plan` does not.
 */
import {
  findLaunchProfile,
  type LaunchOptions,
  type LaunchProfile,
} from "./launch-profile";

function flag(name: string, value: string | null): readonly string[] {
  return value === null ? [] : [name, value];
}

export function composeLaunchCommand(options: LaunchOptions): string {
  switch (options.kind) {
    case "claude":
      return [
        "claude",
        ...flag("--model", options.model),
        ...flag("--permission-mode", options.permissionMode),
      ].join(" ");
    case "codex":
      // `bypass` supersedes the other two rather than joining them: the CLI
      // ignores `--sandbox` / `--ask-for-approval` once both are skipped, and
      // the row prints this string as what will run.
      return [
        "codex",
        ...flag("--model", options.model),
        ...(options.bypass
          ? ["--dangerously-bypass-approvals-and-sandbox"]
          : [
              ...flag("--sandbox", options.sandbox),
              ...flag("--ask-for-approval", options.approval),
            ]),
      ].join(" ");
    case "cursor-agent":
      return [
        "cursor-agent",
        ...flag("--model", options.model),
        ...flag("--mode", options.mode),
        ...(options.force ? ["--force"] : []),
      ].join(" ");
    case "opencode":
      return [
        "opencode",
        ...flag("--model", options.model),
        ...flag("--agent", options.agent),
        ...(options.auto ? ["--auto"] : []),
      ].join(" ");
  }
}

/**
 * The options a chosen profile contributes, or null. A profile whose kind is
 * not this agent is refused rather than applied: ids are stable but a caller
 * may hold one across an agent change, and codex flags typed at claude's
 * prompt would just fail.
 */
export function resolveLaunchOptions(
  agentId: string | null,
  profileId: string | null,
  profiles: readonly LaunchProfile[],
): LaunchOptions | null {
  if (agentId === null) {
    return null;
  }
  const profile = findLaunchProfile(profileId, profiles);
  if (profile === null || profile.options.kind !== agentId) {
    return null;
  }
  return profile.options;
}

/** The agent's declared default profile's options, or null. */
export function defaultLaunchOptions(
  agentId: string | null,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): LaunchOptions | null {
  if (agentId === null) {
    return null;
  }
  return resolveLaunchOptions(agentId, defaults[agentId] ?? null, profiles);
}

/**
 * Session restore: put the pane's mode back on the command that resumes its
 * conversation. Only `claude` is handled, and only when the command is
 * claude's own — its `--model` / `--permission-mode` are global options that
 * sit beside `--resume`. `codex resume` and `opencode -s` take their flags in
 * positions this module does not model, so they are returned untouched rather
 * than guessed at.
 *
 * Not runtime-verified: the compatibility claim comes from `claude --help`,
 * not from an observed resume with both flags present.
 */
export function applyResumeOptions(
  command: string,
  options: LaunchOptions | null,
): string {
  if (options === null || options.kind !== "claude") {
    return command;
  }
  if (!command.startsWith("claude ") && command !== "claude") {
    return command;
  }
  const extra = [
    ...flag("--model", options.model),
    ...flag("--permission-mode", options.permissionMode),
  ];
  return extra.length === 0 ? command : `${command} ${extra.join(" ")}`;
}
