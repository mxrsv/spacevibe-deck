import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ComputerTerminal01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import type { ComponentChildren } from "preact";
import { Badge } from "../../../../ui/controls/badge";
import { Button } from "../../../../ui/controls/button";
import { Input } from "../../../../ui/controls/input";
import { Chord } from "../../../../ui/blocks/chord";
import { Kbd } from "../../../../ui/controls/kbd";
import { Switch } from "../../../../ui/controls/switch";
import { AgentLogo } from "../../agent-parts";
import { areaById, type AreaId, type MockSetting } from "./settings-data";
import {
  ABOUT,
  ANALYTICS_COLLECTS,
  NOTIFICATION_PERMISSION,
  type HealthIssue,
  type MockAgentConfig,
  type MockShortcut,
} from "./settings-setup-data";
import {
  ChoiceControl,
  ResetButton,
  SettingControl,
  refocusSearch,
} from "./settings-option-a-controls";
import {
  activeKey,
  agentView,
  chordChanged,
  chordOf,
  conflictOf,
  currentValue,
  defaultChord,
  editAgent,
  expanded,
  isChanged,
  osOpened,
  query,
  reassign,
  recording,
  resetSetting,
  resetTarget,
  resolveHealth,
  scope,
  setChord,
  valueOf,
} from "./settings-option-a-state";

const SEVERITY_DOT = {
  error: "bg-red-600 dark:bg-red-500",
  warning: "bg-amber-500 dark:bg-amber-400",
  info: "bg-muted-foreground",
} as const;

/** One list row: change mark, label, live control, reset slot; extras span the full width. */
function Row({
  itemKey,
  active,
  changed,
  label,
  crumb,
  control,
  reset,
  children,
}: {
  readonly itemKey: string;
  readonly active: boolean;
  readonly changed?: boolean;
  readonly label: ComponentChildren;
  readonly crumb?: string;
  readonly control?: ComponentChildren;
  readonly reset?: ComponentChildren;
  readonly children?: ComponentChildren;
}) {
  return (
    <div
      id={`a-row-${itemKey}`}
      data-active={active || undefined}
      aria-current={active || undefined}
      onPointerMove={() => {
        if (activeKey.value !== itemKey) activeKey.value = itemKey;
      }}
      className={cn(
        "grid min-h-9 grid-cols-[8px_minmax(0,1fr)_auto_28px] items-center gap-x-2.5 rounded-md px-2.5 py-1 text-xs text-foreground",
        active && "bg-muted [&_.text-muted-foreground]:text-foreground",
      )}
    >
      <span className="flex justify-center">
        {changed ? (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            <span className="sr-only">Changed</span>
          </>
        ) : null}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{label}</span>
        {crumb ? <span className="shrink-0 text-muted-foreground">{crumb}</span> : null}
      </span>
      <span className="flex items-center justify-end gap-2">{control}</span>
      <span className="flex justify-end">{reset}</span>
      {children ? <div className="col-span-4 pb-1.5 pl-[18px]">{children}</div> : null}
    </div>
  );
}

export function Head({ title }: { readonly title: string }) {
  return <h3 className="m-0 px-5 pt-3 pb-1 text-2xs font-medium text-muted-foreground">{title}</h3>;
}

function NotificationBlock() {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-foreground">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", SEVERITY_DOT.error)} />
      <span className="flex-1">macOS blocks Deck's notifications</span>
      <Button
        variant="outline"
        size="xs"
        disabled={osOpened.value}
        onClick={() => {
          osOpened.value = true;
        }}
      >
        {osOpened.value ? "Opened" : "Open System Settings"}
      </Button>
    </div>
  );
}

export function SettingRow({
  setting,
  active,
  crumb,
}: {
  readonly setting: MockSetting;
  readonly active: boolean;
  readonly crumb?: boolean;
}) {
  const changed = isChanged(setting);
  const fallback = setting.control.fallback;
  const fallbackLabel =
    setting.control.kind === "choice"
      ? (setting.control.choices.find((choice) => choice.value === fallback)?.label ??
        String(fallback))
      : typeof fallback === "boolean"
        ? fallback
          ? "on"
          : "off"
        : String(fallback);
  return (
    <Row
      itemKey={`setting:${setting.key}`}
      active={active}
      changed={changed}
      label={setting.label}
      crumb={crumb ? areaById(setting.area).label : undefined}
      control={<SettingControl setting={setting} />}
      reset={
        changed ? (
          <ResetButton
            label={setting.label}
            to={fallbackLabel}
            onReset={() => resetSetting(setting)}
          />
        ) : null
      }
    >
      {setting.key === "agentNotifications" &&
      !crumb &&
      NOTIFICATION_PERMISSION === "denied" &&
      currentValue(setting) === true ? (
        <NotificationBlock />
      ) : null}
    </Row>
  );
}

