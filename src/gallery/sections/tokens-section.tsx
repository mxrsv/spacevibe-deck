import { auditAppStyles, rootTokens, type AuditGroup } from "../css-audit";
import { SectionHead } from "../specimen";

/**
 * What the visual system is made of today, read live from the stylesheet:
 * every `:root` token above, and every dimension typed by hand below.
 *
 * The two halves are the whole argument. The colour half routes through
 * tokens; the dimension half has none, so the counts under "spread" are the
 * size of the gap a scale would close.
 */

// `--status-unread` is named in full on purpose: a `--status-` prefix would
// also swallow `--status-h`, which is the status bar's height.
const COLOUR_TOKEN =
  /^--(bg|fg|accent|red|green|yellow|magenta|cyan|tone|chrome-|tab-active-bg|input-bg|hair|text-|status-unread)/;

function isColour(name: string): boolean {
  return COLOUR_TOKEN.test(name);
}

function TokenSwatch({ value }: { value: string }) {
  return (
    <span class="gx-token__swatch" style={{ background: value }} aria-hidden />
  );
}

function AuditTable({ group }: { group: AuditGroup }) {
  const total = group.entries.length;
  return (
    <div class="gx-audit">
      <header class="gx-audit__head">
        <span class="gx-audit__label">{group.label}</span>
        <span class="gx-audit__count">
          {total} {total === 1 ? "value" : "distinct values"}
        </span>
      </header>
      <p class="gx-audit__note">{group.note}</p>
      {total === 0 ? (
        <p class="gx-audit__empty">none — nothing to tokenize here.</p>
      ) : (
        <ul class="gx-audit__list">
          {group.entries.map((entry) => (
            <li key={entry.value}>
              <code>{entry.value}</code>
              {/* Spelled out rather than a multiplication sign: the icon-system
                  gate rejects the glyph anywhere in `src/`, and it is right to
                  — it cannot tell arithmetic from a button label. */}
              <span class="gx-audit__times">{entry.count} uses</span>
              <span class="gx-audit__sample">{entry.sample}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TokensSection() {
  const tokens = rootTokens();
  const colours = tokens.filter((token) => isColour(token.name));
  const others = tokens.filter((token) => !isColour(token.name));
  const audit = auditAppStyles();

  return (
    <>
      <SectionHead
        title="Tokens & spread"
        blurb="Read live from src/styles.css on every load, so these numbers cannot go stale."
      />

      <section class="gx-specimen">
        <header class="gx-specimen__head">
          <span class="gx-specimen__name">:root — colour tokens</span>
          <span class="gx-specimen__note">
            {colours.length} declared · theme-injected values resolve through
            JS, the rest via color-mix
          </span>
        </header>
        <ul class="gx-tokens">
          {colours.map((token) => (
            <li key={token.name} class="gx-token">
              <TokenSwatch value={`var(${token.name})`} />
              <code class="gx-token__name">{token.name}</code>
              <span class="gx-token__computed">{token.computed}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="gx-specimen">
        <header class="gx-specimen__head">
          <span class="gx-specimen__name">:root — everything else</span>
          <span class="gx-specimen__note">
            {others.length} declared · all of them layout heights, plus one
            radius and one font stack
          </span>
        </header>
        <ul class="gx-tokens gx-tokens--plain">
          {others.map((token) => (
            <li key={token.name} class="gx-token">
              <code class="gx-token__name">{token.name}</code>
              <span class="gx-token__computed">{token.computed}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="gx-specimen">
        <header class="gx-specimen__head">
          <span class="gx-specimen__name">spread — values typed by hand</span>
          <span class="gx-specimen__note">
            every literal in the stylesheet that no token stands behind
          </span>
        </header>
        <div class="gx-audits">
          {audit.map((group) => (
            <AuditTable key={group.label} group={group} />
          ))}
        </div>
      </section>
    </>
  );
}
