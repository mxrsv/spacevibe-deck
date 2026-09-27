import type { ComponentChildren } from "preact";
import deckLogoUrl from "../../../.github/assets/icon.svg";
import type { PaneAgent } from "../../lib/process-info";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { ToggleRow } from "../../ui/controls/config-row";
import { NotificationsSection } from "../../ui/settings/sections/notifications-section";
import { NOOP } from "../chrome-fixtures";
import { Column, Pair } from "./before-after-2026-09-23-frame";

/**
 * Pair 1 of the attention group: the OS notification and the dock. The
 * settings row in `before` is the real `NotificationsSection` (the gallery's
 * in-memory settings start at the shipped default, off). The banner and the
 * dock are drawings: macOS paints both, so only what Deck hands it — title,
 * subtitle, body, one action, the badge count — is the candidate here.
 */

/** A labelled slot inside a column: what surface the drawing stands for. */
function Slot({ label, children }: { readonly label?: string; readonly children: ComponentChildren }) {
  return (
    <div class="ba23-att-slot">
      {label !== undefined && <p class="ba23-att-slot__label">{label}</p>}
      {children}
    </div>
  );
}

function Banner({
  agent,
  title,
  subtitle,
  body,
  action,
  when = "now",
  hint,
}: {
  readonly when?: string;
  readonly hint?: string;
  readonly agent?: PaneAgent;
  readonly title: string;
  readonly subtitle?: string;
  readonly body: string;
  readonly action?: string;
}) {
  return (
    <div
      class="ba23-att-banner"
      role="img"
      aria-label={`Notification: ${title}. ${body}${hint === undefined ? "" : `. ${hint}`}`}
      title={hint}
    >
      <img class="ba23-att-banner__app" src={deckLogoUrl} alt="" draggable={false} />
      <div class="ba23-att-banner__text">
        <p class="ba23-att-banner__title">
          {agent !== undefined && <AgentGlyph agent={agent} className="ba23-att-banner__glyph" />}
          <span>{title}</span>
          {when !== "" && <span class="ba23-att-banner__when">{when}</span>}
        </p>
        {subtitle !== undefined && <p class="ba23-att-banner__subtitle">{subtitle}</p>}
        <p class="ba23-att-banner__body">{body}</p>
      </div>
      {action !== undefined && (
        <span class="ba23-att-banner__action" aria-hidden="true">
          {action}
        </span>
      )}
    </div>
  );
}

function Dock({ badge, caption = true }: { readonly badge?: number; readonly caption?: boolean }) {
  return (
    <div class="ba23-att-dock">
      <div class="ba23-att-dock__tile">
        <img src={deckLogoUrl} alt="Deck" draggable={false} />
        {badge !== undefined && <span class="ba23-att-dock__badge">{badge}</span>}
        <span class="ba23-att-dock__running" aria-hidden="true" />
      </div>
      {caption && (
      <p class="ba23-att-dock__caption">
        {badge === undefined ? "No count. The dock looks the same whether 0 or 5 agents wait." : `${badge} agents need you. Clears as you answer them.`}
      </p>
      )}
    </div>
  );
}

export function NotificationPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="off by default, and a click goes nowhere"
        note="`agentNotifications` ships false (settings-schema.ts:258), so a new user never sees one. Turned on, the body is `<agent> needs attention` under the workspace name, and `notification_send` builds a bare Notification with no click handler (electron/ipc/register-shell.ts:57-61): pressing it only brings the app forward. There is no dock count."
      >
        <Slot label="Settings › Notifications (real section)">
          <div class="settings-screen__section ba23-att-settings">
            <NotificationsSection />
          </div>
        </Slot>
        <Slot label="macOS banner, if turned on">
          <Banner title="spacevibe-deck" body="Codex needs attention" />
          <p class="ba23-att-slot__hint">Click: raises Deck on whatever pane was last focused.</p>
        </Slot>
        <Slot label="Dock">
          <Dock />
        </Slot>
      </Column>
      <Column
        side="after"
        title="on by default, and the banner opens the pane"
        note="On by default; the first launch asks the OS once. The row loses its description. The banner names the agent, where, and its last sentence, with no action button: a click anywhere focuses that pane (routed to its window by the main process). The dock/taskbar badge is the whole count: app.setBadgeCount on macOS, an overlay icon on Windows. Whether macOS draws the agent mark in the banner is unverified."
      >
        <div class="ba23-att-after">
          <div class="settings-screen__section ba23-att-settings">
            <ToggleRow label="Agent notifications" checked onToggle={NOOP} />
          </div>
          <Banner
            agent="codex"
            title="Codex needs you"
            subtitle="spacevibe-deck › main"
            body="Overwrite the migration or add a new one?"
            when=""
            hint="Click to open this pane"
          />
          <Dock badge={2} caption={false} />
        </div>
      </Column>
    </Pair>
  );
}
