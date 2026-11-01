import { useSignal } from "@preact/signals";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Badge } from "../controls/badge";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { PrivacySection } from "../settings/sections/privacy-section";
import { RowShell } from "./command-settings-live-row";

/**
 * The always-on usage analytics as one row: the fact is the badge, the account of what is sent
 * is the disclosure under it. `PrivacySection` is mounted unchanged (its copy is pinned by a test
 * and named in `docs/internals/telemetry.md`), so there is a single source for the words; the
 * Privacy area opens with it showing, since reading it is why anyone goes there.
 */
export function PrivacyRow({ open: initiallyOpen }: { readonly open: boolean }) {
  const open = useSignal(initiallyOpen);
  return (
    <RowShell
      itemKey="piece:privacy:analytics"
      active={false}
      changed={false}
      label="Usage analytics"
      crumb={null}
      reset={null}
      control={
        <>
          <Badge variant="outline">Always on</Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="What is sent"
            aria-expanded={open.value}
            onClick={() => {
              open.value = !open.value;
            }}
          >
            <DeckIcon icon={open.value ? CaretDown : CaretRight} size={ROW_ICON} />
          </Button>
        </>
      }
      below={open.value ? <PrivacySection /> : null}
    />
  );
}
