# Agent Launch Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save named launch profiles that select an agent CLI's mode (permission mode, sandbox, model) and pick one when a pane opens, instead of always launching the bare binary.

**Architecture:** A profile stores _semantic_ options — closed enums plus a validated model token — never a flag string. One pure module composes those options into the command line, and that composition is the only place a command is built. The options travel through `MaterializeIntent` as data, so `AgentLauncher` still receives a finished string and its readiness state machine is untouched.

**Tech Stack:** TypeScript, Preact + `@preact/signals`, Vitest, the existing renderer settings store (`settings.json`).

**Spec:** None — the direction was approved in conversation on 2026-08-19 (shape reviewed by Codex against this repository first). Every decision that a spec would carry lives in Global Constraints below.

## Global Constraints

- **Naming.** The concept is `LaunchProfile` / `launchProfiles` / `launchProfileId`. Never `preset` — `Preset` already means a pane layout in `src/lib/preset-schema.ts` and `src/presets/`.
- **No free-form flags.** Every option is a closed enum, a boolean, or a single token matching `/^[A-Za-z0-9._\/-]{1,64}$/`. `AgentLauncher.arm` writes its string verbatim into an interactive shell, so a stored string is never executed as-is.
- **v1 agents:** `claude`, `codex`, `opencode`. `gemini`, `agy` and custom agents have no profiles; a custom agent already carries its own full command line.
- **No risk chip.** The owner rejected a `Risky` badge on 2026-08-19. Rows show the composed command and nothing else.
- **Achromatic Settings.** No accent or semantic status colour on the Settings surface — neutral `--text-*`, `--tone`, `--hair-*` only. This follows the in-flight `docs/specs/2026-08-19-light-dark-settings-design.md`.
- **Control shapes** (same spec): native `select` for a finite technical list, segmented radio for 2–3 equal choices, switch for a boolean, explicit Add/Save + Cancel for multi-field editing, confirmation for deletion. **No cycle buttons** — `terminalRenderer` was removed from Settings for exactly that reason.
- **Command display.** A profile row prints the composed command, and that is the whole content of the row: the binary at `--text`, its flags at `--text-faint`. **Set in `--ui-font`, not mono** — DL-4.1 keeps the monospace face in the terminal, and DL-15.4 states this repo has no `--mono` token and will not gain one. A mono treatment was considered on 2026-08-19 and dropped rather than amending those rules.
- **Text fields go through `CommitInput`** (`src/ui/controls/commit-input.tsx`, DL-6.3). A store-controlled `value={…}` input in Settings is a data-loss bug — the panel never unmounts.
- **Multi-field editing overrides DL-12.5.** DL-12 says a declared item is edited in place; the light/dark spec says a multi-field draft commits atomically through explicit Save/Cancel. A profile is several fields whose half-applied state would launch a wrong command, so the spec wins here. Task 12 records the override.
- **Launch paths.** ⌘T picks a profile per open. Open Board and rail-drop use the agent's default profile. Session History resume is untouched in v1.
- **Host parity.** Everything in this plan is renderer-only, so it reaches both the Electron and Tauri hosts. No IPC channel is added or changed.
- **English only** in code, comments, docs and commit messages (AGENTS.md R1).
- **Commit hygiene.** This checkout is shared with other sessions and carries unrelated uncommitted work. Every commit step uses `git commit -- <explicit paths>`; never `git add -A`.
- **Fork record.** Tab materialization is a stop-and-ask seam (AGENTS.md "Forks"). The owner approved this change on 2026-08-19; Task 12 writes that line into the queue.

## Relationship to the light/dark Settings plan

[`2026-08-19-light-dark-settings.md`](2026-08-19-light-dark-settings.md) is
**in flight in this same checkout** — `themes.ts`, `theme-mode-selector.tsx`,
`settings-categories.ts`, `settings-screen.tsx`, `11-settings-screen.css`,
`appearance-section.tsx`, `commit-input.tsx` and `docs/DESIGN-LANGUAGE.md` all
carry its uncommitted work. This plan does not compete with it; it defers to it.

- **Blocked until its schema work lands:** Task 3 (`settings-schema.ts` is
  already dirty with its `terminalRenderer` removal, and a commit cannot be
  scoped to part of a file).
- **Blocked until its Task 2A lands:** Tasks 8 and 9. That task is where a
  field's Escape is separated from the screen's Escape and focus is contained
  in Settings — a draft editor built before it would close Settings on the
  first Escape.
- **Not in contention:** `agents-section.tsx` appears in neither its plan nor
  its working tree, so this plan's mount point is clear.
- **Same-region hazard:** both plans append to `src/gallery/section-registry.ts`
  and `src/gallery/main.tsx`. Task 6 appends at the END of the array and the
  END of the import block, not beside its neighbours.
- **Its control vocabulary is this plan's control vocabulary.** Everything
  needed already exists in DESIGN-LANGUAGE §6: `menu` for a list over three
  options, `binary` for two or three (DL-6.5), `toggle` for a boolean,
  `action` for Save/Cancel/Delete. **This plan amends no design-language rule.**

## File Structure

**New files**

| File                                               | Responsibility                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/launch-profile.ts`                        | The data model: option types, closed enums, validation, id minting, profile lookup. No command strings.                                             |
| `src/lib/launch-profile.test.ts`                   | Tests for the above.                                                                                                                                |
| `src/lib/launch-command.ts`                        | The only place options become a command line. Per-agent adapters plus the resume-append rule.                                                       |
| `src/lib/launch-command.test.ts`                   | Tests for the above.                                                                                                                                |
| `src/ui/settings/launch-profile-editor.tsx`        | The Settings sub-surface: profile list, add/edit form, delete confirmation.                                                                         |
| `src/ui/settings/launch-profile-editor.test.tsx`   | Tests for the above.                                                                                                                                |
| `src/gallery/sections/launch-profiles-section.tsx` | Gallery-only specimen of the Agents rows + editor, for owner eye review.                                                                            |
| `src/gallery/sections/launch-profiles-section.css` | Gallery-only styling for that specimen.                                                                                                             |
| `src/styles/16-launch-profiles.css`                | Shipping styles for the editor. Its own file because `07-config-rows.css` and `11-settings-screen.css` are both mid-rewrite by the light/dark plan. |

**Modified files**

| File                                          | Change                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/settings/settings-schema.ts`             | `launchProfiles` and `defaultLaunchProfiles` fields, defaults, validation.                                                      |
| `src/terminal/tab-materialize.ts`             | `MaterializeIntent.launchOptions`.                                                                                              |
| `src/terminal/tab-manager.ts`                 | Compose the command, retain per-pane options, prune them, expose them to `captureSession`; `openQuickAgent` takes a profile id. |
| `src/terminal/tab-manager-types.ts`           | `openQuickAgent` signature.                                                                                                     |
| `src/ui/agent-quick-picker.tsx`               | A profile `select` on each agent row.                                                                                           |
| `src/ui/app.tsx`                              | Pass the picked profile id through.                                                                                             |
| `src/ui/settings/sections/agents-section.tsx` | Mount `LaunchProfileEditor`.                                                                                                    |
| `src/lib/session-schema.ts`                   | `SessionPane.launchOptions`.                                                                                                    |
| `src/terminal/session-restore.ts`             | Re-apply options to a resumed `claude` pane.                                                                                    |
| `src/gallery/section-registry.ts`             | One additive registry line, appended at the END of the array (the light/dark plan is editing the same region).                  |
| `src/styles.css`                              | One `@import` line for the new stylesheet, appended after `15-rail-footer.css`.                                                 |
| `AGENTS.md`, `docs/CONTEXT.md`                | Record the feature and the resolved fork.                                                                                       |

**Deliberately not touched:** `src/terminal/agent-launch.ts` (the launcher keeps receiving a finished string), `src/lib/agent-resume.ts` (`COMMAND_TABLE` stays as-is; the append happens in `launch-command.ts`), `src/sessions/resume-session.ts`, `electron/**`, `src-tauri/**`.

