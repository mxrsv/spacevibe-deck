import { useEffect, useState } from "preact/hooks";
import { reportPersistError } from "../../../chrome/events";
import { openUrl, writeText } from "../../../host/shell-host";
import type { MobilePhone, MobileState } from "../../../lib/mobile-state";
import { Button } from "../../controls/button";
import { ConfigGroup, ConfigRow } from "../../controls/config-row";
import { Dialog, DialogContent } from "../../controls/dialog";
import {
  cancelPairing,
  confirmRevoke,
  mobileState,
  pairDialogOpen,
  pairError,
  pairStarting,
  revokeTarget,
  showPairingCode,
  startMobile,
  stopMobile,
} from "../mobile-store";
import {
  lastSeenLabel,
  MOBILE_PRIVACY_URL,
  MobileFootnote,
  pairedDateLabel,
  PairDialogView,
  RevokeDialogView,
} from "./mobile-section-parts";

/** One tick a second while mounted, for the code's countdown and the "last seen" ages. */
function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface MobileRowsProps {
  readonly state: MobileState;
  readonly now: number;
  readonly starting: boolean;
  readonly onPair: () => void;
  readonly onRevoke: (phone: MobilePhone) => void;
}

/** The section's rows: the pair action, then the paired phones. */
export function MobileRows({ state, now, starting, onPair, onRevoke }: MobileRowsProps) {
  return (
    <>
      <ConfigRow
        label="Pair a phone"
        desc={
          state.encryptionAvailable
            ? "Show a code to scan with SpaceVibe Deck on your iPhone"
            : "This computer cannot protect pairing keys (secure storage is unavailable), so phones cannot be paired"
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={starting || !state.encryptionAvailable}
          onClick={onPair}
        >
          Pair a phone
        </Button>
      </ConfigRow>
      <ConfigGroup label="Paired phones" />
      {state.phones.length === 0 ? (
        <p class="settings-screen__note">No phones are paired yet.</p>
      ) : (
        state.phones.map((phone) => (
          <ConfigRow
            key={phone.pairingId}
            label={phone.name}
            desc={`${phone.model} · ${pairedDateLabel(phone)} · ${lastSeenLabel(phone, now)}`}
          >
            <Button variant="outline" size="sm" onClick={() => onRevoke(phone)}>
              Revoke
            </Button>
          </ConfigRow>
        ))
      )}
    </>
  );
}

function openPrivacy(): void {
  void openUrl(MOBILE_PRIVACY_URL).catch(() => {
    reportPersistError(`Could not open ${MOBILE_PRIVACY_URL}`);
  });
}

/** Settings → Mobile (spec MOB1-3). Only mounted while `mobileCompanion` is on. */
export function MobileSection() {
  const now = useNow();
  useEffect(() => {
    void startMobile();
    return stopMobile;
  }, []);

  const state = mobileState.value;
  const phone = revokeTarget.value;
  return (
    <>
      <MobileRows
        state={state}
        now={now}
        starting={pairStarting.value}
        onPair={() => void showPairingCode()}
        onRevoke={(target) => {
          revokeTarget.value = target;
        }}
      />
      <MobileFootnote onOpenPrivacy={openPrivacy} />
      <Dialog
        open={pairDialogOpen.value}
        onOpenChange={(open) => {
          if (!open) void cancelPairing();
        }}
      >
        <DialogContent showCloseButton={false}>
          <PairDialogView
            qr={state.pending?.qr ?? null}
            expiresAt={state.pending?.expiresAt ?? null}
            now={now}
            error={pairError.value}
            starting={pairStarting.value}
            onCancel={() => void cancelPairing()}
            onNewCode={() => void showPairingCode()}
            onCopy={() => {
              const code = state.pending?.qr;
              if (code === undefined) return;
              void writeText(code).catch(() =>
                reportPersistError("Could not copy the pairing code"),
              );
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={phone !== null}
        onOpenChange={(open) => {
          if (!open) revokeTarget.value = null;
        }}
      >
        <DialogContent showCloseButton={false}>
          {phone === null ? null : (
            <RevokeDialogView
              phone={phone}
              onCancel={() => {
                revokeTarget.value = null;
              }}
              onRevoke={() => void confirmRevoke()}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
