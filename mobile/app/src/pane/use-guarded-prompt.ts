import { useEffect, useState } from "react";
import type { TreePane } from "@protocol/tree";
import { useConnectionSnapshot } from "@/app-state/app-provider";
import { sendErrorText, sendReply } from "@/home/send-to-pane";
import type { DesktopConnection } from "@/session/connection";
import {
  GUARD_READ_LINES,
  GUARD_START,
  guardReduce,
  READY_TIMEOUT_MS,
  takePendingPrompt,
  type GuardEvent,
  type GuardState,
} from "@/newagent/guarded-prompt";

/**
 * Drives the guarded first prompt for a pane the New agent sheet just opened: wait for idle, read
 * the screen, send only when nothing is being asked, else hold it for the composer.
 */
export function useGuardedPrompt(
  connection: DesktopConnection,
  desktopId: string,
  paneId: number,
  pane: TreePane | null,
): { readonly prompt: string | null; readonly state: GuardState } {
  // Taken once at mount: a second visit to the same pane has no prompt to send.
  const [prompt] = useState(() => takePendingPrompt(desktopId, paneId));
  const [state, setState] = useState<GuardState>(GUARD_START);
  const online = useConnectionSnapshot(connection).status === "online";

  // The tree is an input like any other event; applied while rendering so no extra render pass is needed.
  const next = prompt === null ? state : guardReduce(state, { t: "tree", pane });
  if (next !== state) setState(next);

  const apply = (event: GuardEvent): void => setState((s) => guardReduce(s, event));

  useEffect(() => {
    if (prompt === null) return;
    const timer = setTimeout(
      () => setState((s) => guardReduce(s, { t: "timeout" })),
      READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [prompt]);

  useEffect(() => {
    if (prompt === null || !online || state.phase !== "reading") return;
    let cancelled = false;
    connection.rpc
      .request("pane.read", { paneId, lines: GUARD_READ_LINES })
      .then((result) => {
        if (cancelled) return;
        apply("text" in result ? { t: "screen", text: result.text } : { t: "screen-failed" });
      })
      .catch(() => {
        if (!cancelled) apply({ t: "screen-failed" });
      });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- runs when the phase becomes "reading"; `apply` only calls setState
  }, [prompt, online, state.phase, connection, paneId]);

  useEffect(() => {
    if (prompt === null || !online || state.phase !== "sending") return;
    let cancelled = false;
    sendReply(connection, paneId, prompt).then(
      () => !cancelled && apply({ t: "sent", outcome: "sent" }),
      (error: unknown) => !cancelled && apply({ t: "send-failed", message: sendErrorText(error) }),
    );
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- runs when the phase becomes "sending"; `apply` only calls setState
  }, [prompt, online, state.phase, connection, paneId]);

  return { prompt, state };
}
