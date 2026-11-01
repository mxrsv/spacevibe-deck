import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import type { ThemeDef } from "./theme-data";

const LINES = [
  { ink: "term-accent", width: "62%" },
  { ink: "term-ok", width: "44%" },
  { ink: "term-err", width: "52%" },
  { ink: "term-dim", width: "30%" },
] as const;

/** A miniature of the shell painted only from the theme's own colours. */
function Preview({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <div
      className="flex h-[68px] overflow-hidden rounded-sm"
      style={{ background: c["term-bg"], border: `1px solid ${c.border}` }}
      aria-hidden="true"
    >
      <div
        className="flex w-[22%] flex-col gap-1 p-1.5"
        style={{ background: c.sidebar, borderRight: `1px solid ${c["sidebar-border"]}` }}
      >
        <span className="h-1 rounded-full" style={{ background: c["sidebar-primary"] }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: c["muted-foreground"] }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: c["muted-foreground"] }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between p-1.5">
        <div className="flex flex-col gap-1">
          {LINES.map((line) => (
            <span
              key={line.ink}
              className="h-1 rounded-full"
              style={{ width: line.width, background: c[line.ink] }}
            />
          ))}
        </div>
        <span
          className="h-2.5 w-9 self-end rounded-sm"
          style={{ background: c.primary, border: `1px solid ${c.ring}` }}
        />
      </div>
    </div>
  );
}

interface CardProps {
  theme: ThemeDef;
  selected: boolean;
  custom: boolean;
  onPick: () => void;
  onHover: (on: boolean) => void;
}

export function ThemeCard({ theme, selected, custom, onPick, onHover }: CardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-card p-1.5 text-left text-xs text-card-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "border-ring ring-1 ring-ring" : "border-border",
      )}
    >
      <Preview theme={theme} />
      <span className="flex items-center justify-between gap-1 px-0.5">
        <span className="truncate font-medium">{theme.label}</span>
        {custom && <span className="text-3xs text-muted-foreground">Custom</span>}
        {selected && (
          <HugeiconsIcon
            icon={Tick02Icon}
            strokeWidth={2.5}
            className="size-3 shrink-0 text-primary"
            aria-label="Selected"
          />
        )}
      </span>
    </button>
  );
}
