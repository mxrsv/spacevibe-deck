import { option, toggle, valued, type AgentDefinition } from "./agent-definition";

const APPROVAL = ["--approval-mode"];

/**
 * Gemini CLI. Launch flags read off `gemini --help` 0.55.1 on 2026-09-11;
 * model on 2026-08-24 (`-m, --model`, no effort flag).
 *
 * It keeps its place beside Antigravity rather than being dropped: paid Code
 * Assist licences still reach the service, and every `lastAgent` on disk
 * holding "gemini" must keep resolving.
 */
export const GEMINI: AgentDefinition = {
  id: "gemini",
  label: "Gemini CLI",
  defaultCommand: "gemini --yolo",
  url: "https://github.com/google-gemini/gemini-cli",
  dotColor: "var(--cyan)",
  // No id-precise resume form: `resolveResume` never produces a `{ kind: "id" }`
  // ref for gemini, but the id form still answers (with the latest form) so
  // the resume table stays total and never throws on an unexpected input.
  resume: {
    id: () => "gemini --resume latest",
    latest: "gemini --resume latest",
    bare: "gemini",
  },
  runtime: { modelFlag: "--model", models: [], effortFlag: null, efforts: [] },
  launchFlags: [
    {
      id: "approval",
      label: "Approval",
      desc: "Which actions Gemini runs without asking.",
      kind: "menu",
      options: [
        option("yolo", "Everything", ["--yolo"], ["-y"], ["--approval-mode", "yolo"]),
        valued(APPROVAL, "auto_edit", "Edits only"),
        valued(APPROVAL, "plan", "Plan (read only)"),
      ],
    },
    toggle("sandbox", "Sandbox", "Run tools inside a sandbox.", ["--sandbox"], ["-s"]),
    toggle("trust", "Trust folder", "Trust the current folder for this session.", ["--skip-trust"]),
  ],
};
