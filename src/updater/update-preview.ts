import type { UpdatePhase, UpdateView } from "./update-controller";

const PREVIEW_PHASES = new Set<UpdatePhase>([
  "available",
  "downloading",
  "downloaded",
  "download-failed",
]);

export interface UpdatePreview extends UpdateView {
  readonly sidebar: boolean;
}

export function resolveUpdatePreview(
  search: string,
  development: boolean,
): UpdatePreview | null {
  if (!development) {
    return null;
  }
  const params = new URLSearchParams(search);
  const phase = params.get("update-preview") as UpdatePhase | null;
  const layout = params.get("layout") ?? "top";
  if (
    phase === null ||
    !PREVIEW_PHASES.has(phase) ||
    (layout !== "top" && layout !== "sidebar")
  ) {
    return null;
  }
  return Object.freeze({
    phase,
    currentVersion: "0.9.0",
    availableVersion: "0.10.0",
    notes: "Updater preview fixture. No download or installation will run.",
    sidebar: layout === "sidebar",
  });
}
