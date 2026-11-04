import { useEffect, useState } from "react";
import type { TreePane } from "@protocol/tree";
import { parseChoices, type Choice } from "@/choices/parse-choices";
import { useConnectionSnapshot } from "@/app-state/app-provider";
import type { DesktopConnection } from "@/session/connection";
import { paneSignature } from "./needs-you";

/** Screen rows read to look for an option list. */
export const CHOICE_READ_LINES = 40;

/**
 * The numbered options a pane's screen ends in, read with `pane.read` and refreshed whenever the
 * tree reports a change for that pane. Panes that are not on screen are never read.
 */
export function usePaneChoices(
  connection: DesktopConnection,
  pane: TreePane | null,
): readonly Choice[] | null {
  const online = useConnectionSnapshot(connection).status === "online";
  const [choices, setChoices] = useState<readonly Choice[] | null>(null);
  const paneId = pane?.paneId ?? null;
  const signature = pane === null ? "" : paneSignature(pane);

  useEffect(() => {
    if (!online || paneId === null) return;
    let cancelled = false;
    connection.rpc
      .request("pane.read", { paneId, lines: CHOICE_READ_LINES })
      .then((result) => {
        if (cancelled) return;
        // A chunked answer is not a 40-line screen; treat it as having no list.
        setChoices("text" in result ? parseChoices(result.text) : null);
      })
      .catch(() => {
        if (!cancelled) setChoices(null);
      });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `signature` is the cue to read the screen again, not a value the effect reads
  }, [connection, online, paneId, signature]);

  return online ? choices : null;
}
