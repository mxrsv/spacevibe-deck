import { useSignal } from "@preact/signals";
import { ArrowClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { signalAdaptersPatch } from "../../settings/signal-adapter-choice";
import { quickAgentChoices, toggleQuickAgent } from "../../settings/quick-agent-choices";
import { agentResetPatch } from "../../settings/settings-rows";
import type { Settings } from "../../settings/settings-schema";
import { ensureAgentHooksSupportLoaded } from "../../settings/agent-hooks-support-store";
import { settings as settingsStore, updateSettings } from "../../settings/settings-store";
import { AgentInstallControl } from "../../launcher/agent-install-control";
import { probeAgentsNow } from "../../launcher/agent-install-store";
import { detectedAgents } from "../../terminal/agent-detection-store";
import { Button } from "../controls/button";
import { NOT_AVAILABLE_ON_WINDOWS } from "../controls/config-row";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { Switch } from "../controls/switch";
import { AgentLaunchFlags } from "../settings/agent-launch-flags";
import { AgentMark, CommandLine, RuntimeSettings } from "../settings/launch-profile-editor";
import { agentRowData, type AgentRowData } from "./command-settings-agents";
import { RowReset, RowShell } from "./command-settings-live-row";

/** What the row says instead of the command while the agent is not simply ready. */
function statusOf(data: AgentRowData): string | null {
  if (!data.probed) return "Looking…";
  if (!data.installed) return "Not installed";
  return data.enabled ? null : "Off";
}

function DetailRow({
  label,
  hint,
  children,
}: {
  readonly label: string;
  /** A reason or a sentence, kept off the row: the label's tooltip. */
  readonly hint?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="text-muted-foreground" title={hint}>
        {label}
      </span>
      {children}
    </div>
  );
}

const SIGNALS_HINT: Readonly<Record<string, string>> = {
  claude:
    "Install Deck hooks in Claude settings for sessions opened here, including manual launches.",
};
const SIGNALS_HINT_DEFAULT =
  "Use agent-reported status for new sessions. When off, Deck estimates status.";

function setSignals(agentId: string, next: boolean): void {
  updateSettings(
    signalAdaptersPatch({ ...settingsStore.value.agentSignalAdapters, [agentId]: next }),
  );
}

/** The configuration under an expanded built-in row. */
function AgentDetails({ data, locked }: { readonly data: AgentRowData; readonly locked: boolean }) {
  const pin = quickAgentChoices().find((choice) => choice.id === data.id);
  const agent = data.builtin;
  return (
    <div className="flex flex-col gap-1 border-l pl-3 text-xs">
      {pin === undefined ? null : (
        <DetailRow
          label="Quick launch"
          hint={pin.blocked ?? "Pin to quick launch and the checkout menu"}
        >
          <Switch
            aria-label={`${data.label} pinned`}
            checked={pin.pinned}
            disabled={locked || !pin.toggleable}
            onCheckedChange={() => toggleQuickAgent(data.id)}
          />
        </DetailRow>
      )}
      {data.signals === null ? null : (
        <DetailRow
          label="Signals"
          hint={
            data.signalsAvailable
              ? (SIGNALS_HINT[data.id] ?? SIGNALS_HINT_DEFAULT)
              : NOT_AVAILABLE_ON_WINDOWS
          }
        >
          {/* Unavailable, not disabled (DL-23.6): it keeps its tab stop so the reason is reachable,
              reads off because nothing is registered, and drops the press; the stored value stays. */}
          <Switch
            aria-label={`${data.label} signals`}
            checked={data.signalsAvailable && data.signals}
            disabled={locked}
            aria-disabled={data.signalsAvailable ? undefined : true}
            onCheckedChange={(next: boolean) => {
              if (data.signalsAvailable) setSignals(data.id, next);
            }}
          />
        </DetailRow>
      )}
      {agent === null ? null : (
        <div className="settings-screen__doc--studio">
          <div className="settings-screen__fields settings-screen__fields--studio">
            <div className="lp-agent-details">
              <AgentLaunchFlags agent={agent} command={data.command} />
              {data.installed ? <RuntimeSettings agent={agent} /> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AgentRowProps {
  readonly itemKey: string;
  readonly agentId: string;
  readonly settings: Settings;
  readonly crumb: string | null;
  readonly active: boolean;
  /** The settings snapshot is still loading. */
  readonly locked: boolean;
}

/**
 * One agent as a row: its mark, name and state, the install offer for a missing built-in, the
 * enable switch, and a disclosure for its pin and, for a built-in, its Signals, launch command and
 * model. The row mounts the details only while open, so a control inside a closed row is never a
 * tab stop.
 */
export function AgentRow({ itemKey, agentId, settings, crumb, active, locked }: AgentRowProps) {
  const data = agentRowData(agentId, settings);
  const open = useSignal(false);
  useEffect(() => {
    // Asked once per window and shared (the store keeps the answer), so a row may ask.
    if (data.signals !== null) void ensureAgentHooksSupportLoaded();
  }, [data.signals]);
  const status = statusOf(data);
  return (
    <RowShell
      itemKey={itemKey}
      active={active}
      changed={data.changed}
      crumb={crumb}
      label={
        <span className="flex min-w-0 items-center gap-2">
          <AgentMark id={data.id} label={data.label} />
          <span className="truncate">{data.label}</span>
          {status === null ? (
            <span className="min-w-0 truncate text-muted-foreground">
              <CommandLine command={data.command} />
            </span>
          ) : (
            <span className="shrink-0 text-muted-foreground">{status}</span>
          )}
        </span>
      }
      control={
        <>
          {data.builtin === null ? null : (
            <AgentInstallControl agentId={data.id} label={data.label} />
          )}
          <Switch
            aria-label={`${data.label} availability`}
            checked={data.enabled}
            disabled={locked}
            onCheckedChange={(next: boolean) => {
              const off = settingsStore.value.disabledAgents.filter((id) => id !== data.id);
              updateSettings({ disabledAgents: next ? off : [...off, data.id] });
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Configure ${data.label}`}
            aria-expanded={open.value}
            onClick={() => {
              open.value = !open.value;
            }}
          >
            <DeckIcon icon={open.value ? CaretDown : CaretRight} size={ROW_ICON} />
          </Button>
        </>
      }
      reset={
        data.changed ? (
          <RowReset
            label={data.label}
            to="its defaults"
            locked={locked}
            onReset={() => updateSettings(agentResetPatch(data.id, settingsStore.value))}
          />
        ) : null
      }
      below={open.value ? <AgentDetails data={data} locked={locked} /> : null}
    />
  );
}

/** The detected count and the Refresh that re-reads `$PATH`, the only way to see a CLI installed elsewhere. */
export function AgentsRefresh() {
  const refreshing = useSignal(false);
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-1 text-xs text-muted-foreground">
      <span>{detectedAgents.value.length} detected</span>
      <Button
        variant="outline"
        size="sm"
        aria-label="Refresh installed agents"
        disabled={refreshing.value}
        onClick={() => {
          if (refreshing.value) return;
          refreshing.value = true;
          // Forced with the boot probe's full name list, as the legacy Refresh does.
          void probeAgentsNow().finally(() => {
            refreshing.value = false;
          });
        }}
      >
        <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
        Refresh
      </Button>
    </li>
  );
}