---

### Task 1: The launch profile data model

**Files:**

- Create: `src/lib/launch-profile.ts`
- Test: `src/lib/launch-profile.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type LaunchProfileAgentId = "claude" | "codex" | "opencode"`
  - `type LaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions | OpencodeLaunchOptions` — each has a literal `kind` equal to its agent id
  - `interface LaunchProfile { readonly id: string; readonly name: string; readonly options: LaunchOptions }`
  - `const LAUNCH_PROFILE_AGENTS: readonly LaunchProfileAgentId[]`
  - `const CLAUDE_PERMISSION_MODES`, `CODEX_SANDBOXES`, `CODEX_APPROVALS: readonly string[]`
  - `function isLaunchOptionToken(value: unknown): value is string`
  - `function hasLaunchProfiles(agentId: string): agentId is LaunchProfileAgentId`
  - `function createLaunchProfileId(name: string, existing: readonly LaunchProfile[]): string`
  - `function profileNameProblem(name: string, others: readonly LaunchProfile[]): string | null`
  - `function profilesForAgent(agentId: string, profiles: readonly LaunchProfile[]): readonly LaunchProfile[]`
  - `function findLaunchProfile(id: string | null, profiles: readonly LaunchProfile[]): LaunchProfile | null`
  - `function validateLaunchProfiles(raw: unknown): readonly LaunchProfile[]`
  - `function validateDefaultLaunchProfiles(raw: unknown, profiles: readonly LaunchProfile[]): Readonly<Record<string, string>>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/launch-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createLaunchProfileId,
  findLaunchProfile,
  hasLaunchProfiles,
  isLaunchOptionToken,
  profileNameProblem,
  profilesForAgent,
  validateDefaultLaunchProfiles,
  validateLaunchProfiles,
  type LaunchProfile,
} from "./launch-profile";

const claudePlan: LaunchProfile = {
  id: "lp:plan",
  name: "Plan",
  options: { kind: "claude", model: null, permissionMode: "plan" },
};

const codexReadOnly: LaunchProfile = {
  id: "lp:read-only",
  name: "Read only",
  options: {
    kind: "codex",
    model: null,
    sandbox: "read-only",
    approval: "on-request",
  },
};

describe("hasLaunchProfiles", () => {
  it("accepts the three v1 agents and refuses the rest", () => {
    expect(hasLaunchProfiles("claude")).toBe(true);
    expect(hasLaunchProfiles("codex")).toBe(true);
    expect(hasLaunchProfiles("opencode")).toBe(true);
    expect(hasLaunchProfiles("gemini")).toBe(false);
    expect(hasLaunchProfiles("custom:review")).toBe(false);
  });
});

describe("isLaunchOptionToken", () => {
  it("accepts a model alias and a provider-qualified model", () => {
    expect(isLaunchOptionToken("opus")).toBe(true);
    expect(isLaunchOptionToken("anthropic/claude-opus-5")).toBe(true);
  });

  it("refuses anything a shell would act on", () => {
    expect(isLaunchOptionToken("opus; rm -rf /")).toBe(false);
    expect(isLaunchOptionToken("$(whoami)")).toBe(false);
    expect(isLaunchOptionToken("a b")).toBe(false);
    expect(isLaunchOptionToken("")).toBe(false);
    expect(isLaunchOptionToken("x".repeat(65))).toBe(false);
    expect(isLaunchOptionToken(7)).toBe(false);
  });
});

describe("createLaunchProfileId", () => {
  it("mints a prefixed slug and never collides", () => {
    expect(createLaunchProfileId("Plan mode", [])).toBe("lp:plan-mode");
    expect(
      createLaunchProfileId("Plan mode", [
        { ...claudePlan, id: "lp:plan-mode" },
      ]),
    ).toBe("lp:plan-mode-2");
  });
});

describe("profileNameProblem", () => {
  it("refuses an empty, over-long or duplicate name", () => {
    expect(profileNameProblem("", [])).not.toBeNull();
    expect(profileNameProblem("x".repeat(33), [])).not.toBeNull();
    expect(profileNameProblem("Plan", [claudePlan])).not.toBeNull();
    expect(profileNameProblem("Plan", [])).toBeNull();
  });
});

describe("profilesForAgent", () => {
  it("selects by the options' kind", () => {
    const all = [claudePlan, codexReadOnly];
    expect(profilesForAgent("claude", all)).toEqual([claudePlan]);
    expect(profilesForAgent("gemini", all)).toEqual([]);
  });
});

describe("findLaunchProfile", () => {
  it("answers null for a null id and for an unknown id", () => {
    expect(findLaunchProfile(null, [claudePlan])).toBeNull();
    expect(findLaunchProfile("lp:gone", [claudePlan])).toBeNull();
    expect(findLaunchProfile("lp:plan", [claudePlan])).toEqual(claudePlan);
  });
});

describe("validateLaunchProfiles", () => {
  it("keeps a well-formed profile", () => {
    expect(validateLaunchProfiles([claudePlan])).toEqual([claudePlan]);
  });

  it("drops a profile rather than repairing it", () => {
    expect(validateLaunchProfiles("nope")).toEqual([]);
    expect(validateLaunchProfiles([{ id: "lp:x", name: "X" }])).toEqual([]);
    expect(
      validateLaunchProfiles([
        { id: "lp:x", name: "X", options: { kind: "gemini" } },
      ]),
    ).toEqual([]);
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: { kind: "claude", model: null, permissionMode: "nonsense" },
        },
      ]),
    ).toEqual([]);
    expect(
      validateLaunchProfiles([
        {
          id: "lp:x",
          name: "X",
          options: { kind: "claude", model: "a b", permissionMode: null },
        },
      ]),
    ).toEqual([]);
  });

  it("drops a duplicate id, first wins", () => {
    const second: LaunchProfile = { ...claudePlan, name: "Other" };
    expect(validateLaunchProfiles([claudePlan, second])).toEqual([claudePlan]);
  });
});

describe("validateDefaultLaunchProfiles", () => {
  it("keeps a mapping that points at a profile of that agent", () => {
    expect(
      validateDefaultLaunchProfiles({ claude: "lp:plan" }, [claudePlan]),
    ).toEqual({ claude: "lp:plan" });
  });

  it("drops a dangling id and a cross-agent mapping", () => {
    expect(
      validateDefaultLaunchProfiles({ claude: "lp:gone" }, [claudePlan]),
    ).toEqual({});
    expect(
      validateDefaultLaunchProfiles({ codex: "lp:plan" }, [claudePlan]),
    ).toEqual({});
    expect(validateDefaultLaunchProfiles(null, [claudePlan])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- launch-profile`
Expected: FAIL — `Failed to resolve import "./launch-profile"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/launch-profile.ts`:

