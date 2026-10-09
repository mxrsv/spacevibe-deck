/**
 * The one dev-server observation service of an Electron process.
 *
 * It owns WHEN things happen; `discovery.ts` owns what the evidence means and `protocol.ts`
 * owns how one endpoint is probed. No Electron import lives here: the window-focus signal
 * arrives as `DevServerActivity`, so every behaviour below runs under test with an injected
 * collector, prober and fake timers.
 *
 * - Interest drives the lifecycle. The first sender with a root starts observation, the
 *   last release (or an empty root list) stops it, cancels in-flight work and forgets what
 *   was observed, so a later start never shows hour-old rows as live.
 * - One native collection is in flight at a time, shared by every window. A scan publishes
 *   listener rows first; protocol identification runs after it, only for rows some sender
 *   can see, and never delays the next scan.
 * - Every await re-checks the epoch before it commits. `stop` and `dispose` bump it, so a
 *   probe or scan that returns late changes nothing.
 * - `dispose` is terminal for the discovery and the prober; it belongs to `will-quit`.
 *   `stop` is not terminal and runs on every last release.
 */
import {
  createDiscovery,
  type DevServerDiscovery,
  type DevServerEnrichment,
  type DevServerRow,
  type DevServerSnapshot,
  type ScanResult,
} from "./discovery";
import type { DevServerCapability } from "./native";
import type { RootDiagnostic } from "./roots";
import {
  createProber,
  urlFor,
  type EndpointTarget,
  type IdentifyResult,
  type Prober,
} from "./protocol";

/** Why a row's URL could not be proven right now, as the renderer must not guess. */
export type ResolveUnavailableReason =
  "unsupported-platform" | "observation-stopped" | "not-running" | "scan-incomplete";

export type ResolveResult =
  | {
      readonly status: "ready";
      readonly id: string;
      readonly url: string;
      readonly protocol: "http" | "https";
    }
  /** The id or token is not visible to this sender, or names a different process now. */
  | { readonly status: "stale" }
  | { readonly status: "unavailable"; readonly reason: ResolveUnavailableReason }
  /** The listener is there but no HTTP(S) answer proved a URL. */
  | { readonly status: "unknown-protocol"; readonly error: string | null };

export interface ServiceSetRootsResult {
  readonly capability: DevServerCapability;
  /** The sender's root-set generation; 0 only when the call was superseded before any. */
  readonly generation: number;
  /** False when a newer call or a release superseded this one; nothing changed. */
  readonly applied: boolean;
  readonly rootDiagnostics: readonly RootDiagnostic[];
}

/** Window focus/visibility and power state, as main sees them. */
export interface DevServerActivity {
  isActive(): boolean;
  /** `listener` runs when focus, visibility or power state may have changed. */
  subscribe(listener: () => void): () => void;
}

export interface DevServerServiceOptions {
  readonly activity: DevServerActivity;
  readonly discovery?: DevServerDiscovery;
  readonly prober?: Prober;
}

const NON_LOOPBACK_ERROR = "non-loopback";
const ABORTED_ERROR = "aborted";
const STALE: ResolveResult = Object.freeze({ status: "stale" });

const unavailable = (reason: ResolveUnavailableReason): ResolveResult =>
  Object.freeze({ status: "unavailable", reason });

/** First bound address a browser could reach; IPv4 comes first in `bindings`. */
export function probeTarget(row: DevServerRow): EndpointTarget | null {
  for (const binding of row.bindings) {
    const target: EndpointTarget = {
      address: binding.address,
      family: binding.family,
      port: row.port,
    };
    if (urlFor(target, "http") !== null) {
      return target;
    }
  }
  return null;
}

function toEnrichment(target: EndpointTarget, result: IdentifyResult): DevServerEnrichment {
  const tls = result.tlsError === undefined ? null : `tls:${result.tlsError}`;
  return {
    protocol: result.protocol,
    url: urlFor(target, result.protocol),
    error: result.error ?? tls,
  };
}

export class DevServerService {
  private readonly discovery: DevServerDiscovery;
  private readonly prober: Prober;
  private readonly activity: DevServerActivity;
  private running = false;
  private disposed = false;
  private epoch = 0;
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private inFlightScans = 0;
  /** Instance ids handed to the prober, so they can be forgotten when the instance leaves. */
  private readonly probed = new Set<string>();
  /** Ids whose known protocol this service committed; see `enrichRow`. */
  private readonly known = new Set<string>();
  /** Tokens with a probe awaiting an answer, so a scan tick never queues a second one. */
  private readonly pending = new Set<string>();

