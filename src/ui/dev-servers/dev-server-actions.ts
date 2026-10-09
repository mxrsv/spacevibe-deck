/**
 * The three things a dev server row can do, each gated the same way: the core
 * re-checks the selected instance immediately before a URL is acted on
 * (`resolve`), and the URL used is the one it returns, never the one the row
 * was drawn with. A refusal comes back as words, not as a silent no-op, so the
 * popover can show why nothing opened.
 *
 * This is a check made just before the action, not a guarantee: a process can
 * still change between the reply and the browser loading it (spec AC4).
 */
import type { DevServerResolveResult } from "../../dev-servers/dev-server-types";
import type { OpenBrowserAtResult } from "../../browser/browser-store";
import { identificationText, type DevServerItem } from "./dev-server-model";

export interface DevServerFeedback {
  readonly tone: "ok" | "error";
  readonly text: string;
}

export interface DevServerActionDeps {
  resolve(id: string, instanceToken: string): Promise<DevServerResolveResult>;
  openInDeck(url: string): Promise<OpenBrowserAtResult>;
  openExternal(url: string): Promise<void>;
  copy(text: string): Promise<void>;
}

export type DevServerAction = "open-deck" | "open-external" | "copy";

const error = (text: string): DevServerFeedback => ({ tone: "error", text });
const ok = (text: string): DevServerFeedback => ({ tone: "ok", text });

const UNAVAILABLE: Readonly<
  Record<Extract<DevServerResolveResult, { status: "unavailable" }>["reason"], string>
> = {
  "unsupported-platform": "dev server discovery is not available here.",
  "observation-stopped": "the list stopped updating. Reopen it and try again.",
  "not-running": "that server is not running any more.",
  "scan-incomplete": "the last scan could not confirm it is running.",
};

/** Why the core would not vouch for the instance, in the popover's words. */
export function refusalReason(item: DevServerItem, result: DevServerResolveResult): string | null {
  switch (result.status) {
    case "ready":
      return null;
    case "stale":
      return `${item.title} is no longer the server that was listed.`;
    case "unknown-protocol":
      return `${identificationText(result.error).toLowerCase()}.`;
    case "unavailable":
      return UNAVAILABLE[result.reason];
  }
}

async function verified(
  deps: DevServerActionDeps,
  item: DevServerItem,
  verb: "opened" | "copied",
): Promise<{ url: string } | { refusal: DevServerFeedback }> {
  let result: DevServerResolveResult;
  try {
    result = await deps.resolve(item.id, item.instanceToken);
  } catch {
    return { refusal: error(`Not ${verb} — could not check that server just now.`) };
  }
  const reason = refusalReason(item, result);
  return result.status === "ready" && reason === null
    ? { url: result.url }
    : { refusal: error(`Not ${verb} — ${reason ?? "the server could not be confirmed."}`) };
}

/** Run one row action; the returned feedback is what the status line shows. */
export async function runDevServerAction(
  action: DevServerAction,
  item: DevServerItem,
  deps: DevServerActionDeps,
): Promise<DevServerFeedback> {
  // A bare address carries no URL, so there is nothing to vouch for.
  if (action === "copy" && item.url === null) {
    return copyText(deps, item.address);
  }
  const check = await verified(deps, item, action === "copy" ? "copied" : "opened");
  if ("refusal" in check) {
    return check.refusal;
  }
  if (action === "copy") {
    return copyText(deps, check.url);
  }
  if (action === "open-external") {
    try {
      await deps.openExternal(check.url);
      return ok(`Opened ${item.title} in your browser`);
    } catch {
      return error("Could not open your browser.");
    }
  }
  const opened = await deps.openInDeck(check.url);
  return opened.ok ? ok(`Opened ${item.title} in Deck`) : error(opened.message);
}

async function copyText(deps: DevServerActionDeps, text: string): Promise<DevServerFeedback> {
  try {
    await deps.copy(text);
    return ok(`Copied ${text}`);
  } catch {
    return error("Could not copy — the clipboard is not available.");
  }
}
