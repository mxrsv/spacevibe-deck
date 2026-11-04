import type { MobilePhone, MobileState } from "../../lib/mobile-state";
import { MobileRows } from "../../ui/settings/sections/mobile-section";
import {
  MobileFootnote,
  PairDialogView,
  RevokeDialogView,
} from "../../ui/settings/sections/mobile-section-parts";
import { SectionHead, Specimen } from "../specimen";

/**
 * Settings → Mobile from the real rows, dialog bodies and footnote, over fixture states (plan
 * 2026-11-05 T5). Nothing here talks to the host: the views take their state as props, so every
 * state is reachable without a relay or a phone. The dialog frame copies `DialogContent`'s popup
 * classes, because the real one portals out of the specimen.
 */
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = 86_400_000;

/** A real pairing code's shape (`deck-pair:` + base64url JSON), with placeholder key material. */
const PLACEHOLDER_QR = `deck-pair:${btoa(
  JSON.stringify({
    v: 1,
    r: "https://api.deck.spacevibe.dev/relay",
    p: "gallery-pairing-id-0001",
    k: "A".repeat(43),
    s: "B".repeat(43),
    e: NOW + 272_000,
    n: "Mark's MacBook",
  }),
)
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")}`;

const PHONES: readonly MobilePhone[] = [
  {
    pairingId: "gallery-phone-online-01",
    name: "Mark's iPhone",
    model: "iPhone 16 Pro",
    pairedAt: NOW - 12 * DAY,
    lastSeenAt: NOW - 5_000,
    online: true,
  },
  {
    pairingId: "gallery-phone-offline-2",
    name: "Work iPhone",
    model: "iPhone 15",
    pairedAt: NOW - 40 * DAY,
    lastSeenAt: NOW - 30 * 3_600_000,
    online: false,
  },
];

const EMPTY: MobileState = { enabled: true, encryptionAvailable: true, phones: [], pending: null };
const PAIRED: MobileState = { ...EMPTY, phones: PHONES };
const none = (): void => {};

function Rows({ state }: { readonly state: MobileState }) {
  return (
    <div class="settings-screen__section" style={{ position: "static", maxWidth: "36rem" }}>
      <MobileRows state={state} now={NOW} starting={false} onPair={none} onRevoke={none} />
      <MobileFootnote onOpenPrivacy={none} />
    </div>
  );
}

function DialogFrame({ children }: { readonly children: preact.ComponentChildren }) {
  return <div class="mobile-dialog-frame">{children}</div>;
}

export function MobileSettingsSection() {
  return (
    <>
      <SectionHead
        title="Settings · Mobile"
        blurb="The real section rows and dialog bodies over fixture states. Shown in the app only while the mobileCompanion switch is on."
      />
      <Specimen name="No phones paired" note="Empty state; Pair a phone is the one action">
        <Rows state={EMPTY} />
      </Specimen>
      <Specimen name="Two phones" note="One online now, one last seen yesterday; Revoke per row">
        <Rows state={PAIRED} />
      </Specimen>
      <Specimen
        name="Secure storage unavailable"
        note="Pairing is refused with a visible reason; no plaintext fallback (MOB3)"
      >
        <Rows state={{ ...EMPTY, encryptionAvailable: false }} />
      </Specimen>
      <Specimen
        name="Pairing dialog · waiting"
        note="QR on a white quiet zone in every theme, relay host, live countdown (MOB1)"
      >
        <DialogFrame>
          <PairDialogView
            qr={PLACEHOLDER_QR}
            expiresAt={NOW + 272_000}
            now={NOW}
            error={null}
            starting={false}
            onCancel={none}
            onNewCode={none}
          />
        </DialogFrame>
      </Specimen>
      <Specimen name="Pairing dialog · expired" note="Offers a new code">
        <DialogFrame>
          <PairDialogView
            qr={PLACEHOLDER_QR}
            expiresAt={NOW - 1_000}
            now={NOW}
            error={null}
            starting={false}
            onCancel={none}
            onNewCode={none}
          />
        </DialogFrame>
      </Specimen>
      <Specimen name="Pairing dialog · error" note="The reason main gave, not a generic failure">
        <DialogFrame>
          <PairDialogView
            qr={null}
            expiresAt={null}
            now={NOW}
            error="Deck could not reach the relay. Check the connection and try again."
            starting={false}
            onCancel={none}
            onNewCode={none}
          />
        </DialogFrame>
      </Specimen>
      <Specimen name="Revoke confirmation" note="Asks before it calls mobile_revoke (MOB2)">
        <DialogFrame>
          <RevokeDialogView phone={PHONES[1]!} onCancel={none} onRevoke={none} />
        </DialogFrame>
      </Specimen>
    </>
  );
}
