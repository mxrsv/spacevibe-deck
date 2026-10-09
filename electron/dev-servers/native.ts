/**
 * Native reader for dev-server discovery: which processes hold TCP listeners, where
 * they run, and which process instance each one is. macOS only.
 *
 * Every rule below was measured on macOS 27.2 with lsof 4.91 (C1 experiments, 2026-10-09)
 * rather than assumed:
 *
 * - `lsof` exits 1 when NOTHING matches, with empty stdout and stderr. That is a
 *   complete, empty answer, not a failure. `processCwds` in `platform/macos.ts` hides
 *   every error behind an empty map; here an empty list is only believable when the tool
 *   actually said so.
 * - A non-root `lsof` silently omits listeners owned by other users (root daemons,
 *   launchd sockets) with exit 0 and no stderr. "Complete" therefore means complete for
 *   the processes this user can see, which is the scope of external dev servers.
 * - The cwd read exits 1 whenever ANY requested pid produced no row (exited, other user,
 *   denied), with nothing on stderr. Exit codes cannot tell those apart, so a pid that
 *   is absent from the output simply has no cwd; that is a metadata gap, never evidence
 *   that the server stopped.
 * - Reported cwds are canonical kernel paths (`/tmp` appears as `/private/tmp`).
 * - A process start time (`ps -o lstart=`) has one-second resolution and is localised
 *   unless `LC_ALL=C`; it is kept as an opaque string and never parsed to a Date.
 * - A dual-stack server appears once as `IPv6 *:port`, but a process that opens separate
 *   IPv4 and IPv6 sockets appears twice, so one instance may carry several bindings.
 *
 * All work is asynchronous `execFile` with fixed absolute executables and arguments, a
 * timeout and an output cap; nothing goes through a shell.
 */
import { execFile } from "node:child_process";

export const LSOF_PATH = "/usr/sbin/lsof";
export const PS_PATH = "/bin/ps";
export const SUPPORTED_PLATFORM = "darwin";

export const NATIVE_TIMEOUT_MS = 4_000;
export const LISTENER_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
export const METADATA_OUTPUT_CAP_BYTES = 1024 * 1024;
/** Upper bound on listener pids read for cwd and identity in one scan. */
export const MAX_CANDIDATE_PIDS = 256;
/** Pids per `-p` list, so one command line never grows with the process table. */
export const PID_BATCH_SIZE = 64;
export const MAX_DIAGNOSTICS = 8;

const MIN_PORT = 1;
const MAX_PORT = 65_535;
/** Pinned so `lstart` is not localised. */
const NATIVE_ENV = { LC_ALL: "C" } as const;

export type ScanCompleteness = "complete" | "partial" | "failed";
export type AddressFamily = "IPv4" | "IPv6";

export type DevServerCapability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "unsupported-platform";
      readonly platform: string;
    };

/** One bound address. A wildcard is normalised to the family's unspecified address. */
export interface Binding {
  readonly family: AddressFamily;
  readonly address: string;
}

export interface Listener {
  readonly pid: number;
  readonly port: number;
  readonly binding: Binding;
}

export interface ProcessIdentity {
  readonly pid: number;
  readonly ppid: number;
  /** Opaque `ps lstart` text, compared for equality only. */
  readonly startTime: string;
}

export type NativeDiagnosticCode =
  | "unsupported-platform"
  | "tool-missing"
  | "tool-timeout"
  | "tool-error"
  | "output-truncated"
  | "output-unparseable"
  | "tool-stderr"
  | "candidates-capped"
  | "cwd-unavailable"
  | "identity-unavailable";

export interface NativeDiagnostic {
  readonly code: NativeDiagnosticCode;
  /** Bounded text. Never contains a process command line. */
  readonly message: string;
}

export interface NativeScan {
  readonly capability: DevServerCapability;
  /** Completeness of the listener enumeration alone. */
  readonly completeness: ScanCompleteness;
  readonly listeners: readonly Listener[];
  /** Completeness of the cwd and identity reads; separate from `completeness`. */
  readonly metadata: ScanCompleteness;
  readonly cwds: ReadonlyMap<number, string>;
  readonly identities: ReadonlyMap<number, ProcessIdentity>;
  readonly diagnostics: readonly NativeDiagnostic[];
}

