import { useSignal } from "@preact/signals";
import { Badge } from "../../ui/controls/badge";
import { Button } from "../../ui/controls/button";
import { Input } from "../../ui/controls/input";
import { PreviewIcon } from "./preview-icon";

export const CHANGED_FILES = [
  { name: "src/ui/controls/button.tsx", added: 48, removed: 12 },
  { name: "src/ui/controls/switch.tsx", added: 32, removed: 18 },
  { name: "src/ui/settings/settings-screen.tsx", added: 86, removed: 54 },
  { name: "src/styles/11-settings-screen.css", added: 4, removed: 96 },
] as const;

export function WorkbenchPreview({
  onChanges,
  session,
}: {
  onChanges: () => void;
  session: { title: string; agent: string; state: string };
}) {
  const draft = useSignal("");
  const submitted = useSignal("");
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2 text-xs">
          <PreviewIcon name="terminal" />
          <span className="font-medium">{session.title}</span>
          <Badge variant="secondary">{session.agent}</Badge>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">main → shadcn-base-ui</span>
      </div>
      <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px]">
        <section
          className="preview-terminal flex flex-col p-5 lg:p-8"
          aria-label="Sample agent terminal"
        >
          <div className="mb-8 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-muted">
              <PreviewIcon name="agent" />
            </span>
            <div>
              <h1 className="text-sm font-semibold">{session.agent}</h1>
              <p className="text-xs text-muted-foreground">~/Projects/spacevibe-deck</p>
            </div>
          </div>
          <div className="space-y-5 font-mono text-xs leading-6">
            <div className="rounded-lg bg-muted px-4 py-3">
              <p className="text-muted-foreground">You</p>
              <p>Replace the Settings controls with shadcn. Keep the existing behavior.</p>
            </div>
            <p>I’ll start with the shared controls, then connect them to Settings.</p>
            <div className="space-y-1 text-muted-foreground">
              <p>
                <span className="text-primary">✓</span> Read the Settings registry and existing
                components
              </p>
              <p>
                <span className="text-primary">✓</span> Added the Base UI primitives
              </p>
              <p>
                <span className="text-primary">✓</span> Kept preference updates and reset behavior
              </p>
            </div>
            <div className="border-l-2 border-border pl-4">
              <p className="text-muted-foreground">$ npm test -- src/ui/controls</p>
              <p>
                Test Files <span className="text-primary">4 passed</span>
              </p>
              <p>
                Tests <span className="text-primary">28 passed</span>
              </p>
              <p className="text-muted-foreground">Sample output</p>
            </div>
            <p>The first pass is ready. Review the controls before moving to the next surface.</p>
            {submitted.value && (
              <p className="rounded-lg bg-muted px-4 py-3">You: {submitted.value}</p>
            )}
          </div>
          <form
            className="mt-auto flex items-center gap-2 pt-8"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.value.trim()) submitted.value = draft.value.trim();
              draft.value = "";
            }}
          >
            <Input
              aria-label="Preview message"
              placeholder="Send a message…"
              value={draft.value}
              onInput={(event) => {
                draft.value = event.currentTarget.value;
              }}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send preview message"
              disabled={!draft.value.trim()}
            >
              <PreviewIcon name="arrow" />
            </Button>
          </form>
        </section>
        <aside
          className="border-t bg-muted/20 p-5 xl:border-t-0 xl:border-l"
          aria-label="Session details"
        >
          <h2 className="mb-4 text-xs font-semibold">Session</h2>
          <dl className="space-y-3 text-xs">
            {[
              ["Agent", session.agent],
              ["Status", session.state],
              ["Branch", "shadcn-base-ui"],
              ["Started", "12 minutes ago"],
            ].map(([key, value]) => (
              <div className="flex items-center justify-between gap-3" key={key}>
                <dt className="text-muted-foreground">{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-7 flex items-center justify-between border-t pt-5">
            <h2 className="text-xs font-semibold">Changes</h2>
            <Badge variant="outline">4 files</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {CHANGED_FILES.map((file) => (
              <div key={file.name} className="flex items-center gap-2 text-xs">
                <PreviewIcon name="changes" />
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name.split("/").at(-1)}
                </span>
                <span className="text-primary">+{file.added}</span>
              </div>
            ))}
          </div>
          <Button variant="outline" className="mt-5 w-full" onClick={onChanges}>
            Review changes <PreviewIcon name="arrow" />
          </Button>
          <p className="mt-8 text-xs leading-5 text-muted-foreground">
            This is a gallery session. Messages and changes stay in this preview.
          </p>
        </aside>
      </div>
    </div>
  );
}

const DAILY_USAGE = [24, 36, 22, 48, 40, 65, 52, 45, 74, 58, 83, 68, 92, 76];
const MODELS = [
  { name: "Claude", sessions: 24, tokens: "8.4M", cost: "$18.42", share: 58 },
  { name: "Codex", sessions: 18, tokens: "5.2M", cost: "$10.76", share: 34 },
  { name: "Gemini CLI", sessions: 6, tokens: "1.1M", cost: "$2.54", share: 8 },
] as const;

export function UsagePreview() {
  const period = useSignal("14 days");
  return (
    <div className="mx-auto w-full max-w-4xl space-y-7 p-5 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Usage</h1>
          <p className="mt-1 text-xs text-muted-foreground">Sample activity across your agents.</p>
        </div>
        <div className="flex gap-1" aria-label="Usage period">
          {["7 days", "14 days"].map((value) => (
            <Button
              key={value}
              variant={period.value === value ? "secondary" : "ghost"}
              aria-pressed={period.value === value}
              onClick={() => {
                period.value = value;
              }}
            >
              {value}
            </Button>
          ))}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-5 border-y py-5 md:grid-cols-4">
        {[
          ["Estimated cost", "$31.72"],
          ["Tokens", "14.7M"],
          ["Sessions", "48"],
          ["Active projects", "3"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <section aria-label={`Sample daily usage over ${period.value}`}>
        <div className="mb-6 flex items-center justify-between text-xs">
          <h2 className="font-medium">Daily activity</h2>
          <span className="text-muted-foreground">{period.value} · sample values</span>
        </div>
        <div className="flex h-40 items-end gap-2 border-b" aria-hidden="true">
          {DAILY_USAGE.slice(period.value === "7 days" ? 7 : 0).map((value, index) => (
            <div
              key={`${index}-${value}`}
              className="flex-1 rounded-t-sm bg-primary/80"
              style={{ height: `${value}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{period.value === "7 days" ? "Oct 15" : "Oct 8"}</span>
          <span>Oct 21</span>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-medium">By agent</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Agent", "Sessions", "Tokens", "Estimated cost"].map((label) => (
                  <th key={label} className="px-4 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODELS.map((model) => (
                <tr key={model.name} className="border-t">
                  <td className="px-4 py-4 font-medium">
                    {model.name}
                    <div className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${model.share}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-4 tabular-nums">{model.sessions}</td>
                  <td className="px-4 py-4 tabular-nums">{model.tokens}</td>
                  <td className="px-4 py-4 tabular-nums">{model.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const DIFF_LINES = [
  ["context", 'import { useSignal } from "@preact/signals";'],
  ["removed", 'import { ToggleRow } from "../controls/config-row";'],
  ["added", 'import { Switch } from "../controls/switch";'],
  ["context", ""],
  ["context", "export function Notifications() {"],
  ["context", "  const enabled = useSignal(true);"],
  ["context", "  return ("],
  ["removed", '    <ToggleRow label="Notifications" value={enabled.value} />'],
  ["added", "    <Switch"],
  ["added", '      aria-label="Notifications"'],
  ["added", "      checked={enabled.value}"],
  ["added", "      onCheckedChange={(value) => { enabled.value = value; }}"],
  ["added", "    />"],
  ["context", "  );"],
  ["context", "}"],
] as const;

export function ChangesPreview() {
  const selected = useSignal(2);
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-sm font-semibold">Changes</h1>
          <p className="mt-1 text-xs text-muted-foreground">shadcn-base-ui · 4 files</p>
        </div>
        <Badge variant="secondary">Uncommitted</Badge>
      </header>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          className="space-y-1 border-b p-3 lg:border-r lg:border-b-0"
          aria-label="Changed files"
        >
          {CHANGED_FILES.map((file, index) => (
            <Button
              key={file.name}
              variant={selected.value === index ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-pressed={selected.value === index}
              onClick={() => {
                selected.value = index;
              }}
            >
              <PreviewIcon name="changes" />
              <span className="truncate">{file.name.split("/").at(-1)}</span>
            </Button>
          ))}
        </nav>
        <section className="min-w-0" aria-label="Illustrative code diff">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3 text-xs">
            <span className="truncate font-mono">{CHANGED_FILES[selected.value].name}</span>
            <span className="shrink-0 text-muted-foreground">Sample diff</span>
          </div>
          <div className="overflow-x-auto py-4 font-mono text-xs leading-7">
            {DIFF_LINES.map(([kind, line], index) => (
              <div
                key={`${index}-${kind}`}
                className={`flex min-w-max px-4 ${kind === "added" ? "bg-primary/10 text-primary" : kind === "removed" ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
              >
                <span className="w-9 select-none text-right opacity-50">{index + 1}</span>
                <span className="w-8 text-center">
                  {kind === "added" ? "+" : kind === "removed" ? "−" : " "}
                </span>
                <span className="whitespace-pre">{line || " "}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
