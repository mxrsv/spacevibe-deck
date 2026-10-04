import { toggle, valued, type AgentDefinition } from "./agent-definition";

const AUTO = ["--auto"];

/**
 * Factory Droid. Launch flags and resume forms read off `droid --help` 0.233.0
 * on 2026-10-03. The help lists no top-level model flag (`-m` belongs to
 * `droid exec`), so none is offered.
 *
 * No `defaultCommand`: `--auto high` is documented only as an autonomy level,
 * not as "skip every prompt", so Deck does not claim it is the equivalent of
 * the other agents' skip-permissions flags. The Autonomy control sets it.
 */
export const DROID: AgentDefinition = {
  id: "droid",
  label: "Droid",
  url: "https://docs.factory.ai/cli/getting-started/overview",
  // `--last` is per working folder, which is what a restored pane has.
  resume: {
    id: (id) => `droid --resume ${id}`,
    latest: "droid --resume --last",
    bare: "droid",
  },
  runtime: { modelFlag: null, models: [], effortFlag: null, efforts: [] },
  launchFlags: [
    {
      id: "auto",
      label: "Autonomy",
      desc: "How much Droid does before it asks.",
      kind: "menu",
      options: [
        valued(AUTO, "low", "Low"),
        valued(AUTO, "medium", "Medium"),
        valued(AUTO, "high", "High"),
      ],
    },
    toggle("spec", "Spec mode", "Start by writing a spec.", ["--use-spec"]),
  ],
};