export type ExecOutcome =
  | {
      readonly kind: "exit";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: "overflow"; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export interface ExecLimits {
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
}

/** Injectable process runner; tests replace it, production uses `execNative`. */
export type ExecFn = (
  file: string,
  args: readonly string[],
  limits: ExecLimits,
) => Promise<ExecOutcome>;

export interface CollectOptions {
  readonly exec?: ExecFn;
  readonly platform?: string;
}

export function nativeCapability(platform: string = process.platform): DevServerCapability {
  return platform === SUPPORTED_PLATFORM
    ? { available: true }
    : { available: false, reason: "unsupported-platform", platform };
}

/** The part of `execFile`'s error this module reads. `code` is a string or an exit code. */
interface ExecErrorShape {
  readonly message: string;
  readonly code?: string | number;
  readonly killed?: boolean;
  readonly signal?: string | null;
}

/** Order matters: a cap breach also sets `killed`, and ENOENT has no exit code. */
function classifyExecError(error: ExecErrorShape, stdout: string, stderr: string): ExecOutcome {
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return { kind: "overflow", stdout, stderr };
  }
  if (error.code === "ENOENT") {
    return { kind: "missing" };
  }
  if (error.killed === true || (error.signal ?? null) !== null) {
    return { kind: "timeout" };
  }
  if (typeof error.code === "number") {
    return { kind: "exit", code: error.code, stdout, stderr };
  }
  return { kind: "error", message: error.message };
}

export const execNative: ExecFn = (file, args, limits) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        encoding: "utf8",
        timeout: limits.timeoutMs,
        maxBuffer: limits.maxBufferBytes,
        env: NATIVE_ENV,
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        resolve(
          error === null
            ? { kind: "exit", code: 0, stdout: out, stderr: err }
            : classifyExecError(error, out, err),
        );
      },
    );
  });

/* ----------------------------- parsing ----------------------------- */

const ENDPOINT_NAME = /^(\*|\[[^\]]+\]|[0-9.]+):(\d{1,5})$/;
const WILDCARD: Record<AddressFamily, string> = { IPv4: "0.0.0.0", IPv6: "::" };
const START_TIME = /^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/;

function parsePid(text: string): number | null {
  const pid = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** Parse an lsof `n` value such as `*:7000`, `127.0.0.1:5199` or `[::1]:65103`. */
export function parseEndpointName(
  name: string,
  family: AddressFamily,
): { readonly binding: Binding; readonly port: number } | null {
  const match = ENDPOINT_NAME.exec(name);
  if (match === null) {
    return null;
  }
  const port = Number(match[2]);
  if (port < MIN_PORT || port > MAX_PORT) {
    return null;
  }
  const raw = match[1];
  const address = raw === "*" ? WILDCARD[family] : raw.replace(/^\[|\]$/g, "");
  if (family === "IPv4" && address.includes(":")) {
    return null;
  }
  if (family === "IPv6" && !address.includes(":")) {
    return null;
  }
  return { binding: { family, address }, port };
}

export interface ParsedListeners {
  readonly listeners: readonly Listener[];
  /** Records that could not be understood; any non-zero value makes the scan partial. */
  readonly skipped: number;
}

/**
 * Parse `lsof -Fpftn` output. A truncated stream loses its trailing segment, which has
 * no newline and may be half a field, so that segment is dropped before parsing.
 */
export function parseListeners(stdout: string, truncated: boolean): ParsedListeners {
  const text = truncated ? stdout.slice(0, stdout.lastIndexOf("\n") + 1) : stdout;
  const found = new Map<string, Listener>();
  let skipped = 0;
  let pid: number | null = null;
  let family: AddressFamily | null = null;
  for (const line of text.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) {
      pid = parsePid(value);
      family = null;
      skipped += pid === null ? 1 : 0;
    } else if (line.startsWith("f")) {
      family = null;
    } else if (line.startsWith("t")) {
      family = value === "IPv4" || value === "IPv6" ? value : null;
    } else if (line.startsWith("n")) {
      const endpoint = family === null ? null : parseEndpointName(value, family);
      if (pid === null || endpoint === null) {
        skipped += 1;
        continue;
      }
      const listener: Listener = { pid, port: endpoint.port, binding: endpoint.binding };
      found.set(
        `${pid}|${listener.port}|${listener.binding.family}|${listener.binding.address}`,
        listener,
      );
    }
  }
  return { listeners: [...found.values()], skipped };
}

