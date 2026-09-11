import { toggle, valued, values, type AgentDefinition } from "./agent-definition";

const MODE = ["--mode"];

/**
 * Antigravity, Google's successor to Gemini CLI. Launch flags read off
 * `agy --help` 1.1.13 on 2026-09-11; model and effort on 2026-08-24.
 */
export const AGY: AgentDefinition = {
  id: "agy",
  label: "Antigravity",
  defaultCommand: "agy --dangerously-skip-permissions",
  url: "https://antigravity.google",
  // Shares Gemini's cyan on purpose. The theme hands chrome eight colors;
  // four are taken, `--red` is error-only (DL-3.2) and `--accent` is the
  // theme's blue, reserved for interactive (DL-3.1) — so a fifth distinct
  // agent color does not exist without changing the token set. Google's two
  // CLIs sharing a hue is the honest reading, and the header names which one.
  dotColor: "var(--cyan)",
  resume: {
    id: (id) => `agy --conversation ${id}`,
    latest: "agy --continue",
    bare: "agy",
  },
  runtime: {
    modelFlag: "--model",
    models: [],
    effortFlag: "--effort",
    efforts: values("low", "medium", "high"),
  },
  launchFlags: [
    toggle("skip", "Skip permissions", "Approve every tool request without asking.", [
      "--dangerously-skip-permissions",
    ]),
    {
      id: "mode",
      label: "Mode",
      desc: "How the agent works through a session.",
      kind: "menu",
      options: [valued(MODE, "accept-edits", "Accept edits"), valued(MODE, "plan", "Plan")],
    },
    toggle("sandbox", "Sandbox", "Run with terminal restrictions.", ["--sandbox"]),
  ],
};
