/**
 * Dev-server discovery state: turns native scans into per-sender rows with an honest
 * lifecycle. Pure state and scheduling INPUTS only; there are no timers here. The main
 * process (C4) owns when `scanOnce` runs, using `scanIntervalMs`.
 *
 * What a row means:
 *
 * - An instance is one process holding one port: pid + port + start time. A pid with
 *   separate IPv4 and IPv6 sockets on one port is one instance with several bindings.
 *   Endpoint alone is never identity, so a same-port takeover is a new instance.
 * - `running` = seen by the latest complete-or-partial scan and not stale. After ONE
 *   complete scan omits it the row is `unknown`; after TWO consecutive complete scans omit
 *   it, `stopped`. A partial or failed scan never counts as absence and breaks the run, so
 *   complete-miss, partial, complete-miss is still not stopped.
 * - A scan that sees the listener but misses its start time or cwd is NOT an absence. The
 *   instance is kept, but continuity is unverified so cached protocol/url are dropped.
 *   Only a different start time for the same pid and port makes a new instance.
 * - Rows go stale to `unknown` after twice the current scan interval.
 * - Stopped rows live 60 s and at most 100; a server never observed is never invented as
 *   stopped, and a process outside every root is dropped when it exits.
 * - Attribution is per sender: each window's own deepest root decides, and a more specific
 *   root registered by another window cannot steal a row. An endpoint shared by processes
 *   that attribute differently is ambiguous and is withheld, counted in diagnostics.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  collectNative,
  nativeCapability,
  type Binding,
  type DevServerCapability,
  type NativeDiagnostic,
  type NativeScan,
  type ScanCompleteness,
} from "./native";
import {
  canonicalizeRoots,
  deepestRoot,
  type CanonicalRoot,
  type RealpathFn,
  type RootDiagnostic,
} from "./roots";

export const ACTIVE_SCAN_INTERVAL_MS = 3_000;
export const BACKGROUND_SCAN_INTERVAL_MS = 15_000;
export const STALE_INTERVAL_FACTOR = 2;
export const STOPPED_RETENTION_MS = 60_000;
export const MAX_STOPPED_ROWS = 100;
export const ABSENT_SCANS_TO_STOP = 2;
export const MAX_SNAPSHOT_DIAGNOSTICS = 12;

export type ScanCadence = "active" | "background";
export type DevServerLiveness = "running" | "stopped" | "unknown";
export type DevServerProtocol = "http" | "https" | "unknown";

/** Protocol evidence for one instance, written by the probe layer (C3). */
export interface DevServerEnrichment {
  readonly protocol: DevServerProtocol;
  readonly url: string | null;
  /** Short, bounded identification error; never a stack or a command line. */
  readonly error: string | null;
}

export interface DevServerRow {
  /** Opaque and stable for the life of the instance. */
  readonly id: string;
  /** Opaque proof of identity (includes a per-service salt); echoed back to `resolve`. */
  readonly instanceToken: string;
  /** Canonical root that owns this row for the requesting sender. */
  readonly workspacePath: string;
  /** The same root as the sender spelled it. */
  readonly displayRoot: string;
  readonly port: number;
  /** Bound addresses, IPv4 first. A wildcard is the unspecified address, not a URL host. */
  readonly bindings: readonly Binding[];
  /** Another live process on an overlapping binding of this port belongs to the same root. */
  readonly sharedEndpoint: boolean;
  /** Epoch ms of the last scan that saw the listener. */
  readonly observedAt: number;
  readonly liveness: DevServerLiveness;
  /** Epoch ms when it was confirmed stopped, else null. */
  readonly stoppedAt: number | null;
  readonly protocol: DevServerProtocol;
  readonly url: string | null;
  readonly identificationError: string | null;
}

export type SnapshotDiagnosticCode =
  NativeDiagnostic["code"] | "ambiguous-endpoint" | "scan-stale" | "scan-pending" | "scan-skipped";