/** Parse `lsof -a -d cwd -Fn`: `p<pid>`, `fcwd`, `n<path>`; first path per pid wins. */
export function parseCwds(stdout: string, truncated: boolean): Map<number, string> {
  const text = truncated ? stdout.slice(0, stdout.lastIndexOf("\n") + 1) : stdout;
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = parsePid(line.slice(1));
    } else if (line.startsWith("n") && pid !== null && line.length > 1 && !cwds.has(pid)) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/** Parse `ps -o pid=,ppid=,lstart=`. Rows with an unrecognised start time are skipped. */
export function parseIdentities(stdout: string, truncated: boolean): Map<number, ProcessIdentity> {
  const text = truncated ? stdout.slice(0, stdout.lastIndexOf("\n") + 1) : stdout;
  const identities = new Map<number, ProcessIdentity>();
  for (const line of text.split("\n")) {
    const match = PS_LINE.exec(line);
    if (match === null || !START_TIME.test(match[3])) {
      continue;
    }
    const pid = parsePid(match[1]);
    if (pid !== null) {
      identities.set(pid, { pid, ppid: Number(match[2]), startTime: match[3].replace(/ +/g, " ") });
    }
  }
  return identities;
}

/* ------------------------- listener collection ------------------------- */

interface ListenerRead {
  readonly completeness: ScanCompleteness;
  readonly listeners: readonly Listener[];
  readonly diagnostics: readonly NativeDiagnostic[];
}

const LISTENER_ARGS = ["-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpftn"] as const;

function failedRead(code: NativeDiagnosticCode, message: string): ListenerRead {
  return { completeness: "failed", listeners: [], diagnostics: [{ code, message }] };
}

function blank(text: string): boolean {
  return text.trim().length === 0;
}

/** Decide what a finished `lsof` listener run proves. See the file header for the rules. */
export function readListeners(outcome: ExecOutcome): ListenerRead {
  switch (outcome.kind) {
    case "missing":
      return failedRead("tool-missing", "lsof was not found");
    case "timeout":
      return failedRead("tool-timeout", "lsof timed out");
    case "error":
      return failedRead("tool-error", `lsof failed: ${outcome.message.slice(0, 120)}`);
    case "overflow":
      return fromOutput(outcome.stdout, true, "partial", [
        { code: "output-truncated", message: "lsof output exceeded the size cap" },
      ]);
    case "exit":
      return fromExit(outcome.code, outcome.stdout, outcome.stderr);
  }
}

function fromExit(code: number, stdout: string, stderr: string): ListenerRead {
  if (code !== 0 && code !== 1) {
    return failedRead("tool-error", `lsof exited with code ${code}`);
  }
  if (code === 1 && blank(stdout)) {
    return blank(stderr)
      ? { completeness: "complete", listeners: [], diagnostics: [] }
      : failedRead("tool-error", "lsof exited with code 1 and an error message");
  }
  const noisy = !blank(stderr) || code === 1;
  const note: NativeDiagnostic[] = noisy
    ? [{ code: "tool-stderr", message: "lsof reported a problem while listing sockets" }]
    : [];
  return fromOutput(stdout, false, noisy ? "partial" : "complete", note);
}

function fromOutput(
  stdout: string,
  truncated: boolean,
  base: ScanCompleteness,
  notes: readonly NativeDiagnostic[],
): ListenerRead {
  const { listeners, skipped } = parseListeners(stdout, truncated);
  const diagnostics = [...notes];
  if (skipped > 0) {
    diagnostics.push({
      code: "output-unparseable",
      message: `${skipped} lsof records were not understood`,
    });
  }
  if (listeners.length === 0 && (truncated || skipped > 0)) {
    return { completeness: "failed", listeners, diagnostics };
  }
  const completeness = base === "complete" && skipped > 0 ? "partial" : base;
  return { completeness, listeners, diagnostics };
}

/* ------------------------- metadata collection ------------------------- */

interface MetadataRead<T> {
  readonly values: Map<number, T>;
  /** Batches that ran to a usable result (exit 0 or 1, even with a cap breach). */
  readonly usable: number;
  readonly batches: number;
  readonly truncated: boolean;
}

function batchPids(pids: readonly number[]): number[][] {
  const batches: number[][] = [];
  for (let index = 0; index < pids.length; index += PID_BATCH_SIZE) {
    batches.push(pids.slice(index, index + PID_BATCH_SIZE));
  }
  return batches;
}