```ts
/**
 * Launch profiles: named, reusable MODE selections for the agent CLIs Deck
 * launches. Pure — no signals, no host, no DOM.
 *
 * The load-bearing rule is that a profile stores SEMANTIC options, never a
 * flag string. `AgentLauncher.arm` writes its command verbatim into an
 * interactive shell, so anything stored here would be executed as typed. Every
 * option is therefore a closed enum, a boolean, or a single token matching
 * `LAUNCH_TOKEN` — and `src/lib/launch-command.ts` is the only module allowed
 * to turn them into a command line.
 *
 * `options.kind` IS the agent id: one field rather than a separate `agentId`,
 * so a profile can never claim one agent while carrying another's options.
 *
 * Not called "preset" on purpose — `Preset` already means a pane layout
 * (`src/lib/preset-schema.ts`).
 */

/** Agents whose flags are public and stable enough to model. */
export const LAUNCH_PROFILE_AGENTS = ["claude", "codex", "opencode"] as const;

export type LaunchProfileAgentId = (typeof LAUNCH_PROFILE_AGENTS)[number];

/** `claude --permission-mode` choices, verbatim from its `--help`. */
export const CLAUDE_PERMISSION_MODES = [
  "plan",
  "manual",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

/** `codex --sandbox` choices, verbatim from its `--help`. */
export const CODEX_SANDBOXES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type CodexSandbox = (typeof CODEX_SANDBOXES)[number];

/** `codex --ask-for-approval` choices, verbatim from its `--help`. */
export const CODEX_APPROVALS = ["untrusted", "on-request", "never"] as const;

export type CodexApproval = (typeof CODEX_APPROVALS)[number];

export interface ClaudeLaunchOptions {
  readonly kind: "claude";
  /** `--model`; null leaves the CLI's own default. */
  readonly model: string | null;
  /** `--permission-mode`; null leaves the CLI's own default. */
  readonly permissionMode: ClaudePermissionMode | null;
}

export interface CodexLaunchOptions {
  readonly kind: "codex";
  /** `-m/--model`. */
  readonly model: string | null;
  /** `-s/--sandbox`. */
  readonly sandbox: CodexSandbox | null;
  /** `-a/--ask-for-approval`. */
  readonly approval: CodexApproval | null;
}

export interface OpencodeLaunchOptions {
  readonly kind: "opencode";
  /** `-m/--model`, in opencode's `provider/model` form. */
  readonly model: string | null;
  /** `--agent`, one of the user's own opencode agents. */
  readonly agent: string | null;
  /** `--auto`: auto-approve permissions that are not explicitly denied. */
  readonly auto: boolean;
}

export type LaunchOptions =
  ClaudeLaunchOptions | CodexLaunchOptions | OpencodeLaunchOptions;

export interface LaunchProfile {
  /** Stable `lp:<slug>` id. Minted once, never re-derived from the name. */
  readonly id: string;
  readonly name: string;
  readonly options: LaunchOptions;
}

export const LAUNCH_PROFILE_ID_PREFIX = "lp:";
export const LAUNCH_PROFILE_NAME_MAX = 32;

/**
 * What a single option token may contain. The same reasoning as
 * `PROBE_SAFE` in `agent-catalog.ts`: everything a shell acts on is excluded,
 * because this token is interpolated into a line typed at a live prompt.
 */
const LAUNCH_TOKEN = /^[A-Za-z0-9._/-]{1,64}$/;

const FALLBACK_SLUG = "profile";

export function isLaunchOptionToken(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_TOKEN.test(value);
}

export function hasLaunchProfiles(
  agentId: string,
): agentId is LaunchProfileAgentId {
  return (LAUNCH_PROFILE_AGENTS as readonly string[]).includes(agentId);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createLaunchProfileId(
  name: string,
  existing: readonly LaunchProfile[],
): string {
  const base = slugify(name) || FALLBACK_SLUG;
  const taken = new Set(existing.map((profile) => profile.id));
  const first = `${LAUNCH_PROFILE_ID_PREFIX}${base}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${LAUNCH_PROFILE_ID_PREFIX}${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Why a name is refused, or null when it is fine. */
export function profileNameProblem(
  name: string,
  others: readonly LaunchProfile[],
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  if (trimmed.length > LAUNCH_PROFILE_NAME_MAX) {
    return `names stay under ${LAUNCH_PROFILE_NAME_MAX} characters`;
  }
  return others.some((profile) => profile.name === trimmed)
    ? "that name is already used"
    : null;
}

export function profilesForAgent(
  agentId: string,
  profiles: readonly LaunchProfile[],
): readonly LaunchProfile[] {
  return profiles.filter((profile) => profile.options.kind === agentId);
}

export function findLaunchProfile(
  id: string | null,
  profiles: readonly LaunchProfile[],
): LaunchProfile | null {
  if (id === null) {
    return null;
  }
  return profiles.find((profile) => profile.id === id) ?? null;
}

function optionalToken(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return isLaunchOptionToken(value) ? value : undefined;
}

function optionalChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/**
 * Drop-not-repair, the same discipline `validateCustomAgents` uses: an
 * option nobody understands would otherwise be carried into a live shell.
 * `undefined` from the helpers above means "present but wrong" and sinks the
 * whole profile; `null` means "absent", which is a legal value.
 */
function validateLaunchOptions(raw: unknown): LaunchOptions | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const model = optionalToken(source.model);
  if (model === undefined) {
    return null;
  }
  if (source.kind === "claude") {
    const permissionMode = optionalChoice(
      source.permissionMode,
      CLAUDE_PERMISSION_MODES,
    );
    if (permissionMode === undefined) {
      return null;
    }
    return { kind: "claude", model, permissionMode };
  }
  if (source.kind === "codex") {
    const sandbox = optionalChoice(source.sandbox, CODEX_SANDBOXES);
    const approval = optionalChoice(source.approval, CODEX_APPROVALS);
    if (sandbox === undefined || approval === undefined) {
      return null;
    }
    return { kind: "codex", model, sandbox, approval };
  }
  if (source.kind === "opencode") {
    const agent = optionalToken(source.agent);
    if (agent === undefined || typeof source.auto !== "boolean") {
      return null;
    }
    return { kind: "opencode", model, agent, auto: source.auto };
  }
  return null;
}

export function validateLaunchProfiles(raw: unknown): readonly LaunchProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: LaunchProfile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== "string" || seen.has(source.id)) {
      continue;
    }
    if (typeof source.name !== "string" || source.name.trim() === "") {
      continue;
    }
    const options = validateLaunchOptions(source.options);
    if (options === null) {
      continue;
    }
    seen.add(source.id);
    result.push({ id: source.id, name: source.name, options });
  }
  return result;
}

/**
 * The agent → default profile map. A mapping is kept only when it points at a
 * profile that exists AND belongs to that agent: a dangling default would
 * otherwise silently launch the bare binary while Settings showed a name.
 */
export function validateDefaultLaunchProfiles(
  raw: unknown,
  profiles: readonly LaunchProfile[],
): Readonly<Record<string, string>> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [agentId, profileId] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof profileId !== "string") {
      continue;
    }
    const profile = findLaunchProfile(profileId, profiles);
    if (profile !== null && profile.options.kind === agentId) {
      result[agentId] = profileId;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- launch-profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/lib/launch-profile.ts src/lib/launch-profile.test.ts \
  -m "feat(launch-profiles): add the launch profile data model"
```

---

### Task 2: Compose options into a command line

**Files:**

- Create: `src/lib/launch-command.ts`
- Test: `src/lib/launch-command.test.ts`

**Interfaces:**

- Consumes: `LaunchOptions`, `LaunchProfile`, `findLaunchProfile`, `hasLaunchProfiles` from Task 1.
- Produces:
  - `function composeLaunchCommand(options: LaunchOptions): string`
  - `function resolveLaunchOptions(agentId: string | null, profileId: string | null, profiles: readonly LaunchProfile[]): LaunchOptions | null`
  - `function defaultLaunchOptions(agentId: string | null, profiles: readonly LaunchProfile[], defaults: Readonly<Record<string, string>>): LaunchOptions | null`
  - `function applyResumeOptions(command: string, options: LaunchOptions | null): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/launch-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyResumeOptions,
  composeLaunchCommand,
  defaultLaunchOptions,
  resolveLaunchOptions,
} from "./launch-command";
import type { LaunchProfile } from "./launch-profile";

const plan: LaunchProfile = {
  id: "lp:plan",
  name: "Plan",
  options: { kind: "claude", model: "opus", permissionMode: "plan" },
};

const sandboxed: LaunchProfile = {
  id: "lp:sandboxed",
  name: "Sandboxed",
  options: {
    kind: "codex",
    model: null,
    sandbox: "workspace-write",
    approval: "on-request",
  },
};

