import { toggle, valued, type AgentDefinition } from "./agent-definition";

const SANDBOX = ["--sandbox", "-s"];
const APPROVAL = ["--ask-for-approval", "-a"];

/**
 * Codex. Launch flags read off `codex --help` 0.154.0 on 2026-09-11; model on
 * 2026-08-24 (`-m, --model <MODEL>`, no effort flag).
 */
export const CODEX: AgentDefinition = {
  id: "codex",
  label: "Codex",
  defaultCommand: "codex --dangerously-bypass-approvals-and-sandbox",
  url: "https://developers.openai.com/codex/cli",
  dotColor: "var(--green)",
  resume: {
    id: (id) => `codex resume ${id}`,
    latest: "codex resume --last",
    bare: "codex",
  },
  runtime: { modelFlag: "--model", models: [], effortFlag: null, efforts: [] },
  launchFlags: [
    toggle(
      "bypass",
      "No approvals or sandbox",
      "Skip every approval and run commands without a sandbox.",
      ["--dangerously-bypass-approvals-and-sandbox"],
    ),
    toggle("approveForMe", "Auto review", "Route approval requests through automatic review.", [
      "--approve-for-me",
    ]),
    {
      id: "sandbox",
      label: "Sandbox",
      desc: "Where model-generated commands may write.",
      kind: "menu",
      options: [
        valued(SANDBOX, "read-only", "Read only"),
        valued(SANDBOX, "workspace-write", "Workspace write"),
        valued(SANDBOX, "danger-full-access", "Full access"),
      ],
    },
    {
      id: "approval",
      label: "Approval policy",
      desc: "When Codex stops to ask before running a command.",
      kind: "menu",
      options: [valued(APPROVAL, "on-request", "On request"), valued(APPROVAL, "never", "Never")],
    },
    toggle("search", "Web search", "Let the model search the web without asking.", ["--search"]),
    toggle("inline", "Inline mode", "Keep terminal scrollback instead of an alternate screen.", [
      "--no-alt-screen",
    ]),
  ],
};