async function readInBatches<T>(
  exec: ExecFn,
  file: string,
  argsFor: (csv: string) => readonly string[],
  parse: (stdout: string, truncated: boolean) => Map<number, T>,
  pids: readonly number[],
): Promise<MetadataRead<T>> {
  const limits = { timeoutMs: NATIVE_TIMEOUT_MS, maxBufferBytes: METADATA_OUTPUT_CAP_BYTES };
  const batches = batchPids(pids);
  const values = new Map<number, T>();
  let usable = 0;
  let truncated = false;
  for (const batch of batches) {
    const outcome = await exec(file, argsFor(batch.join(",")), limits);
    const readable =
      outcome.kind === "overflow" ||
      (outcome.kind === "exit" && (outcome.code === 0 || outcome.code === 1));
    if (!readable) {
      continue;
    }
    usable += 1;
    truncated = truncated || outcome.kind === "overflow";
    for (const [pid, value] of parse(outcome.stdout, outcome.kind === "overflow")) {
      values.set(pid, value);
    }
  }
  return { values, usable, batches: batches.length, truncated };
}

function metadataCompleteness(
  reads: readonly MetadataRead<unknown>[],
  gaps: number,
): ScanCompleteness {
  const batches = reads.reduce((sum, read) => sum + read.batches, 0);
  const usable = reads.reduce((sum, read) => sum + read.usable, 0);
  if (batches > 0 && usable === 0) {
    return "failed";
  }
  const damaged = usable < batches || reads.some((read) => read.truncated);
  return damaged || gaps > 0 ? "partial" : "complete";
}

function metadataDiagnostics(
  cwdGaps: number,
  identityGaps: number,
  truncated: boolean,
): NativeDiagnostic[] {
  const notes: NativeDiagnostic[] = [];
  if (cwdGaps > 0) {
    notes.push({
      code: "cwd-unavailable",
      message: `${cwdGaps} listener processes had no readable working directory`,
    });
  }
  if (identityGaps > 0) {
    notes.push({
      code: "identity-unavailable",
      message: `${identityGaps} listener processes had no start time`,
    });
  }
  if (truncated) {
    notes.push({
      code: "output-truncated",
      message: "process metadata output exceeded the size cap",
    });
  }
  return notes;
}

function unavailableScan(capability: DevServerCapability): NativeScan {
  return {
    capability,
    completeness: "failed",
    listeners: [],
    metadata: "failed",
    cwds: new Map(),
    identities: new Map(),
    diagnostics: [
      {
        code: "unsupported-platform",
        message: "Dev server discovery is not available on this platform",
      },
    ],
  };
}

/**
 * One native collection: listeners first, then cwd and identity for the listener pids
 * only. Never rejects; every failure is a typed completeness plus a diagnostic.
 * Non-macOS platforms return an `unavailable` scan without running anything.
 */
export async function collectNative(options: CollectOptions = {}): Promise<NativeScan> {
  const capability = nativeCapability(options.platform);
  if (!capability.available) {
    return unavailableScan(capability);
  }
  const exec = options.exec ?? execNative;
  const outcome = await exec(LSOF_PATH, LISTENER_ARGS, {
    timeoutMs: NATIVE_TIMEOUT_MS,
    maxBufferBytes: LISTENER_OUTPUT_CAP_BYTES,
  });
  const read = readListeners(outcome);
  const allPids = [...new Set(read.listeners.map((listener) => listener.pid))].sort(
    (a, b) => a - b,
  );
  const pids = allPids.slice(0, MAX_CANDIDATE_PIDS);
  const diagnostics = [...read.diagnostics];
  if (pids.length < allPids.length) {
    diagnostics.push({
      code: "candidates-capped",
      message: `${allPids.length - pids.length} listener processes were not inspected`,
    });
  }
  const cwd = await readInBatches(
    exec,
    LSOF_PATH,
    (csv) => ["-w", "-nP", "-a", "-d", "cwd", "-p", csv, "-Fn"],
    parseCwds,
    pids,
  );
  const identity = await readInBatches(
    exec,
    PS_PATH,
    (csv) => ["-o", "pid=,ppid=,lstart=", "-p", csv],
    parseIdentities,
    pids,
  );
  const cwdGaps = pids.filter((pid) => !cwd.values.has(pid)).length;
  const identityGaps = pids.filter((pid) => !identity.values.has(pid)).length;
  const gaps = cwdGaps + identityGaps + (allPids.length - pids.length);
  diagnostics.push(
    ...metadataDiagnostics(cwdGaps, identityGaps, cwd.truncated || identity.truncated),
  );
  return {
    capability,
    completeness: read.completeness,
    listeners: read.listeners,
    metadata: metadataCompleteness([cwd, identity], gaps),
    cwds: cwd.values,
    identities: identity.values,
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
  };
}
