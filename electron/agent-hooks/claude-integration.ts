/** Runtime ownership of Claude Signals; global registration is scoped to this script path. */
import { writeClaudeHooksFiles, type ClaudeHooksFiles } from "./claude-hooks-file";
import { claudeUserSettingsPath, syncClaudeUserSettings } from "./claude-user-settings";
import { hooksSupported } from "./hooks-supported";
import { storedSignalAdapterOn } from "../../src/settings/signal-adapter-choice";

export function claudeSignalsEnabled(settings: unknown): boolean {
  return storedSignalAdapterOn(settings, "claude");
}

interface IntegrationDeps {
  readonly userData: string;
  readonly settingsPath?: string;
  readonly supported?: boolean;
  readonly writeFiles?: typeof writeClaudeHooksFiles;
  readonly syncSettings?: typeof syncClaudeUserSettings;
  readonly log?: (message: string, error: unknown) => void;
}

export function createClaudeIntegration(deps: IntegrationDeps) {
  let paths: ClaudeHooksFiles | null = null;
  let enabled = false;
  let desired = false;
  let applied: boolean | null = null;
  let queue: Promise<void> = Promise.resolve();
  const log = deps.log ?? console.warn;
  const supported = deps.supported ?? hooksSupported();
  const settingsPath = deps.settingsPath ?? claudeUserSettingsPath();

  return {
    scriptPath: () => paths?.scriptPath ?? null,
    enabled: () => enabled,
    sync(settings: unknown): Promise<void> {
      const requested = claudeSignalsEnabled(settings);
      desired = requested;
      // Immediately stop accepting old-session events when the switch is turned off.
      if (!requested) enabled = false;
      const pending = queue
        .then(async () => {
          if (!supported) return;
          if (applied === requested) return;
          paths ??= await (deps.writeFiles ?? writeClaudeHooksFiles)(deps.userData);
          if (paths === null) return;
          await (deps.syncSettings ?? syncClaudeUserSettings)(
            settingsPath,
            paths.scriptPath,
            requested,
          );
          enabled = requested && desired;
          applied = requested;
        })
        .catch((error: unknown) => {
          enabled = false;
          applied = null;
          log("Deck: Claude hook registration failed; session discovery remains available.", error);
        });
      queue = pending;
      return pending;
    },
  };
}
