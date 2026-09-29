import { useSignal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Plus, SquaresFour } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import {
  agentName,
  membersOf,
  needsYouCount,
  spaceOrder,
  type MockAgent,
  type MockGroup,
} from "./agent-overview-data";
import { captureRects, fadeIn, playFlip, type RectMap } from "./agent-overview-flip";
import { GroupsWindow, selectGroup, useGroupDemo } from "./agent-overview-groups";
import { AgentLabel, StateWord, focusPane } from "./agent-overview-pane";
import { SpacesBar } from "./agent-overview-spaces";
import { SpaceDots, type DotStyle } from "./agent-overview-dots";
import { SpaceTrack, type SlideDirection } from "./agent-overview-track";
import "./agent-overview-mission.css";

/**
 * Candidate C — Mission Control. Tab groups become spaces laid side by side
 * and the tab strip goes: the bar names the current cwd beside one dot per
 * space. ⌃← ⌃→, a horizontal swipe or a dot slide between them, and ⌃↑ (or the toolbar button) zooms its panes out into a
 * spread with every space thumbnailed above. Hover a space to preview its
 * agents, press a window to zoom back into it with Focus Expand, press a space
 * to enter it, Esc to return unchanged. Stands in for the Board's role; the
 * windows are fixture snapshots and own no live terminal.
 */

const PANE_SELECTOR = '.aog-track__space[data-current="true"] .aog-pane[data-key]';
const SHOT_SELECTOR = ".aog-mc-win__shot[data-key]";

