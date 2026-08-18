import { SectionHead } from '../specimen';

/**
 * The selected gallery direction's compact semantic contract. Historical
 * production-token audits are intentionally absent: this is now a review
 * surface for one picked lane, not a comparison with the retired treatment.
 */

const DIRECTION_TOKENS = [
  ['--gx-chat-app-under', 'navigation ground'],
  ['--gx-chat-surface-main', 'primary workspace'],
  ['--gx-chat-surface-raised', 'controls and overlays'],
  ['--gx-chat-pane-surface', 'terminal canvas'],
  ['--gx-chat-selected', 'persistent selection'],
  ['--gx-chat-border', 'quiet structure'],
  // The tenth alias. DL-2.3 splits what the retired flat file had collapsed
  // into one 10% white line: `--gx-chat-border` is a line INSIDE a surface,
  // this one is the boundary BETWEEN two of them. Omitting it here made the
  // review surface claim a nine-role contract the stylesheet did not have.
  ['--gx-chat-seam', 'shell boundaries'],
  ['--gx-chat-ink', 'primary text'],
  ['--gx-chat-ink-secondary', 'supporting text'],
  ['--gx-chat-ink-faint', 'quiet metadata'],
] as const;

export function TokensSection() {
  return (
    <>
      <SectionHead
        title="Direction tokens"
        blurb="The single semantic contract applied to every gallery specimen."
      />

      <section class="gx-specimen gx-direction-contract">
        <header class="gx-specimen__head">
          <span class="gx-specimen__name">Deck Electron direction</span>
          <span class="gx-specimen__note">
            one neutral surface ramp, one selection state, one border role
          </span>
        </header>
        <ul class="gx-direction-tokens">
          {DIRECTION_TOKENS.map(([name, role]) => (
            <li key={name} class="gx-direction-token">
              <span
                class="gx-direction-token__swatch"
                style={{ background: `var(${name})` }}
                aria-hidden
              />
              <span class="gx-direction-token__copy">
                <code>{name}</code>
                <small>{role}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