export interface SnapshotDiagnostic {
  readonly code: SnapshotDiagnosticCode;
  readonly message: string;
}

export interface DevServerSnapshot {
  /** The sender's root-set generation; a reply for an older one is stale. */
  readonly generation: number;
  /** Increases with every committed scan, shared across senders. */
  readonly sequence: number;
  /** Epoch ms of the latest committed scan, or null before the first. */
  readonly observedAt: number | null;
  readonly capability: DevServerCapability;
  /** Listener-scan completeness only. Metadata gaps are in `metadata` and diagnostics. */
  readonly completeness: ScanCompleteness | "pending";
  readonly metadata: ScanCompleteness | "pending";
  readonly rows: readonly DevServerRow[];
  readonly diagnostics: readonly SnapshotDiagnostic[];
  readonly rootDiagnostics: readonly RootDiagnostic[];
}

export interface SetRootsResult {
  /** False when a newer `setRoots`, a release or `dispose` superseded this call. */
  readonly applied: boolean;
  readonly generation: number;
  readonly rootDiagnostics: readonly RootDiagnostic[];
}

export type ScanResult =
  | { readonly status: "scanned"; readonly sequence: number }
  | { readonly status: "skipped"; readonly reason: "unavailable" | "no-interest" }
  | { readonly status: "discarded" };

export interface DiscoveryOptions {
  readonly collect?: () => Promise<NativeScan>;
  readonly clock?: () => number;
  readonly realpath?: RealpathFn;
  /** Mixed into instance tokens so the renderer cannot forge one. Tests pin it. */
  readonly salt?: string;
  readonly platform?: string;
}

export function scanIntervalMs(cadence: ScanCadence): number {
  return cadence === "active" ? ACTIVE_SCAN_INTERVAL_MS : BACKGROUND_SCAN_INTERVAL_MS;
}

/* ------------------------------ instances ------------------------------ */

const NO_ENRICHMENT: DevServerEnrichment = Object.freeze({
  protocol: "unknown",
  url: null,
  error: null,
});

interface Instance {
  readonly id: string;
  readonly pid: number;
  readonly port: number;
  readonly startTime: string | null;
  readonly bindings: readonly Binding[];
  readonly cwd: string | null;
  readonly lastSeenAt: number;
  /** Consecutive complete scans that omitted it. */
  readonly missRun: number;
  /** A partial or failed scan interrupted a run of misses. */
  readonly uncertain: boolean;
  readonly stoppedAt: number | null;
  readonly enrichment: DevServerEnrichment;
}

interface Observation {
  readonly pid: number;
  readonly port: number;
  readonly bindings: readonly Binding[];
  readonly startTime: string | null;
  readonly cwd: string | null;
}

function bindingKey(binding: Binding): string {
  return `${binding.family}|${binding.address}`;
}

/** IPv4 before IPv6, then by address, so equal sets compare and print identically. */
function sortBindings(bindings: Iterable<Binding>): Binding[] {
  const unique = new Map<string, Binding>();
  for (const binding of bindings) {
    unique.set(bindingKey(binding), Object.freeze({ ...binding }));
  }
  return [...unique.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || a.address.localeCompare(b.address),
  );
}

function observe(scan: NativeScan): Observation[] {
  const grouped = new Map<string, { pid: number; port: number; bindings: Binding[] }>();
  for (const listener of scan.listeners) {
    const key = `${listener.pid}:${listener.port}`;
    const entry = grouped.get(key) ?? { pid: listener.pid, port: listener.port, bindings: [] };
    entry.bindings.push(listener.binding);
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => ({
    pid: entry.pid,
    port: entry.port,
    bindings: Object.freeze(sortBindings(entry.bindings)),
    startTime: scan.identities.get(entry.pid)?.startTime ?? null,
    cwd: scan.cwds.get(entry.pid) ?? null,
  }));
}

