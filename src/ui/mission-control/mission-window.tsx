import { displayAgent } from "../agent-rail-card-model";
import { AgentGlyph } from "../controls/agent-glyph";
import type { SpacePane } from "../spaces/space-model";

/**
 * One window in Mission Control's spread (DL-35.1): a pane's last rows as
 * text, never its xterm — the Agent Board's snapshot rule (DL-34.6, as
 * written). `asked` and `failed` mark the head the way DL-34.3 marks a card.
 */
export interface MissionWindowProps {
  readonly pane: SpacePane;
  readonly snapshot: string;
  /** What the pane's agent last said, when the tail store has it. */
  readonly caption: string;
  readonly focused: boolean;
  readonly onChoose: (paneId: number) => void;
}

function nameOf(pane: SpacePane): string {
  return pane.agent === null ? "shell" : displayAgent(pane.agent);
}

export function MissionWindow({ pane, snapshot, caption, focused, onChoose }: MissionWindowProps) {
  const name = nameOf(pane);
  const state = pane.state === "shell" ? null : pane.state;
  return (
    <button
      type="button"
      class="mc-window"
      data-pane={pane.paneId}
      data-state={pane.state}
      aria-current={focused ? "true" : undefined}
      aria-label={state === null ? name : `${name} · ${state}`}
      onClick={() => onChoose(pane.paneId)}
    >
      <span class="mc-window__shot" data-pane={pane.paneId}>
        <span class="mc-window__head">
          <span class="mc-window__who">
            {pane.agent !== null && <AgentGlyph agent={pane.agent} className="mc-window__logo" />}
            <span>{name}</span>
          </span>
          {state !== null && <span class="mc-window__state">{state}</span>}
        </span>
        <pre class="mc-window__body">{snapshot}</pre>
      </span>
      <span class="mc-window__caption">{caption}</span>
    </button>
  );
}
