import { FolderDashed, Play } from '@phosphor-icons/react';
import { AgentGlyph } from '../controls/agent-glyph';
import { DeckIcon, ROW_ICON } from '../controls/deck-icon';
import { tildify } from '../../lib/process-info';
import { formatRelativeTime } from '../../lib/workspace-recents';
import { SESSION_AGENT_LABELS, type SessionEntry } from '../../lib/session-history';

interface SessionRowProps {
  readonly entry: SessionEntry;
  /** The recorded directory no longer exists; this row cannot resume. */
  readonly dead: boolean;
  readonly homeDir: string;
  onResume(entry: SessionEntry): void;
}

/**
 * One past session (DL §25).
 *
 * DL-25.1, amended 2026-08-16: the row is CONTENT plus one named action, not
 * one giant button. Resuming spawns a pane and types a command into it — an
 * outcome big enough that it earns a control the user aims at, rather than one
 * a stray click anywhere in the list can fire. The body is inert; only
 * `Resume` acts.
 *
 * DL-25.2: content is fixed in order and role — the agent's own brand mark,
 * the session's own name (title, or its id when no title was found), the
 * project it ran in, and when it last changed. Only the title truncates when a
 * value runs long; the other three never give up their place. The mark is
 * `AgentGlyph`, the same component the rail rows and the strip chips use, so
 * the three surfaces cannot disagree about what `claude` looks like.
 *
 * DL-25.3, which defers to DL-23.6: a dead row is **unavailable, not
 * disabled** — its action keeps its place in the tab order, reads
 * `--text-faint` on an unchanged surface, drops the hover treatment, and
 * carries its reason in an accessible description. A `disabled` attribute
 * would make that reason unreachable by keyboard.
 */
export function SessionRow({ entry, dead, homeDir, onResume }: SessionRowProps) {
  const reasonId = dead ? `session-gone-${entry.sessionId}` : undefined;
  const name = entry.title ?? entry.sessionId;
  return (
    <li class="session-row__slot">
      <div class={`session-row ${dead ? 'is-unavailable' : ''}`}>
        {dead ? (
          <DeckIcon icon={FolderDashed} size={ROW_ICON} class="session-row__ico" />
        ) : (
          <AgentGlyph agent={entry.agent} className="session-row__logo" />
        )}
        <span class="session-row__body">
          <span class="session-row__title">{name}</span>
          <span class="session-row__meta">
            <span class="session-row__agent">{SESSION_AGENT_LABELS[entry.agent]}</span>
            <span class="session-row__path">
              {homeDir === '' ? entry.cwd : tildify(entry.cwd, homeDir)}
            </span>
            <span class="session-row__time">
              {formatRelativeTime(entry.lastActivityMs, Date.now())}
            </span>
          </span>
        </span>
        {dead ? (
          <span id={reasonId} class="session-row__gone">
            folder is gone
          </span>
        ) : null}
        {/* The accessible name carries the session too: a list of rows whose
            controls all announce the bare word "Resume" tells a screen-reader
            user which action they are on and never which session. The visible
            label stays the first word of it, so the name still contains what
            the eye reads. */}
        <button
          type="button"
          class="session-row__resume"
          aria-label={`Resume ${name}`}
          aria-describedby={reasonId}
          onClick={() => {
            if (!dead) {
              onResume(entry);
            }
          }}
        >
          <DeckIcon icon={Play} size={ROW_ICON} />
          <span class="session-row__resume-text">Resume</span>
        </button>
      </div>
    </li>
  );
}
