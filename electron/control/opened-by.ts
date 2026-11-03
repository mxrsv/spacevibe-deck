/**
 * Which pane opened which: the scope table behind `send`, `read`, `wait` and `close`
 * (spec 2026-11-03-agent-orchestration, ORC6-7).
 *
 * A coordinator may act on the panes it opened through `deck pane open`, and read or wait on
 * itself. Nothing else: a worker must not type into the user's pane, and no pane may close or
 * type into itself. The record is plain data in main and dies with either pane.
 */

/** The commands that take a target pane and are scoped by this table. */
const SCOPED_COMMANDS = ["read", "wait", "send", "close"] as const;
export type ScopedCommand = (typeof SCOPED_COMMANDS)[number];

/** The commands that may also target the caller's own pane. */
const SELF_COMMANDS: readonly string[] = ["read", "wait"];

export interface OpenedBy {
  /** Remember that `openerPaneId` opened `childPaneId`. A pane never opens itself. */
  record(childPaneId: number, openerPaneId: number): void;
  /** Drop every record the pane appears in, as child or as opener. */
  forget(paneId: number): void;
  /** Whether `callerPaneId` opened `targetPaneId`. */
  openedBy(callerPaneId: number, targetPaneId: number): boolean;
  /** Whether the caller may run `command` on the target; false for any command not scoped here. */
  mayAct(callerPaneId: number, targetPaneId: number, command: string): boolean;
}

export function createOpenedBy(): OpenedBy {
  const openerOf = new Map<number, number>();
  const openedBy = (callerPaneId: number, targetPaneId: number): boolean =>
    openerOf.get(targetPaneId) === callerPaneId;
  return {
    record(childPaneId, openerPaneId) {
      if (childPaneId !== openerPaneId) openerOf.set(childPaneId, openerPaneId);
    },
    forget(paneId) {
      openerOf.delete(paneId);
      for (const [child, opener] of openerOf) {
        if (opener === paneId) openerOf.delete(child);
      }
    },
    openedBy,
    mayAct(callerPaneId, targetPaneId, command) {
      if (!(SCOPED_COMMANDS as readonly string[]).includes(command)) return false;
      if (callerPaneId === targetPaneId) return SELF_COMMANDS.includes(command);
      return openedBy(callerPaneId, targetPaneId);
    },
  };
}
