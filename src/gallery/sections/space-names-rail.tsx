import { CaretRight, Folder, GitBranch, GitFork, X } from "@phosphor-icons/react";
import { useState } from "preact/hooks";
import { checkoutBadge, checkoutLabel } from "../../ui/agent-rail-card-model";
import type { RailCardPane, RailWorktreeGroup } from "../../ui/agent-rail-model";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "../../ui/controls/deck-icon";
import { CardLoad, CardMark, signalLabelOf, whereOf } from "../../ui/worktree-card-row";
import type { NameVariant, SpaceNames } from "./space-names-data";
import { RenameInput } from "./space-names-label";
import "./space-names-rail.css";
import { RAIL_PROJECT, railGroups, rowText, tabKeyOf } from "./space-names-rail-data";

/**
 * The sidebar half of the study: the shipping rail's classes around rows that
 * this file draws itself. `WorktreeCard` renders `CardAgentRow`, which has one
 * text span and no place for a rename field or a second line, so the row
 * markup is copied from it; the cluster head, the card head, the count line and
 * the row's hit layer, mark and close are the shipping ones.
 */

interface RailProps {
  readonly variant: NameVariant;
  readonly names: SpaceNames;
  readonly onRename: (key: number, name: string | null) => void;
  /** A pane whose row starts in the rename state, for static frames. */
  readonly editPaneId?: number;
}

const NOOP = (): void => undefined;

function CardHead({ group }: { readonly group: RailWorktreeGroup }) {
  const badge = checkoutBadge(group);
  return (
    <button type="button" class="asr-card__head" aria-expanded="true">
      <span class="asr-card__mark" data-live={group.live} aria-hidden="true" />
      <span class="asr-card__name">{checkoutLabel(group)}</span>
      <span class="asr-card__badge" data-kind={badge.kind} title={badge.text}>
        {badge.kind === "branch" && <DeckIcon icon={GitBranch} size={CHROME_ICON} />}
        {badge.kind === "worktree" && <DeckIcon icon={GitFork} size={CHROME_ICON} />}
        <span>{badge.text}</span>
      </span>
      <DeckIcon icon={CaretRight} size={CHROME_ICON} class="asr-card__chevron" />
    </button>
  );
}

interface RowProps extends RailProps {
  readonly group: RailWorktreeGroup;
  readonly pane: RailCardPane;
  readonly editing: boolean;
  /** The static frame's own edit: draw the ring, never steal focus. */
  readonly forced: boolean;
  readonly onEdit: () => void;
  readonly onStop: () => void;
}

function RowName(props: RowProps) {
  const { variant, pane, names } = props;
  const name = names[tabKeyOf(pane)] ?? null;
  const text = rowText(variant, pane, name);
  if (props.editing) {
    return (
      <span class="asr-card__name spn-r-name spn-r-name--editing" data-named={name !== null}>
        <RenameInput
          initial={name ?? ""}
          placeholder={text.primary}
          forced={props.forced}
          onCommit={(value) => {
            props.onRename(tabKeyOf(pane), value);
            props.onStop();
          }}
          onCancel={props.onStop}
        />
        {/* C keeps the sentence under the field, so the row does not jump. */}
        {text.secondary !== null && <span class="spn-r-secondary">{text.secondary}</span>}
      </span>
    );
  }
  return (
    <span class="asr-card__name spn-r-name" data-named={name !== null}>
      <span class="spn-r-primary">{text.primary}</span>
      {text.context !== null && <span class="spn-r-context">{text.context}</span>}
      {text.secondary !== null && <span class="spn-r-secondary">{text.secondary}</span>}
    </span>
  );
}

function AgentRow(props: RowProps) {
  const { pane, group } = props;
  const state = signalLabelOf(pane.state, pane.confidence, pane.detail);
  const where = whereOf(RAIL_PROJECT, group);
  return (
    <div
      class="asr-card__row spn-r-row"
      data-kind="agent"
      data-state={pane.state}
      data-confidence={pane.confidence}
      data-focused={pane.focused}
      data-pane-id={pane.paneId}
    >
      <button
        type="button"
        class="asr-card__hit"
        aria-current={pane.focused ? "true" : undefined}
        aria-label={`Focus ${pane.label} in ${where}, ${state}`}
        title={`${pane.label} — ${state}`}
        onDblClick={props.onEdit}
      />
      <span class="asr-card__glyph">
        <AgentGlyph agent={pane.agent} className="asr-card__logo" />
      </span>
      <RowName {...props} />
      <span class="asr-card__status" aria-hidden="true">
        <CardLoad state={pane.state} />
        {pane.state !== "working" && <CardMark state={pane.state} confidence={pane.confidence} />}
      </span>
      <div class="asr-row__actions">
        <button
          type="button"
          class="asr-row__action asr-row__action--close"
          aria-label={`Close ${pane.label} in ${where}`}
          onClick={NOOP}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    </div>
  );
}

function Card({ group, rail }: { readonly group: RailWorktreeGroup; readonly rail: RailProps }) {
  const [editing, setEditing] = useState<number | null>(rail.editPaneId ?? null);
  // Only the frame's initial edit is forced; one the user opens takes focus.
  const [forced, setForced] = useState(rail.editPaneId !== undefined);
  return (
    <article class="asr-card" data-open="true" data-active={group.active} data-live={group.live}>
      <CardHead group={group} />
      <div class="asr-card__count">{group.entries.length} active</div>
      {group.panes.map((pane) => (
        <AgentRow
          key={pane.paneId}
          {...rail}
          group={group}
          pane={pane}
          editing={editing === pane.paneId}
          forced={forced}
          onEdit={() => {
            setForced(false);
            setEditing(pane.paneId);
          }}
          onStop={() => setEditing(null)}
        />
      ))}
    </article>
  );
}

/** One rail at the width the window shell gives it: a project cluster of cards. */
export function RailFrame(props: RailProps) {
  return (
    <div class={`asr-study__stage spn-rail--${props.variant}`}>
      <nav class="asr-rail asr-rail--mounted" aria-label="Agents (specimen)">
        <div class="asr-rail__list">
          <section class="asr-stream" aria-label="Open agents">
            <div class="asr-cluster" data-labelled="true" data-collapsed="false">
              <div class="asr-cluster__head">
                <button type="button" class="asr-cluster__toggle" aria-expanded="true">
                  <span class="asr-cluster__folder" aria-hidden="true">
                    <DeckIcon icon={Folder} size={FEATURE_ICON} filled />
                  </span>
                  <span class="asr-cluster__name">{RAIL_PROJECT}</span>
                  <span class="asr-cluster__caret" aria-hidden="true">
                    <DeckIcon icon={CaretRight} size={CHROME_ICON} />
                  </span>
                </button>
              </div>
              {railGroups(props.names).map((group) => (
                <Card key={group.key} group={group} rail={props} />
              ))}
            </div>
          </section>
        </div>
      </nav>
    </div>
  );
}
