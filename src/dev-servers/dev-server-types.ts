/**
 * Renderer-side shapes for dev server discovery.
 *
 * Type-only mirror of `electron/dev-servers/discovery.ts` (`DevServerRow`,
 * `DevServerSnapshot`, `SetRootsResult`) and `native.ts` (`DevServerCapability`,
 * `ScanCompleteness`, `Binding`). The renderer must not import Electron/Node code, so the
 * shapes are duplicated; `src/host/dev-server-host.ts` validates every host reply against
 * them at runtime, so a drift fails loudly instead of leaking into signals.
 */

export type ScanCompleteness = "complete" | "partial" | "failed";
export type DevServerLiveness = "running" | "stopped" | "unknown";
export type DevServerProtocol = "http" | "https" | "unknown";
export type AddressFamily = "IPv4" | "IPv6";
export type RootDiagnosticCode = "invalid" | "not-found" | "unreadable" | "over-limit";

/**
 * `unsupported-platform` comes from main (the OS cannot be scanned); `unsupported-host` is
 * the renderer's own answer when there is no Electron bridge (Tauri, browser preview), where
 * no IPC is attempted. Both mean "unavailable", never "available but empty".
 */
export type DevServerCapability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "unsupported-platform";
      readonly platform: string;
    }
  | { readonly available: false; readonly reason: "unsupported-host" };

export interface DevServerBinding {
  readonly family: AddressFamily;
  readonly address: string;
}

export interface DevServerRow {
  readonly id: string;
  readonly instanceToken: string;
  readonly workspacePath: string;
  readonly displayRoot: string;
  readonly port: number;
  readonly bindings: readonly DevServerBinding[];
  readonly sharedEndpoint: boolean;
  readonly observedAt: number;
  readonly liveness: DevServerLiveness;
  readonly stoppedAt: number | null;
  readonly protocol: DevServerProtocol;
  readonly url: string | null;
  readonly identificationError: string | null;
}

/** `code` is deliberately a string: main may add diagnostic codes the renderer need not know. */
export interface DevServerDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface DevServerRootDiagnostic {
  readonly code: RootDiagnosticCode;
  readonly root: string;
  readonly message: string;
}

export interface DevServerSnapshot {
  readonly generation: number;
  readonly sequence: number;
  readonly observedAt: number | null;
  readonly capability: DevServerCapability;
  readonly completeness: ScanCompleteness | "pending";
  readonly metadata: ScanCompleteness | "pending";
  readonly rows: readonly DevServerRow[];
  readonly diagnostics: readonly DevServerDiagnostic[];
  readonly rootDiagnostics: readonly DevServerRootDiagnostic[];
}

export interface DevServerRootsReply {
  readonly capability: DevServerCapability;
  /** False when a newer registration, a release or disposal superseded this call. */
  readonly applied: boolean;
  readonly generation: number;
  readonly rootDiagnostics: readonly DevServerRootDiagnostic[];
}

export type DevServerUnavailableReason =
  "unsupported-platform" | "observation-stopped" | "not-running" | "scan-incomplete";

/** Mirror of `ResolveResult` in `electron/dev-servers/service.ts`. */
export type DevServerResolveResult =
  | {
      readonly status: "ready";
      readonly id: string;
      readonly url: string;
      readonly protocol: "http" | "https";
    }
  | { readonly status: "stale" }
  | { readonly status: "unavailable"; readonly reason: DevServerUnavailableReason }
  | { readonly status: "unknown-protocol"; readonly error: string | null };

/** The four host operations the store depends on; the facade implements them. */
export interface DevServerHost {
  setRoots(roots: readonly string[]): Promise<DevServerRootsReply>;
  snapshot(): Promise<DevServerSnapshot>;
  release(): Promise<void>;
  resolve(id: string, instanceToken: string): Promise<DevServerResolveResult>;
}