export function TypePreview() {
  const family = String(valueOf("fontFamily") ?? "SF Mono");
  const size = Number(valueOf("fontSize") ?? 13);
  const leading = Number(valueOf("lineHeight") ?? 1.25);
  return (
    <div
      role="img"
      aria-label={`Typography preview: ${family} ${size}px, line height ${leading}`}
      className="mx-5 my-1 overflow-hidden rounded-md border px-3 py-2"
      style={{
        background: "var(--term-bg)",
        color: "var(--term-fg)",
        fontFamily: `"${family}", ui-monospace, monospace`,
        fontSize: `${size}px`,
        lineHeight: leading,
      }}
    >
      <div>$ claude --resume</div>
      <div>Renamed 12 files, 3 tests pass</div>
      <div>{'{ "ok": true, "0O": "1lI" }'}</div>
    </div>
  );
}

export function HealthRow({
  issue,
  active,
}: {
  readonly issue: HealthIssue;
  readonly active: boolean;
}) {
  const done = issue.id === "notifications-blocked" && osOpened.value;
  return (
    <div
      id={`a-row-health:${issue.id}`}
      aria-current={active || undefined}
      onPointerMove={() => {
        activeKey.value = `health:${issue.id}`;
      }}
      className={cn(
        "grid min-h-9 grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2.5 py-1 text-xs text-foreground",
        active && "bg-muted [&_.text-muted-foreground]:text-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", SEVERITY_DOT[issue.severity])}
      />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{issue.title}</span>
        <span className="shrink-0 text-muted-foreground">{areaById(issue.area).label}</span>
      </span>
      <Button
        variant={issue.severity === "error" ? "default" : "outline"}
        size="sm"
        disabled={done}
        onClick={() => resolveHealth(issue)}
      >
        {done ? "Opened" : issue.action}
      </Button>
    </div>
  );
}

export function AreaRow({ area, active }: { readonly area: AreaId; readonly active: boolean }) {
  return (
    <Row
      itemKey={`area:${area}`}
      active={active}
      label={areaById(area).label}
      control={
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open ${areaById(area).label}`}
          onClick={() => {
            scope.value = area;
            query.value = "";
          }}
        >
          Open area
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
      }
    />
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div className="grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </div>
  );
}

const EFFORTS = ["low", "medium", "high"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const SIGNAL_LABEL = { hooks: "Hooks", plugin: "Plugin", inferred: "Inferred" } as const;

function AgentFields({ config }: { readonly config: MockAgentConfig }) {
  const agent = agentView(config);
  const name = config.name;
  if (!agent.installed) {
    return (
      <Field label="Status">
        <span>Not installed</span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => editAgent(config.id, { installed: true })}
        >
          Install
        </Button>
      </Field>
    );
  }
  return (
    <div className="border-l pl-3">
      <Field label="Pinned">
        <Switch
          size="sm"
          aria-label={`${name} pinned to quick launch`}
          checked={agent.pinned}
          onCheckedChange={(next: boolean) => editAgent(config.id, { pinned: next })}
        />
      </Field>
      <Field label="Signals">
        <Badge variant="outline">{SIGNAL_LABEL[agent.signals]}</Badge>
        {agent.signalsOn === null ? null : (
          <Switch
            size="sm"
            aria-label={`${name} signal adapter`}
            checked={agent.signalsOn}
            onCheckedChange={(next: boolean) => editAgent(config.id, { signalsOn: next })}
          />
        )}
      </Field>
      {agent.models && agent.model ? (
        <Field label="Model">
          <ChoiceControl
            label={`${name} model`}
            value={agent.model}
            choices={agent.models.map((value) => ({ value, label: value }))}
            menuKey={`${config.id}:model`}
            width="w-44"
            onChange={(next) => editAgent(config.id, { model: next })}
          />
        </Field>
      ) : null}
      {agent.effort ? (
        <Field label="Effort">
          <ChoiceControl
            label={`${name} effort`}
            value={agent.effort}
            choices={EFFORTS}
            menuKey={`${config.id}:effort`}
            onChange={(next) => editAgent(config.id, { effort: next as "low" | "medium" | "high" })}
          />
        </Field>
      ) : null}
      <Field label="Launch profile">
        {config.profile ? <Badge variant="outline">{config.profile.name}</Badge> : null}
        <Input
          aria-label={`${name} launch flags`}
          className="h-6 flex-1 font-mono"
          placeholder="No flags"
          value={agent.flags}
          onInput={(event: Event) =>
            editAgent(config.id, { flags: (event.target as HTMLInputElement).value })
          }
        />
      </Field>
    </div>
  );
}

export function AgentRow({
  config,
  active,
  single,
}: {
  readonly config: MockAgentConfig;
  readonly active: boolean;
  readonly single: boolean;
}) {
  const agent = agentView(config);
  const isOpen = expanded.value[config.id] ?? single;
  const status = !agent.installed ? "Not installed" : !agent.enabled ? "Off" : agent.version;
  return (
    <Row
      itemKey={`agent:${config.id}`}
      active={active}
      label={
        <span className="flex items-center gap-2">
          {config.kind === "custom" ? (
            <HugeiconsIcon
              icon={ComputerTerminal01Icon}
              size={14}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <AgentLogo kind={config.kind} className="size-3.5" />
          )}
          {config.name}
          <span className="text-muted-foreground tabular-nums">{status}</span>
        </span>
      }
      control={
        <>
          <Switch
            aria-label={`${config.name} enabled`}
            disabled={!agent.installed}
            checked={agent.enabled && agent.installed}
            onCheckedChange={(next: boolean) => {
              editAgent(config.id, { enabled: next });
              refocusSearch();
            }}
          />
        </>
      }
      reset={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${config.name}`}
          aria-expanded={isOpen}
          onClick={() => {
            expanded.value = { ...expanded.value, [config.id]: !isOpen };
          }}
        >
          <HugeiconsIcon icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon} strokeWidth={2} />
        </Button>
      }
    >
      {isOpen ? <AgentFields config={config} /> : null}
    </Row>
  );
}

