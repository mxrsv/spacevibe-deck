/**
 * What the dev servers chip and popover print: the core's snapshot, narrowed to
 * the scope the user is looking at and put into words. Pure — no signals, no
 * clock (`now` is injected), nothing host-shaped.
 *
 * The core attributes each row to ONE of the roots this window registered and
 * says nothing about frameworks, who started the server or which terminal owns
 * it, so none of that is invented here: a row is named by its endpoint, and the
 * project and branch beside it come from the repository scans the rail already
 * holds.
 */
import type {
  DevServerLiveness,
  DevServerRow,
  DevServerSnapshot,
} from "../../dev-servers/dev-server-types";
import { normalizeWorkspacePath, workspaceLabel } from "../../lib/workspace-label";
import { formatRelativeTime } from "../../lib/workspace-recents";
import {
  inScope,
  scanOwning,
  type DevServerScope,
  type DevServerSubject,
  type ScanMap,
} from "./dev-server-scope";

const STATE_WORD: Readonly<Record<DevServerLiveness, string>> = {
  running: "Running",
  stopped: "Stopped",
  unknown: "Unknown",
};

const STATE_RANK: Readonly<Record<DevServerLiveness, number>> = {
  running: 0,
  unknown: 1,
  stopped: 2,
};

export interface ProtocolToken {
  readonly text: string;
  readonly tone: "ok" | "faint";
}

export interface DevServerItem {
  readonly id: string;
  readonly instanceToken: string;
  /** `127.0.0.1:5173` — the endpoint, which is all the core knows to call it. */
  readonly title: string;
  /** Project and branch, left out where the scope row already says it. */
  readonly detail: string | null;
  readonly state: DevServerLiveness;
  readonly stateWord: string;
  /** The web address, or null when the protocol is not identified as HTTP(S). */
  readonly url: string | null;
  /** What Copy puts on the clipboard when there is no URL. */
  readonly address: string;
  /** HTTP/TLS/protocol evidence; separate from the state, never replaces it. */
  readonly protocol: ProtocolToken | null;
  readonly age: string | null;
  /** Why the two open actions cannot run right now, else null. */
  readonly openReason: string | null;
}

