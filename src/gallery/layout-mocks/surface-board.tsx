import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "../../ui/controls/badge";
import { ToggleGroup, ToggleGroupItem } from "../../ui/controls/toggle-group";
import { DEFAULT_FOCUS, agentById } from "./layout-fixture";
import { OptionInbox } from "./option-inbox";
import { SURFACES } from "./surfaces/surface-registry";
import type { SurfaceArea, SurfaceOption, SurfaceSpec } from "./surfaces/surface-types";

const AREA_LABEL: Readonly<Record<SurfaceArea, string>> = {
  "chrome-only": "Chrome only",
  "terminal-area": "Terminal area",
  "needs-new-signal": "Needs new signal",
};

export function surfaceById(id: string | null): SurfaceSpec | undefined {
  return SURFACES.find((surface) => surface.id === id);
}

/** Every option of a surface is a panel, so the board can lay them side by side. */
function comparable(surface: SurfaceSpec): boolean {
  return surface.options.every((option) => option.frame === "panel");
}

function Caption({ option, picked }: { readonly option: SurfaceOption; readonly picked: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-1 pb-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">
          {option.id.toUpperCase()} · {option.label}
        </span>
        {picked ? <Badge>Picked</Badge> : null}
        {option.area.map((area) => (
          <Badge key={area} variant="outline">
            {AREA_LABEL[area]}
          </Badge>
        ))}
      </div>
      <p className="m-0 text-xs text-muted-foreground">{option.concept}</p>
    </div>
  );
}

function PanelColumn({
  option,
  picked,
}: {
  readonly option: SurfaceOption & { frame: "panel" };
  readonly picked: boolean;
}) {
  const agent = agentById(option.focus ?? DEFAULT_FOCUS);
  return (
    <section className="flex min-h-0 shrink-0 flex-col" style={{ width: option.width }}>
      <Caption option={option} picked={picked} />
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
        {option.render(agent, () => undefined)}
      </div>
    </section>
  );
}

/**
 * One surface's options. Panel options compare side by side unless one is picked; a shell
 * option renders inside the hybrid shell through its slots, one at a time.
 */
export function SurfaceBoard({
  surface,
  optionId,
}: {
  readonly surface: SurfaceSpec;
  readonly optionId: string | null;
}) {
  const picked = surface.options.find((option) => option.id === optionId);
  const shown = picked ?? (comparable(surface) ? null : surface.options[0]);
  const ids = surface.options.map((option) => option.id).join(",");

  if (shown?.frame === "shell") {
    return (
      <div className="h-full" data-surface={surface.id} data-surface-options={ids}>
        <OptionInbox
          key={shown.id}
          initialFocus={shown.focus ?? DEFAULT_FOCUS}
          overlay={null}
          slots={shown.slots}
          dockOpen={shown.dock !== "closed"}
        />
      </div>
    );
  }

  if (shown?.frame === "overview") {
    return (
      <div className="h-full" data-surface={surface.id} data-surface-options={ids}>
        {shown.render()}
      </div>
    );
  }

  const columns = shown ? [shown] : surface.options;
  return (
    <div
      className="flex h-full gap-6 overflow-x-auto bg-muted/40 p-6"
      data-surface={surface.id}
      data-surface-options={ids}
    >
      {columns.map((option) =>
        option.frame === "panel" ? (
          <PanelColumn key={option.id} option={option} picked={option.id === surface.picked} />
        ) : null,
      )}
    </div>
  );
}

/** The floating controls for a surface board: surface, option, and the option's concept. */
export function SurfaceBar({
  surfaceId,
  optionId,
  onSurface,
  onOption,
}: {
  readonly surfaceId: string;
  readonly optionId: string | null;
  readonly onSurface: (id: string) => void;
  readonly onOption: (id: string | null) => void;
}) {
  const surface = surfaceById(surfaceId);
  if (!surface) return null;
  const all = comparable(surface);
  const value = optionId ?? (all ? "all" : surface.options[0]?.id);
  const option = surface.options.find((item) => item.id === value);
  return (
    <div className="flex max-w-[720px] flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="Surface"
          value={[surfaceId]}
          onValueChange={(next: unknown[]) => {
            if (typeof next[0] === "string") onSurface(next[0]);
          }}
        >
          {SURFACES.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id} size="sm">
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label="Option"
          value={value ? [value] : []}
          onValueChange={(next: unknown[]) => {
            const id = next[0];
            if (typeof id === "string") onOption(id === "all" ? null : id);
          }}
        >
          {all ? (
            <ToggleGroupItem value="all" size="sm">
              All
            </ToggleGroupItem>
          ) : null}
          {surface.options.map((item) => (
            <ToggleGroupItem
              key={item.id}
              value={item.id}
              size="sm"
              aria-label={
                item.id === surface.picked ? `${item.id.toUpperCase()}, picked` : undefined
              }
            >
              {item.id.toUpperCase()}
              {item.id === surface.picked ? (
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} aria-hidden="true" />
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="m-0 px-1 text-xs text-muted-foreground">
        {option
          ? `${option.label}${option.id === surface.picked ? " (picked)" : ""}: ${option.concept}`
          : `Today: ${surface.today}`}
      </p>
    </div>
  );
}