  constructor(options: DevServerServiceOptions) {
    this.activity = options.activity;
    this.discovery = options.discovery ?? createDiscovery();
    this.prober = options.prober ?? createProber();
  }

  capability(): DevServerCapability {
    return this.discovery.getCapability();
  }

  /** Whether observation is currently scheduled. */
  isObserving(): boolean {
    return this.running;
  }

  async setRoots(senderId: string, roots: readonly string[]): Promise<ServiceSetRootsResult> {
    const result = await this.discovery.setRoots(senderId, roots);
    if (result.applied && !this.disposed) {
      this.syncInterest();
    }
    return {
      capability: this.discovery.getCapability(),
      generation: result.generation,
      applied: result.applied,
      rootDiagnostics: result.rootDiagnostics,
    };
  }

  /** Idempotent. */
  release(senderId: string): void {
    this.discovery.releaseSender(senderId);
    if (!this.disposed) {
      this.syncInterest();
    }
  }

  /**
   * Cached view for one sender. Never scans and never subscribes. A sender that has not
   * registered roots gets an explicit "not registered" answer, never a verified-looking
   * empty list.
   */
  snapshot(senderId: string): DevServerSnapshot {
    const snapshot = this.discovery.snapshotFor(senderId);
    if (snapshot.generation !== 0 || !snapshot.capability.available) {
      return snapshot;
    }
    return Object.freeze({
      ...snapshot,
      completeness: "pending",
      metadata: "pending",
      rows: Object.freeze([]),
      diagnostics: Object.freeze([
        { code: "scan-skipped" as const, message: "This window has not registered any roots" },
      ]),
    });
  }

  /**
   * Revalidate one instance right now and report the URL only if it is still verified:
   * a scan that started after this call (a scan already running may predate a takeover),
   * the same process still holding the port, then a fresh probe that bypasses the cache.
   * Never navigates, copies or writes anywhere.
   */
  async resolve(senderId: string, id: string, instanceToken: string): Promise<ResolveResult> {
    if (!this.discovery.getCapability().available) {
      return unavailable("unsupported-platform");
    }
    if (this.disposed || this.discovery.findRow(senderId, id, instanceToken) === null) {
      return this.disposed ? unavailable("observation-stopped") : STALE;
    }
    const epoch = this.epoch;
    if (!(await this.freshScan()) || !this.live(epoch)) {
      return unavailable("observation-stopped");
    }
    const row = this.discovery.findRow(senderId, id, instanceToken);
    if (row === null) {
      return STALE;
    }
    // `running` alone is not proof: a failed scan leaves earlier rows running until they go
    // stale. The listener must have been seen by the scan that was just committed.
    const latest = this.discovery.snapshotFor(senderId);
    if (row.liveness !== "running" || row.observedAt !== latest.observedAt) {
      return unavailable(latest.completeness === "complete" ? "not-running" : "scan-incomplete");
    }
    return this.reprobe(senderId, row, epoch);
  }

  /** Terminal. Called once, at `will-quit`. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stop();
    this.discovery.dispose();
    this.prober.dispose();
  }

  /* ------------------------------ lifecycle ------------------------------ */

  private syncInterest(): void {
    if (!this.discovery.getCapability().available) {
      return;
    }
    if (!this.discovery.hasInterest()) {
      this.stop();
    } else if (this.running) {
      this.enrichAll(this.epoch);
    } else {
      this.start();
    }
  }

  private start(): void {
    this.running = true;
    this.controller = new AbortController();
    this.unsubscribe = this.activity.subscribe(() => this.onActivity());
    this.applyCadence();
    void this.tick();
  }

