import { option, toggle, valued, values, type AgentDefinition } from "./agent-definition";

const MODE = ["--mode"];
const SANDBOX = ["--sandbox"];

/**
 * Cursor CLI. The id is the binary name, as it is for every built-in — note it
 * is `cursor-agent`, not `cursor` (that is Cursor's editor launcher). Launch
 * flags read off `cursor-agent --help` 2026.07.01 on 2026-09-11; model on
 * 2026-08-24, seeded from the help text's own prose example ("e.g., gpt-5,
 * sonnet-4-thinking").
 *
 * **Withdrawn on 2026-09-11** on the owner's ask (DECK-71). No session scanner
 * exists in `electron/resume/`, so even active it only ever relaunched bare;
 * the id and latest forms are here so adding a scanner is one file.
 */
export const CURSOR_AGENT: AgentDefinition = {
  id: "cursor-agent",
  label: "Cursor",
  withdrawn: true,
  // `--force` is the long form; `--yolo` is documented as its alias.
  defaultCommand: "cursor-agent --force",
  url: "https://cursor.com/cli",
  resume: {
    id: (id) => `cursor-agent --resume ${id}`,
    latest: "cursor-agent --continue",
    bare: "cursor-agent",
  },
  runtime: {
    modelFlag: "--model",
    models: values("gpt-5", "sonnet-4-thinking"),
    effortFlag: null,
    efforts: [],
  },
  launchFlags: [
    toggle(
      "force",
      "Run everything",
      "Allow commands unless explicitly denied.",
      ["--force"],
      ["-f"],
      ["--yolo"],
    ),
    toggle("autoReview", "Auto review", "Run safe tool calls automatically and ask for the rest.", [
      "--auto-review",
    ]),
    {
      id: "mode",
      label: "Mode",
      desc: "Start read-only, to plan or to answer questions.",
      kind: "menu",
      options: [option("plan", "Plan", ["--mode", "plan"], ["--plan"]), valued(MODE, "ask", "Ask")],
    },
    {
      id: "sandbox",
      label: "Sandbox",
      desc: "Override the sandbox setting from config.",
      kind: "menu",
      options: [valued(SANDBOX, "enabled", "Enabled"), valued(SANDBOX, "disabled", "Disabled")],
    },
    toggle("approveMcps", "Approve MCP servers", "Approve every MCP server automatically.", [
      "--approve-mcps",
    ]),
  ],
};