/**
 * The same process, or at least not provably another one: two known start times must match.
 * A stopped instance is only revived on a proven match, never on a missing start time.
 */
function sameProcess(instance: Instance, seen: Observation): boolean {
  if (instance.pid !== seen.pid || instance.port !== seen.port) {
    return false;
  }
  if (instance.stoppedAt !== null) {
    return instance.startTime !== null && instance.startTime === seen.startTime;
  }
  return (
    instance.startTime === null || seen.startTime === null || instance.startTime === seen.startTime
  );
}

function refreshed(instance: Instance, seen: Observation, now: number): Instance {
  const continuous = instance.startTime !== null && instance.startTime === seen.startTime;
  return {
    ...instance,
    bindings: seen.bindings,
    cwd: seen.cwd ?? instance.cwd,
    startTime: seen.startTime ?? instance.startTime,
    lastSeenAt: now,
    missRun: 0,
    uncertain: false,
    stoppedAt: null,
    enrichment: continuous ? instance.enrichment : NO_ENRICHMENT,
  };
}

function afterOmission(
  instance: Instance,
  complete: boolean,
  now: number,
  keep: boolean,
): Instance | null {
  if (!complete) {
    return instance.missRun > 0 ? { ...instance, missRun: 0, uncertain: true } : instance;
  }
  const missRun = instance.missRun + 1;
  if (missRun < ABSENT_SCANS_TO_STOP) {
    return { ...instance, missRun };
  }
  return keep ? { ...instance, missRun, stoppedAt: now } : null;
}

function pruneStopped(instances: Map<string, Instance>, now: number): void {
  const stopped = [...instances.values()].filter((instance) => instance.stoppedAt !== null);
  const expired = stopped.filter(
    (instance) => now - (instance.stoppedAt ?? 0) >= STOPPED_RETENTION_MS,
  );
  for (const instance of expired) {
    instances.delete(instance.id);
  }
  const live = stopped
    .filter((instance) => !expired.includes(instance))
    .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0));
  for (const instance of live.slice(MAX_STOPPED_ROWS)) {
    instances.delete(instance.id);
  }
}

interface ReconcileContext {
  readonly now: number;
  readonly nextId: () => string;
  /** Whether any sender's roots hold this cwd; decides if a stopped entry is worth keeping. */
  readonly interesting: (cwd: string | null) => boolean;
}

/** Next instance table after one scan. Never mutates `previous`. */
function reconcile(
  previous: ReadonlyMap<string, Instance>,
  scan: NativeScan,
  context: ReconcileContext,
): Map<string, Instance> {
  const next = new Map(previous);
  const claimed = new Set<string>();
  for (const seen of observe(scan)) {
    const candidates = [...next.values()].filter(
      (instance) => !claimed.has(instance.id) && sameProcess(instance, seen),
    );
    const match = candidates.find((instance) => instance.stoppedAt === null) ?? candidates[0];
    const id = match?.id ?? context.nextId();
    claimed.add(id);
    next.set(
      id,
      match === undefined
        ? freshInstance(id, seen, context.now)
        : refreshed(match, seen, context.now),
    );
  }
  const complete = scan.completeness === "complete";
  for (const instance of previous.values()) {
    if (claimed.has(instance.id) || instance.stoppedAt !== null) {
      continue;
    }
    const updated = afterOmission(
      instance,
      complete,
      context.now,
      context.interesting(instance.cwd),
    );
    if (updated === null) {
      next.delete(instance.id);
    } else {
      next.set(instance.id, updated);
    }
  }
  pruneStopped(next, context.now);
  return next;
}

function freshInstance(id: string, seen: Observation, now: number): Instance {
  return {
    id,
    pid: seen.pid,
    port: seen.port,
    startTime: seen.startTime,
    bindings: seen.bindings,
    cwd: seen.cwd,
    lastSeenAt: now,
    missRun: 0,
    uncertain: false,
    stoppedAt: null,
    enrichment: NO_ENRICHMENT,
  };
}