  private stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.epoch += 1;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller.abort();
    for (const id of this.probed) {
      this.prober.forget(id);
    }
    this.probed.clear();
    this.known.clear();
    this.pending.clear();
    this.discovery.reset();
  }

  private live(epoch: number): boolean {
    return !this.disposed && this.running && epoch === this.epoch;
  }

  private applyCadence(): void {
    this.discovery.setCadence(this.activity.isActive() ? "active" : "background");
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private onActivity(): void {
    if (!this.running) {
      return;
    }
    this.applyCadence();
    if (this.activity.isActive() && this.inFlightScans === 0) {
      this.clearTimer();
      void this.tick();
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const epoch = this.epoch;
    this.clearTimer();
    await this.trackedScan();
    if (!this.live(epoch)) {
      return;
    }
    this.enrichAll(epoch);
    this.applyCadence();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.discovery.intervalMs());
    this.timer.unref();
  }

  /* -------------------------------- scans -------------------------------- */

  private async trackedScan(): Promise<ScanResult> {
    this.inFlightScans += 1;
    try {
      return await this.discovery.scanOnce();
    } finally {
      this.inFlightScans -= 1;
    }
  }

  /** True when a scan that began after this call has been committed. */
  private async freshScan(): Promise<boolean> {
    const joinedRunning = this.inFlightScans > 0;
    let result = await this.trackedScan();
    if (joinedRunning && result.status === "scanned") {
      result = await this.trackedScan();
    }
    return result.status === "scanned";
  }

  /* ----------------------------- identification ----------------------------- */

  private enrichAll(epoch: number): void {
    const visible = this.discovery.visibleRows();
    const keep = new Set(visible.filter((row) => row.liveness !== "stopped").map((row) => row.id));
    for (const id of this.probed) {
      if (!keep.has(id)) {
        this.prober.forget(id);
        this.probed.delete(id);
        this.known.delete(id);
      }
    }
    for (const row of visible) {
      if (row.liveness === "running" && row.protocol === "unknown") {
        void this.enrichRow(row, epoch);
      }
    }
  }

  private async enrichRow(row: DevServerRow, epoch: number): Promise<void> {
    if (!this.live(epoch) || this.pending.has(row.instanceToken)) {
      return;
    }
    const target = probeTarget(row);
    if (target === null) {
      if (row.identificationError !== NON_LOOPBACK_ERROR) {
        this.discovery.setEnrichment(row.instanceToken, {
          protocol: "unknown",
          url: null,
          error: NON_LOOPBACK_ERROR,
        });
      }
      return;
    }
    // The row is unknown although a protocol was committed for it: discovery dropped it
    // because continuity could not be proven. The prober's cache must not put it back.
    if (this.known.delete(row.id)) {
      this.prober.forget(row.id);
    }
    this.pending.add(row.instanceToken);
    this.probed.add(row.id);
    try {
      const result = await this.prober.identify(
        { key: row.id, identity: row.instanceToken, target },
        this.controller.signal,
      );
      // A backoff answer was already committed when it was produced; an aborted one
      // says nothing about the endpoint.
      if (this.live(epoch) && result.source !== "backoff" && result.error !== ABORTED_ERROR) {
        this.commit(row, toEnrichment(target, result));
      }
    } finally {
      this.pending.delete(row.instanceToken);
    }
  }

  private commit(row: DevServerRow, enrichment: DevServerEnrichment): void {
    if (!this.discovery.setEnrichment(row.instanceToken, enrichment)) {
      return;
    }
    if (enrichment.protocol === "unknown") {
      this.known.delete(row.id);
    } else {
      this.known.add(row.id);
    }
  }

  private async reprobe(
    senderId: string,
    row: DevServerRow,
    epoch: number,
  ): Promise<ResolveResult> {
    const target = probeTarget(row);
    if (target === null) {
      return { status: "unknown-protocol", error: NON_LOOPBACK_ERROR };
    }
    this.prober.forget(row.id);
    this.probed.add(row.id);
    const result = await this.prober.identify(
      { key: row.id, identity: row.instanceToken, target },
      this.controller.signal,
    );
    if (!this.live(epoch)) {
      return unavailable("observation-stopped");
    }
    const current = this.discovery.findRow(senderId, row.id, row.instanceToken);
    if (current === null || current.liveness !== "running") {
      return STALE;
    }
    if (result.error === ABORTED_ERROR) {
      return { status: "unknown-protocol", error: ABORTED_ERROR };
    }
    const enrichment = toEnrichment(target, result);
    this.commit(row, enrichment);
    if (enrichment.url === null || enrichment.protocol === "unknown") {
      return { status: "unknown-protocol", error: enrichment.error };
    }
    return {
      status: "ready",
      id: row.id,
      url: enrichment.url,
      protocol: enrichment.protocol,
    };
  }
}

export function createDevServerService(options: DevServerServiceOptions): DevServerService {
  return new DevServerService(options);
}
