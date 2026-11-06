import type { ConnectionSnapshot } from "@/session/connection";
import type { DesktopOs, PairingSummary } from "@/pairing/pairing-store";
import type { DotKind } from "@/ui/status-dot";

const OS_LABEL: Record<DesktopOs, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  unknown: "Computer",
};

export function osLabel(os: DesktopOs): string {
  return OS_LABEL[os];
}

/** The SF Symbol for a desktop: the mock draws a laptop for a Mac and a monitor for the rest. */
export function osSymbol(os: DesktopOs): "laptopcomputer" | "desktopcomputer" {
  return os === "macos" ? "laptopcomputer" : "desktopcomputer";
}

/** "5 min ago", "2 h ago", "3 d ago": the coarse age a last-seen label needs. */
export function formatAge(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function pathLabel(path: ConnectionSnapshot["path"]): string {
  return path === "lan" ? "Same Wi-Fi" : "Relay";
}

export interface StatusLine {
  readonly dot: DotKind;
  /** The second line of a desktop row. */
  readonly text: string;
  /** True when the desktop cannot be used until the user acts (MOB10, MOB2). */
  readonly blocked: boolean;
}

/** What a desktop row says about its connection (MOB2, MOB10, MOB11). */
export function statusLine(
  summary: PairingSummary,
  snapshot: ConnectionSnapshot,
  now: number,
): StatusLine {
  const os = osLabel(summary.os);
  const name = summary.desktopName;
  switch (snapshot.status) {
    case "online":
      return { dot: "online", text: `${os} · ${pathLabel(snapshot.path)}`, blocked: false };
    case "offline":
      return {
        dot: "offline",
        text:
          snapshot.lastSeen === null
            ? `${os} · offline`
            : `${os} · offline · seen ${formatAge(snapshot.lastSeen, now)}`,
        blocked: false,
      };
    case "blocked":
      return {
        dot: "problem",
        text:
          snapshot.block === "update-phone"
            ? "Update this app from TestFlight or the App Store"
            : `Update Deck on ${name}`,
        blocked: true,
      };
    case "revoked":
      return {
        dot: "problem",
        text: `${name} removed this phone. Forget it, then pair again.`,
        blocked: true,
      };
    case "failed":
      return { dot: "problem", text: snapshot.problem ?? `${os} · can't connect`, blocked: false };
    case "connecting":
      return { dot: "offline", text: `${os} · connecting`, blocked: false };
  }
}
