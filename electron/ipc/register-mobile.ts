/**
 * IPC for the iPhone companion: the Settings section's four commands, and the renderer's answers
 * to what main asks of it (a query, a stream piece, a push decision).
 *
 * With the `mobileCompanion` switch off `service` is null: the section's commands answer
 * `enabled: false` and everything else is refused, so nothing listens, connects or stores.
 *
 * The renderer is not the trust boundary. Every payload is checked field by field, and a stream
 * piece, query answer or reply counts only for the window main asked, resolved here with
 * `labelOf`, never from a payload field. A push is refused unless the sender owns the pane.
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isPairingId } from "../../mobile/protocol/src/relay-messages";
import { PUSH_EVENT_KINDS } from "../../mobile/protocol/src/push";
import {
  DISABLED_STATE,
  type MobileService,
  type MobileStartResult,
  type MobileState,
} from "../mobile/service";
import { QUERY_KINDS } from "../mobile/phone-queries";
import { MAX_STREAM_DATA_CHARS, STREAM_KINDS } from "../mobile/phone-streams";
import { CHANNELS } from "./channels";

export interface RegisterMobileDeps {
  /** Null while the switch is off. */
  readonly service: MobileService | null;
  readonly labelOf: (event: IpcMainInvokeEvent) => string;
  /** Throws unless `label` owns the pane (`WindowCoordinator.assertAccess`). */
  readonly assertOwner: (paneId: number, label: string) => void;
}

const MAX_REQUEST_ID = 64;
const MAX_PUSH_TEXT = 400;

function oneOf<T extends string>(set: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (set.find((member) => member === value) ?? null) : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000
    ? value
    : null;
}

export function registerMobile(deps: RegisterMobileDeps): void {
  const { service } = deps;
  const disabled = (): MobileState => DISABLED_STATE;

  ipcMain.handle(CHANNELS.mobileState, (): MobileState => service?.state() ?? disabled());

  ipcMain.handle(CHANNELS.mobilePairStart, async (): Promise<MobileStartResult> =>
    service === null
      ? {
          ...disabled(),
          error: { reason: "disabled", message: "Phone pairing is not available in this build." },
        }
      : service.pairStart(),
  );

  ipcMain.handle(CHANNELS.mobilePairCancel, (): MobileState => service?.pairCancel() ?? disabled());

  ipcMain.handle(CHANNELS.mobileRevoke, async (_event, { pairingId }): Promise<MobileState> => {
    if (!isPairingId(pairingId)) throw new TypeError("mobile_revoke needs a pairing id");
    return service === null ? disabled() : service.revoke(pairingId);
  });

  // Answers whether the report settled a held query; unknown or foreign ones are routine.
  ipcMain.handle(CHANNELS.mobileQueryReport, (event, { requestId, kind, payload }): boolean => {
    const asked = oneOf(QUERY_KINDS, kind);
    if (
      typeof requestId !== "string" ||
      requestId === "" ||
      requestId.length > MAX_REQUEST_ID ||
      asked === null
    ) {
      throw new TypeError("mobile_query_report carries a field outside its shape");
    }
    if (service === null) return false;
    return service.settleQuery(deps.labelOf(event), requestId, asked, payload);
  });

  ipcMain.handle(
    CHANNELS.mobileStreamData,
    (event, { subscriptionId, paneId, kind, data, cols, rows }): boolean => {
      const streamKind = oneOf(STREAM_KINDS, kind);
      const pane = positiveInteger(paneId);
      const width = dimension(cols);
      const height = dimension(rows);
      if (
        typeof subscriptionId !== "string" ||
        subscriptionId === "" ||
        subscriptionId.length > MAX_REQUEST_ID ||
        streamKind === null ||
        pane === null ||
        typeof data !== "string" ||
        data.length > MAX_STREAM_DATA_CHARS ||
        width === null ||
        height === null
      ) {
        throw new TypeError("mobile_stream_data carries a field outside its shape");
      }
      if (service === null) return false;
      return service.streamData(deps.labelOf(event), {
        subscriptionId,
        paneId: pane,
        kind: streamKind,
        data,
        cols: width,
        rows: height,
      });
    },
  );

  // Answers whether the push was accepted; a pane the sender does not own is refused quietly.
  ipcMain.handle(CHANNELS.mobilePush, (event, { paneId, kind, title, body }): boolean => {
    const pane = positiveInteger(paneId);
    const pushKind = oneOf(PUSH_EVENT_KINDS, kind);
    if (
      pane === null ||
      pushKind === null ||
      typeof title !== "string" ||
      typeof body !== "string" ||
      title.length > MAX_PUSH_TEXT ||
      body.length > MAX_PUSH_TEXT
    ) {
      throw new TypeError("mobile_push carries a field outside its shape");
    }
    if (service === null) return false;
    try {
      deps.assertOwner(pane, deps.labelOf(event));
    } catch {
      return false;
    }
    service.push({ paneId: pane, kind: pushKind, title, body });
    return true;
  });
}