describe("composeLaunchCommand", () => {
  it("builds a claude command with both options", () => {
    expect(composeLaunchCommand(plan.options)).toBe(
      "claude --model opus --permission-mode plan",
    );
  });

  it("omits every option left null", () => {
    expect(
      composeLaunchCommand({
        kind: "claude",
        model: null,
        permissionMode: null,
      }),
    ).toBe("claude");
  });

  it("builds a codex command", () => {
    expect(composeLaunchCommand(sandboxed.options)).toBe(
      "codex --sandbox workspace-write --ask-for-approval on-request",
    );
  });

  it("builds an opencode command and only adds --auto when true", () => {
    expect(
      composeLaunchCommand({
        kind: "opencode",
        model: "anthropic/claude-sonnet-5",
        agent: "build",
        auto: true,
      }),
    ).toBe("opencode --model anthropic/claude-sonnet-5 --agent build --auto");
    expect(
      composeLaunchCommand({
        kind: "opencode",
        model: null,
        agent: null,
        auto: false,
      }),
    ).toBe("opencode");
  });
});

describe("resolveLaunchOptions", () => {
  it("returns the profile's options when the agent matches", () => {
    expect(resolveLaunchOptions("claude", "lp:plan", [plan])).toEqual(
      plan.options,
    );
  });

  it("refuses a profile belonging to another agent", () => {
    expect(resolveLaunchOptions("codex", "lp:plan", [plan])).toBeNull();
  });

  it("returns null for a null agent, a null id and an unknown id", () => {
    expect(resolveLaunchOptions(null, "lp:plan", [plan])).toBeNull();
    expect(resolveLaunchOptions("claude", null, [plan])).toBeNull();
    expect(resolveLaunchOptions("claude", "lp:gone", [plan])).toBeNull();
  });
});

describe("defaultLaunchOptions", () => {
  it("reads the agent's declared default", () => {
    expect(
      defaultLaunchOptions("claude", [plan], { claude: "lp:plan" }),
    ).toEqual(plan.options);
  });

  it("returns null when the agent has no default", () => {
    expect(defaultLaunchOptions("claude", [plan], {})).toBeNull();
    expect(
      defaultLaunchOptions(null, [plan], { claude: "lp:plan" }),
    ).toBeNull();
  });
});

