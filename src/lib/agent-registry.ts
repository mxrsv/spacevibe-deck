/**
 * Wire mirror of `electron/agent-registry/claude-registry.ts`'s snapshot —
 * what the `agent_registry` channel answers — plus the validator the renderer
 * runs on it. Pure: no host import, so the facade in `src/host/` stays thin
 * and this can be unit-tested with plain objects.
 *
 * Every field is re-checked here even though main built the object: the
 * renderer is the far side of an IPC boundary, and a validator that trusts
 * the wire is one that stops saying anything (the `validateResumeRequests`
 * posture, pointed the other way).
 */

export interface RegistryEntry {
  readonly pid: number;
  readonly cwd: string | null;
  readonly sessionId: string;
  readonly status: string;
  readonly waitingFor: string | null;
  readonly name: string | null;
  readonly kind: string;
}

export interface RegistrySnapshot {
  readonly available: boolean;
  readonly stale: boolean;
  readonly polledAt: number;
  readonly entries: readonly RegistryEntry[];
}

/** The `waiting` status is the one Claude documents; the rest are carried, never acted on. */
export const REGISTRY_STATUS_WAITING = "waiting";

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const UNAVAILABLE_REGISTRY: RegistrySnapshot = Object.freeze({
  available: false,
  stale: true,
  polledAt: 0,
  entries: Object.freeze([]) as readonly RegistryEntry[],
});

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseEntry(raw: unknown): RegistryEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (
    typeof node.pid !== "number" ||
    !Number.isSafeInteger(node.pid) ||
    node.pid <= 0 ||
    typeof node.sessionId !== "string" ||
    !SESSION_ID.test(node.sessionId)
  ) {
    return null;
  }
  return {
    pid: node.pid,
    cwd: optionalString(node.cwd),
    sessionId: node.sessionId,
    status: optionalString(node.status) ?? "unknown",
    waitingFor: optionalString(node.waitingFor),
    name: optionalString(node.name),
    kind: optionalString(node.kind) ?? "interactive",
  };
}

/** A snapshot off the wire, or the unavailable one for anything malformed. */
export function parseRegistrySnapshot(raw: unknown): RegistrySnapshot {
  if (typeof raw !== "object" || raw === null) {
    return UNAVAILABLE_REGISTRY;
  }
  const node = raw as Record<string, unknown>;
  if (!Array.isArray(node.entries)) {
    return UNAVAILABLE_REGISTRY;
  }
  const entries = node.entries.flatMap((entry) => {
    const parsed = parseEntry(entry);
    return parsed === null ? [] : [parsed];
  });
  return {
    available: node.available === true,
    stale: node.stale !== false,
    polledAt:
      typeof node.polledAt === "number" && Number.isFinite(node.polledAt) && node.polledAt >= 0
        ? node.polledAt
        : 0,
    entries,
  };
}

/** The registry's entries keyed by pid — the join `pty_info`'s `processId` answers. */
export function registryByPid(snapshot: RegistrySnapshot): ReadonlyMap<number, RegistryEntry> {
  const byPid = new Map<number, RegistryEntry>();
  for (const entry of snapshot.entries) {
    // First one wins: the registry lists each interactive pid once, and a
    // duplicate would be the same session reported twice.
    if (!byPid.has(entry.pid)) {
      byPid.set(entry.pid, entry);
    }
  }
  return byPid;
}
