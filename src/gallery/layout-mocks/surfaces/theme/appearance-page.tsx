import { useSignal } from "@preact/signals";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download04Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/ui/controls/button";
import { ToggleGroup, ToggleGroupItem } from "@/ui/controls/toggle-group";
import { THEMES, type Appearance, type ThemeDef } from "./theme-data";
import { ThemeCard } from "./appearance-card";
import { ImportPanel } from "./appearance-import";
import {
  addCustomTheme,
  allThemes,
  mode,
  pickTheme,
  previewId,
  selectedTheme,
  slots,
  themeById,
  type Mode,
} from "./theme-state";

const MODES: readonly { id: Mode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const BUILT_IN = new Set(THEMES.map((theme) => theme.id));

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Slot({ label, theme }: { label: string; theme: ThemeDef }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-card px-3 py-1.5">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{theme.label}</span>
    </div>
  );
}

/** Settings, Appearance page: mode, the light and dark slots, the theme gallery, import and export. */
export function AppearancePage() {
  const importing = useSignal(false);
  const copied = useSignal(false);
  const selected = selectedTheme.value;
  const exportSelected = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
    } catch {
      return;
    }
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1600);
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <Section title="Mode">
        <ToggleGroup
          variant="outline"
          spacing={0}
          value={[mode.value]}
          onValueChange={(next) => next[0] && (mode.value = next[0] as Mode)}
          aria-label="Mode"
          className="self-start"
        >
          {MODES.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id} className="px-4">
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex max-w-[420px] gap-2">
          {mode.value === "system" ? (
            <>
              <Slot label="Light theme" theme={themeById(slots.value.light)} />
              <Slot label="Dark theme" theme={themeById(slots.value.dark)} />
            </>
          ) : (
            <Slot label="Theme" theme={selected} />
          )}
        </div>
      </Section>
      {(["light", "dark"] as readonly Appearance[]).map((appearance) => (
        <Section key={appearance} title={appearance === "light" ? "Light" : "Dark"}>
          <div role="radiogroup" className="grid grid-cols-3 gap-3">
            {allThemes.value
              .filter((theme) => theme.appearance === appearance)
              .map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  custom={!BUILT_IN.has(theme.id)}
                  selected={slots.value[appearance] === theme.id}
                  onPick={() => pickTheme(theme)}
                  onHover={(on) => {
                    if (on) previewId.value = theme.id;
                    else if (previewId.value === theme.id) previewId.value = null;
                  }}
                />
              ))}
          </div>
        </Section>
      ))}
      <div className="flex items-center gap-2">
        <Button
          variant={importing.value ? "secondary" : "outline"}
          aria-expanded={importing.value}
          onClick={() => (importing.value = !importing.value)}
        >
          <HugeiconsIcon
            icon={Upload04Icon}
            strokeWidth={2}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Import
        </Button>
        <Button variant="outline" onClick={exportSelected}>
          <HugeiconsIcon
            icon={Download04Icon}
            strokeWidth={2}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Export
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {copied.value ? "Copied" : ""}
        </span>
      </div>
      {importing.value ? (
        <ImportPanel
          taken={new Set(allThemes.value.map((theme) => theme.id))}
          onAdd={(theme) => {
            addCustomTheme(theme);
            importing.value = false;
          }}
        />
      ) : null}
    </div>
  );
}