describe("applyResumeOptions", () => {
  it("appends claude's options to its resume command", () => {
    expect(applyResumeOptions("claude --resume abc123", plan.options)).toBe(
      "claude --resume abc123 --model opus --permission-mode plan",
    );
  });

  it("leaves every other agent's resume command alone", () => {
    expect(applyResumeOptions("codex resume abc123", sandboxed.options)).toBe(
      "codex resume abc123",
    );
    expect(applyResumeOptions("claude --continue", null)).toBe(
      "claude --continue",
    );
  });

  it("leaves a command that is not this agent's own alone", () => {
    expect(applyResumeOptions("review --resume x", plan.options)).toBe(
      "review --resume x",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- launch-command`
Expected: FAIL — `Failed to resolve import "./launch-command"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/launch-command.ts`:

```ts
/**
 * The only place launch options become a command line. Pure.
 *
 * Every value that reaches a flag here has already passed `launch-profile.ts`'s
 * validation — a closed enum or a `LAUNCH_TOKEN`. Nothing in this module
 * quotes or escapes, because nothing that needs quoting can arrive: that is
 * the invariant, and it is why the whole feature has one composition point
 * rather than one per call site.
 *
 * Flag spellings are the long forms from each CLI's own `--help` (checked
 * 2026-08-19). Long forms on purpose: the row prints this string, and
 * `--permission-mode plan` says what it does where `-p plan` does not.
 */
import {
  findLaunchProfile,
  type LaunchOptions,
  type LaunchProfile,
} from "./launch-profile";

function flag(name: string, value: string | null): readonly string[] {
  return value === null ? [] : [name, value];
}

export function composeLaunchCommand(options: LaunchOptions): string {
  switch (options.kind) {
    case "claude":
      return [
        "claude",
        ...flag("--model", options.model),
        ...flag("--permission-mode", options.permissionMode),
      ].join(" ");
    case "codex":
      return [
        "codex",
        ...flag("--model", options.model),
        ...flag("--sandbox", options.sandbox),
        ...flag("--ask-for-approval", options.approval),
      ].join(" ");
    case "opencode":
      return [
        "opencode",
        ...flag("--model", options.model),
        ...flag("--agent", options.agent),
        ...(options.auto ? ["--auto"] : []),
      ].join(" ");
  }
}

/**
 * The options a chosen profile contributes, or null. A profile whose kind is
 * not this agent is refused rather than applied: ids are stable but a caller
 * may hold one across an agent change, and codex flags typed at claude's
 * prompt would just fail.
 */
export function resolveLaunchOptions(
  agentId: string | null,
  profileId: string | null,
  profiles: readonly LaunchProfile[],
): LaunchOptions | null {
  if (agentId === null) {
    return null;
  }
  const profile = findLaunchProfile(profileId, profiles);
  if (profile === null || profile.options.kind !== agentId) {
    return null;
  }
  return profile.options;
}

/** The agent's declared default profile's options, or null. */
export function defaultLaunchOptions(
  agentId: string | null,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): LaunchOptions | null {
  if (agentId === null) {
    return null;
  }
  return resolveLaunchOptions(agentId, defaults[agentId] ?? null, profiles);
}

/**
 * Session restore: put the pane's mode back on the command that resumes its
 * conversation. Only `claude` is handled, and only when the command is
 * claude's own — its `--model` / `--permission-mode` are global options that
 * sit beside `--resume`. `codex resume` and `opencode -s` take their flags in
 * positions this module does not model, so they are returned untouched rather
 * than guessed at.
 *
 * Not runtime-verified: the compatibility claim comes from `claude --help`,
 * not from an observed resume with both flags present.
 */
export function applyResumeOptions(
  command: string,
  options: LaunchOptions | null,
): string {
  if (options === null || options.kind !== "claude") {
    return command;
  }
  if (!command.startsWith("claude ") && command !== "claude") {
    return command;
  }
  const extra = [
    ...flag("--model", options.model),
    ...flag("--permission-mode", options.permissionMode),
  ];
  return extra.length === 0 ? command : `${command} ${extra.join(" ")}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- launch-command`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/lib/launch-command.ts src/lib/launch-command.test.ts \
  -m "feat(launch-profiles): compose launch options into a command line"
```

---

### Task 3: Persist profiles in settings

**Files:**

- Modify: `src/settings/settings-schema.ts`
- Test: `src/settings/settings-schema.test.ts`

**Interfaces:**

- Consumes: `validateLaunchProfiles`, `validateDefaultLaunchProfiles`, `LaunchProfile` from Task 1.
- Produces: `Settings.launchProfiles: readonly LaunchProfile[]` and `Settings.defaultLaunchProfiles: Readonly<Record<string, string>>`, both defaulting to empty.

- [ ] **Step 1: Check the file for foreign changes**

Run: `git diff src/settings/settings-schema.ts`
Expected: the redesign's `terminalRenderer` removal may still be uncommitted here. If any hunk you did not write is present, **stop and ask the owner** how the two workstreams share this file — a commit cannot be scoped to part of one file, so committing now would sweep that work in.

- [ ] **Step 2: Write the failing tests**

Append to `src/settings/settings-schema.test.ts`:

```ts
describe("launch profiles", () => {
  it("defaults to none declared", () => {
    const settings = validateSettings({});
    expect(settings.launchProfiles).toEqual([]);
    expect(settings.defaultLaunchProfiles).toEqual({});
  });

  it("keeps a valid profile and its default mapping", () => {
    const settings = validateSettings({
      launchProfiles: [
        {
          id: "lp:plan",
          name: "Plan",
          options: { kind: "claude", model: null, permissionMode: "plan" },
        },
      ],
      defaultLaunchProfiles: { claude: "lp:plan" },
    });
    expect(settings.launchProfiles).toHaveLength(1);
    expect(settings.defaultLaunchProfiles).toEqual({ claude: "lp:plan" });
  });

  it("drops a default that points at a dropped profile", () => {
    const settings = validateSettings({
      launchProfiles: [{ id: "lp:bad", name: "Bad", options: { kind: "x" } }],
      defaultLaunchProfiles: { claude: "lp:bad" },
    });
    expect(settings.launchProfiles).toEqual([]);
    expect(settings.defaultLaunchProfiles).toEqual({});
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- settings-schema`
Expected: FAIL — `launchProfiles` is undefined on the validated settings.

- [ ] **Step 4: Write the implementation**

In `src/settings/settings-schema.ts`, add the import beside the existing `CustomAgent` import:

```ts
import {
  validateDefaultLaunchProfiles,
  validateLaunchProfiles,
  type LaunchProfile,
} from "../lib/launch-profile";
```

Add to the `Settings` interface, directly under `customAgents`:

```ts
  /** Named mode selections for the agent CLIs that support them. */
  launchProfiles: readonly LaunchProfile[];
  /**
   * Agent id → profile id used when nothing picks one: the Open board, a rail
   * drop, and the quick picker's initial selection. Absent = launch bare.
   */
  defaultLaunchProfiles: Readonly<Record<string, string>>;
```

Add to `DEFAULT_SETTINGS`, beside `customAgents: []`:

```ts
  launchProfiles: [],
  defaultLaunchProfiles: {},
```

Add to the object `validateSettings` returns:

```ts
    launchProfiles: validatedLaunchProfiles,
    defaultLaunchProfiles: validateDefaultLaunchProfiles(
      source.defaultLaunchProfiles,
      validatedLaunchProfiles,
    ),
```

and, above that return statement, the local it depends on — the defaults are validated _against_ the surviving profiles, so the order matters:

```ts
const validatedLaunchProfiles = validateLaunchProfiles(source.launchProfiles);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- settings-schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -- src/settings/settings-schema.ts src/settings/settings-schema.test.ts \
  -m "feat(launch-profiles): persist profiles and per-agent defaults"
```

---

### Task 4: Carry options through materialization

**Files:**

- Modify: `src/terminal/tab-materialize.ts`
- Modify: `src/terminal/tab-manager.ts` (`materialize`, `openQuickAgent`, the two prune sites at ~line 398 and ~line 655)
- Modify: `src/terminal/tab-manager-types.ts` (`openQuickAgent` signature)
- Test: `src/terminal/tab-manager.quick-agent.test.ts` (new)

**Interfaces:**

- Consumes: `composeLaunchCommand`, `resolveLaunchOptions`, `defaultLaunchOptions` from Task 2.
- Produces:
  - `MaterializeIntent.launchOptions?: LaunchOptions | null` — **`undefined` means "resolve this agent's default profile", `null` means "explicitly bare"**. That distinction is what lets the Open board and rail-drop inherit a default without passing anything, while the quick picker can still say "no profile".
  - `openQuickAgent(agentId: AgentChoice, destination?: string | null, profileId?: string | null): Promise<boolean>` — `profileId` has the same three states as `launchOptions`: **omitted** = use the agent's default profile, **`null`** = launch bare, **an id** = use that profile.
  - `TabManager.launchOptionsFor(paneId: number): LaunchOptions | null` — read by Task 10.

**This task edits a fork seam** (AGENTS.md: tab materialization). The owner approved it on 2026-08-19. Do not widen it further: no new IPC, no change to `AgentLauncher`.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/tab-manager.quick-agent.test.ts` following the setup already used by `src/terminal/tab-manager.drop-agent-pane.test.ts` (read that file first and mirror its fakes — same `createTabManager` call, same PTY double). The behaviours to assert:

```ts
it("types the chosen profile's command into the new pane", async () => {
  // settings hold a claude profile "lp:plan" with permissionMode "plan"
  await manager.openQuickAgent("claude", null, "lp:plan");
  expect(armed()).toEqual([
    { id: 1, command: "claude --permission-mode plan" },
  ]);
});

it("falls back to the agent's default profile when none is passed", async () => {
  // defaultLaunchProfiles = { claude: "lp:plan" }
  await manager.openQuickAgent("claude");
  expect(armed()).toEqual([
    { id: 1, command: "claude --permission-mode plan" },
  ]);
});

it("launches bare when the caller passes an explicit null profile", async () => {
  // defaultLaunchProfiles = { claude: "lp:plan" }
  await manager.openQuickAgent("claude", null, null);
  expect(armed()).toEqual([{ id: 1, command: "claude" }]);
});

it("leaves an agent with no profiles on its bare command", async () => {
  await manager.openQuickAgent("gemini");
  expect(armed()).toEqual([{ id: 1, command: "gemini" }]);
});

it("remembers the options a pane launched with", async () => {
  await manager.openQuickAgent("claude", null, "lp:plan");
  expect(manager.launchOptionsFor(1)).toEqual({
    kind: "claude",
    model: null,
    permissionMode: "plan",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tab-manager.quick-agent`
Expected: FAIL — `openQuickAgent` ignores the third argument and `launchOptionsFor` does not exist.

- [ ] **Step 3: Widen the intent**

In `src/terminal/tab-materialize.ts`, add the import and the field to `MaterializeIntent`, directly under `agent`:

```ts
import type { LaunchOptions } from "../lib/launch-profile";
```

```ts
  /**
   * The mode the agent launches in. `undefined` = resolve the agent's default
   * profile (Open board, rail drop, a plain reopen); `null` = launch the bare
   * command even if a default exists (the quick picker's "No profile" row).
   * Semantic on purpose — the command is composed inside `materialize`, so
   * every caller stays out of the business of building a command line.
   */
  readonly launchOptions?: LaunchOptions | null;
```

- [ ] **Step 4: Compose and retain in TabManager**

In `src/terminal/tab-manager.ts`, add the imports:

```ts
import {
  composeLaunchCommand,
  defaultLaunchOptions,
  resolveLaunchOptions,
} from "../lib/launch-command";
import type { LaunchOptions } from "../lib/launch-profile";
```

Beside the other per-pane maps, add:

```ts
/**
 * What each pane launched with. Process classification recovers the BINARY a
 * pane is running, never the flags it was given, so this map is the only
 * record of a pane's mode — `captureSession` reads it for the journal.
 */
const launchOptionsByPane = new Map<number, LaunchOptions>();
```

Add the prune helper beside `pruneNotifiedKinds`:

```ts
function pruneLaunchOptions(live: readonly number[]): void {
  const alive = new Set(live);
  for (const id of [...launchOptionsByPane.keys()]) {
    if (!alive.has(id)) {
      launchOptionsByPane.delete(id);
    }
  }
}
```

and call `pruneLaunchOptions(live);` beside the existing `pruneNotifiedKinds(live);` in **both** places (`callbacks.onLayoutChange` and `pruneMovedPane`).

In `materialize`, replace the `fallback` computation with a composition that keeps every existing behaviour when no options apply:

```ts
const agentId = intent.agent ?? null;
// `undefined` means the caller expressed no opinion, so the agent's own
// default profile applies; `null` means the caller explicitly asked for
// the bare command. An agent with no profiles resolves to null either way
// and takes the catalog's command exactly as before.
const launchOptions =
  intent.launchOptions === undefined
    ? defaultLaunchOptions(
        agentId,
        settings.value.launchProfiles,
        settings.value.defaultLaunchProfiles,
      )
    : intent.launchOptions;
const fallback =
  agentId === null
    ? null
    : launchOptions !== null
      ? composeLaunchCommand(launchOptions)
      : resolveAgentCommand(agentId, settings.value.customAgents);
const paneIds = entry.manager.paneIds();
if (launchOptions !== null) {
  for (const id of paneIds) {
    launchOptionsByPane.set(id, launchOptions);
  }
}
```

In `openQuickAgent`, take and forward the profile id:

```ts
async function openQuickAgent(
  agentId: AgentChoice,
  destination: string | null = null,
  profileId?: string | null,
): Promise<boolean> {
  const cwd = destination ?? (await activePaneCwd());
  const workspacePath = destination ?? activeWorkspacePath();
  return materialize({
    layout: BUILT_IN_PRESET.layout,
    cwds: [cwd],
    agent: agentId,
    // Three states, not two, and the difference is load-bearing: an ABSENT
    // argument states no opinion, so `materialize` resolves the agent's
    // default profile; a `null` argument is the picker's "No profile" row and
    // must launch bare even when a default exists. Passing a resolved `null`
    // in both cases would make the default unreachable from every caller that
    // omits the argument.
    ...(profileId === undefined
      ? {}
      : {
          launchOptions: resolveLaunchOptions(
            agentId,
            profileId,
            settings.value.launchProfiles,
          ),
        }),
    ...(workspacePath !== null ? { workspacePath } : {}),
  });
}
```

Add the reader beside the other per-pane accessors and include `launchOptionsFor` in the returned object:

```ts
function launchOptionsFor(paneId: number): LaunchOptions | null {
  return launchOptionsByPane.get(paneId) ?? null;
}
```

In `src/terminal/tab-manager-types.ts`, update the signature and its doc comment:

```ts
  openQuickAgent(
    agentId: AgentChoice,
    destination?: string | null,
    profileId?: string | null,
  ): Promise<boolean>;
  /** The launch options a pane was started with; null when it had none. */
  launchOptionsFor(paneId: number): LaunchOptions | null;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tab-manager`
Expected: PASS, including the pre-existing tab-manager suites.

- [ ] **Step 6: Commit**

```bash
git commit -- src/terminal/tab-materialize.ts src/terminal/tab-manager.ts \
  src/terminal/tab-manager-types.ts src/terminal/tab-manager.quick-agent.test.ts \
  -m "feat(launch-profiles): carry launch options through materialization"
```

---

### Task 5: Rail drop uses the agent's default profile

**Files:**

- Modify: `src/terminal/tab-manager.ts` (`dropAgentPane`)
- Test: `src/terminal/tab-manager.drop-agent-pane.test.ts`

**Interfaces:**

- Consumes: `defaultLaunchOptions`, `composeLaunchCommand` from Task 2; `launchOptionsByPane` from Task 4.
- Produces: nothing new.

`dropAgentPane` is the one place `arm` is called outside `materialize`, so it needs the composition explicitly — the Open board already goes through `materialize` and inherits defaults for free once Task 4 lands.

- [ ] **Step 1: Write the failing test**

Add to `src/terminal/tab-manager.drop-agent-pane.test.ts`:

```ts
it("docks the pane with the agent's default profile applied", async () => {
  // settings: launchProfiles holds lp:plan (claude, permissionMode "plan"),
  // defaultLaunchProfiles = { claude: "lp:plan" }, and the workspace's
  // remembered agent is claude
  await manager.dropAgentPane(1, "right");
  expect(armed()).toContainEqual({
    id: 2,
    command: "claude --permission-mode plan",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- drop-agent-pane`
Expected: FAIL — the armed command is `claude`.

- [ ] **Step 3: Write the implementation**

In `dropAgentPane`, replace the command passed to `arm`:

```ts
// The drop states no mode, so the agent's default profile applies — the
// same rule the Open board gets through `materialize`. Composed here
// because this is the one launch that does not go through it.
const launchOptions = defaultLaunchOptions(
  agentId,
  settings.value.launchProfiles,
  settings.value.defaultLaunchProfiles,
);
if (launchOptions !== null) {
  launchOptionsByPane.set(paneId, launchOptions);
}
launcher.arm([
  {
    id: paneId,
    command:
      agentId === null
        ? null
        : launchOptions !== null
          ? composeLaunchCommand(launchOptions)
          : resolveAgentCommand(agentId, customAgents),
  },
]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- drop-agent-pane`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/terminal/tab-manager.ts src/terminal/tab-manager.drop-agent-pane.test.ts \
  -m "feat(launch-profiles): apply the default profile to a docked agent pane"
```

---

### Task 6: Gallery specimen for owner eye review

**Files:**

- Create: `src/gallery/sections/launch-profiles-section.tsx`
- Create: `src/gallery/sections/launch-profiles-section.css`
- Modify: `src/gallery/section-registry.ts`
- Modify: `src/gallery/main.tsx` (stylesheet import, following the `icon-set-section.css` line)

**Interfaces:**

- Consumes: `composeLaunchCommand` (Task 2), the option enums (Task 1).
- Produces: `export function LaunchProfilesSection()`.

Its own section file on purpose: `src/gallery/sections/settings-direction.tsx` is being edited by another actor, and R7 keeps gallery code out of the shipping bundle either way. Duplicate the small control primitives it needs rather than importing that file's module-private ones.

The specimen must show:

- A **profile row per profile**, whose entire content is the composed command in `--ui-font` — binary at full `--text` strength, flags at `--text-faint`. **Not mono** (DL-4.1, DL-15.4) and **no risk badge** (owner decision, 2026-08-19). The two strengths are what separate the binary from its flags; the typeface does not change.
- The **add/edit form**: name field, agent segmented radio (claude / codex / opencode), then that agent's option controls — a native `select` per closed enum, a validated token field for the model, a switch for opencode's `--auto`. Cancel and Save, committing atomically.
- A **delete confirmation** in the row.
- A **default marker**: which profile an agent launches with when nothing picks one.
- The whole thing in both Light and Dark review palettes, at the wide and 480px compact widths, using neutral tokens only.

- [ ] **Step 1: Build the specimen**

The markup and CSS are deliberately NOT fixed here: this specimen exists to be
judged by eye, and Task 7 is where its shape is decided. What is fixed is the
content list above and the token discipline — writing a finished component into
this plan would only be overwritten by the review it exists to feed.

Write `launch-profiles-section.tsx` with local `useSignal` state only — it must not import or write the production settings store. Register it:

```ts
import { LaunchProfilesSection } from "./sections/launch-profiles-section";
```

```ts
  {
    id: "launch-profiles",
    label: "launch profiles",
    Section: LaunchProfilesSection,
  },
```

Append both — the import at the END of the import block, the entry at the END
of `GALLERY_SECTIONS`. The light/dark plan is inserting into the same two
regions, and an append is the one edit that merges cleanly against it.

- [ ] **Step 2: Verify the gallery builds and stays out of the bundle**

Run: `npm run build`
Expected: PASS.

Run: `rg -n "gallery/" src --glob '!gallery/**'`
Expected: no shipping module imports the new section.

- [ ] **Step 3: Commit**

```bash
git commit -- src/gallery/sections/launch-profiles-section.tsx \
  src/gallery/sections/launch-profiles-section.css \
  src/gallery/section-registry.ts src/gallery/main.tsx \
  -m "feat(gallery): add the launch profiles direction specimen"
```

---

### Task 7: Owner eye review gate

**Files:** none.

**Depends on:** Task 6.

- [ ] **Step 1: Ask before starting the gallery**

Ask the owner for permission before running `npm run prototype:gallery` or driving a browser.

- [ ] **Step 2: Capture the specimen**

Show the profile rows, the add form, the delete confirmation and the default marker, in Light and Dark, at wide and compact widths.

- [ ] **Step 3: Get explicit approval**

The owner approves in conversation. Apply only requested adjustments and re-capture. **Tasks 8 and 9 do not start until this passes** — browser evidence is not native evidence, and no production Settings UI changes before the rendered direction is approved.

---

### Task 8: The Settings editor

**Files:**

- Create: `src/ui/settings/launch-profile-editor.tsx`
- Create: `src/ui/settings/launch-profile-editor.test.tsx`
- Modify: `src/ui/settings/sections/agents-section.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1–3, plus `settings` / `updateSettings` from `src/settings/settings-store.ts`.
- Produces: `export function LaunchProfileEditor()`.

**Depends on:** Task 7, and the light/dark plan's Task 2A (field-Escape separated from screen-Escape, focus contained in Settings).

Mount it in `AgentsSection` under a `<ConfigGroup label="Launch profiles" />`, after the `Declared` group. `agents-section.tsx` is not in the light/dark redesign plan's file list, so this does not collide with it — but the control shapes above are that spec's, because this surface will be ported by its later category pass.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/settings/launch-profile-editor.test.tsx`, mirroring the setup in `src/ui/settings/sections/agents-section.test.tsx`:

```tsx
it("shows each profile's composed command", () => {
  // settings hold lp:plan → claude, permissionMode "plan"
  render(<LaunchProfileEditor />);
  expect(screen.getByText("claude --permission-mode plan")).toBeTruthy();
});

it("adds a profile only when the whole draft is valid", async () => {
  render(<LaunchProfileEditor />);
  await user.click(screen.getByRole("button", { name: "Add launch profile" }));
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  expect(screen.getByRole("alert").textContent).toContain("a name is required");
  expect(updateSettings).not.toHaveBeenCalled();
});

it("refuses a model token a shell would act on", async () => {
  // type "opus; rm -rf /" into the model field, then save
  expect(screen.getByRole("alert").textContent).toContain("letters, digits");
  expect(updateSettings).not.toHaveBeenCalled();
});

it("asks before deleting and clears the agent default with it", async () => {
  // lp:plan is claude's default
  await user.click(screen.getByRole("button", { name: "Delete Plan" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(updateSettings).toHaveBeenCalledWith({
    launchProfiles: [],
    defaultLaunchProfiles: {},
  });
});

it("cancelling the draft writes nothing", async () => {
  await user.click(screen.getByRole("button", { name: "Add launch profile" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(updateSettings).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- launch-profile-editor`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the implementation**

Port the markup the owner approved in Task 7 — that review, not this plan, is
what fixes the visual shape. The behaviour below is fixed here and the tests in
Step 1 are what hold it:

- one `useSignal` per draft field plus a `draftError` signal, following `AgentsSection`'s existing shape;
- a row per profile: the composed command from `composeLaunchCommand`, set in `--ui-font` with the binary at `--text` and its flags at `--text-faint` (DL-4.1 — no mono), a "Default" marker for `defaultLaunchProfiles[agentId] === profile.id`, an edit control and a delete control;
- deletion in two steps — the row asks, a second click confirms — and the write clears any `defaultLaunchProfiles` entry pointing at it in the **same** `updateSettings` call, so a dangling default never reaches disk;
- the draft validated by `profileNameProblem` and `isLaunchOptionToken` before any write, with the message rendered in a `role="alert"` element and the fields left editable;
- a `<select>` per closed enum (DL-6's `menu`), a segmented `role="radiogroup"` for the agent choice (DL-6.5's `binary` — three options, at its ceiling), a `role="switch"` for opencode's `--auto` (DL-6's `toggle`);
- the model field as a **`CommitInput`** (DL-6.3), never a store-controlled `value={…}`;
- no colour beyond the neutral `--text-*` / `--tone` / `--hair-*` ladders.

Styles go in the new `src/styles/16-launch-profiles.css` with one `@import`
appended to `src/styles.css`. Do **not** add them to `07-config-rows.css` or
`11-settings-screen.css`: both are mid-rewrite by the light/dark plan.

In `agents-section.tsx`, add the import and mount it after the declared-agents block:

```tsx
import { LaunchProfileEditor } from "../launch-profile-editor";
```

```tsx
      <ConfigGroup label="Launch profiles" />
      <LaunchProfileEditor />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- launch-profile-editor agents-section`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/ui/settings/launch-profile-editor.tsx \
  src/ui/settings/launch-profile-editor.test.tsx \
  src/ui/settings/sections/agents-section.tsx \
  src/styles/16-launch-profiles.css src/styles.css \
  -m "feat(launch-profiles): add the Settings launch profile editor"
```

---

### Task 9: Pick a profile in the quick picker

**Files:**

- Modify: `src/ui/agent-quick-picker.tsx`
- Modify: `src/ui/app.tsx` (the `AgentQuickPicker` mount, ~line 1421)
- Test: `src/ui/agent-quick-picker.test.tsx`

**Interfaces:**

- Consumes: `profilesForAgent` (Task 1), `Settings.launchProfiles` / `defaultLaunchProfiles` (Task 3), `openQuickAgent`'s third argument (Task 4).
- Produces: `AgentQuickPickerProps.onSelect(agentId, destination, profileId)` — a third argument, `null` when the agent has no profiles or the "No profile" option is selected.

**Depends on:** Task 7, and the light/dark plan's Task 2A (field-Escape separated from screen-Escape, focus contained in Settings).

The digit-key contract is unchanged: **one row per agent**, `1-9` still pick agents and `0` is still Shell. The profile `select` sits at the row's trailing end, is not reachable by digit, and a click on it must not launch the row.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/agent-quick-picker.test.tsx`:

```tsx
it("offers a profile select only for agents that have profiles", () => {
  // settings: one claude profile
  render(<AgentQuickPicker {...props} />);
  expect(screen.getByLabelText("Claude Code launch profile")).toBeTruthy();
  expect(screen.queryByLabelText("Gemini CLI launch profile")).toBeNull();
});

it("selects the agent's default profile on mount", () => {
  render(<AgentQuickPicker {...props} />);
  const select = screen.getByLabelText("Claude Code launch profile");
  expect((select as HTMLSelectElement).value).toBe("lp:plan");
});

it("passes the chosen profile id to onSelect", async () => {
  await user.selectOptions(
    screen.getByLabelText("Claude Code launch profile"),
    "lp:yolo",
  );
  await user.click(screen.getByRole("button", { name: /Claude Code/ }));
  expect(onSelect).toHaveBeenCalledWith("claude", null, "lp:yolo");
});

it("changing the select does not open a tab", async () => {
  await user.selectOptions(
    screen.getByLabelText("Claude Code launch profile"),
    "lp:yolo",
  );
  expect(onSelect).not.toHaveBeenCalled();
});

it("passes null for an agent with no profiles", async () => {
  await user.click(screen.getByRole("button", { name: /Gemini CLI/ }));
  expect(onSelect).toHaveBeenCalledWith("gemini", null, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- agent-quick-picker`
Expected: FAIL — no select is rendered and `onSelect` takes two arguments.

- [ ] **Step 3: Write the implementation**

In `agent-quick-picker.tsx`:

- read `settings.value.launchProfiles` / `settings.value.defaultLaunchProfiles`;
- hold one `useSignal<Record<string, string | null>>` of the per-agent selection, seeded from the defaults;
- render, at each row's trailing end, a `<select class="cfg-btn" aria-label={`${option.label} launch profile`}>` whose options are `profilesForAgent(option.id, profiles)` plus a leading `No profile` (value `""` → `null`), **only when `hasLaunchProfiles(option.id)` and that list is non-empty** — the
  first test is what keeps `gemini`, `agy` and custom agents free of an empty
  control, rather than the row's profile count happening to be zero;
- stop the select's `click` from bubbling to the row, so changing a profile does not launch;
- pass the row's current selection as `onSelect`'s third argument.

Then update the suite's **existing** `onSelect` assertions: they were written
against a two-argument callback, so every `toHaveBeenCalledWith("claude", null)`
now fails on arity and must expect the third argument. Those failures are this
task's own doing — do not "fix" them on the component side.

In `app.tsx`, widen the callback:

```tsx
              onSelect={(agentId, destination, profileId) => {
                agentQuickPickerOpen.value = false;
                void tabsRef.current
                  ?.openQuickAgent(agentId, destination, profileId)
                  .then((ok) => {
                    if (!ok) {
                      reportPersistError("Could not open a new tab.");
                    }
                  });
              }}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- agent-quick-picker app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/ui/agent-quick-picker.tsx src/ui/agent-quick-picker.test.tsx src/ui/app.tsx \
  -m "feat(launch-profiles): pick a profile when opening an agent"
```

---

### Task 10: Record a pane's mode in the session journal

**Files:**

- Modify: `src/lib/session-schema.ts`
- Modify: `src/terminal/tab-manager.ts` (`captureSession`, ~line 924)
- Test: `src/lib/session-schema.test.ts`

**Interfaces:**

- Consumes: `LaunchOptions` (Task 1), `launchOptionsFor` (Task 4), `validateLaunchProfiles`'s option validator.
- Produces: `SessionPane.launchOptions: LaunchOptions | null`.

The snapshot stores the **options themselves**, not a profile id: editing or deleting a profile later must not retroactively change a session that is already running under the old one. No `SESSION_VERSION` bump — the field is optional and an older file validates unchanged, which is the existing drop-not-repair contract.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/session-schema.test.ts`:

```ts
it("keeps a pane's launch options", () => {
  const record = validateWindowRecord({
    savedAt: 1,
    activeTabIndex: 0,
    tabs: [
      {
        workspacePath: null,
        layout: { kind: "leaf" },
        panes: [
          {
            cwd: "/tmp",
            agent: "claude",
            launchOptions: {
              kind: "claude",
              model: null,
              permissionMode: "plan",
            },
          },
        ],
        name: null,
        dotColor: null,
      },
    ],
    files: [],
    activeFileTab: null,
  });
  expect(record?.tabs[0].panes[0].launchOptions).toEqual({
    kind: "claude",
    model: null,
    permissionMode: "plan",
  });
});

it("drops malformed launch options without dropping the pane", () => {
  // same record with launchOptions: { kind: "claude", permissionMode: "nope" }
  expect(record?.tabs[0].panes[0].launchOptions).toBeNull();
  expect(record?.tabs[0].panes[0].agent).toBe("claude");
});

it("reads a file written before the field existed", () => {
  // panes: [{ cwd: "/tmp", agent: "claude" }]
  expect(record?.tabs[0].panes[0].launchOptions).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- session-schema`
Expected: FAIL — `launchOptions` is not on the validated pane.

- [ ] **Step 3: Write the implementation**

Export the option validator from `src/lib/launch-profile.ts` (it is currently module-private):

```ts
export function validateLaunchOptions(raw: unknown): LaunchOptions | null {
```

In `src/lib/session-schema.ts`, add the import:

```ts
import { validateLaunchOptions, type LaunchOptions } from "./launch-profile";
```

then add to `SessionPane`:

```ts
  /**
   * The mode this pane launched in, or null. Stored as options rather than a
   * profile id: editing or deleting the profile must not rewrite a session
   * that is already running under the old one. Classification cannot recover
   * this — it reports the binary, never its flags.
   */
  readonly launchOptions: LaunchOptions | null;
```

and to `validateSessionPane`:

```ts
    launchOptions: validateLaunchOptions(source.launchOptions),
```

(both the object literal and the early `{ cwd: null, agent: null }` return, which becomes `{ cwd: null, agent: null, launchOptions: null }`).

In `captureSession`, read the map:

```ts
const panes = entry.manager.paneIds().map((id) => {
  const info = poller.infoFor(id);
  return {
    cwd: info?.cwd ?? null,
    agent: info?.agent ?? null,
    launchOptions: launchOptionsFor(id),
  };
});
```

**Known limit, recorded not fixed:** a pane detached into another window loses this metadata — the map is per TabManager and the adopting window has no entry for it. Its snapshot is `null`, so restore falls back to the bare resume command. Do not add cross-window transfer here; that is a `transfer-client.ts` change and a separate decision.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- session-schema tab-manager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/lib/session-schema.ts src/lib/session-schema.test.ts \
  src/lib/launch-profile.ts src/terminal/tab-manager.ts \
  -m "feat(launch-profiles): record a pane's launch options in the journal"
```

---

### Task 11: Re-apply the mode when a claude pane resumes

**Files:**

- Modify: `src/terminal/session-restore.ts` (`paneCommandsFor`)
- Test: `src/terminal/session-restore.test.ts`

**Interfaces:**

- Consumes: `applyResumeOptions` (Task 2), `SessionPane.launchOptions` (Task 10).
- Produces: nothing new.

Only `claude` is re-flagged. `applyResumeOptions` returns every other command untouched, so this is one call site, not a per-agent branch here.

- [ ] **Step 1: Write the failing tests**

Add to `src/terminal/session-restore.test.ts`:

```ts
it("puts a claude pane's mode back on its resume command", async () => {
  // journal pane: agent "claude", launchOptions permissionMode "plan";
  // lookup answers { kind: "id", id: "abc123" }
  expect(paneCommands).toEqual([
    "claude --resume abc123 --permission-mode plan",
  ]);
});

it("leaves a codex pane's resume command alone", async () => {
  // journal pane: agent "codex", launchOptions sandbox "workspace-write"
  expect(paneCommands).toEqual(["codex resume abc123"]);
});

it("restores a pane with no recorded options exactly as before", async () => {
  expect(paneCommands).toEqual(["claude --resume abc123"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- session-restore`
Expected: FAIL — the mode is missing from the claude command.

- [ ] **Step 3: Write the implementation**

In `paneCommandsFor`:

```ts
const ref = refs.get(paneKey(tabIndex, paneIndex)) ?? null;
const command = buildResumeCommand(pane.agent, ref, customAgents);
// The pane's own recorded options, not its profile's current ones: the
// profile may have been edited or deleted since this session started.
return command === null
  ? null
  : applyResumeOptions(command, pane.launchOptions);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- session-restore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/terminal/session-restore.ts src/terminal/session-restore.test.ts \
  -m "feat(launch-profiles): restore a claude pane in the mode it was launched in"
```

---

### Task 12: Records and final verification

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/CONTEXT.md`

**Depends on:** Tasks 1–11.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS. Paste the summary line as evidence.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Check the diff is scoped**

Run: `git diff --check` → no whitespace errors.
Run: `git status --short` → only this plan's files, plus whatever the owner already had uncommitted.

- [ ] **Step 4: Write the records**

Add a "Current direction" bullet to `AGENTS.md` naming: what a launch profile is, the three v1 agents, that Open board and rail-drop take the default while ⌘T picks, that Session History resume is untouched, that only `claude` re-flags on restore, and the exact evidence class reached (suite/build plus a gallery review — no native `electron:dev` pass unless one was actually run).

Record the DL-12.5 override in the same bullet: a launch profile is edited
through an explicit Save/Cancel draft rather than in place, because several
fields half-applied would launch a wrong command. **No design-language rule is
amended** — every control used is already in §6, and the mono treatment that
would have needed DL-4.1 amended was dropped on 2026-08-19 instead.

Add the resolved fork to the open queue:

```markdown
- **Materialization gained a launch-mode seam (2026-08-19, owner-approved).**
  `MaterializeIntent.launchOptions` carries SEMANTIC options, not a command:
  `undefined` resolves the agent's default profile, `null` forces the bare
  command. `AgentLauncher` still receives one finished string, so its
  readiness state machine did not move.
```

Add a `docs/CONTEXT.md` section with the same date heading style as its neighbours, covering the data model, why flags are never free-form, the detach limit from Task 10, and the untested `claude --resume` + mode combination from Task 2.

Add the row to the "Chưa khớp thực tế" table:

| Claim                               | Intent     | Status     | Evidence                                                                   |
| ----------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------- |
| Launch profiles set an agent's mode | `building` | unverified | Landed 2026-08-19; suite/build plus a gallery review only — no native pass |

- [ ] **Step 5: Ask before committing the docs**

Show the owner the `AGENTS.md` and `docs/CONTEXT.md` changes and get approval before committing them.

- [ ] **Step 6: Commit**

```bash
git commit -- AGENTS.md docs/CONTEXT.md \
  -m "docs(launch-profiles): record the feature and the materialization fork"
```

---

## Notes for the executor

- **Never run `npm test` without a pattern** until Task 12 — the suite is large and each task's targeted run is the gate.
- **The tree is shared.** Other sessions leave files staged and modified. Every commit here names its paths.
- **Evidence class.** Vitest and `npm run build` are not native evidence. Do not claim Electron or Tauri behaviour without having run that host, and do not claim a visual result without a screenshot the owner has seen.