/* --------------------------- sender projection --------------------------- */

interface SenderState {
  readonly generation: number;
  readonly roots: readonly CanonicalRoot[];
  readonly rootDiagnostics: readonly RootDiagnostic[];
}

function livenessOf(instance: Instance, now: number, staleMs: number): DevServerLiveness {
  if (instance.stoppedAt !== null) {
    return "stopped";
  }
  if (instance.missRun > 0 || instance.uncertain || now - instance.lastSeenAt > staleMs) {
    return "unknown";
  }
  return "running";
}

function bindingsOverlap(a: readonly Binding[], b: readonly Binding[]): boolean {
  return a.some((left) =>
    b.some(
      (right) =>
        left.family === right.family &&
        (left.address === right.address || isUnspecified(left) || isUnspecified(right)),
    ),
  );
}

function isUnspecified(binding: Binding): boolean {
  return binding.address === "0.0.0.0" || binding.address === "::";
}

interface Projection {
  readonly rows: readonly Omit<DevServerRow, "instanceToken">[];
  readonly ambiguous: number;
}

function project(
  instances: readonly Instance[],
  roots: readonly CanonicalRoot[],
  now: number,
  staleMs: number,
): Projection {
  const owner = new Map<string, CanonicalRoot | null>();
  for (const instance of instances) {
    owner.set(instance.id, instance.cwd === null ? null : deepestRoot(roots, instance.cwd));
  }
  const live = instances.filter((instance) => instance.stoppedAt === null);
  const rows: Omit<DevServerRow, "instanceToken">[] = [];
  let ambiguous = 0;
  for (const instance of instances) {
    const root = owner.get(instance.id) ?? null;
    if (root === null) {
      continue;
    }
    const rivals =
      instance.stoppedAt !== null
        ? []
        : live.filter(
            (other) =>
              other.id !== instance.id &&
              other.port === instance.port &&
              bindingsOverlap(other.bindings, instance.bindings),
          );
    if (rivals.some((other) => owner.get(other.id)?.canonical !== root.canonical)) {
      ambiguous += 1;
      continue;
    }
    rows.push({
      id: instance.id,
      workspacePath: root.canonical,
      displayRoot: root.input,
      port: instance.port,
      bindings: instance.bindings,
      sharedEndpoint: rivals.length > 0,
      observedAt: instance.lastSeenAt,
      liveness: livenessOf(instance, now, staleMs),
      stoppedAt: instance.stoppedAt,
      protocol: instance.enrichment.protocol,
      url: instance.enrichment.url,
      identificationError: instance.enrichment.error,
    });
  }
  return { rows, ambiguous };
}

function compareRows(a: Pick<DevServerRow, "workspacePath" | "port" | "id">, b: typeof a): number {
  return (
    a.workspacePath.localeCompare(b.workspacePath) || a.port - b.port || a.id.localeCompare(b.id)
  );
}

/* ------------------------------- service ------------------------------- */

interface LastScan {
  readonly at: number;
  readonly completeness: ScanCompleteness;
  readonly metadata: ScanCompleteness;
  readonly diagnostics: readonly NativeDiagnostic[];
}

export class DevServerDiscovery {
  private readonly collect: () => Promise<NativeScan>;
  private readonly clock: () => number;
  private readonly realpath: RealpathFn | undefined;
  private readonly salt: string;
  private readonly capability: DevServerCapability;
  private senders = new Map<string, SenderState>();
  private pendingRoots = new Map<string, number>();
  private instances: ReadonlyMap<string, Instance> = new Map();
  private lastScan: LastScan | null = null;
  private cadence: ScanCadence = "active";
  private sequence = 0;
  private generationCounter = 0;
  private requestCounter = 0;
  private idCounter = 0;
  private inFlight: Promise<ScanResult> | null = null;
  private epoch = 0;
  private disposed = false;

