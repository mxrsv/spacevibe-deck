import { requestBody } from "@/session/chunked";
import type { DesktopConnection } from "@/session/connection";
import { parseUsage, type UsageView } from "./usage-format";
import { RpcError } from "@/session/rpc";

/** A sentence for a failed read, for the screen that tried it. */
export function readErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    switch (error.code) {
      case "outside-root":
        return "That folder is not one of Deck's projects.";
      case "not-found":
        return "It no longer exists on the desktop, or this is not a git repository.";
      case "too-large":
        return "That is too large to show on a phone.";
      case "timeout":
      case "not-connected":
      case "closed":
        return "Not connected to this desktop. Pull down to try again.";
      case "unavailable":
        return "Deck could not read that right now. Pull down to try again.";
      default:
        return "Deck could not read that. Pull down to try again.";
    }
  }
  return "Deck could not read that. Pull down to try again.";
}

export async function listFiles(connection: DesktopConnection, root: string, path: string) {
  return (await connection.rpc.request("files.list", { root, path })).entries;
}

export interface FileBody {
  readonly text: string;
  readonly truncated: boolean;
  readonly binary: boolean;
}

/** `files.read`; a body past one message arrives as `chunk` events after the answer. */
export async function readFile(
  connection: DesktopConnection,
  root: string,
  path: string,
): Promise<FileBody> {
  const { answer, text } = await requestBody(
    connection,
    () => connection.rpc.request("files.read", { root, path }),
    (a) => ("text" in a ? { text: a.text } : { chunked: a.chunked }),
  );
  return { text, truncated: answer.truncated, binary: answer.binary };
}

export async function listChanges(connection: DesktopConnection, root: string) {
  return (await connection.rpc.request("changes.list", { root })).changes;
}

export async function readDiff(
  connection: DesktopConnection,
  root: string,
  path: string,
): Promise<string> {
  const { text } = await requestBody(
    connection,
    () => connection.rpc.request("changes.diff", { root, path }),
    (a) => ("diff" in a ? { text: a.diff } : { chunked: a.chunked }),
  );
  return text;
}

export async function getUsage(connection: DesktopConnection): Promise<UsageView> {
  const { usage } = await connection.rpc.request("usage.get", {});
  const view = parseUsage(usage);
  if (view === null)
    throw new RpcError("bad-response", "The desktop sent usage numbers this app cannot read.");
  return view;
}
