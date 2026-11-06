/**
 * Keep the Mac from sleeping while an agent works and a phone could be watching it (MOB12). The
 * policy is one pure line (`working panes > 0 && paired phones > 0`); the controller applies it
 * to an injected `powerSaveBlocker`, re-evaluated whenever a pane report or a pairing change
 * could move it, and released on quit. `prevent-app-suspension` keeps the system awake but lets
 * the display sleep, which is all a background agent needs.
 */
export interface PowerBlocker {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
}

export function shouldKeepAwake(workingPanes: number, pairedPhones: number): boolean {
  return workingPanes > 0 && pairedPhones > 0;
}

export interface KeepAwake {
  /** Re-reads the counts and starts or stops the blocker to match. */
  evaluate(): void;
  /** Always stops the blocker (quit, or the feature switched off). */
  release(): void;
  readonly active: boolean;
}

export function createKeepAwake(deps: {
  readonly blocker: PowerBlocker;
  readonly workingPanes: () => number;
  readonly pairedPhones: () => number;
}): KeepAwake {
  let blockerId: number | null = null;

  function release(): void {
    if (blockerId === null) return;
    const id = blockerId;
    blockerId = null;
    deps.blocker.stop(id);
  }

  return {
    evaluate() {
      const want = shouldKeepAwake(deps.workingPanes(), deps.pairedPhones());
      if (want && blockerId === null) blockerId = deps.blocker.start("prevent-app-suspension");
      else if (!want) release();
    },
    release,
    get active() {
      return blockerId !== null;
    },
  };
}
