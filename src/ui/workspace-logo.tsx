import { letterAvatar } from "../lib/letter-avatar";
import { tabDotCssColor } from "../lib/tab-colors";
import { resolveWorkspaceLogo } from "../settings/workspace-logo-store";
import type { AgentAttentionSummary } from "../terminal/tabs-store";
import { AgentAttentionMark } from "./agent-attention-mark";
import { WorkspaceSpinner } from "./workspace-spinner";

interface WorkspaceLogoProps {
  /** Normalized workspace path; null when the tab has no workspace. */
  workspacePath: string | null;
  /** Display label — first letter feeds the fallback avatar. */
  label: string;
  /** An agent is running in this tab → spinner ring around the avatar. */
  pending: boolean;
  /** Background output arrived while the tab was inactive → yellow badge. */
  unread: boolean;
  /**
   * Agent Attention Rail summary for this tab. When it carries actionable
   * items (error/warning/requested/completed), the shared status mark
   * renders in the corner instead of the pending/unread overlay below.
   * Absent or non-actionable → the overlay renders unchanged.
   */
  attention?: AgentAttentionSummary;
  /** Invoked when the actionable attention mark is clicked. */
  onFocusAttention?: () => void;
}

/**
 * The round identity mark for a workspace row: a custom logo, else the repo's
 * favicon, else a letter avatar on a theme color. A status overlay sits at the
 * corner. An actionable `attention` summary outranks everything else and
 * renders the shared AgentAttentionMark there; otherwise the original overlay
 * applies unchanged: a spinner ring while an agent runs (pending), else a
 * yellow dot for unread background output, else nothing. Pending outranks
 * unread.
 */
export function WorkspaceLogo({
  workspacePath,
  label,
  pending,
  unread,
  attention,
  onFocusAttention,
}: WorkspaceLogoProps) {
  const image = resolveWorkspaceLogo(workspacePath);
  const avatar = letterAvatar(label, workspacePath ?? label);

  return (
    <span class="wsitem__logo">
      {image !== null ? (
        <img class="wsitem__logo-img" src={image} alt="" />
      ) : (
        <span
          class="wsitem__logo-letter"
          style={{
            color: tabDotCssColor(avatar.color),
            background: `color-mix(in srgb, ${tabDotCssColor(avatar.color)} 18%, transparent)`,
          }}
          aria-hidden="true"
        >
          {avatar.letter}
        </span>
      )}
      {attention !== undefined && attention.actionableCount > 0 ? (
        // Corner slot, same spot the pending/unread overlay would occupy.
        // stopPropagation keeps a click on the mark from bubbling to the
        // row's own onClick (select tab / toggle popover).
        <span
          class="wsitem__logo-attn"
          onClick={(event) => event.stopPropagation()}
        >
          <AgentAttentionMark
            summary={attention}
            label={label}
            onActivate={onFocusAttention}
          />
        </span>
      ) : pending ? (
        <WorkspaceSpinner />
      ) : unread ? (
        <span
          class="wsitem__logo-badge wsitem__logo-badge--unread"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
