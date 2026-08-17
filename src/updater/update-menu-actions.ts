import type { UpdateCheckResult, UpdateController } from "./update-controller";

export const RELEASE_NOTES_URL =
  "https://deck.spacevibe.dev/landing-prototype/changelog/";

export type UpdateMenuAction = "check-for-updates" | "open-release-notes";

type MessageKind = "info" | "error";

interface UpdateMenuDependencies {
  readonly controller: Pick<UpdateController, "checkNow" | "view">;
  openUrl(url: string): Promise<void>;
  notify(message: string, kind: MessageKind): Promise<void>;
  report(message: string, error: unknown): void;
}

export function isUpdateMenuAction(value: unknown): value is UpdateMenuAction {
  return value === "check-for-updates" || value === "open-release-notes";
}

function checkResultMessage(
  result: UpdateCheckResult,
  availableVersion: string,
): readonly [message: string, kind: MessageKind] {
  if (result === "available") {
    return [
      availableVersion
        ? `SpaceVibe Deck ${availableVersion} is available. Use Update in the toolbar to download it.`
        : "A SpaceVibe Deck update is available. Use Update in the toolbar to download it.",
      "info",
    ];
  }
  if (result === "current") {
    return ["SpaceVibe Deck is up to date.", "info"];
  }
  if (result === "unsupported") {
    return ["Updates are unavailable in this build.", "info"];
  }
  return [
    "Couldn't check for updates. Check your connection and try again.",
    "error",
  ];
}

async function notifySafely(
  deps: UpdateMenuDependencies,
  message: string,
  kind: MessageKind,
): Promise<void> {
  try {
    await deps.notify(message, kind);
  } catch (error: unknown) {
    deps.report("Update menu notification failed", error);
  }
}

export async function runUpdateMenuAction(
  action: string,
  deps: UpdateMenuDependencies,
): Promise<boolean> {
  if (action === "check-for-updates") {
    const result = await deps.controller.checkNow();
    const [message, kind] = checkResultMessage(
      result,
      deps.controller.view.value.availableVersion,
    );
    await notifySafely(deps, message, kind);
    return true;
  }

  if (action === "open-release-notes") {
    try {
      await deps.openUrl(RELEASE_NOTES_URL);
    } catch (error: unknown) {
      deps.report("Opening release notes failed", error);
      await notifySafely(
        deps,
        "Couldn't open Release Notes in your browser.",
        "error",
      );
    }
    return true;
  }

  return false;
}
