import { Settings02Icon, SlidersHorizontalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { LaunchCommandChoices } from "../lib/launch-command";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import "./agent-launch-page.css";

export interface LaunchProfileSection {
  readonly id: string;
  readonly label: string;
  readonly choices: LaunchCommandChoices;
  /** The command a press of this agent types now: its pick, else its default. */
  readonly active: string;
}

interface LaunchProfilePopoverProps {
  /** One section per installed agent on the page, in page order. */
  readonly sections: readonly LaunchProfileSection[];
  readonly onPick: (agentId: string, command: string) => void;
  /** Settings → Agents, where profiles are written. */
  readonly onEditProfiles: () => void;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * DL-13.1 / DL-32.6: the chip at the preview line's right end and its anchored
 * popover — each installed agent's launch commands, a check on the active one
 * and `default` on the default. A pick is the page's, for this visit only
 * (DL-32.6's no-state rule); this component owns only whether it is open and
 * where focus sits. Menu keys follow `WorkspacePicker`.
 */
export function LaunchProfilePopover(props: LaunchProfilePopoverProps) {
  const open = useSignal(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const custom = props.sections.some((section) => section.active !== section.choices.default);
  const rows = (): HTMLButtonElement[] =>
    Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);

  // Focus moves in only when the menu opens, never when a pick resolves.
  useLayoutEffect(() => {
    if (!open.value) return;
    const checked = root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? rows()[0])?.focus();
  }, [open.value]);

  useEffect(() => {
    if (!open.value) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        open.value = false;
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open.value, open]);

  function close(): void {
    open.value = false;
    trigger.current?.focus();
  }

  function navigate(event: KeyboardEvent): void {
    if (!open.value) return;
    if (event.key === "Escape") {
      // The page leaves on a bare Escape; the menu answers it first.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!NAV_KEYS.has(event.key)) return;
    event.preventDefault();
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <div
      class="launch-profile"
      ref={root}
      onKeyDown={navigate}
      onFocusOut={(event) => {
        if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) {
          open.value = false;
        }
      }}
    >
      <button
        type="button"
        class="launch-profile__trigger"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open.value}
        title="Launch profile: the command each agent starts with"
        onClick={() => {
          open.value = !open.value;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open.value) {
            event.preventDefault();
            event.stopPropagation();
            open.value = true;
          }
        }}
      >
        <DeckIcon icon={SlidersHorizontalIcon} size={GLYPH_ROW} />
        {custom ? "Custom profile" : "Default profile"}
      </button>
      {open.value ? (
        <div class="launch-profile__menu" role="menu" aria-label="Launch profile">
          {/* Only the commands scroll: the Settings row below stays in reach. */}
          <div class="launch-profile__list">
            {props.sections.map((section) => (
              <div key={section.id} role="group" aria-label={section.label}>
                <div class="launch-profile__section">
                  <AgentGlyph
                    agent={section.id.startsWith("custom:") ? section.label : section.id}
                    className="launch-profile__glyph"
                  />
                  {section.label}
                </div>
                {section.choices.commands.map((command) => {
                  const selected = command === section.active;
                  return (
                    <button
                      key={command}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      tabIndex={-1}
                      title={command}
                      onClick={() => {
                        close();
                        props.onPick(section.id, command);
                      }}
                    >
                      {selected ? (
                        <DeckIcon icon={Tick02Icon} size={GLYPH_ROW} />
                      ) : (
                        <span class="launch-profile__check" />
                      )}
                      <span class="launch-profile__command">{command}</span>
                      {command === section.choices.default ? (
                        <span class="launch-profile__default">default</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div class="launch-profile__separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close();
              props.onEditProfiles();
            }}
          >
            <DeckIcon icon={Settings02Icon} size={GLYPH_ROW} />
            <span class="launch-profile__command">Edit profiles in Settings…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
