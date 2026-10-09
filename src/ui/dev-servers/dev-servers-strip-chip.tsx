import { useEffect, useRef } from "preact/hooks";
import type { OpenBrowserAtResult } from "../../browser/browser-store";
import {
  devServerStore,
  type DevServerObserver,
  type DevServerStore,
} from "../../dev-servers/dev-server-store";
import { openUrl, writeText } from "../../host/shell-host";
import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import type { DevServerActionDeps } from "./dev-server-actions";
import { devServerRoots, subjectFor } from "./dev-server-scope";
import { DevServersChip } from "./dev-servers-chip";

/**
 * The dev servers chip as the strip mounts it: observation for the window's
 * life, projected from the same stores the rail reads.
 *
 * The chip needs a live count, so this starts observing when it mounts rather
 * than when the popover opens, and stops when it unmounts. The roots are the
 * open tabs' workspaces, the worktrees of their scanned repositories and the
 * retained recents (`devServerRoots`) — nothing new is catalogued here — and
 * are re-registered only when that set actually changes: `tabViews` republishes on the process poll, and every re-registration
 * queues a snapshot read.
 */

export interface DevServersStripChipProps {
  /**
   * Navigate the Deck browser to a URL the core vouched for. `App` supplies it
   * because only `App` can take the stage from the other surfaces.
   */
  openInDeck(url: string): Promise<OpenBrowserAtResult>;
  readonly store?: DevServerStore;
  /** External open and clipboard; the shell host by default, injectable for tests. */
  readonly shell?: Pick<DevServerActionDeps, "copy"> & { openUrl(url: string): Promise<void> };
}

const SHELL = { openUrl, copy: writeText };

export function DevServersStripChip({
  openInDeck,
  store = devServerStore,
  shell = SHELL,
}: DevServersStripChipProps) {
  const roots = devServerRoots(
    tabViews.value.map((tab) => tab.workspacePath),
    workspacesData.value.recents.map((recent) => recent.path),
    repositoryScans.value,
  );
  const key = JSON.stringify(roots);
  const rootsRef = useRef(roots);
  rootsRef.current = roots;
  const observer = useRef<DevServerObserver | null>(null);
  const registered = useRef<string | null>(null);

  useEffect(() => {
    const started = store.start(rootsRef.current);
    observer.current = started;
    registered.current = JSON.stringify(rootsRef.current);
    return () => {
      observer.current = null;
      void started.stop();
    };
  }, [store]);

  useEffect(() => {
    if (observer.current !== null && registered.current !== key) {
      registered.current = key;
      void observer.current.updateRoots(rootsRef.current);
    }
  }, [key]);

  const snapshot = store.snapshot.value;
  const subject = subjectFor(
    tabViews.value[activeTabIndex.value]?.workspacePath ?? null,
    repositoryScans.value,
  );
  const deps: DevServerActionDeps = {
    resolve: (id, token) => store.resolve(id, token),
    openInDeck,
    openExternal: shell.openUrl,
    copy: shell.copy,
  };

  return (
    <DevServersChip
      capability={store.capability.value}
      snapshot={snapshot}
      failed={store.error.value !== null || snapshot?.completeness === "failed"}
      subject={subject}
      scans={repositoryScans.value}
      deps={deps}
      onRetry={() => void observer.current?.refresh()}
    />
  );
}
