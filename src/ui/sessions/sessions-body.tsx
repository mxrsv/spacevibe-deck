import type { SessionEntry } from "../../lib/session-history";
import { sessionAgentFilter } from "../../sessions/sessions-store";
import { SessionsNav, sessionsTabId, SESSIONS_PANEL_ID } from "./sessions-nav";
import { SessionsList } from "./sessions-list";

interface SessionsBodyProps {
  /**
   * `"screen"` (default): renders `SessionsNav` and the `tabpanel` section
   * as bare siblings, unwrapped — so a caller's own grid keeps owning their
   * layout exactly as `sessions-screen.tsx`'s `.sessions-screen__grid` did
   * before this extraction (DL-11.1). `"dock"`: wraps the identical two
   * pieces in `.sessions-body--dock` and stacks them — since 2026-08-16 the
   * agent filter is a compact chip ROW above the list rather than a rail
   * beside it (DL-19.8), because a 360-560px column has no prose width to
   * rent out to a second vertical rail. See `styles.css` for both classes.
   */
  variant?: "screen" | "dock";
  onResume(entry: SessionEntry): void;
}

/**
 * The session history screen's content, extracted unchanged out of
 * `sessions-screen.tsx`: the agent-filter rail (`SessionsNav`) and the row
 * list (`SessionsList`) inside its `tabpanel` section. This extraction
 * changes no behaviour — `SessionsScreen` renders `variant="screen"` and its
 * DOM is identical to before this file existed. `variant="dock"` is purely
 * additive: a narrower rail column via CSS, nothing in these components
 * renamed or restructured (session history spec still open on an unmerged
 * branch; keeping this cheap to redo later).
 */
export function SessionsBody({ variant = "screen", onResume }: SessionsBodyProps) {
  const content = (
    <>
      <SessionsNav variant={variant === "dock" ? "compact" : "rail"} />
      <section
        class="sessions-screen__section"
        id={SESSIONS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sessionsTabId(sessionAgentFilter.value)}
      >
        <SessionsList onResume={onResume} />
      </section>
    </>
  );

  if (variant === "dock") {
    return <div class="sessions-body sessions-body--dock">{content}</div>;
  }

  return content;
}
