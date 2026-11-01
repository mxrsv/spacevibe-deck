import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import { useEffect } from "preact/hooks";
import { Badge } from "../../../../ui/controls/badge";
import { Button } from "../../../../ui/controls/button";
import { Input } from "../../../../ui/controls/input";
import { Kbd } from "../../../../ui/controls/kbd";
import { ToggleGroup, ToggleGroupItem } from "../../../../ui/controls/toggle-group";
import { DEFAULT_FOCUS } from "../../layout-fixture";
import { OptionHybrid } from "../../option-hybrid";
import type { OverviewOption } from "../surface-types";
import { AppearancePage } from "../theme/appearance-page";
import { AREAS, areaById, type AreaId } from "./settings-data";
import { HEALTH } from "./settings-setup-data";
import { refocusSearch } from "./settings-option-a-controls";
import { ResetDialog } from "./settings-option-a-dialog";
import { handleKey, enterLabel } from "./settings-option-a-keys";
import {
  AgentRow,
  AreaRow,
  EmptyRow,
  Head,
  HealthRow,
  PrivacyBlock,
  ResetRow,
  SettingRow,
  ShortcutRow,
  TypePreview,
  UpdateRow,
} from "./settings-option-a-rows";
import {
  activeKey,
  closePanel,
  liveHealth,
  open,
  query,
  recording,
  resolveHealth,
  retrySave,
  save,
  scope,
} from "./settings-option-a-state";
import { buildItems, isNavigable, type Item } from "./settings-option-a-view";

function SaveStatus() {
  const state = save.value;
  return (
    <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-foreground">
      {state === "saved" ? (
        <>
          <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} aria-hidden="true" />
          Saved
        </>
      ) : state === "saving" ? (
        "Saving…"
      ) : (
        <>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />
          Couldn't save
          <Button variant="outline" size="xs" onClick={retrySave}>
            Retry
          </Button>
        </>
      )}
    </span>
  );
}

function Hint({ keys, label }: { readonly keys: string; readonly label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
      {label}
    </span>
  );
}

function Footer({ enter, esc }: { readonly enter: string | null; readonly esc: string }) {
  return (
    <footer className="flex h-9 shrink-0 items-center gap-4 border-t px-4 text-xs text-muted-foreground">
      <SaveStatus />
      <span className="ml-auto flex items-center gap-4">
        <Hint keys="↑↓" label="Move" />
        {enter ? <Hint keys="↵" label={enter} /> : null}
        <Hint keys="Esc" label={esc} />
      </span>
    </footer>
  );
}

function SearchField() {
  const area = scope.value;
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-input/20 px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30">
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
      {area ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <Badge variant="secondary">{areaById(area).label}</Badge>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Leave ${areaById(area).label}`}
            onClick={() => {
              scope.value = null;
              refocusSearch();
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        </span>
      ) : null}
      <Input
        id="a-search"
        aria-label="Search settings"
        placeholder={area ? "Filter" : "Search settings, agents, shortcuts"}
        autoComplete="off"
        spellcheck={false}
        value={query.value}
        className="h-8 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
        onInput={(event: Event) => {
          query.value = (event.target as HTMLInputElement).value;
        }}
      />
    </div>
  );
}

function AreaChips() {
  return (
    <ToggleGroup
      aria-label="Areas"
      size="sm"
      spacing={1}
      className="flex-wrap"
      value={scope.value ? [scope.value] : []}
      onValueChange={(next: unknown[]) => {
        scope.value = (next[0] as AreaId | undefined) ?? null;
        activeKey.value = null;
        refocusSearch();
      }}
    >
      {AREAS.map((area) => (
        <ToggleGroupItem key={area.id} value={area.id}>
          {area.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function renderItem(item: Item, active: boolean, single: boolean, updated: boolean) {
  switch (item.t) {
    case "head":
      return <Head key={item.key} title={item.title} />;
    case "health":
      return <HealthRow key={item.key} issue={item.issue} active={active} />;
    case "setting":
      return (
        <SettingRow key={item.key} setting={item.setting} active={active} crumb={item.crumb} />
      );
    case "agent":
      return <AgentRow key={item.key} config={item.config} active={active} single={single} />;
    case "shortcut":
      return (
        <ShortcutRow key={item.key} shortcut={item.shortcut} active={active} crumb={item.crumb} />
      );
    case "area":
      return <AreaRow key={item.key} area={item.area} active={active} />;
    case "preview":
      return <TypePreview key={item.key} />;
    case "themes":
      return (
        <div key={item.key} className="px-3 py-2">
          <AppearancePage />
        </div>
      );
    case "update":
      return (
        <UpdateRow
          key={item.key}
          active={active}
          updated={updated}
          onUpdate={() => {
            const issue = HEALTH.find((entry) => entry.id === "update");
            if (issue) resolveHealth(issue);
          }}
        />
      );
    case "privacy":
      return <PrivacyBlock key={item.key} />;
    case "reset":
      return <ResetRow key={item.key} id={item.id} label={item.label} active={active} />;
    case "empty":
      return <EmptyRow key={item.key} text={item.text} />;
  }
}

function Panel() {
  const items = buildItems(query.value, scope.value);
  const navs = items.filter(isNavigable);
  const current = navs.find((item) => item.key === activeKey.value) ?? navs[0] ?? null;
  const single =
    query.value.trim() !== "" && items.filter((item) => item.t === "agent").length === 1;
  const updated = !liveHealth().some((issue) => issue.id === "update");
  const esc = recording.value ? "Cancel" : query.value ? "Clear" : scope.value ? "Back" : "Close";

  useEffect(() => {
    refocusSearch();
  }, []);
  const currentKey = current?.key;
  useEffect(() => {
    if (currentKey)
      document.getElementById(`a-row-${currentKey}`)?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/55 pt-[64px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <section
        role="dialog"
        aria-label="Settings"
        className={cn(
          "flex max-h-[calc(100%-128px)] w-[760px] max-w-[calc(100%-48px)] flex-col overflow-hidden rounded-xl bg-background text-foreground ring-1 ring-foreground/15",
        )}
      >
        <header className="flex shrink-0 flex-col gap-2 border-b p-3">
          <SearchField />
          <AreaChips />
        </header>
        <div
          role="region"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5"
        >
          {items.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-muted-foreground">
              Nothing needs attention
            </div>
          ) : (
            items.map((item) => renderItem(item, item.key === current?.key, single, updated))
          )}
        </div>
        <Footer enter={current ? enterLabel(current, single) : null} esc={esc} />
      </section>
      <ResetDialog />
    </div>
  );
}

export function SettingsOverlay() {
  useEffect(() => {
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, []);
  return open.value ? <Panel /> : null;
}

function SettingsBoard() {
  useEffect(() => {
    open.value = true;
  }, []);
  return <OptionHybrid initialFocus={DEFAULT_FOCUS} overlay={null} />;
}

/** Option A: one search field is the navigation; every setting is a live row in the list. */
export const SETTINGS_A: OverviewOption = {
  id: "a",
  label: "Command",
  concept:
    "One search field is the navigation: type to reach any setting, agent field or shortcut as a live row you edit in place. Appearance carries the theme gallery.",
  area: ["chrome-only"],
  frame: "overview",
  render: () => <SettingsBoard />,
};
