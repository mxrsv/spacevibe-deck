import { ClockCounterClockwise } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { AgentGlyph } from "../controls/agent-glyph";
import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";
import type { SessionAgent } from "../../lib/session-history";
import { filterSessions, type AgentFilter } from "../../sessions/session-filters";
import { sessionAgentFilter, sessionEntries } from "../../sessions/sessions-store";

/**
 * Id of the one panel every rail item controls. This rail filters a single
 * list in place rather than switching between separate view components, so
 * — unlike `usage-nav.tsx`'s per-view `viewTabId` — there is exactly one
 * panel id, defined once here and consumed by `sessions-screen.tsx`.
 */
export const SESSIONS_PANEL_ID = "sessions-view-panel";

/** Id of a rail item's tab — the panel points back at it via `aria-labelledby`. */
export function sessionsTabId(agent: AgentFilter): string {
  return `sessions-tab-${agent}`;
}

interface SessionsNavItem {
  readonly agent: AgentFilter;
  readonly label: string;
  /**
   * What the compact row prints. A chip beside two others in a 360px column
   * has no room for the full name, and the full one stays the accessible
   * name — which still CONTAINS this (WCAG 2.5.3), so the two never disagree.
   */
  readonly short: string;
}

/** DL-11.4: sentence-case labels; "Claude Code" and "Codex" are product
 *  names and keep their capitals (the 2026-08-15 casing fork). */
const SESSIONS_NAV_ITEMS: readonly SessionsNavItem[] = [
  { agent: "all", label: "All sessions", short: "All" },
  { agent: "claude", label: "Claude Code", short: "Claude" },
  { agent: "codex", label: "Codex", short: "Codex" },
];

/** DL-25.2's mark, reused on the filter that selects that same agent: `all`
 *  has no brand, so it keeps the surface's own history glyph. */
function NavGlyph({ agent }: { readonly agent: AgentFilter }) {
  return agent === "all" ? (
    <DeckIcon icon={ClockCounterClockwise} size={RAIL_ICON} />
  ) : (
    <AgentGlyph agent={agent as SessionAgent} className="sessions-nav__logo" />
  );
}

/**
 * The sessions rail: filters the list by agent instead of switching between
 * separate views, because this screen's one section has no natural
 * multi-view split (plan's "Open decision" for §25). Copied from
 * `usage-nav.tsx`: same `role="tablist"` semantics, the same `↑`/`↓`
 * wraparound formula `(index + step + length) % length`, the same
 * "there is no foot" rule (DL-11.5) — this screen has no destructive action.
 *
 * Click sets `sessionAgentFilter.value` directly — a module signal, no prop
 * callback, the same idiom `usage-nav.tsx` and `settings-nav.tsx` use (R5).
 *
 * `variant="compact"` (DL-19.8, 2026-08-16) lays the same tablist out as a
 * short chip row instead of a column. It exists because this surface no
 * longer has a full window to spend: inside a 360–560px docked column the
 * rail ate a fixed 120px and still clipped every label to `Cla…`, which is a
 * rail paying prose-width rent while delivering none of it.
 */
interface SessionsNavProps {
  readonly variant?: "rail" | "compact";
}
export function SessionsNav({ variant = "rail" }: SessionsNavProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const compact = variant === "compact";

  const selectItem = (index: number): void => {
    sessionAgentFilter.value = SESSIONS_NAV_ITEMS[index].agent;
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    // A tablist is walked along the axis it is laid out on, so the compact
    // row answers ←/→ and the rail keeps ↑/↓. Same wraparound formula.
    const next = compact ? "ArrowRight" : "ArrowDown";
    const previous = compact ? "ArrowLeft" : "ArrowUp";
    let step: 1 | -1;
    if (event.key === next) {
      step = 1;
    } else if (event.key === previous) {
      step = -1;
    } else {
      return;
    }
    event.preventDefault();
    const length = SESSIONS_NAV_ITEMS.length;
    const currentIndex = SESSIONS_NAV_ITEMS.findIndex(
      (item) => item.agent === sessionAgentFilter.value,
    );
    const from = currentIndex === -1 ? 0 : currentIndex;
    selectItem((from + step + length) % length);
  };

  return (
    <nav
      class={`sessions-nav ${compact ? "sessions-nav--compact" : ""}`}
      aria-label="Session filters"
    >
      <div
        class="sessions-nav__list"
        role="tablist"
        aria-orientation={compact ? "horizontal" : "vertical"}
        onKeyDown={handleKeyDown}
      >
        {SESSIONS_NAV_ITEMS.map((item, index) => {
          const isActive = item.agent === sessionAgentFilter.value;
          // Spec §3.2 / this task's interface: each item's count is the
          // filtered length for that agent alone, project unfiltered.
          const count = filterSessions(sessionEntries.value, {
            agent: item.agent,
            project: null,
          }).length;
          return (
            <button
              key={item.agent}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              id={sessionsTabId(item.agent)}
              role="tab"
              aria-selected={isActive}
              aria-controls={SESSIONS_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              class={`sessions-nav__item ${isActive ? "is-active" : ""}`}
              aria-label={compact ? item.label : undefined}
              onClick={() => selectItem(index)}
            >
              {/* DL-11.3: rail icons through DeckIcon at 16px; an agent's own
                  brand mark where it has one, so the filter and the rows it
                  filters name the agent the same way. */}
              <NavGlyph agent={item.agent} />
              <span class="sessions-nav__label">{compact ? item.short : item.label}</span>
              <span class="sessions-nav__count">{count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
