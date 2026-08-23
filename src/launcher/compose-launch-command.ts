/**
 * One launch command out of the agent's saved default plus the model and
 * reasoning effort chosen for THIS launch. Pure — no signals, no host, no DOM.
 *
 * Spec §3.4: the launcher never exposes a `Command` field. It takes whatever
 * Settings says this agent launches with (`agentLaunchCommand`) as the base and
 * applies the runtime pair on top; choosing a model does not edit the saved
 * command.
 *
 * Three rules, each of which has a reason it is here rather than upstream:
 *
 * 1. **Strip before appending.** A base that already carries `--model sonnet`
 *    would otherwise be handed a second `--model`, and which one a CLI honours
 *    is per-CLI behaviour Deck must not depend on.
 * 2. **Validate the pair against the capability** — spec §8 step 3. A draft can
 *    outlive the agent it was written for (the user switches, or edits
 *    `agentModels`), and an effort agy has never heard of must be refused, not
 *    typed.
 * 3. **Re-check the whole result with `commandProblem`.** This string is
 *    written VERBATIM into a live interactive shell by `AgentLauncher.arm`, so
 *    the same door every saved command passes through applies here too.
 *
 * Consequence of rule 3 worth stating: `COMMAND_SAFE` admits no quotes and no
 * brackets, so cursor-agent's parameterized form
 * `'claude-opus-4-8[context=1m,effort=high]'` is **unrepresentable here by
 * design**. It belongs in a launch profile or a custom agent, which is what
 * Settings' help text says.
 */

import { commandProblem } from "../lib/launch-profile";
import { modelsFor, type AgentRuntimeCapability } from "./runtime-catalog";

export interface ComposeInput {
  readonly agentId: string;
  /** null for a custom agent — its command is used exactly as declared. */
  readonly capability: AgentRuntimeCapability | null;
  /** Settings' answer for this agent; null means it has none and cannot launch. */
  readonly baseCommand: string | null;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
  /** `settings.agentModels`, so a user-declared value is accepted. */
  readonly declaredModels: Readonly<Record<string, readonly string[]>>;
}

export type ComposeResult =
  { readonly ok: true; readonly command: string } | { readonly ok: false; readonly reason: string };

/**
 * Remove `flag` and the token after it. Whole-token matching only: `--model`
 * must not eat `--model-picker`, which is a different option entirely.
 */
export function stripFlag(command: string, flag: string | null): string {
  if (flag === null) {
    return command;
  }
  const tokens = command.trim().split(/\s+/);
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === flag) {
      index += 1; // drop this flag's value with it
      continue;
    }
    kept.push(tokens[index]);
  }
  return kept.join(" ");
}

export function composeLaunchCommand(input: ComposeInput): ComposeResult {
  const base = input.baseCommand?.trim() ?? "";
  if (base === "") {
    return { ok: false, reason: `${input.agentId} has no launch command` };
  }
  const capability = input.capability;
  if (capability === null) {
    // A custom agent: Deck does not know its flags, so the declared command is
    // the whole answer and the runtime pair is not applicable rather than
    // wrong. Still re-validated, because the caller may have composed it.
    return finish(base);
  }

  const modelFlag = capability.modelFlag;
  const effortFlag = capability.effortFlag;

  // Spec §8 step 3. An EMPTY list is not a refusal: it means the CLI
  // enumerates nothing, and the user's own declared values are legitimate
  // there (see runtime-catalog's module comment).
  if (input.modelId !== null && modelFlag !== null) {
    const known = modelsFor(input.agentId, input.declaredModels);
    if (known.length > 0 && !known.some((entry) => entry.value === input.modelId)) {
      return {
        ok: false,
        reason: `${input.agentId} does not list the model ${input.modelId}`,
      };
    }
  }
  if (input.reasoningEffort !== null && effortFlag !== null) {
    if (!capability.efforts.some((entry) => entry.value === input.reasoningEffort)) {
      return {
        ok: false,
        reason: `${input.agentId} does not take the effort ${input.reasoningEffort}`,
      };
    }
  }

  let command = stripFlag(stripFlag(base, modelFlag), effortFlag);
  // An agent with no flag for a half simply does not receive it. Dropping is
  // right where refusing is not: the value is a leftover of a draft written for
  // another agent, not something the user asked of THIS one.
  if (modelFlag !== null && input.modelId !== null) {
    command = `${command} ${modelFlag} ${input.modelId}`;
  }
  if (effortFlag !== null && input.reasoningEffort !== null) {
    command = `${command} ${effortFlag} ${input.reasoningEffort}`;
  }
  return finish(command);
}

function finish(command: string): ComposeResult {
  const problem = commandProblem(command);
  return problem === null ? { ok: true, command: command.trim() } : { ok: false, reason: problem };
}
