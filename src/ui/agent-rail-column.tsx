import { useEffect, useState } from "preact/hooks";
import type { RailAvatar } from "./agent-rail-collapsed-model";
import type { RailStreamGroup } from "./agent-rail-model";
import { WorktreeCard, type WorktreeCardProps } from "./worktree-card";
import {
  useDismiss,
  useStageOverlayFlag,
  useSurfacePlacement,
  type CardActions,
} from "./worktree-card-menus";
import { WorkspaceIcon } from "./workspace-icon";

/**
 * The collapsed rail (DL-27.29, amending DL-18.9): one avatar per live project,
 * in rail order, instead of a hidden column. Electron only — `AgentRail` routes
 * Tauri to `RepositoryRail`, which keeps hiding.
 *
 * The frame row is hidden while the column is collapsed (`04e-rail-collapsed.css`),
 * so the column carries its own drag strip where the OS paints the traffic
 * lights; the expand control stays where DL-18.9 put it, on the stage strip's
 * leading edge.
 *
 * Pressing an avatar opens that project's checkouts in a DL-13 popover beside the
 * column. The popover renders the same `WorktreeCard` the tree does — it
 * restyles nothing — so focus (RAIL5), rename, close and each checkout's `+`
 * behave exactly as in the full rail.
 */

/** What a flyout's cards need from `AgentRail`; the project and checkout are the flyout's own. */
export type FlyoutCardProps = Omit<WorktreeCardProps, "project" | "group">;

export interface RailAvatarColumnProps {
  readonly avatars: readonly RailAvatar[];
  /** The tree's own stream: the flyout reads its project's checkouts from here, live. */
  readonly stream: readonly RailStreamGroup[];
  readonly cards: FlyoutCardProps;
}

/**
 * The accessible name keeps the state word (DL-27.2): a badge is paint, and
 * `N need you` is the same fact the project header's count words say.
 */
function avatarName(avatar: RailAvatar): string {
  return avatar.needCount > 0 ? `${avatar.project}, ${avatar.needWords}` : avatar.project;
}

interface AvatarProps {
  readonly avatar: RailAvatar;
  readonly open: boolean;
  onPress(button: HTMLButtonElement): void;
}

function Avatar({ avatar, open, onPress }: AvatarProps) {
  return (
    <button
      type="button"
      class="asr-avatar"
      data-current={avatar.current}
      data-key={avatar.key}
      aria-current={avatar.current ? "true" : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={avatarName(avatar)}
      title={avatarName(avatar)}
      onClick={(event) => {
        onPress(event.currentTarget);
      }}
    >
      <WorkspaceIcon
        key={avatar.iconPath}
        path={avatar.iconPath}
        fallback={<span class="asr-avatar__initials">{avatar.initials}</span>}
      />
      {avatar.needCount > 0 && (
        <span
          class="asr-avatar__badge"
          data-tone={avatar.failed ? "failed" : "asked"}
          aria-hidden="true"
        >
          {avatar.needCount}
        </span>
      )}
    </button>
  );
}

/**
 * Every callback a checkout's `+` menu can raise closes the flyout first: each
 * one opens something on the stage (the launcher page, a split, a shell), and a
 * popover left standing over it would cover the very thing just asked for.
 */
function closingActions(actions: CardActions, close: () => void): CardActions {
  const wrapped = Object.entries(actions).map(([name, value]) => [
    name,
    typeof value === "function"
      ? (...args: readonly unknown[]) => {
          close();
          return (value as (...rest: readonly unknown[]) => unknown)(...args);
        }
      : value,
  ]);
  return Object.fromEntries(wrapped) as unknown as CardActions;
}

interface FlyoutProps {
  readonly group: RailStreamGroup;
  readonly rect: DOMRect;
  readonly trigger: HTMLElement;
  readonly cards: FlyoutCardProps;
  /** `restoreFocus` is false when the press already moved focus somewhere on purpose. */
  onClose(restoreFocus: boolean): void;
}

function RailFlyout({ group, rect, trigger, cards, onClose }: FlyoutProps) {
  const { ref, style, placed } = useSurfacePlacement(rect, "right");
  // Esc and an outside press close it (DL-13); the trigger's own press toggles instead.
  // Focus goes back to the avatar only when it was inside the flyout, so a press that
  // landed on something focusable elsewhere keeps the focus it just took.
  useDismiss(
    () => {
      onClose(ref.current?.contains(document.activeElement) === true);
    },
    ref,
    trigger,
  );
  // The native browser view would paint over this surface otherwise.
  useStageOverlayFlag();
  // Hidden until measured, and a hidden element cannot take focus: so the first control
  // is focused once placed, which is what makes Enter on an avatar land in the flyout.
  useEffect(() => {
    if (placed) {
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [placed, ref]);

  const choose = <Args extends readonly unknown[]>(
    handler: ((...args: Args) => void) | undefined,
  ): ((...args: Args) => void) => {
    return (...args) => {
      // A chosen row hands focus to its pane, so the avatar must not take it back.
      onClose(false);
      handler?.(...args);
    };
  };
  const actions = cards.actions && closingActions(cards.actions, () => onClose(false));

  return (
    <div
      ref={ref}
      class="asr-pop asr-flyout"
      role="dialog"
      aria-label={`${group.project} sessions`}
      style={style}
    >
      <div class="asr-flyout__head">{group.project}</div>
      <div class="asr-cluster">
        {group.worktrees.map((worktree) => (
          <WorktreeCard
            key={worktree.key}
            {...cards}
            project={group.project}
            group={worktree}
            onFocusPane={choose(cards.onFocusPane)}
            onSelectTab={choose(cards.onSelectTab)}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
}

interface OpenFlyout {
  readonly key: string;
  readonly trigger: HTMLButtonElement;
  readonly rect: DOMRect;
}

export function RailAvatarColumn({ avatars, stream, cards }: RailAvatarColumnProps) {
  // One flyout at a time: a single slot, so pressing another avatar replaces it.
  const [open, setOpen] = useState<OpenFlyout | null>(null);
  const openGroup = open === null ? undefined : stream.find((group) => group.key === open.key);

  // The project can leave the rail under an open flyout (its last tab closed).
  useEffect(() => {
    if (open !== null && openGroup === undefined) {
      setOpen(null);
    }
  }, [open, openGroup]);

  const close = (restoreFocus: boolean): void => {
    const trigger = open?.trigger;
    setOpen(null);
    if (restoreFocus) {
      trigger?.focus();
    }
  };

  return (
    <nav class="asr-rail asr-rail--mounted asr-rail--column" aria-label="Agents">
      <div class="asr-column__drag" data-tauri-drag-region aria-hidden="true" />
      <div class="asr-column__list">
        {avatars.map((avatar) => (
          <Avatar
            key={avatar.key}
            avatar={avatar}
            open={open?.key === avatar.key}
            onPress={(button) => {
              // A second press on the avatar that opened it closes it.
              if (open?.key === avatar.key) {
                close(false);
                return;
              }
              setOpen({ key: avatar.key, trigger: button, rect: button.getBoundingClientRect() });
            }}
          />
        ))}
      </div>
      {open !== null && openGroup !== undefined && (
        <RailFlyout
          key={open.key}
          group={openGroup}
          rect={open.rect}
          trigger={open.trigger}
          cards={cards}
          onClose={close}
        />
      )}
    </nav>
  );
}
