import { option, toggle, valued, values, type AgentDefinition } from "./agent-definition";

const PERMISSION_MODE = ["--permission-mode"];

/**
 * Claude Code. Launch flags read off `claude --help` 2.1.268 on 2026-09-11;
 * model and effort on 2026-08-24. The model seed is the help text's own prose
 * example ("an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')")
 * — no CLI enumerates its model list.
 */
export const CLAUDE: AgentDefinition = {
  id: "claude",
  label: "Claude Code",
  defaultCommand: "claude --dangerously-skip-permissions",
  url: "https://claude.com/claude-code",
  dotColor: "var(--magenta)",
  resume: {
    id: (id) => `claude --resume ${id}`,
    latest: "claude --continue",
    bare: "claude",
  },
  runtime: {
    modelFlag: "--model",
    models: values("fable", "opus", "sonnet"),
    effortFlag: "--effort",
    efforts: values("low", "medium", "high", "xhigh", "max"),
  },
  launchFlags: [
    {
      id: "permissions",
      label: "Permissions",
      desc: "How Claude Code asks before it acts.",
      kind: "menu",
      options: [
        option("skip", "Skip all checks", ["--dangerously-skip-permissions"]),
        valued(PERMISSION_MODE, "acceptEdits", "Accept edits"),
        valued(PERMISSION_MODE, "auto", "Auto"),
        valued(PERMISSION_MODE, "bypassPermissions", "Bypass permissions"),
        valued(PERMISSION_MODE, "manual", "Manual"),
        valued(PERMISSION_MODE, "dontAsk", "Don't ask"),
        valued(PERMISSION_MODE, "plan", "Plan"),
      ],
    },
    toggle("ide", "Connect to IDE", "Attach to the IDE on startup when exactly one is open.", [
      "--ide",
    ]),
    toggle("verbose", "Verbose", "Override the verbose setting from config.", ["--verbose"]),
  ],
};