export function ShortcutRow({
  shortcut,
  active,
  crumb,
}: {
  readonly shortcut: MockShortcut;
  readonly active: boolean;
  readonly crumb?: boolean;
}) {
  const keys = chordOf(shortcut);
  const changed = chordChanged(shortcut);
  const isRecording = recording.value === shortcut.id;
  const clash = conflictOf(shortcut);
  return (
    <Row
      itemKey={`shortcut:${shortcut.id}`}
      active={active}
      changed={changed}
      label={shortcut.label}
      crumb={crumb ? "Shortcuts" : undefined}
      control={
        <>
          {isRecording ? (
            <span
              role="status"
              className="flex h-6 items-center gap-1.5 rounded-md border border-ring px-2 text-foreground"
            >
              Press the new chord
              <Kbd>Esc</Kbd>
            </span>
          ) : keys.length > 0 ? (
            <Chord keys={keys} label={`${shortcut.label} chord`} />
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
          <Button
            variant={isRecording ? "outline" : "ghost"}
            size="sm"
            aria-label={`${isRecording ? "Cancel recording" : "Record"} ${shortcut.label}`}
            onClick={() => {
              recording.value = isRecording ? null : shortcut.id;
              if (isRecording) refocusSearch();
            }}
          >
            {isRecording ? "Cancel" : "Record"}
          </Button>
        </>
      }
      reset={
        changed ? (
          <ResetButton
            label={shortcut.label}
            to={defaultChord(shortcut).join("")}
            onReset={() => setChord(shortcut.id, defaultChord(shortcut))}
          />
        ) : null
      }
    >
      {clash ? (
        <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", SEVERITY_DOT.warning)} />
          <span className="flex-1">
            {keys.join("")} is also {clash.label}
          </span>
          <Button variant="outline" size="xs" onClick={() => reassign(shortcut)}>
            Reassign
          </Button>
        </div>
      ) : null}
    </Row>
  );
}

export function UpdateRow({
  active,
  updated,
  onUpdate,
}: {
  readonly active: boolean;
  readonly updated: boolean;
  readonly onUpdate: () => void;
}) {
  return (
    <Row
      itemKey="update"
      active={active}
      label={
        <span className="flex items-center gap-2">
          Deck {ABOUT.version}
          <Badge variant="outline">{ABOUT.channel}</Badge>
        </span>
      }
      control={
        updated ? (
          <span className="text-muted-foreground">Up to date</span>
        ) : (
          <>
            <span className="text-muted-foreground tabular-nums">
              {ABOUT.update.version} · {ABOUT.update.size}
            </span>
            <Button size="sm" onClick={onUpdate}>
              Restart to update
            </Button>
          </>
        )
      }
    />
  );
}

export function PrivacyBlock() {
  return (
    <div className="px-5 py-2 text-xs text-foreground">
      <div className="mb-1.5 flex items-center gap-2">
        Usage analytics
        <Badge variant="outline">Always on</Badge>
      </div>
      <ul className="m-0 list-none space-y-1 p-0 text-muted-foreground">
        {ANALYTICS_COLLECTS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function ResetRow({
  id,
  label,
  active,
}: {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}) {
  return (
    <Row
      itemKey={`reset:${id}`}
      active={active}
      label={label}
      control={
        <Button
          variant="destructive"
          size="sm"
          aria-label={`Reset ${label}`}
          onClick={() => {
            resetTarget.value = id;
          }}
        >
          Reset…
        </Button>
      }
    />
  );
}

export function EmptyRow({ text }: { readonly text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-xs text-foreground">
      <span>
        Nothing matches <span className="font-medium">“{text}”</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          query.value = "";
          refocusSearch();
        }}
      >
        Clear search
      </Button>
    </div>
  );
}
