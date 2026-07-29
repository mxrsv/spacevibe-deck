import { invoke } from "@tauri-apps/api/core";

export type DesktopPlatform = "macos" | "windows" | "unsupported";

export interface DesktopEnvironment {
  readonly platform: DesktopPlatform;
  readonly homeDir: string;
}

type ModifierEvent = Readonly<Pick<KeyboardEvent, "metaKey" | "ctrlKey">>;
type EnvironmentLoader = () => Promise<unknown>;
type DiagnosticWriter = (message: string, error: unknown) => void;

const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set([
  "macos",
  "windows",
  "unsupported",
]);
const MACOS_ABSOLUTE_PATH = /^\//;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;
const FALLBACK_ENVIRONMENT: DesktopEnvironment = Object.freeze({
  platform: "unsupported",
  homeDir: "",
});

let initializedEnvironment: DesktopEnvironment | null = null;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function hasAbsoluteHome(
  platform: DesktopPlatform,
  homeDir: string,
): boolean {
  if (platform === "macos") {
    return MACOS_ABSOLUTE_PATH.test(homeDir);
  }
  if (platform === "windows") {
    return WINDOWS_ABSOLUTE_PATH.test(homeDir);
  }
  return homeDir === "";
}

export function parseDesktopEnvironment(
  value: unknown,
): DesktopEnvironment {
  if (!isRecord(value) || !SUPPORTED_PLATFORMS.has(String(value.platform))) {
    throw new Error("Desktop environment has an invalid platform");
  }
  if (typeof value.homeDir !== "string") {
    throw new Error("Desktop environment homeDir must be a string");
  }
  const platform = value.platform as DesktopPlatform;
  if (!hasAbsoluteHome(platform, value.homeDir)) {
    const requirement =
      platform === "unsupported"
        ? "must be empty"
        : "must be an absolute path";
    throw new Error(`Desktop environment homeDir ${requirement}`);
  }
  return Object.freeze({ platform, homeDir: value.homeDir });
}

export function initializeDesktopEnvironment(
  value: unknown,
): DesktopEnvironment {
  if (initializedEnvironment !== null) {
    throw new Error("Desktop environment is already initialized");
  }
  const environment = parseDesktopEnvironment(value);
  initializedEnvironment = environment;
  return environment;
}

export function getDesktopEnvironment(): DesktopEnvironment {
  return initializedEnvironment ?? FALLBACK_ENVIRONMENT;
}

export async function initializeDesktopEnvironmentFromBackend(
  load: EnvironmentLoader = () => invoke("desktop_environment"),
  writeDiagnostic: DiagnosticWriter = (message, error) =>
    console.warn(message, error),
): Promise<DesktopEnvironment> {
  try {
    return initializeDesktopEnvironment(await load());
  } catch (error) {
    writeDiagnostic(
      "desktop_environment failed; using unsupported platform:",
      error,
    );
    return initializeDesktopEnvironment(FALLBACK_ENVIRONMENT);
  }
}

export function hasPrimaryModifier(event: ModifierEvent): boolean {
  const { platform } = getDesktopEnvironment();
  if (platform === "macos") {
    return event.metaKey;
  }
  if (platform === "windows") {
    return event.ctrlKey;
  }
  return false;
}

/** Test-only reset for exercising the one-time initialization boundary. */
export function resetDesktopEnvironmentForTests(): void {
  initializedEnvironment = null;
}
