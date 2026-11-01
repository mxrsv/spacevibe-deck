import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { Badge } from "../../ui/controls/badge";
import { Button } from "../../ui/controls/button";
import { Input } from "../../ui/controls/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/controls/select";
import { Switch } from "../../ui/controls/switch";
import { PreviewIcon } from "./preview-icon";

export function PreviewSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ComponentChildren;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}

const AGENTS = [
  { name: "Claude Code", command: "claude", model: "Opus", shortcut: "⌘1" },
  { name: "Codex", command: "codex", model: "Default", shortcut: "⌘2" },
  { name: "Gemini CLI", command: "gemini", model: "Pro", shortcut: "⌘3" },
] as const;

export function SettingsPreview({
  dark,
  onDarkChange,
}: {
  dark: boolean;
  onDarkChange: (value: boolean) => void;
}) {
  const page = useSignal("General");
  const query = useSignal("");
  const font = useSignal("JetBrains Mono");
  const fontSize = useSignal("13");
  const notifications = useSignal(true);
  const sound = useSignal(false);
  const browser = useSignal("System default");
  const enabled = useSignal<readonly string[]>(AGENTS.map((agent) => agent.name));
  const commands = useSignal<Record<string, string>>(
    Object.fromEntries(AGENTS.map((agent) => [agent.name, agent.command])),
  );
  const changed =
    font.value !== "JetBrains Mono" ||
    fontSize.value !== "13" ||
    !notifications.value ||
    sound.value ||
    browser.value !== "System default" ||
    enabled.value.length !== AGENTS.length ||
    AGENTS.some((agent) => commands.value[agent.name] !== agent.command);
  const matches = (label: string): boolean =>
    label.toLowerCase().includes(query.value.trim().toLowerCase());
  const reset = (): void => {
    font.value = "JetBrains Mono";
    fontSize.value = "13";
    notifications.value = true;
    sound.value = false;
    browser.value = "System default";
    enabled.value = AGENTS.map((agent) => agent.name);
    commands.value = Object.fromEntries(AGENTS.map((agent) => [agent.name, agent.command]));
  };
  const groups = [
    {
      title: "Appearance",
      rows: [
        {
          label: "Interface",
          control: (
            <PreviewSelect
              label="Interface mode"
              value={dark ? "Dark" : "Light"}
              options={["Light", "Dark"]}
              onChange={(value) => onDarkChange(value === "Dark")}
            />
          ),
        },
      ],
    },
    {
      title: "Terminal",
      rows: [
        {
          label: "Font family",
          control: (
            <PreviewSelect
              label="Font family"
              value={font.value}
              options={["JetBrains Mono", "SF Mono", "Menlo"]}
              onChange={(value) => {
                font.value = value;
              }}
            />
          ),
        },
        {
          label: "Font size",
          control: (
            <PreviewSelect
              label="Font size"
              value={fontSize.value}
              options={["12", "13", "14", "16"]}
              onChange={(value) => {
                fontSize.value = value;
              }}
            />
          ),
        },
      ],
    },
    {
      title: "Notifications",
      rows: [
        {
          label: "Agent notifications",
          description: "Know when an agent needs your attention.",
          control: (
            <Switch
              aria-label="Agent notifications"
              checked={notifications.value}
              onCheckedChange={(value) => {
                notifications.value = value;
              }}
            />
          ),
        },
        {
          label: "Play a sound",
          control: (
            <Switch
              aria-label="Play a sound"
              checked={sound.value}
              onCheckedChange={(value) => {
                sound.value = value;
              }}
            />
          ),
        },
      ],
    },
    {
      title: "Links",
      rows: [
        {
          label: "Browser",
          control: (
            <Input
              aria-label="Browser"
              value={browser.value}
              onInput={(event) => {
                browser.value = event.currentTarget.value;
              }}
            />
          ),
        },
      ],
    },
  ];
  const visibleGroups = groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => matches(row.label)) }))
    .filter((group) => group.rows.length > 0);
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 lg:px-10 lg:py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="flex items-center gap-2">
          {changed && <Badge variant="secondary">Modified</Badge>}
          <Button variant="outline" disabled={!changed} onClick={reset}>
            Reset changes
          </Button>
        </div>
      </header>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <nav className="flex gap-1" aria-label="Settings areas">
          {["General", "Agents", "Shortcuts"].map((name) => (
            <Button
              key={name}
              variant={page.value === name ? "secondary" : "ghost"}
              aria-pressed={page.value === name}
              onClick={() => {
                page.value = name;
                query.value = "";
              }}
            >
              {name}
            </Button>
          ))}
        </nav>
        <Input
          aria-label="Search preview settings"
          placeholder="Search settings…"
          className="max-w-48"
          value={query.value}
          onInput={(event) => {
            query.value = event.currentTarget.value;
          }}
        />
      </div>
      {page.value === "General" && (
        <div className="space-y-6">
          {visibleGroups.map((group) => (
            <section key={group.title}>
              <h2 className="text-xs font-semibold text-muted-foreground">{group.title}</h2>
              {group.rows.map((row) => (
                <SettingRow
                  key={row.label}
                  label={row.label}
                  description={"description" in row ? row.description : undefined}
                >
                  {row.control}
                </SettingRow>
              ))}
            </section>
          ))}
          {visibleGroups.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground" role="status">
              No settings match “{query.value}”.
            </p>
          )}
        </div>
      )}
      {page.value === "Agents" && (
        <section className="space-y-4">
          {AGENTS.filter((agent) => matches(agent.name)).map((agent) => (
            <div key={agent.name} className="rounded-lg border p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <PreviewIcon name="agent" />
                  {agent.name}
                </h2>
                <Switch
                  aria-label={`Enable ${agent.name}`}
                  checked={enabled.value.includes(agent.name)}
                  onCheckedChange={(checked) => {
                    enabled.value = checked
                      ? [...enabled.value, agent.name]
                      : enabled.value.filter((name) => name !== agent.name);
                  }}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs">
                  <span className="text-muted-foreground">Command</span>
                  <Input
                    aria-label={`${agent.name} command`}
                    value={commands.value[agent.name]}
                    onInput={(event) => {
                      commands.value = {
                        ...commands.value,
                        [agent.name]: event.currentTarget.value,
                      };
                    }}
                  />
                </label>
                <div className="space-y-2 text-xs">
                  <span className="text-muted-foreground">Model</span>
                  <p className="pt-1">{agent.model}</p>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
      {page.value === "Shortcuts" && (
        <section>
          {[
            ["New task", "⌘N"],
            ["Open Settings", "⌘,"],
            ["Switch workspace", "⌘K"],
            ["Toggle Explorer", "⌘B"],
            ["Close tab", "⌘W"],
          ]
            .filter(([name]) => matches(name))
            .map(([name, chord]) => (
              <SettingRow key={name} label={name}>
                <kbd className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                  {chord}
                </kbd>
              </SettingRow>
            ))}
        </section>
      )}
    </div>
  );
}
