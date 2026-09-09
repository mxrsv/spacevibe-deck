/**
 * Arm-time augmentation — the flags Deck appends to the user's launch
 * command so the CLI reports to Deck (agent-signal contract layer, stage 2;
 * spec §4 "The mechanism, once"). Pure.
 *
 * The user's command is a `launch-profile.ts` string, and `commandProblem`
 * refuses quotes, `$` and backslashes at the door — so a path with a space
 * (macOS `userData` is `…/Application Support/SpaceVibe Deck/`) cannot be
 * typed by a USER. Deck's own additions are not a profile: they are composed
 * HERE, exempt from that gate, shell-quoted, and never written to a profile,
 * the journal or the strip — restore re-applies them at arm time from the
 * journal's stored USER command. The result reaches `AgentLauncher.arm` and
 * nothing else.
 *
 * Per agent, v1:
 * - **claude** — `--settings '<deck file>'` (Claude loads it as additional
 *   settings for the session; the user's own hooks keep firing — verified
 *   2026-09-03) and, for a FRESH launch, `--session-id <uuid>` minted by Deck
 *   so the pane → session pairing exists before the first byte of output
 *   (spec §10.2's default). A command that resumes (`--resume`, `-r`,
 *   `--continue`, `-c`, `--fork-session`) keeps its own id.
 * - **codex** — `-c tui.notification_condition=always`, so Codex's BEL rings
 *   for `approval-requested` and `agent-turn-complete` whether or not the
 *   pane is focused (spec §10.6's default: the mark is worth the beep).
 * - **opencode** — `--port <n>` with the port main reserved for the pane, so
 *   its server can be subscribed to.
 *
 * A flag the user already typed is never doubled (spec §6): Deck's addition
 * is skipped and the row stays inferred for that half. Typed VISIBLY
 * (spec §10.3): the user sees exactly what Deck runs.
 */
import { commandAgentId } from "./launch-profile";

export interface SignalAdapters {
  readonly claude: boolean;
  readonly codex: boolean;
  readonly opencode: boolean;
}

export interface AugmentContext {
  readonly adapters: SignalAdapters;
  /** POSIX hosts only: the hook script is `sh` + `curl`. */
  readonly platform: "macos" | "windows" | "unsupported";
  readonly claudeSettingsPath: string | null;
  /** A uuid minted for a fresh Claude launch, or null to leave the id to Claude. */
  readonly sessionId: string | null;
  /** The port main reserved for an opencode pane, or null. */
  readonly opencodePort: number | null;
}

export interface Augmented {
  readonly command: string;
  /** The session id the command carries, when Deck minted one. */
  readonly sessionId: string | null;
}

const CLAUDE_RESUME_FLAGS = ["--resume", "-r", "--continue", "-c", "--fork-session"];

/** POSIX single-quoting — `'` is the only character that needs escaping inside `'…'`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/** Whether `flag` (or `flag=…`) appears as its own argument. */
function hasFlag(command: string, flag: string): boolean {
  return tokens(command).some((token) => token === flag || token.startsWith(`${flag}=`));
}

/** Whether a `-c key=value` / `--config key=value` pair for `key` was typed. */
function hasConfigKey(command: string, key: string): boolean {
  const parts = tokens(command);
  return parts.some(
    (token, index) =>
      (token === "-c" || token === "--config") && (parts[index + 1] ?? "").startsWith(`${key}=`),
  );
}

export function augmentLaunchCommand(command: string, context: AugmentContext): Augmented {
  const agent = commandAgentId(command);
  const extra: string[] = [];
  let sessionId: string | null = null;

  if (agent === "claude" && context.adapters.claude && context.platform !== "windows") {
    if (context.claudeSettingsPath !== null && !hasFlag(command, "--settings")) {
      extra.push("--settings", shellQuote(context.claudeSettingsPath));
    }
    const resumes = CLAUDE_RESUME_FLAGS.some((flag) => hasFlag(command, flag));
    if (context.sessionId !== null && !resumes && !hasFlag(command, "--session-id")) {
      extra.push("--session-id", context.sessionId);
      sessionId = context.sessionId;
    }
  } else if (agent === "codex" && context.adapters.codex) {
    if (!hasConfigKey(command, "tui.notification_condition")) {
      extra.push("-c", "tui.notification_condition=always");
    }
  } else if (agent === "opencode" && context.adapters.opencode) {
    if (context.opencodePort !== null && !hasFlag(command, "--port")) {
      extra.push("--port", String(context.opencodePort));
    }
  }

  return {
    command: extra.length === 0 ? command : `${command.trim()} ${extra.join(" ")}`,
    sessionId,
  };
}

/** Which agents a launch would ASK main for something before arming. */
export function needsOpencodePort(command: string, adapters: SignalAdapters): boolean {
  return commandAgentId(command) === "opencode" && adapters.opencode && !hasFlag(command, "--port");
}

export function mintsClaudeSession(command: string, adapters: SignalAdapters): boolean {
  return (
    commandAgentId(command) === "claude" &&
    adapters.claude &&
    !hasFlag(command, "--session-id") &&
    !CLAUDE_RESUME_FLAGS.some((flag) => hasFlag(command, flag))
  );
}
