import { useSignal } from "@preact/signals";
import { useLayoutEffect } from "preact/hooks";
import { Button } from "../../ui/controls/button";
import { TooltipProvider } from "../../ui/controls/tooltip";
import { AGENTS, DEFAULT_FOCUS } from "./layout-fixture";
import { OptionHybrid } from "./option-hybrid";
import { SurfaceBar, SurfaceBoard, surfaceById } from "./surface-board";

/**
 * URL contract, so every capture is reproducible:
 * `?mode=dark|light&overlay=<name>&focus=<agent id>&bare=1` opens the overview (the owner's
 * picks composed into one shell); it also takes `&stage=diff|browser`.
 * `?surface=<id>[&option=<id>]` opens a surface board instead.
 * `bare=1` hides the floating controls for screenshots.
 */
export function LayoutMocks() {
  const params = new URLSearchParams(window.location.search);
  const dark = useSignal(params.get("mode") !== "light");
  const focusParam = params.get("focus");
  const initialFocus = AGENTS.some((agent) => agent.id === focusParam)
    ? (focusParam as string)
    : DEFAULT_FOCUS;
  const overlay = params.get("overlay");
  const bare = params.get("bare") === "1";
  const surface = useSignal<string | null>(surfaceById(params.get("surface"))?.id ?? null);
  const surfaceOption = useSignal<string | null>(surface.value ? params.get("option") : null);

  // The overview and the Settings board own the theme (the theme engine reads `?mode=`); the
  // other boards compare options under one plain light or dark class.
  const themed = !surface.value || surface.value === "settings";
  useLayoutEffect(() => {
    if (!themed) {
      document.documentElement.classList.toggle("dark", dark.value);
      document.documentElement.style.colorScheme = dark.value ? "dark" : "light";
    }
    const url = new URL(window.location.href);
    if (!themed) url.searchParams.set("mode", dark.value ? "dark" : "light");
    if (surface.value) {
      url.searchParams.set("surface", surface.value);
      if (surfaceOption.value) url.searchParams.set("option", surfaceOption.value);
      else url.searchParams.delete("option");
    } else {
      url.searchParams.delete("surface");
      url.searchParams.delete("option");
    }
    window.history.replaceState(null, "", url);
  }, [dark.value, surface.value, surfaceOption.value, themed]);
  const board = surfaceById(surface.value);

  return (
    <TooltipProvider>
      <div className="ui-preset h-full bg-background text-foreground">
        {board ? (
          <SurfaceBoard key={board.id} surface={board} optionId={surfaceOption.value} />
        ) : (
          <OptionHybrid initialFocus={initialFocus} overlay={overlay} />
        )}
      </div>
      {bare ? null : (
        <div className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {board ? (
            <SurfaceBar
              surfaceId={board.id}
              optionId={surfaceOption.value}
              onSurface={(id) => {
                surface.value = id;
                surfaceOption.value = null;
              }}
              onOption={(id) => {
                surfaceOption.value = id;
              }}
            />
          ) : null}
          {themed ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dark.value = !dark.value;
              }}
            >
              {dark.value ? "Light" : "Dark"}
            </Button>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
