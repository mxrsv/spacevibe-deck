/**
 * What model and reasoning effort each agent can be launched with, and how the
 * two become one composite select. Pure — no signals, no host, no DOM.
 *
 * **Every flag here was read off that CLI's own `--help` on the owner's machine
 * on 2026-08-24**, the same rule `BuiltinAgent.defaultCommand` follows. Nothing
 * is inferred from another agent, and an undocumented flag is `null` rather
 * than a guess — a wrong flag is typed verbatim into a live shell.
 *
 * ```
 * claude        --model <model>              --effort <level>  (low|medium|high|xhigh|max)
 * agy           --model                      --effort          (low|medium|high)
 * codex         -m, --model <MODEL>          none
 * opencode      -m, --model provider/model   none
 * gemini        -m, --model                  none
 * cursor-agent  --model <model>              none
 * ```
 *
 * **No CLI enumerates its model list.** Only two name examples in prose —
 * claude ("an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')")
 * and cursor-agent ("e.g., gpt-5, sonnet-4-thinking") — and those are the whole
 * seed. Every other agent seeds EMPTY, which is not an oversight: the user adds
 * model values per agent in Settings → Agents (`agentModels`), and until they
 * do, an agent with no efforts either renders no runtime select at all
 * (DL-19.7's omit-don't-disable rule) rather than an empty control.
 *
 * The two values stay independent data even though they present as one control
 * — spec §3.5 — because only the composition step knows which flag each half
 * belongs to, and an agent with no effort flag must never be handed an effort.
 */

export interface RuntimeValue {
  readonly value: string;
  readonly label: string;
}

export interface AgentRuntimeCapability {
  readonly agentId: string;
  /** e.g. `--model`; null when the CLI documents no model flag. */
  readonly modelFlag: string | null;
  /** Seed values quoted from the CLI's own `--help`; usually empty. */
  readonly models: readonly RuntimeValue[];
  /** e.g. `--effort`; null when the CLI documents none. */
  readonly effortFlag: string | null;
  /** Closed set — an effort outside it is refused, never passed through. */
  readonly efforts: readonly RuntimeValue[];
  readonly defaultModel: string | null;
  readonly defaultEffort: string | null;
}

/** Every value is its own label: these are what the user types at the CLI. */
function values(...raw: readonly string[]): readonly RuntimeValue[] {
  return raw.map((value) => ({ value, label: value }));
}

/**
 * `defaultModel`/`defaultEffort` are null across the board on purpose: absent
 * means "whatever the CLI itself defaults to", which is the only honest answer
 * before the user has expressed a preference. Settings' `agentRuntimeDefaults`
 * is what fills them, through `mergeRuntimeDefaults` below.
 */
export const AGENT_RUNTIMES: readonly AgentRuntimeCapability[] = [
  {
    agentId: "claude",
    modelFlag: "--model",
    models: values("fable", "opus", "sonnet"),
    effortFlag: "--effort",
    efforts: values("low", "medium", "high", "xhigh", "max"),
    defaultModel: null,
    defaultEffort: null,
  },
  {
    agentId: "codex",
    modelFlag: "--model",
    models: [],
    effortFlag: null,
    efforts: [],
    defaultModel: null,
    defaultEffort: null,
  },
  {
    agentId: "opencode",
    modelFlag: "--model",
    models: [],
    effortFlag: null,
    efforts: [],
    defaultModel: null,
    defaultEffort: null,
  },
  {
    agentId: "agy",
    modelFlag: "--model",
    models: [],
    effortFlag: "--effort",
    efforts: values("low", "medium", "high"),
    defaultModel: null,
    defaultEffort: null,
  },
  {
    agentId: "gemini",
    modelFlag: "--model",
    models: [],
    effortFlag: null,
    efforts: [],
    defaultModel: null,
    defaultEffort: null,
  },
  {
    agentId: "cursor-agent",
    modelFlag: "--model",
    models: values("gpt-5", "sonnet-4-thinking"),
    effortFlag: null,
    efforts: [],
    defaultModel: null,
    defaultEffort: null,
  },
];