  constructor(options: DiscoveryOptions = {}) {
    this.capability = nativeCapability(options.platform);
    this.collect = options.collect ?? (() => collectNative({ platform: options.platform }));
    this.clock = options.clock ?? Date.now;
    this.realpath = options.realpath;
    this.salt = options.salt ?? randomUUID();
  }

  setCadence(cadence: ScanCadence): void {
    this.cadence = cadence;
  }

  /** How long the caller should wait between scans at the current cadence. */
  intervalMs(): number {
    return scanIntervalMs(this.cadence);
  }

  /** True when any sender has at least one root, so a scan has someone to serve. */
  hasInterest(): boolean {
    return [...this.senders.values()].some((state) => state.roots.length > 0);
  }

  /**
   * Replace one sender's roots. The call that was issued last wins even if an earlier one
   * finishes resolving later; the loser reports `applied: false` and changes nothing.
   */
  async setRoots(senderId: string, inputs: unknown): Promise<SetRootsResult> {
    const request = ++this.requestCounter;
    this.pendingRoots.set(senderId, request);
    const { roots, diagnostics } = await canonicalizeRoots(inputs, this.realpath);
    if (this.disposed || this.pendingRoots.get(senderId) !== request) {
      return {
        applied: false,
        generation: this.senders.get(senderId)?.generation ?? 0,
        rootDiagnostics: [],
      };
    }
    const generation = ++this.generationCounter;
    this.senders = new Map(this.senders).set(senderId, {
      generation,
      roots,
      rootDiagnostics: diagnostics,
    });
    return { applied: true, generation, rootDiagnostics: diagnostics };
  }

  /** Idempotent. Invalidates a `setRoots` still resolving for this sender. */
  releaseSender(senderId: string): void {
    this.pendingRoots.delete(senderId);
    const remaining = new Map(this.senders);
    remaining.delete(senderId);
    this.senders = remaining;
  }

  /** One native collection at a time; concurrent callers share it. */
  scanOnce(): Promise<ScanResult> {
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    const run: Promise<ScanResult> = this.runScan().finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
    return run;
  }

  private async runScan(): Promise<ScanResult> {
    if (this.disposed || !this.capability.available) {
      return { status: "skipped", reason: "unavailable" };
    }
    if (!this.hasInterest()) {
      return { status: "skipped", reason: "no-interest" };
    }
    const epoch = this.epoch;
    const scan = await this.collectSafely();
    if (this.disposed || epoch !== this.epoch) {
      return { status: "discarded" };
    }
    const now = this.clock();
    this.instances = reconcile(this.instances, scan, {
      now,
      nextId: () => `srv-${(++this.idCounter).toString(36)}`,
      interesting: (cwd) => this.isInteresting(cwd),
    });
    this.lastScan = {
      at: now,
      completeness: scan.completeness,
      metadata: scan.metadata,
      diagnostics: scan.diagnostics,
    };
    this.sequence += 1;
    return { status: "scanned", sequence: this.sequence };
  }

  private async collectSafely(): Promise<NativeScan> {
    try {
      return await this.collect();
    } catch {
      return {
        capability: this.capability,
        completeness: "failed",
        listeners: [],
        metadata: "failed",
        cwds: new Map(),
        identities: new Map(),
        diagnostics: [{ code: "tool-error", message: "The native collector failed unexpectedly" }],
      };
    }
  }

  private isInteresting(cwd: string | null): boolean {
    if (cwd === null) {
      return false;
    }
    return [...this.senders.values()].some((state) => deepestRoot(state.roots, cwd) !== null);
  }

  /**
   * Record protocol evidence for an instance. Rejected (false) when the token does not name
   * a current, non-stopped instance, e.g. the process exited or the pid was reused, so a
   * late probe result cannot attach to a different process.
   */
  setEnrichment(instanceToken: string, enrichment: DevServerEnrichment): boolean {
    const target = [...this.instances.values()].find(
      (instance) => instance.stoppedAt === null && this.tokenFor(instance.id) === instanceToken,
    );
    if (target === undefined) {
      return false;
    }
    const next = new Map(this.instances);
    next.set(target.id, { ...target, enrichment: Object.freeze({ ...enrichment }) });
    this.instances = next;
    return true;
  }

