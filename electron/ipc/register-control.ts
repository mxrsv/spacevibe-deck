/**
 * IPC for the in-pane `deck` command (spec 2026-11-03-agent-orchestration): the phase mirror's
 * report channel and the reply to a pushed control command.
 *
 * The renderer is not the trust boundary. A report is checked field by field against the closed
 * sets in `src/lib/pane-attention-report.ts`, and it is kept only when the sending window owns
 * the pane: the owner is the sender, resolved here with `labelOf`, never a payload field. A
 * reply is checked the same way against `src/lib/control-command.ts`, and it settles a request
 * only when the sender is the window the command was pushed to.
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { parseControlReply, type ControlReplyPayload } from "../../src/lib/control-command";
import { parsePaneAttentionReport } from "../../src/lib/pane-attention-report";
import type { PaneMirror } from "../control/pane-mirror";
import { CHANNELS } from "./channels";

export interface RegisterControlDeps {
  readonly mirror: PaneMirror;
  readonly labelOf: (event: IpcMainInvokeEvent) => string;
  /** Throws unless `label` owns the pane (`WindowCoordinator.assertAccess`). */
  readonly assertOwner: (paneId: number, label: string) => void;
  /**
   * Hands a reply to the request it answers; false when there is none to answer. Null while the
   * `agentControl` switch is off, when no command is ever pushed and every reply is refused.
   */
  readonly settleReply: ((fromWindow: string, reply: ControlReplyPayload) => boolean) | null;
}

export function registerControl(deps: RegisterControlDeps): void {
  // Answers whether the report was kept. A pane that is gone or moving is routine, not an
  // error: its last report must not bring a dead pane's mirror back.
  ipcMain.handle(
    CHANNELS.paneAttentionReport,
    (event, { paneId, phase, attention, source, confidence, agent, pid }): boolean => {
      const report = parsePaneAttentionReport({
        paneId,
        phase,
        attention,
        source,
        confidence,
        agent,
        pid,
      });
      if (report === null) {
        throw new TypeError("pane_attention_report carries a field outside its closed set");
      }
      try {
        deps.assertOwner(report.paneId, deps.labelOf(event));
      } catch {
        return false;
      }
      deps.mirror.report(report.paneId, {
        phase: report.phase,
        attention: report.attention,
        source: report.source,
        confidence: report.confidence,
        agent: report.agent,
        pid: report.pid,
      });
      return true;
    },
  );

  // Answers whether the reply settled a request. A request that is gone, or was addressed to
  // another window, is routine (the call timed out, the window was closed): refused, not thrown.
  ipcMain.handle(
    CHANNELS.controlReply,
    (event, { requestId, ok, paneId, text, outcome, error }): boolean => {
      const reply = parseControlReply({ requestId, ok, paneId, text, outcome, error });
      if (reply === null) {
        throw new TypeError("control_reply carries a field outside its shape");
      }
      let label: string;
      try {
        label = deps.labelOf(event);
      } catch {
        return false;
      }
      return deps.settleReply?.(label, reply) ?? false;
    },
  );
}
