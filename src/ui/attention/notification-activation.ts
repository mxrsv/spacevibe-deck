import { listenNotificationActivated } from "../../host/shell-host";
import { tabViews } from "../../terminal/tabs-store";

/** Route through App's rail preflight, including overlay dismissal and spaces. */
export function installNotificationActivation(
  focusPane: (tabIndex: number, paneId: number) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listenNotificationActivated((paneId) => {
    if (disposed) return;
    const index = tabViews
      .peek()
      .findIndex((tab) => (tab.panes ?? []).some((pane) => pane.paneId === paneId));
    if (index >= 0) focusPane(index, paneId);
  }).then(
    (stop) => {
      if (disposed) stop();
      else unlisten = stop;
    },
    (error: unknown) => console.warn("Could not listen for notification activation:", error),
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}