/**
 * The capability for an agent, or null. A custom agent always lands here: Deck
 * cannot know a user-declared wrapper's flags, so it gets no model or effort
 * control and launches with its declared command exactly as written.
 */
export function runtimeFor(agentId: string | null): AgentRuntimeCapability | null {
  if (agentId === null) {
    return null;
  }
  return AGENT_RUNTIMES.find((entry) => entry.agentId === agentId) ?? null;
}

/**
 * The catalog seed plus whatever the user declared for this agent, seed first,
 * deduplicated by value. An agent with no catalog entry still answers — a
 * custom agent the user has given model values to is a legitimate case, even
 * though nothing here knows its flag.
 */
export function modelsFor(
  agentId: string,
  declared: Readonly<Record<string, readonly string[]>>,
): readonly RuntimeValue[] {
  const seed = runtimeFor(agentId)?.models ?? [];
  const seen = new Set(seed.map((entry) => entry.value));
  const extra = (declared[agentId] ?? []).filter((value) => {
    if (value === "" || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
  return [...seed, ...values(...extra)];
}

export interface RuntimeOption {
  /** `${model}::${effort}`, either half empty when the agent has none. */
  readonly value: string;
  /** `opus · high`, or one half alone when the agent offers only one. */
  readonly label: string;
  readonly model: string | null;
  readonly effort: string | null;
}

export function runtimeKey(model: string | null, effort: string | null): string {
  return `${model ?? ""}::${effort ?? ""}`;
}

export function parseRuntimeKey(key: string): {
  model: string | null;
  effort: string | null;
} {
  const separator = key.indexOf("::");
  if (separator === -1) {
    return { model: key === "" ? null : key, effort: null };
  }
  const model = key.slice(0, separator);
  const effort = key.slice(separator + 2);
  return { model: model === "" ? null : model, effort: effort === "" ? null : effort };
}

/**
 * The composite select's options (spec §3.5). Four shapes, and the empty one
 * matters most: it is what makes the control disappear rather than stand there
 * offering nothing.
 */
export function runtimeOptions(
  capability: AgentRuntimeCapability | null,
  declared: Readonly<Record<string, readonly string[]>>,
): readonly RuntimeOption[] {
  if (capability === null) {
    return [];
  }
  const models = capability.modelFlag === null ? [] : modelsFor(capability.agentId, declared);
  const efforts = capability.effortFlag === null ? [] : capability.efforts;
  if (models.length > 0 && efforts.length > 0) {
    return models.flatMap((model) =>
      efforts.map((effort) => ({
        value: runtimeKey(model.value, effort.value),
        label: `${model.label} · ${effort.label}`,
        model: model.value,
        effort: effort.value,
      })),
    );
  }
  if (models.length > 0) {
    return models.map((model) => ({
      value: runtimeKey(model.value, null),
      label: model.label,
      model: model.value,
      effort: null,
    }));
  }
  return efforts.map((effort) => ({
    value: runtimeKey(null, effort.value),
    label: effort.label,
    model: null,
    effort: effort.value,
  }));
}

/**
 * The Settings default overriding the catalog seed — spec §3.5 and §7.
 *
 * The two halves are validated differently on purpose. An **effort** is checked
 * against `capability.efforts`, which is a closed set read off `--help`, so a
 * value outside it (a `max` carried over from claude into agy) is dropped. A
 * **model** is not, because `agentModels` lets the user declare values this
 * module deliberately does not know; the only check is that the agent takes a
 * model flag at all.
 */
export function mergeRuntimeDefaults(
  capability: AgentRuntimeCapability | null,
  stored: { readonly model: string | null; readonly effort: string | null } | undefined,
): AgentRuntimeCapability | null {
  if (capability === null || stored === undefined) {
    return capability;
  }
  const model =
    capability.modelFlag !== null && stored.model !== null && stored.model !== ""
      ? stored.model
      : capability.defaultModel;
  const effort =
    capability.effortFlag !== null &&
    stored.effort !== null &&
    capability.efforts.some((entry) => entry.value === stored.effort)
      ? stored.effort
      : capability.defaultEffort;
  return { ...capability, defaultModel: model, defaultEffort: effort };
}
