/** Temporary feature gates only. Safety/consent/retirement controls stay separate. */
export interface ReleaseSwitchDefinition {
  readonly enabled: boolean;
  readonly createdOn: string;
  /** First stable publication with enabled=true, not the local activation date. */
  readonly enabledOn?: string;
}

export type ReleaseSwitchDefinitions = Readonly<Record<string, ReleaseSwitchDefinition>>;
export type ReleaseSwitchSnapshot = Readonly<Record<string, boolean>>;

// Add each feature here with an explicit boolean type and YYYY-MM-DD creation date.
// No placeholder production feature: fixtures exercise the contract in both states.
export const RELEASE_SWITCHES = Object.freeze({
  // The project-first rail (spec LAY-1..LAY-4): replaces the cluster list inside `AgentRail`.
  projectRail: { enabled: false, createdOn: "2026-10-24" },
  /** Command Settings replaces the Settings screen (shell rebuild, Settings track C1c). */
  commandSettings: { enabled: false, createdOn: "2026-10-24" },
  /** The stacked-section agent dock replaces the tabbed dock column (shell rebuild, Overview track A1). */
  agentDock: { enabled: false, createdOn: "2026-10-24" },
  /** The flush stage replaces the card panes: breadcrumb bar, pane identity header (LAY-5, LAY-10). */
  shellStage: { enabled: false, createdOn: "2026-10-25" },
} satisfies ReleaseSwitchDefinitions);
export type ReleaseSwitchId = keyof typeof RELEASE_SWITCHES;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
export const RELEASE_SWITCH_RETENTION_DAYS = 14;

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATE.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function resolveReleaseSwitches(
  isDevelopment: boolean,
  definitions: ReleaseSwitchDefinitions = RELEASE_SWITCHES,
): ReleaseSwitchSnapshot {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([id, definition]) => {
        if (
          !/^[a-z][a-zA-Z0-9]*$/.test(id) ||
          typeof definition.enabled !== "boolean" ||
          !validDate(definition.createdOn) ||
          (definition.enabledOn !== undefined &&
            (!validDate(definition.enabledOn) ||
              definition.enabledOn < definition.createdOn ||
              !definition.enabled))
        ) {
          throw new Error(`Invalid release switch definition: ${id}`);
        }
        return [id, isDevelopment === true ? true : definition.enabled];
      }),
    ),
  );
}

/** Unknown keys are disabled even in development. */
export function isReleaseSwitchEnabled(id: string, snapshot: ReleaseSwitchSnapshot): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot, id) && snapshot[id] === true;
}

export function requireReleaseSwitch(id: string, snapshot: ReleaseSwitchSnapshot): void {
  if (!isReleaseSwitchEnabled(id, snapshot))
    throw new Error(`Feature is not available in this release: ${id}`);
}

/** A rollback clears enabledOn; a later publication starts the clock again. */
export function releaseSwitchCleanupDue(
  definition: ReleaseSwitchDefinition,
  today: string,
): boolean {
  resolveReleaseSwitches(false, { feature: definition });
  if (!validDate(today)) throw new Error("Cleanup date must be YYYY-MM-DD");
  return (
    definition.enabled &&
    definition.enabledOn !== undefined &&
    Date.parse(today) - Date.parse(definition.enabledOn) >= RELEASE_SWITCH_RETENTION_DAYS * DAY_MS
  );
}
