import { ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "../../controls/button";
import { CHROME_ICON, DeckIcon } from "../../controls/deck-icon";
import { QrCode } from "./qr-code";
import type { MobilePhone } from "../../../lib/mobile-state";

/**
 * The Mobile section's pieces, as plain views over props so the real section and the gallery
 * specimen draw the same thing from different state.
 */

export const MOBILE_PRIVACY_URL = "https://deck.spacevibe.dev/privacy";
const PAIRING_CODE_FORMAT = /^deck-pair:/;

/** The relay a pairing code names, for "Connects through …"; null when the code is not readable. */
export function relayHostOf(qr: string): string | null {
  if (!PAIRING_CODE_FORMAT.test(qr)) return null;
  try {
    const base64 = qr.slice("deck-pair:".length).replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    const relay: unknown = (JSON.parse(json) as { r?: unknown }).r;
    return typeof relay === "string" ? new URL(relay).host : null;
  } catch {
    return null;
  }
}

/** `4:32`, never negative. */
export function countdownLabel(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function lastSeenLabel(phone: MobilePhone, now: number): string {
  if (phone.online) return "Online now";
  if (phone.lastSeenAt === null) return "Not seen yet";
  const age = Math.max(0, now - phone.lastSeenAt);
  if (age < MINUTE) return "Last seen just now";
  if (age < HOUR) return `Last seen ${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `Last seen ${Math.floor(age / HOUR)} h ago`;
  if (age < 2 * DAY) return "Last seen yesterday";
  return `Last seen ${new Date(phone.lastSeenAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

export function pairedDateLabel(phone: MobilePhone): string {
  return `Paired ${new Date(phone.pairedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

export interface PairDialogViewProps {
  readonly qr: string | null;
  readonly expiresAt: number | null;
  readonly now: number;
  readonly error: string | null;
  readonly starting: boolean;
  readonly onCancel: () => void;
  readonly onNewCode: () => void;
}

/** What the pairing dialog says: a live code, a code that expired, or why there is none. */
export function PairDialogView(props: PairDialogViewProps) {
  const { qr, expiresAt, now, error, starting, onCancel, onNewCode } = props;
  const expired = qr !== null && expiresAt !== null && now >= expiresAt;
  const live = qr !== null && !expired && error === null;
  const host = qr === null ? null : relayHostOf(qr);
  return (
    <div class="mobile-dialog">
      <h2 class="mobile-dialog__title">Pair a phone</h2>
      <p class="mobile-dialog__text">Open the Deck app on your iPhone and scan this code.</p>
      {error !== null ? (
        <p class="mobile-dialog__text mobile-dialog__text--problem" role="alert">
          {error}
        </p>
      ) : live ? (
        <div class="mobile-dialog__code">
          <QrCode text={qr} label="Pairing code for the Deck app" />
          <p class="mobile-dialog__text mobile-dialog__text--strong" role="status">
            Waiting for your phone…
          </p>
          <p class="mobile-dialog__text">Code expires in {countdownLabel(expiresAt!, now)}</p>
          {host !== null ? <p class="mobile-dialog__text">Connects through {host}</p> : null}
        </div>
      ) : expired ? (
        <p class="mobile-dialog__text mobile-dialog__text--strong" role="status">
          This code expired. Show a new one to pair.
        </p>
      ) : (
        <p class="mobile-dialog__text" role="status">
          {starting ? "Getting a pairing code…" : "No pairing code is showing."}
        </p>
      )}
      <div class="mobile-dialog__actions">
        {error !== null || expired ? (
          <Button variant="outline" size="sm" disabled={starting} onClick={onNewCode}>
            Show a new code
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onCancel}>
          {error !== null || expired ? "Close" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

export interface RevokeDialogViewProps {
  readonly phone: MobilePhone;
  readonly onCancel: () => void;
  readonly onRevoke: () => void;
}

export function RevokeDialogView({ phone, onCancel, onRevoke }: RevokeDialogViewProps) {
  return (
    <div class="mobile-dialog">
      <h2 class="mobile-dialog__title">Revoke {phone.name}?</h2>
      <p class="mobile-dialog__text">
        This phone will lose access to Deck right away. You can pair it again later.
      </p>
      <div class="mobile-dialog__actions">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={onRevoke}>
          Revoke
        </Button>
      </div>
    </div>
  );
}

export function MobileFootnote({ onOpenPrivacy }: { readonly onOpenPrivacy: () => void }) {
  return (
    <>
      <p class="settings-screen__note">
        The relay Deck connects through sees identifiers, timestamps and message sizes. It never
        sees terminal text, files or notification copy: those are encrypted between your computer
        and your phone.
      </p>
      <p class="settings-screen__note">
        While an agent works and a phone is paired, Deck keeps this computer awake. Closing the lid
        on battery still puts it to sleep.
      </p>
      <Button variant="ghost" size="sm" onClick={onOpenPrivacy}>
        <span>Read the full privacy notice</span>
        <DeckIcon icon={ArrowSquareOut} size={CHROME_ICON} />
      </Button>
    </>
  );
}
