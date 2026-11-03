import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { QuitPreparation, type QuitFlight, type QuitPreparationDeps } from "../quit-flow";
import { CHANNELS } from "./channels";

function requestIdOf(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null || !("requestId" in payload)) return null;
  const id = payload.requestId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Register the authenticated renderer replies, separately from the main-owned census. */
export function registerQuit(
  flight: QuitFlight,
  deps: QuitPreparationDeps & { labelOf(event: IpcMainInvokeEvent): string },
): QuitPreparation {
  const preparation = new QuitPreparation(flight, deps);
  const senderLabel = (event: IpcMainInvokeEvent): string | null => {
    try {
      return deps.labelOf(event);
    } catch {
      return null;
    }
  };
  ipcMain.handle(CHANNELS.confirmQuit, (event, payload: unknown) => {
    const requestId = requestIdOf(payload);
    const label = senderLabel(event);
    if (requestId !== null && label !== null)
      preparation.confirm(label, event.sender.id, requestId);
  });
  ipcMain.handle(CHANNELS.cancelQuit, (event, payload: unknown) => {
    const requestId = requestIdOf(payload);
    const label = senderLabel(event);
    if (requestId !== null && label !== null) preparation.cancel(label, event.sender.id, requestId);
  });
  ipcMain.handle(CHANNELS.quitPrepared, (event, payload: unknown) => {
    const requestId = requestIdOf(payload);
    const label = senderLabel(event);
    if (
      requestId === null ||
      label === null ||
      typeof payload !== "object" ||
      payload === null ||
      !("ok" in payload) ||
      typeof payload.ok !== "boolean"
    )
      return;
    preparation.acknowledge(label, event.sender.id, requestId, payload.ok);
  });
  return preparation;
}
