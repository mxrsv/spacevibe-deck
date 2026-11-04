import { RpcError } from "@/session/rpc";
import type { DesktopConnection } from "@/session/connection";

/** A sentence for a failed send, for the card or composer that tried it. */
export function sendErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    switch (error.code) {
      case "no-target":
        return "That pane is gone.";
      case "not-an-agent-pane":
        return "That pane is not running an agent.";
      case "busy":
        return "The pane is busy. Try again.";
      case "timeout":
      case "not-connected":
      case "closed":
        return "Not connected to this desktop.";
      default:
        return error.message === "" ? "Deck could not do that." : error.message;
    }
  }
  return "Deck could not do that.";
}

/** MOB19: text goes to the pane and is submitted. */
export async function sendReply(
  connection: DesktopConnection,
  paneId: number,
  text: string,
): Promise<void> {
  await connection.rpc.request("pane.send", { paneId, text, submit: true });
}

/** Raw keystrokes (a digit for a choice, Esc). */
export async function sendKeys(
  connection: DesktopConnection,
  paneId: number,
  data: string,
): Promise<void> {
  await connection.rpc.request("pane.input", { paneId, data });
}
