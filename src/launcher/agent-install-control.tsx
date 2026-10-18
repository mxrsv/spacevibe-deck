import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { settingsOpen } from "../chrome/events";
import { openUrl } from "../host/shell-host";
import {
  agentInstallErrors,
  agentInstallOpening,
  installOfferFor,
  noteAgentListShown,
  startAgentInstall,
} from "./agent-install-store";

const LINK_FAILED = "Couldn't open the link";

/**
 * A missing built-in agent's way forward on a row: `Install` when Deck has a
 * verified command (the tooltip is that command, as plain text — DL-4.1), `Get`
 * when it has none (the tooltip is the page), nothing otherwise. Every agent
 * list renders this one control, so the rules for when it shows live in
 * `installOfferFor` and nowhere else. Keep it outside any `<label>`: pressing
 * it must never toggle the checkbox beside it.
 */
export function AgentInstallControl({ agentId, label }: { agentId: string; label: string }) {
  const offer = installOfferFor(agentId);
  const linkFailed = useSignal(false);
  if (offer.kind === "none") {
    return null;
  }
  const message = offer.kind === "install" ? agentInstallErrors.value.get(agentId) : undefined;
  return (
    <span class="agent-install" data-agent-install={agentId} data-agent-install-kind={offer.kind}>
      {offer.kind === "install" ? (
        <button
          type="button"
          class="cfg-btn"
          title={offer.command}
          aria-label={`Install ${label}`}
          aria-disabled={agentInstallOpening.value.has(agentId) ? "true" : undefined}
          onClick={() => void startAgentInstall(agentId)}
        >
          Install
        </button>
      ) : (
        <a
          class="cfg-btn agent-install__get"
          href={offer.url}
          title={offer.url}
          aria-label={`Get ${label}`}
          onClick={(event) => {
            event.preventDefault();
            linkFailed.value = false;
            openUrl(offer.url).catch((cause: unknown) => {
              console.error("Could not open the agent's page:", cause);
              linkFailed.value = true;
            });
          }}
        >
          Get
        </a>
      )}
      {message !== undefined && (
        <span class="agent-install__error" role="alert">
          {message}
        </span>
      )}
      {offer.kind === "get" && linkFailed.value && (
        <span class="agent-install__error" role="alert">
          {LINK_FAILED}
        </span>
      )}
    </span>
  );
}

/**
 * Settings stays mounted while closed, so its agent lists are "shown" when
 * Settings opens over them (or when they mount while it is open), not on mount
 * alone. Forces a fresh probe while an install is pending. Call it once per
 * Settings page, not once per list: every call forces its own probe.
 */
export function useNoteAgentListWhileSettingsOpen(): void {
  const open = settingsOpen.value;
  useEffect(() => {
    if (open) {
      noteAgentListShown();
    }
  }, [open]);
}
