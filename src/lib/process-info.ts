export type PaneProcessKind = "idle-shell" | "agent" | "busy" | "unknown";
/** Built-ins use stable ids; declared agents use their validated display label. */
export type PaneAgent = string;

/** Mirror of the `PtyInfo` payload returned by the Rust `pty_info` command. */
export interface PaneProcessInfo {
  readonly id: number;
  readonly cwd: string | null;
  readonly process: string | null;
  readonly kind: PaneProcessKind;
  readonly agent: PaneAgent | null;
}

/** Display-ready strings for a pane header bar. */
export interface PaneHeaderInfo {
  readonly dotColor: string;
  readonly cwd: string;
  readonly badge: string;
  readonly agent: boolean;
}

const AGENT_DOT_VARS: Readonly<Record<string, string>> = {
  claude: "var(--magenta)",
  codex: "var(--green)",
  gemini: "var(--cyan)",
  opencode: "var(--yellow)",
  // Shares Gemini's cyan on purpose. The theme hands chrome eight colors;
  // four are taken, `--red` is error-only (DL-3.2) and `--accent` is the
  // theme's blue, reserved for interactive (DL-3.1) — so a fifth distinct
  // agent color does not exist without changing the token set. Google's two
  // CLIs sharing a hue is the honest reading, and the header names which one.
  agy: "var(--cyan)",
};

function agentColor(agent: string | null): string | undefined {
  if (
    agent === null ||
    !Object.prototype.hasOwnProperty.call(AGENT_DOT_VARS, agent)
  ) {
    return undefined;
  }
  return AGENT_DOT_VARS[agent];
}

/** Map an explicit agent display label to the tab-dot theme color. */
export function dotColor(label: string | null): string {
  return agentColor(label) ?? "var(--text-faint)";
}

function isWindowsAbsolute(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

function trimHomeSeparator(home: string, windows: boolean): string {
  if (home === "/" || (windows && /^[a-z]:[\\/]$/i.test(home))) {
    return home;
  }
  const separator = windows ? /[\\/]$/ : /\/$/;
  let end = home.length;
  while (end > 1 && separator.test(home.slice(0, end))) {
    end -= 1;
  }
  return home.slice(0, end);
}

/** Replace the home prefix with `~` for display. */
export function tildify(path: string, home: string): string {
  if (home === "") {
    return path;
  }
  const windows = isWindowsAbsolute(path) && isWindowsAbsolute(home);
  const root = trimHomeSeparator(home, windows);
  const comparablePath = windows
    ? path.replace(/\\/g, "/").toLowerCase()
    : path;
  const comparableRoot = windows
    ? root.replace(/\\/g, "/").toLowerCase()
    : root;
  if (comparablePath === comparableRoot) {
    return "~";
  }
  const prefix = comparableRoot.endsWith("/")
    ? comparableRoot
    : `${comparableRoot}/`;
  if (!comparablePath.startsWith(prefix)) {
    return path;
  }
  const suffixStart = comparableRoot.endsWith("/")
    ? root.length - 1
    : root.length;
  return `~${path.slice(suffixStart)}`;
}

function headerBadge(info: PaneProcessInfo): string {
  switch (info.kind) {
    case "agent":
      return info.agent ?? "unknown";
    case "idle-shell":
      return "shell";
    case "busy":
      return info.process ?? "busy";
    case "unknown":
      return "unknown";
  }
}

export function paneHeaderInfo(
  info: PaneProcessInfo,
  home: string,
): PaneHeaderInfo {
  const agent = info.kind === "agent" ? info.agent : null;
  return {
    dotColor: agentColor(agent) ?? "var(--text-faint)",
    cwd: info.cwd === null ? "" : tildify(info.cwd, home),
    badge: headerBadge(info),
    agent: agent !== null,
  };
}

export function explicitAgent(
  info: PaneProcessInfo | undefined,
): PaneAgent | null {
  if (info?.kind !== "agent" || info.agent === null) {
    return null;
  }
  const agent = info.agent.trim();
  return agent.length > 0 ? agent : null;
}

export function processLabel(info: PaneProcessInfo | undefined): string | null {
  return explicitAgent(info) ?? info?.process ?? null;
}
