import { useState } from "preact/hooks";
import { Button } from "@/ui/controls/button";
import { parseOklch } from "./theme-color";
import { TOKEN_GROUPS, THEMES, type ThemeColors, type ThemeDef } from "./theme-data";

const TOKEN_KEYS = new Set<string>(TOKEN_GROUPS.flatMap((group) => [...group.keys]));
const PLACEHOLDER =
  '{ "id": "my-theme", "label": "My theme", "appearance": "dark", "colors": { "primary": "oklch(0.76 0.13 200)" } }';

/** Parses pasted theme JSON; tokens left out fall back to the built-in theme of that appearance. */
export function parseTheme(text: string, taken: ReadonlySet<string>): ThemeDef | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return `Not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`;
  }
  if (typeof raw !== "object" || raw === null) return "Expected an object.";
  const { id, label, appearance, colors } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) return "id must be lowercase kebab-case.";
  if (taken.has(id)) return `A theme with id "${id}" already exists.`;
  if (typeof label !== "string" || !label.trim()) return "label is required.";
  if (appearance !== "light" && appearance !== "dark")
    return 'appearance must be "light" or "dark".';
  if (typeof colors !== "object" || colors === null) return "colors must be an object.";
  const entries = Object.entries(colors as Record<string, unknown>);
  const unknown = entries.map(([key]) => key).filter((key) => !TOKEN_KEYS.has(key));
  if (unknown.length) return `Unknown token${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`;
  const bad = entries.find(([, value]) => typeof value !== "string" || !parseOklch(value));
  if (bad) return `${bad[0]} is not an oklch() colour.`;
  const base = THEMES.find((theme) => theme.appearance === appearance) ?? THEMES[0];
  return {
    id,
    label: label.trim(),
    appearance,
    colors: { ...base.colors, ...Object.fromEntries(entries) } as ThemeColors,
  };
}

export function ImportPanel({
  taken,
  onAdd,
}: {
  taken: ReadonlySet<string>;
  onAdd: (theme: ThemeDef) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const result = parseTheme(text, taken);
    if (typeof result === "string") return setError(result);
    onAdd(result);
    setText("");
    setError(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={text}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setError(null);
        }}
        placeholder={PLACEHOLDER}
        spellcheck={false}
        aria-label="Theme JSON"
        aria-invalid={error !== null}
        className="h-24 resize-none rounded-md border border-input bg-background p-2 font-mono text-2xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      <div className="flex items-start justify-between gap-2">
        <p role="alert" className="min-h-4 flex-1 text-2xs text-destructive">
          {error}
        </p>
        <Button size="sm" disabled={!text.trim()} onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}
