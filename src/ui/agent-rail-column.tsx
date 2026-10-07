import type { RailAvatar } from "./agent-rail-collapsed-model";
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
 */

export interface RailAvatarColumnProps {
  readonly avatars: readonly RailAvatar[];
}

/**
 * The accessible name keeps the state word (DL-27.2): a badge is paint, and
 * `N need you` is the same fact the project header's count words say.
 */
function avatarName(avatar: RailAvatar): string {
  return avatar.needCount > 0 ? `${avatar.project}, ${avatar.needWords}` : avatar.project;
}

function Avatar({ avatar }: { readonly avatar: RailAvatar }) {
  return (
    <button
      type="button"
      class="asr-avatar"
      data-current={avatar.current}
      aria-current={avatar.current ? "true" : undefined}
      aria-label={avatarName(avatar)}
      title={avatarName(avatar)}
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

export function RailAvatarColumn({ avatars }: RailAvatarColumnProps) {
  return (
    <nav class="asr-rail asr-rail--mounted asr-rail--column" aria-label="Agents">
      <div class="asr-column__drag" data-tauri-drag-region aria-hidden="true" />
      <div class="asr-column__list">
        {avatars.map((avatar) => (
          <Avatar key={avatar.key} avatar={avatar} />
        ))}
      </div>
    </nav>
  );
}
