import fs from "node:fs/promises";
import path from "node:path";
import { AGENT_HOOKS_DIR } from "./claude-hooks-file";
import { codexHooksPath, syncCodexHooks } from "./codex-hooks";

export function codexHookScript(): string {
  return [
    "#!/bin/sh",
    "# Deck Codex lifecycle bridge. No stdout: hook output must not change the conversation.",
    'if [ -z "$DECK_HOOK_PORT" ] || [ -z "$DECK_PANE_ID" ] || [ -z "$DECK_HOOK_TOKEN" ]; then exit 0; fi',
    "if ! curl -q --noproxy '*' -fsS --max-time 2 -o /dev/null --data-binary @- \\",
    '  -H "Content-Type: application/json" \\',
    '  -H "X-Deck-Pane: $DECK_PANE_ID" \\',
    '  -H "X-Deck-Token: $DECK_HOOK_TOKEN" \\',
    '  "http://127.0.0.1:$DECK_HOOK_PORT/hook/codex"; then',
    '  printf "%s\\n" "Deck: Codex lifecycle event could not be delivered." >&2',
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

export function codexSignalsEnabled(settings: unknown): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const adapters = (settings as Record<string, unknown>).agentSignalAdapters;
  return (
    typeof adapters === "object" &&
    adapters !== null &&
    (adapters as Record<string, unknown>).codex === true
  );
}

interface IntegrationDeps {
  readonly userData: string;
  readonly hooksPath?: string;
  readonly supported?: boolean;
  readonly syncHooks?: typeof syncCodexHooks;
  readonly log?: (message: string, error: unknown) => void;
}

export function createCodexIntegration(deps: IntegrationDeps) {
  const script = path.join(deps.userData, AGENT_HOOKS_DIR, "deck-codex-hook.sh");
  const hooks = deps.hooksPath ?? codexHooksPath();
  const supported = deps.supported ?? process.platform !== "win32";
  let ready = false;
  let enabled = false;
  let desired = false;
  let applied: boolean | null = null;
  let queue: Promise<void> = Promise.resolve();
  return {
    scriptPath: () => (ready ? script : null),
    enabled: () => enabled,
    sync(settings: unknown): Promise<void> {
      const requested = codexSignalsEnabled(settings);
      desired = requested;
      if (!requested) enabled = false;
      const pending = queue
        .then(async () => {
          if (!supported || applied === requested) return;
          await fs.mkdir(path.dirname(script), { recursive: true, mode: 0o700 });
          await fs.writeFile(script, codexHookScript(), { mode: 0o700 });
          await fs.chmod(script, 0o700);
          ready = true;
          await (deps.syncHooks ?? syncCodexHooks)(hooks, script, requested);
          enabled = requested && desired;
          applied = requested;
        })
        .catch((error: unknown) => {
          enabled = false;
          applied = null;
          (deps.log ?? console.warn)(
            "Deck: Codex hook registration failed; activity remains inferred.",
            error,
          );
        });
      queue = pending;
      return pending;
    },
  };
}