function MissionWindow({
  agent,
  selected,
  onChoose,
}: {
  agent: MockAgent;
  selected: boolean;
  onChoose: (agent: MockAgent) => void;
}) {
  return (
    <button
      type="button"
      class="aog-mc-win"
      data-state={agent.state}
      data-win={agent.key}
      aria-current={selected ? "true" : undefined}
      aria-label={`${agentName(agent)} · ${agent.task} · ${agent.state}`}
      onClick={() => onChoose(agent)}
    >
      <span class="aog-mc-win__shot" data-key={agent.key}>
        <span class="aog-mc-win__head">
          <AgentLabel agent={agent} />
          <StateWord agent={agent} />
        </span>
        <span class="aog-mc-win__body">
          {agent.excerpt.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </span>
      <span class="aog-mc-win__caption">{agent.task}</span>
    </button>
  );
}

interface MissionControlProps {
  readonly agents: readonly MockAgent[];
  readonly groups: readonly MockGroup[];
  readonly currentId: string | null;
  readonly selectedKey: string | null;
  readonly fromRects: RectMap;
  readonly onChoose: (agent: MockAgent) => void;
  readonly onEnter: (groupId: string) => void;
  readonly onBack: () => void;
  readonly onNew: () => void;
}

function MissionControl(props: MissionControlProps) {
  const { agents, groups } = props;
  const previewId = useSignal(props.currentId);
  const rootRef = useRef<HTMLDivElement>(null);
  const windows = previewId.value === null ? [] : membersOf(agents, previewId.value);

  /* oxlint-disable react-hooks/exhaustive-deps -- open-once: the zoom-out and initial focus belong to the mount */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    playFlip(root, SHOT_SELECTOR, props.fromRects);
    fadeIn(root.querySelector(".aog-mc__backdrop"));
    fadeIn(root.querySelector(".aog-spaces"));
    const target =
      root.querySelector<HTMLElement>(`.aog-mc-win[data-win="${props.selectedKey}"]`) ??
      root.querySelector<HTMLElement>(".aog-mc-win, .aog-mc__spread button, .aog-space");
    target?.focus({ preventScroll: true });
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  return (
    <div ref={rootRef} class="aog-mc" role="dialog" aria-label="Mission Control">
      <div class="aog-mc__backdrop" aria-hidden="true" />
      <SpacesBar
        groups={groups}
        agents={agents}
        currentId={props.currentId}
        previewId={previewId.value}
        onPreview={(id) => {
          previewId.value = id;
        }}
        onEnter={props.onEnter}
      />
      <div
        key={previewId.value ?? "none"}
        class="aog-mc__spread"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onBack();
        }}
      >
        {windows.length === 0 ? (
          <button type="button" class="aog-empty__new" onClick={props.onNew}>
            <DeckIcon icon={Plus} size={CHROME_ICON} /> New agent
          </button>
        ) : (
          windows.map((agent) => (
            <MissionWindow
              key={agent.key}
              agent={agent}
              selected={agent.key === props.selectedKey}
              onChoose={props.onChoose}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function MissionCandidate({
  agents,
  capacity,
  dotStyle,
}: {
  agents: readonly MockAgent[];
  capacity: number;
  dotStyle: DotStyle;
}) {
  const demo = useGroupDemo(agents);
  const open = useSignal(false);
  const slide = useSignal(true);
  const focusTarget = useSignal<"invoker" | string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<HTMLButtonElement>(null);
  const openRects = useRef<RectMap>(new Map());
  const closeRects = useRef<RectMap>(new Map());

  // Zoom back in: the windows' spread rects fly to wherever the panes now sit.
  // Also moves focus after a slide, since the space it left becomes inert.
  /* oxlint-disable react-hooks/exhaustive-deps -- Preact signals: open.value and focusTarget.value are the reactive deps */
  useLayoutEffect(() => {
    if (open.value) return;
    playFlip(rootRef.current, PANE_SELECTOR, closeRects.current);
    closeRects.current = new Map();
    // Flush the instant jump before sliding is re-armed, or the jump animates.
    rootRef.current?.getBoundingClientRect();
    slide.value = true;
    const target = focusTarget.value;
    if (target === null) return;
    if (target === "invoker") invokerRef.current?.focus();
    else focusPane(rootRef.current, target);
    focusTarget.value = null;
  }, [open.value, focusTarget.value]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const { groups, agents: all } = demo.state.value;
  const spaces = spaceOrder(groups);
  const needs = needsYouCount(all);

  const show = () => {
    openRects.current = captureRects(rootRef.current, PANE_SELECTOR);
    demo.launchOpen.value = false;
    open.value = true;
  };
  // The zoom carries a space change out of Mission Control, so the track jumps
  // instead of sliding underneath it — a sliding track would also move the
  // rects the zoom measures.
  const close = (target: "invoker" | string | null) => {
    closeRects.current = captureRects(rootRef.current, SHOT_SELECTOR);
    slide.value = false;
    focusTarget.value = target;
    open.value = false;
  };
  const choose = (agent: MockAgent) => {
    selectGroup(demo, agent.groupId);
    demo.selected.value = agent.key;
    demo.expand.value = true;
    close(agent.key);
  };
  const enter = (groupId: string) => {
    selectGroup(demo, groupId);
    close(demo.selected.value);
  };
  const goTo = (groupId: string) => {
    if (groupId === demo.current.value) return;
    slide.value = true;
    selectGroup(demo, groupId);
    focusTarget.value = demo.selected.value;
  };
  const step = (direction: SlideDirection) => {
    const index = spaces.findIndex((space) => space.id === demo.current.value);
    const next = spaces[index + direction];
    if (next !== undefined) goTo(next.id);
  };

  return (
    <GroupsWindow
      demo={demo}
      capacity={capacity}
      rootRef={rootRef}
      barLead={
        <SpaceDots
          spaces={spaces}
          agents={all}
          currentId={demo.current.value}
          dotStyle={dotStyle}
          onGo={goTo}
        />
      }
      stage={
        <SpaceTrack
          spaces={spaces}
          agents={all}
          currentId={demo.current.value}
          selectedKey={demo.selected.value}
          expand={demo.expand.value}
          slide={slide.value}
          onSelectPane={(key) => {
            demo.selected.value = key;
          }}
          onSwipe={step}
          onNew={() => {
            demo.launchOpen.value = true;
          }}
        />
      }
      onKey={(event) => {
        if (event.ctrlKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          if (!open.value) step(event.key === "ArrowLeft" ? -1 : 1);
          return true;
        }
        if (event.ctrlKey && event.key === "ArrowUp") {
          event.preventDefault();
          if (open.value) close("invoker");
          else show();
          return true;
        }
        if (event.key !== "Escape" || !open.value) return false;
        close("invoker");
        return true;
      }}
      tools={
        <button
          ref={invokerRef}
          type="button"
          class="aog-tool"
          aria-label="Mission Control"
          title="Mission Control · ⌃↑"
          aria-expanded={open.value}
          onClick={() => (open.value ? close("invoker") : show())}
        >
          <DeckIcon icon={SquaresFour} size={CHROME_ICON} />
          {needs > 0 && (
            <span class="aog-tool__needs" aria-label={`${needs} need you`}>
              {needs}
            </span>
          )}
        </button>
      }
      overlay={
        open.value && (
          <MissionControl
            agents={all}
            groups={spaces}
            currentId={demo.current.value}
            selectedKey={demo.selected.value}
            fromRects={openRects.current}
            onChoose={choose}
            onEnter={enter}
            onBack={() => close("invoker")}
            onNew={() => {
              close(null);
              demo.launchOpen.value = true;
            }}
          />
        )
      }
    />
  );
}
