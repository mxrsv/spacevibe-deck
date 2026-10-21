/**
 * Diff comment composer: three placements to choose from (plan
 * 2026-10-21-diff-line-comments, T4; spec DLC14).
 *
 * Static drawings over a hand-made diff, no Monaco: the question is where the
 * composer stands relative to the selected lines, and what it costs the code
 * around it. Each placement is shown composing (several panes, the remembered one
 * preselected) and after a send that only pasted. Tokens and colour roles are the
 * shipping ones; none is added. Never imported by shipping code (R7).
 */
import "./diff-comment-section.css";

interface CodeLine {
  readonly n: number;
  readonly text: string;
  readonly kind?: "add" | "del";
  readonly selected?: boolean;
}

const LINES: readonly CodeLine[] = [
  { n: 41, text: "export function stillChanged(" },
  { n: 42, text: "  selection: DiffSelection," },
  { n: 43, text: "  entries: readonly ChangeEntry[]," },
  { n: 44, text: "): boolean {" },
  { n: 45, text: "  return entries.some((e) => e.path === selection.path);", kind: "del" },
  {
    n: 45,
    text: "  const known = new Set(entries.map((e) => e.path));",
    kind: "add",
    selected: true,
  },
  { n: 46, text: "  return known.has(selection.path);", kind: "add", selected: true },
  { n: 47, text: "}" },
  { n: 48, text: "" },
  { n: 49, text: "/** True when the entry lies outside the selection's root. */" },
  { n: 50, text: "export function isOutside(selection: DiffSelection, entry: ChangeEntry) {" },
  { n: 51, text: '  return entry.path.startsWith("../");' },
];

type Placement = "inline" | "anchored" | "footer";
type Phase = "composing" | "pasted";

const SENT_TEXT = "Use the path set once, outside the render loop.";

function Code(props: { readonly lines: readonly CodeLine[] }) {
  return (
    <div class="gx-dc-code" role="presentation">
      {props.lines.map((line) => (
        <div
          class="gx-dc-line"
          data-kind={line.kind}
          data-selected={line.selected === true ? "" : undefined}
          key={`${line.n}-${line.kind ?? "same"}`}
        >
          <span class="gx-dc-num">{line.n}</span>
          <span class="gx-dc-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function Composer(props: { readonly phase: Phase; readonly placement: Placement }) {
  const { phase, placement } = props;
  return (
    <div class={`gx-dc-composer gx-dc-composer--${placement}`}>
      <div class="gx-dc-head">
        <span class="gx-dc-where">L45-L46</span>
        <span class="gx-dc-panes" role="radiogroup" aria-label="Agent">
          <span class="gx-dc-pane" role="radio" aria-checked="true">
            claude
          </span>
          <span class="gx-dc-pane" role="radio" aria-checked="false">
            codex
          </span>
        </span>
      </div>
      <div class="gx-dc-field">
        {phase === "composing" ? "Replace the set with a Map" : SENT_TEXT}
      </div>
      <div class="gx-dc-foot">
        {phase === "pasted" ? (
          <span class="gx-dc-notice">Pasted, not sent: claude is working</span>
        ) : (
          <span class="gx-dc-hint">Esc</span>
        )}
        <span class="gx-dc-send">Send ⌘↵</span>
      </div>
    </div>
  );
}

function Frame(props: {
  readonly placement: Placement;
  readonly phase: Phase;
  readonly label: string;
}) {
  const { placement, phase } = props;
  return (
    <figure class="gx-dc-frame">
      <figcaption class="gx-dc-label">{props.label}</figcaption>
      <div class="gx-dc-stage" data-placement={placement}>
        <div class="gx-dc-column-head">src/files/changes/diff-selection.ts</div>
        <div class="gx-dc-body">
          {placement === "inline" ? (
            <>
              <Code lines={LINES.filter((line) => line.n <= 46)} />
              <Composer phase={phase} placement={placement} />
              <Code lines={LINES.filter((line) => line.n > 46)} />
            </>
          ) : (
            <Code lines={LINES} />
          )}
          {placement === "anchored" ? <Composer phase={phase} placement={placement} /> : null}
        </div>
        {placement === "footer" ? <Composer phase={phase} placement={placement} /> : null}
      </div>
    </figure>
  );
}

const SPECIMENS: readonly { readonly placement: Placement; readonly title: string }[] = [
  { placement: "inline", title: "A · inline, under the selection (view zone)" },
  { placement: "anchored", title: "B · anchored card beside the selection" },
  { placement: "footer", title: "C · column footer" },
];

export function DiffCommentSection() {
  return (
    <section class="gx-section">
      <h2>diff comment composer</h2>
      <p class="gx-note">
        Three placements for the composer, each composing and after a send that only pasted. A
        pushes the code below it down; B floats over the right of the lines and hides the end of
        long ones; C leaves the code alone but sits far from the selection.
      </p>
      {SPECIMENS.map((specimen) => (
        <div class="gx-dc-row" key={specimen.placement}>
          <Frame
            placement={specimen.placement}
            phase="composing"
            label={`${specimen.title}: composing`}
          />
          <Frame
            placement={specimen.placement}
            phase="pasted"
            label={`${specimen.title}: pasted, not sent`}
          />
        </div>
      ))}
    </section>
  );
}