  /** The row a sender currently sees for `{ id, instanceToken }`, or null if it is not visible. */
  findRow(senderId: string, id: string, instanceToken: string): DevServerRow | null {
    const row = this.snapshotFor(senderId).rows.find((entry) => entry.id === id);
    return row !== undefined && row.instanceToken === instanceToken ? row : null;
  }

  /** Immutable view of the shared state through one sender's roots. */
  snapshotFor(senderId: string): DevServerSnapshot {
    const now = this.clock();
    const state = this.senders.get(senderId);
    const staleMs = STALE_INTERVAL_FACTOR * this.intervalMs();
    const { rows, ambiguous } = project(
      [...this.instances.values()],
      state?.roots ?? [],
      now,
      staleMs,
    );
    const diagnostics = this.diagnosticsFor(now, staleMs, ambiguous);
    return Object.freeze({
      generation: state?.generation ?? 0,
      sequence: this.sequence,
      observedAt: this.lastScan?.at ?? null,
      capability: this.capability,
      completeness: this.lastScan?.completeness ?? "pending",
      metadata: this.lastScan?.metadata ?? "pending",
      rows: Object.freeze(
        [...rows]
          .sort(compareRows)
          .map((row) => Object.freeze({ ...row, instanceToken: this.tokenFor(row.id) })),
      ),
      diagnostics: Object.freeze(diagnostics.slice(0, MAX_SNAPSHOT_DIAGNOSTICS)),
      rootDiagnostics: Object.freeze([...(state?.rootDiagnostics ?? [])]),
    });
  }

  private diagnosticsFor(now: number, staleMs: number, ambiguous: number): SnapshotDiagnostic[] {
    if (!this.capability.available) {
      return [
        {
          code: "unsupported-platform",
          message: "Dev server discovery is not available on this platform",
        },
      ];
    }
    if (this.lastScan === null) {
      return [{ code: "scan-pending", message: "No scan has completed yet" }];
    }
    const notes: SnapshotDiagnostic[] = [...this.lastScan.diagnostics];
    if (now - this.lastScan.at > staleMs) {
      notes.push({ code: "scan-stale", message: "The latest scan is older than expected" });
    }
    if (ambiguous > 0) {
      notes.push({
        code: "ambiguous-endpoint",
        message: `${ambiguous} servers share an endpoint with another project and are withheld`,
      });
    }
    return notes;
  }

  private tokenFor(id: string): string {
    return createHash("sha256").update(`${this.salt}|${id}`).digest("hex").slice(0, 16);
  }

  getCapability(): DevServerCapability {
    return this.capability;
  }

  /** Rows at least one sender can see, once per instance. Used to pick probe candidates. */
  visibleRows(): readonly DevServerRow[] {
    const byId = new Map<string, DevServerRow>();
    for (const senderId of this.senders.keys()) {
      for (const row of this.snapshotFor(senderId).rows) {
        byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  /**
   * Forget every observed instance (the last sender left). A scan still in flight is
   * discarded when it returns, so old evidence cannot reappear after a restart. Sequence
   * and generation keep counting so a late reply is still recognisably old.
   */
  reset(): void {
    this.epoch += 1;
    this.inFlight = null;
    this.instances = new Map();
    this.lastScan = null;
  }

  /** Stop serving. A scan still in flight is discarded when it returns. */
  dispose(): void {
    this.disposed = true;
    this.senders = new Map();
    this.pendingRoots = new Map();
    this.instances = new Map();
    this.lastScan = null;
  }
}

export function createDiscovery(options: DiscoveryOptions = {}): DevServerDiscovery {
  return new DevServerDiscovery(options);
}
