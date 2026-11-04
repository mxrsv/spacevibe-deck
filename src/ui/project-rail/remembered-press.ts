/**
 * What pressing a remembered row does (launcher spec LCH-2): resume the conversation in one new
 * pane, else start the agent fresh in the row's folder, else say why not. A resumed or freshly
 * started row is removed from the store; a failed one stays.
 */
import type { CustomAgent } from "../../lib/agent-catalog";
import { agentLaunchCommandChoices } from "../../lib/launch-command";
import type { LaunchProfile } from "../../lib/launch-profile";
import type { RememberedPane } from "../../lib/session-schema";
import type { RememberedResume } from "../../sessions/resume-session";
import type { LaunchCommandOverride } from "../../terminal/agent-launch-target";
import { displayAgent } from "../agent-rail-card-model";

export interface FreshStart {
  readonly ok: boolean;
  /** Why it did not start; said as it stands. */
  readonly message?: string;
}

export interface RememberedPressDeps {
  /** `resumeRememberedPane` with the app's resume wiring. */
  resume(entry: RememberedPane): Promise<RememberedResume>;
  /** Open one new space for `entry.cwd` with the entry's agent and `command`. */
  startFresh(entry: RememberedPane, command: string | null): Promise<FreshStart>;
  /** `remembered-panes.remove`. */
  remove(id: string): Promise<void>;
  /** A short notice in the app's chrome bar. */
  notify(message: string): void;
}

const FAILURE_MESSAGE: Readonly<Record<"cwd-missing" | "not-resumed", string>> = {
  "cwd-missing": "That folder no longer exists.",
  "not-resumed": "Couldn't resume that agent.",
};

/**
 * One press handler per rail. A row being resolved ignores further presses, so a double click
 * resumes once and a second terminal is never typed into by mistake.
 */
export function createRememberedPress(
  deps: RememberedPressDeps,
): (entry: RememberedPane) => Promise<void> {
  const inFlight = new Set<string>();
  async function press(entry: RememberedPane): Promise<void> {
    if (inFlight.has(entry.id)) {
      return;
    }
    inFlight.add(entry.id);
    try {
      const result = await deps.resume(entry);
      if (result.status === "resumed") {
        await deps.remove(entry.id);
      } else if (result.status === "fresh") {
        const started = await deps.startFresh(entry, result.command);
        if (started.ok) {
          deps.notify(`Started ${displayAgent(entry.agent)} fresh: its conversation wasn't found.`);
          await deps.remove(entry.id);
        } else {
          deps.notify(started.message ?? `Couldn't start ${displayAgent(entry.agent)}.`);
        }
      } else {
        deps.notify(FAILURE_MESSAGE[result.reason]);
      }
    } catch (err: unknown) {
      console.warn("Failed to resume a remembered agent:", err);
      deps.notify(FAILURE_MESSAGE["not-resumed"]);
    } finally {
      inFlight.delete(entry.id);
    }
  }
  return press;
}

/**
 * The launch-path arguments for a fresh start. A pane's agent is a declared agent's label, while
 * the launch path takes its id. The recorded command is passed as a profile only when the
 * agent's own choices list it (the launch path refuses any other); otherwise the agent's
 * default command runs.
 */
export function freshLaunchRequest(
  entry: Pick<RememberedPane, "agent">,
  command: string | null,
  settings: {
    readonly customAgents: readonly CustomAgent[];
    readonly launchProfiles: readonly LaunchProfile[];
    readonly defaultLaunchProfiles: Readonly<Record<string, string>>;
  },
): { readonly agentId: string; readonly override?: LaunchCommandOverride } {
  const agentId =
    settings.customAgents.find((custom) => custom.label === entry.agent)?.id ?? entry.agent;
  const listed =
    command !== null &&
    agentLaunchCommandChoices(
      agentId,
      settings.launchProfiles,
      settings.defaultLaunchProfiles,
      settings.customAgents,
    )?.commands.includes(command) === true;
  return listed ? { agentId, override: { kind: "profile", command } } : { agentId };
}
