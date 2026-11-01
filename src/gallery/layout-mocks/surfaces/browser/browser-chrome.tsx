import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Cancel01Icon, CursorPointer01Icon } from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { cn } from "@/lib/cn";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import { Chord } from "../../../../ui/blocks/chord";
import { Kbd } from "../../../../ui/controls/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../ui/controls/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentLogo } from "../../agent-parts";
import { AGENT_NAME, agentById } from "../../layout-fixture";
import { DEV_SERVERS } from "./browser-data";
import { MockLeaderboard } from "./browser-page";
import type { Browser } from "./browser-state";

/**
 * Tooltips open above: the view's rectangle sits under every toolbar, and a tooltip drawn
 * downward would land on the native view.
 */
export function ToolButton({
  label,
  keys,
  pressed,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly keys?: readonly string[];
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: preact.ComponentChildren;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(pressed && "bg-muted text-foreground")}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {keys ? <Chord keys={keys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function Glyph({ icon }: { readonly icon: IconSvgElement }) {
  return <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />;
}

/**
 * The stock dev-server select. Its popup opens downward, so `onOpenChange` lets the view
 * yield the height it needs. `pair` shows the agent that owns the server beside the port.
 */
export function DevServerSelect({
  browser,
  pair,
  className,
}: {
  readonly browser: Browser;
  readonly pair?: boolean;
  readonly className?: string;
}) {
  const label = (port: number) => {
    const item = DEV_SERVERS.find((server) => server.port === port);
    if (!item) return "";
    const agent = item.agentId ? agentById(item.agentId) : null;
    return pair && agent ? (
      <>
        <AgentLogo kind={agent.kind} className="size-3.5" />
        <span className="tabular-nums">:{port}</span>
      </>
    ) : (
      <>
        <span className="tabular-nums">:{port}</span>
        <span className="text-muted-foreground">{item.name}</span>
      </>
    );
  };
  return (
    <span ref={browser.trigger} className={cn("inline-flex shrink-0", className)}>
      <Select
        value={String(browser.port.value)}
        onValueChange={(value) => {
          if (typeof value === "string") browser.port.value = Number(value);
        }}
        onOpenChange={browser.setMenu}
      >
        <SelectTrigger size="default" aria-label="Dev server">
          <SelectValue>{(value: string) => label(Number(value))}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-64">
          {DEV_SERVERS.map((server) => {
            const agent = server.agentId ? agentById(server.agentId) : null;
            return (
              <SelectItem key={server.port} value={String(server.port)}>
                <span className="tabular-nums">:{server.port}</span>
                <span>{server.name}</span>
                {agent ? (
                  <span className="ml-auto flex items-center gap-1.5 pr-5 text-muted-foreground">
                    <AgentLogo kind={agent.kind} className="size-3.5" />
                    {AGENT_NAME[agent.kind]}
                  </span>
                ) : null}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </span>
  );
}

/** Inspect's two live states, drawn in the chrome above the view, never over it. */
export function InspectBar({
  browser,
  agentId,
  onSend,
  className,
}: {
  readonly browser: Browser;
  readonly agentId: string;
  readonly onSend?: (summary: string) => void;
  readonly className?: string;
}) {
  const mode = browser.inspect.value;
  const picked = browser.picked.value;
  const agent = agentById(agentId);
  if (mode === "off") return null;
  return (
    <div
      className={cn("flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs", className)}
      role="status"
    >
      {mode === "pick" ? (
        <>
          <span className="flex size-5 items-center justify-center text-foreground">
            <Glyph icon={CursorPointer01Icon} />
          </span>
          <span className="font-medium text-foreground">Pick an element</span>
          <Kbd className="text-foreground">Esc</Kbd>
        </>
      ) : picked ? (
        <>
          <code
            className="min-w-0 flex-1 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground"
            title={picked.selector}
          >
            {picked.selector}
          </code>
          <Button
            size="sm"
            onClick={() => {
              onSend?.(picked.summary);
              browser.clearPick();
            }}
          >
            Send to {AGENT_NAME[agent.kind]}
          </Button>
          <ToolButton label="Discard element" onClick={browser.clearPick}>
            <Glyph icon={Cancel01Icon} />
          </ToolButton>
        </>
      ) : null}
    </div>
  );
}

/**
 * The native view's rectangle, outlined so the owner can see exactly what the host is asked
 * to place. `emulate` is a device width: narrower than the room it is the rectangle's width,
 * wider it is scaled down to fit.
 */
export function NativeView({
  browser,
  emulate,
}: {
  readonly browser: Browser;
  readonly emulate?: number | null;
}) {
  const rect = useRef<HTMLDivElement>(null);
  const size = useSignal({ width: 0, height: 0 });
  useEffect(() => {
    const node = rect.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      size.value = { width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) };
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [size]);

  const { width, height } = size.value;
  const scaled = emulate && width > 0 && emulate > width ? width / emulate : 1;
  const pageWidth = emulate ?? width;
  return (
    <div ref={browser.area} className="flex min-h-0 flex-1 flex-col gap-1.5 bg-muted/40 p-2">
      <div
        ref={rect}
        data-native-view
        className="relative mx-auto min-h-0 flex-1 overflow-hidden outline-2 outline-offset-2 outline-dashed outline-(--term-info)"
        style={{
          width: emulate ?? "100%",
          maxWidth: "100%",
          marginTop: browser.menuYield.value,
        }}
      >
        <div style={{ width: pageWidth, height: height / scaled, zoom: scaled }}>
          <MockLeaderboard
            width={pageWidth}
            port={browser.port.value}
            picking={browser.inspect.value === "pick"}
            picked={browser.picked.value}
            onPick={browser.pick}
          />
        </div>
      </div>
      <p className="m-0 text-center font-mono text-2xs text-muted-foreground tabular-nums">
        Native view {width} x {height}
        {scaled < 1 ? ` · ${emulate} px emulated` : ""}
      </p>
    </div>
  );
}
