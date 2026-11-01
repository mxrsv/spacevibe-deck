/** A local server the dev-server picker lists, paired with the agent that started it. */
export interface DevServer {
  readonly port: number;
  readonly name: string;
  readonly path: string;
  /** The agent whose checkout serves it, or null for a server no agent owns. */
  readonly agentId: string | null;
}

export const DEV_SERVERS: readonly DevServer[] = [
  { port: 3000, name: "bench", path: "/leaderboard", agentId: "a-filters-gemini" },
  { port: 3001, name: "bench", path: "/leaderboard", agentId: "a-bench-codex" },
  { port: 5173, name: "deck landing", path: "/", agentId: null },
  { port: 6006, name: "gallery", path: "/", agentId: null },
];

export const PROVIDERS = ["All", "Anthropic", "OpenAI", "Google", "Meta"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ModelRow {
  readonly id: string;
  readonly model: string;
  readonly provider: Exclude<Provider, "All">;
  readonly score: number;
  readonly cost: string;
}

export const MODEL_ROWS: readonly ModelRow[] = [
  { id: "opus", model: "Opus 4.1", provider: "Anthropic", score: 94, cost: "$15.00" },
  { id: "gpt5", model: "GPT-5", provider: "OpenAI", score: 92, cost: "$10.00" },
  { id: "gem-pro", model: "Gemini 2.5 Pro", provider: "Google", score: 90, cost: "$10.00" },
  { id: "sonnet", model: "Sonnet 4", provider: "Anthropic", score: 88, cost: "$3.00" },
  { id: "gpt5-mini", model: "GPT-5 mini", provider: "OpenAI", score: 83, cost: "$2.00" },
  { id: "llama", model: "Llama 4 Maverick", provider: "Meta", score: 79, cost: "$0.85" },
  { id: "gem-flash", model: "Gemini 2.5 Flash", provider: "Google", score: 76, cost: "$0.60" },
  { id: "haiku", model: "Haiku 4", provider: "Anthropic", score: 72, cost: "$1.00" },
];

/** What Inspect grabbed from the page: a selector and a one-line description. */
export interface PickedElement {
  readonly selector: string;
  readonly summary: string;
}

export type InspectMode = "off" | "pick" | "picked";