function hostLiteral(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

/** Host and port from the URL the core handed over, else from its first binding. */
function endpointOf(row: DevServerRow): string {
  if (row.url !== null) {
    try {
      return new URL(row.url).host;
    } catch {
      // the facade only passes http(s) URLs; fall back to the bindings below
    }
  }
  const first = row.bindings[0];
  return first === undefined ? `:${row.port}` : `${hostLiteral(first.address)}:${row.port}`;
}

const IDENTIFICATION_WORDS: Readonly<Record<string, string>> = {
  "not-http": "Not an HTTP server",
  timeout: "No answer in time",
  "connection-failed": "Could not connect",
  "non-loopback": "Not on this computer",
  "headers-too-large": "Reply not recognised",
};

/** The probe's short error code in words; an unknown code reads as "not identified". */
export function identificationText(error: string | null): string {
  if (error !== null && error.startsWith("tls:")) {
    return "Certificate not trusted";
  }
  return (
    (error !== null ? IDENTIFICATION_WORDS[error] : undefined) ?? "Not identified as a web server"
  );
}

function protocolToken(row: DevServerRow): ProtocolToken | null {
  if (row.liveness === "stopped") {
    return null; // evidence about a process that is gone
  }
  if (row.protocol === "unknown") {
    return { text: identificationText(row.identificationError), tone: "faint" };
  }
  return { text: row.protocol.toUpperCase(), tone: "ok" };
}

function ageText(row: DevServerRow, now: number): string | null {
  if (row.liveness === "stopped" && row.stoppedAt !== null) {
    return `stopped ${formatRelativeTime(row.stoppedAt, now).toLowerCase()}`;
  }
  if (row.liveness === "unknown") {
    return `last seen ${formatRelativeTime(row.observedAt, now).toLowerCase()}`;
  }
  return null;
}

function openReason(row: DevServerRow): string | null {
  if (row.liveness === "stopped") {
    return "Not running";
  }
  if (row.liveness === "unknown") {
    return "Can’t confirm it is still running";
  }
  return row.url === null ? identificationText(row.identificationError) : null;
}

function detailFor(row: DevServerRow, scope: DevServerScope, scans: ScanMap): string | null {
  if (scope === "worktree") {
    return null; // "a row's detail never restates the scope the surface states once" (DL-13.8)
  }
  const root = normalizeWorkspacePath(row.displayRoot) ?? row.displayRoot;
  const scan = scanOwning(row, root, scans);
  const canonical = normalizeWorkspacePath(row.workspacePath);
  const entry = scan?.worktrees.find((item) => {
    const path = normalizeWorkspacePath(item.path);
    return path === root || path === canonical;
  });
  // The project is the primary checkout, as the rail names it; `scan.root` is only the
  // folder the scan ran in (same rule as `subjectFor`).
  const primary = scan?.worktrees.find((item) => !item.bare);
  const name = workspaceLabel(scan === null ? root : (primary?.path ?? scan.root));
  return entry?.branch ? `${name} · ${entry.branch}` : name;
}

function itemFor(
  row: DevServerRow,
  scope: DevServerScope,
  scans: ScanMap,
  now: number,
): DevServerItem {
  const title = endpointOf(row);
  return {
    id: row.id,
    instanceToken: row.instanceToken,
    title,
    detail: detailFor(row, scope, scans),
    state: row.liveness,
    stateWord: STATE_WORD[row.liveness],
    url: row.url,
    address: title,
    protocol: protocolToken(row),
    age: ageText(row, now),
    openReason: openReason(row),
  };
}

export interface DevServerView {
  readonly items: readonly DevServerItem[];
  /** Rows the core reported that this scope leaves out. */
  readonly hiddenElsewhere: number;
  readonly running: number;
  readonly unknown: number;
}

export function buildView(
  snapshot: DevServerSnapshot | null,
  scope: DevServerScope,
  subject: DevServerSubject,
  scans: ScanMap,
  now: number,
): DevServerView {
  const rows = snapshot?.rows ?? [];
  const shown = rows
    .filter((row) => inScope(row, scope, subject, scans))
    .sort(
      (a, b) =>
        STATE_RANK[a.liveness] - STATE_RANK[b.liveness] ||
        a.displayRoot.localeCompare(b.displayRoot) ||
        a.port - b.port,
    );
  return {
    items: shown.map((row) => itemFor(row, scope, scans, now)),
    hiddenElsewhere: rows.length - shown.length,
    running: shown.filter((row) => row.liveness === "running").length,
    unknown: shown.filter((row) => row.liveness === "unknown").length,
  };
}

/** The chip's whole reading: running servers in the active checkout, and trust in it. */
export function chipSummary(
  snapshot: DevServerSnapshot | null,
  failed: boolean,
  subject: DevServerSubject,
  scans: ScanMap,
): { readonly running: number; readonly scanFailed: boolean } {
  const view = buildView(snapshot, "worktree", subject, scans, 0);
  const scanFailed = failed || snapshot?.completeness === "failed";
  return { running: view.running, scanFailed };
}

/** `Scanned just now · 2 running`, counted over what is listed. */
export function scanLine(
  snapshot: DevServerSnapshot | null,
  view: DevServerView,
  now: number,
): string {
  if (snapshot === null || snapshot.observedAt === null || snapshot.completeness === "pending") {
    return "Scanning for listening servers…";
  }
  const when = formatRelativeTime(snapshot.observedAt, now);
  const counts = [`${view.running} running`];
  if (view.unknown > 0) {
    counts.push(`${view.unknown} unknown`);
  }
  const partial = snapshot.completeness === "partial" ? " · partial scan" : "";
  const label = when === "just now" ? "Scanned just now" : `Scanned ${when.toLowerCase()}`;
  return `${label} · ${counts.join(" · ")}${partial}`;
}
