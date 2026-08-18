/**
 * How a picked skill / subagent becomes one line of prompt text, per CLI.
 * Pure — no signals, no Tauri, no DOM.
 *
 * One table, because the two CLIs address a subagent differently ("subagent"
 * vs "agent") and a wrong verb is a prompt the agent silently ignores. Only
 * the CLIs whose asset layouts were verified on disk have phrasing; anything
 * else composes to the body alone rather than to a guess.
 */

export type PromptAssetKind = 'skill' | 'subagent';

/** The CLIs whose asset layouts were verified on disk (spec §5). */
export type PromptAgentId = 'claude' | 'codex';

export interface PromptAssetPick {
  readonly kind: PromptAssetKind;
  readonly name: string;
}

const REFERENCE_PHRASES: Readonly<
  Record<PromptAgentId, Readonly<Record<PromptAssetKind, (name: string) => string>>>
> = {
  claude: {
    skill: (name) => `Use the ${name} skill.`,
    subagent: (name) => `Use the ${name} subagent.`,
  },
  codex: {
    skill: (name) => `Use the ${name} skill.`,
    subagent: (name) => `Delegate to the ${name} agent.`,
  },
};

export function isPromptAgentId(value: string | null): value is PromptAgentId {
  return value === 'claude' || value === 'codex';
}

/** One reference line, or null when there is no verified phrasing for it. */
export function formatAssetReference(
  agent: string | null,
  kind: PromptAssetKind,
  name: string,
): string | null {
  if (!isPromptAgentId(agent)) {
    return null;
  }
  const trimmed = name.trim();
  return trimmed === '' ? null : REFERENCE_PHRASES[agent][kind](trimmed);
}

/**
 * The text actually pasted: the body verbatim, then one line per pick. With
 * nothing picked the body is returned untouched — a template that ends in a
 * deliberate blank line keeps it.
 */
export function composePromptText(
  body: string,
  agent: string | null,
  picks: readonly PromptAssetPick[],
): string {
  const lines = picks
    .map((pick) => formatAssetReference(agent, pick.kind, pick.name))
    .filter((line): line is string => line !== null);
  return lines.length === 0 ? body : [body.trimEnd(), ...lines].join('\n');
}
