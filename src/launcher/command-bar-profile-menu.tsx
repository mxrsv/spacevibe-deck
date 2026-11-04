import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../ui/controls/button";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/controls/dropdown-menu";
import type { LaunchProfileSection } from "./launch-profile-popover";
import "./command-bar.css";

export interface CommandBarProfileMenuProps {
  /** One section per agent that can run, in the bar's order. */
  readonly sections: readonly LaunchProfileSection[];
  readonly disabled: boolean;
  readonly onPick: (agentId: string, command: string) => void;
  /** Settings → Agents, where profiles are written. */
  readonly onEditProfiles?: () => void;
}

/**
 * The Run button's caret: each agent's launch commands as a radio group, for this visit only.
 * `LaunchProfilePopover` brings its own trigger chip and styles scoped to the launch page, so
 * the bar renders the same sections through the shared menu control instead.
 */
export function CommandBarProfileMenu(props: CommandBarProfileMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="xl" aria-label="Launch profile" disabled={props.disabled} />}
      >
        <DeckIcon icon={ArrowDown01Icon} size={GLYPH_ROW} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.sections.map((section) => (
          <DropdownMenuGroup key={section.id}>
            <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={section.active}
              onValueChange={(command: string) => props.onPick(section.id, command)}
            >
              {section.choices.commands.map((command) => (
                <DropdownMenuRadioItem key={command} value={command}>
                  <code class="command-bar__command">{command}</code>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
        {props.onEditProfiles === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={props.onEditProfiles}>
              Edit profiles in Settings…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
