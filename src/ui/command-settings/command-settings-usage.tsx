import { ChartHistogramIcon } from "@hugeicons/core-free-icons";
import { settingsOpen } from "../../chrome/events";
import { openDockTab } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { RowShell } from "./command-settings-live-row";

/**
 * Token usage lives in the dock: the row closes Settings and opens that tab. It writes the two
 * signals directly, as the legacy row does, instead of closing through the app's helper, which
 * hands focus back to the active pane while the dock's tab is the one that must take it. The
 * legacy row used `revealDockTab`, which closes a dock already showing Usage; a button that says
 * open should not put the dock away, so this one uses `openDockTab`.
 */
export function UsageRow() {
  return (
    <RowShell
      itemKey="piece:agents:usage"
      active={false}
      changed={false}
      label="Token usage"
      crumb={null}
      reset={null}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Open token usage"
                onClick={() => {
                  settingsOpen.value = false;
                  openDockTab("usage");
                }}
              />
            }
          >
            <DeckIcon icon={ChartHistogramIcon} />
          </TooltipTrigger>
          <TooltipContent>Tokens and estimated cost for Claude Code and Codex</TooltipContent>
        </Tooltip>
      }
    />
  );
}
