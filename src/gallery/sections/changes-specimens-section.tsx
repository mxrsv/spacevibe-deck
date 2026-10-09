import { useMemo } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { createFileSurfaceController } from "../../files/file-surface-controller";
import { SectionHead, Specimen, StateLabel } from "../specimen";
import { inertClient, seedTree } from "./changes-specimens-data";
import { VariantA, VariantB, VariantC, type ViewState } from "./changes-specimens-variants";
import "./changes-specimens.css";

/**
 * Spec decision 8: the form of the Changes list, picked by eye before slice 1's
 * code. Three variants of the same checkout (8 entries, `+42 −7`), each at the
 * dock's 360px floor and at 520px, then clean and failed at 360px, and one
 * extra frame that shows what the variant does to the tree around it.
 *
 * The tree is the real `ExplorerTab` over an inert client, as in the explorer
 * tree section; variant C draws its pruned tree on the shipping row classes
 * because the real tree cannot be pruned. Nothing here is imported by shipping
 * code (R7), and nothing reads or writes a repository.
 */

interface Amend {
  readonly rule: string;
  readonly text: string;
  readonly fork?: boolean;
}

function Card({
  id,
  name,
  note,
  amends,
  children,
}: {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly amends: readonly Amend[];
  readonly children: ComponentChildren;
}) {
  return (
    <div data-variant={id}>
      <Specimen name={name} note={note} surface="bg">
        <div class="chgx-frames">{children}</div>
      </Specimen>
      <ul class="chgx-amends">
        {amends.map((amend) => (
          <li key={amend.rule} class={amend.fork === true ? "is-fork" : undefined}>
            <strong>{amend.fork === true ? `fork · ${amend.rule}` : amend.rule}</strong>{" "}
            {amend.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div class="chgx-cell">
      <StateLabel>{label}</StateLabel>
      {children}
    </div>
  );
}

export function ChangesSpecimensSection() {
  const controller = useMemo(() => {
    seedTree();
    return createFileSurfaceController({ client: inertClient });
  }, []);
  const props = (state: ViewState, width: number) => ({ controller, state, width });

  return (
    <section class="gx-section">
      <SectionHead
        title="changes specimens"
        blurb="Three forms for the Changes list inside the Explorer (spec decision 8). Same checkout in each: feat/changes-list, eight entries, +42 −7 against HEAD. Counts are neutral (C9 a); a status is a one-letter mark and its word is in the tooltip."
      />
      <div class="chgx-variants">
        <Card
          id="a"
          name="A · Files / Changes switch"
          note="two views of one column; the Changes view takes the root row's place"
          amends={[
            {
              rule: "DL-19.9",
              text: "the first row names one of two views, so the root row is not always there",
            },
            {
              rule: "DL-19.7",
              text: "amended too if the switch moves into the dock header",
            },
            { rule: "DL-21.1", text: "the active side takes the selection wash" },
          ]}
        >
          <Cell label="360px · changes">
            <VariantA {...props("populated", 360)} />
          </Cell>
          <Cell label="520px · changes">
            <VariantA {...props("populated", 520)} />
          </Cell>
          <Cell label="360px · clean">
            <VariantA {...props("clean", 360)} />
          </Cell>
          <Cell label="360px · git failed">
            <VariantA {...props("error", 360)} />
          </Cell>
          <Cell label="360px · the Files side">
            <VariantA {...props("populated", 360)} view="files" />
          </Cell>
        </Card>

        <Card
          id="b"
          name="B · collapsible Changes section above the tree"
          note="both at once; collapsed it is one 22px row"
          amends={[
            { rule: "DL-19.9", text: "a second action-bearing row in one tab" },
            {
              rule: "root-is-row-0",
              text: "the tree's root stops being the first row: two scroll regions in a 360px column (file-surface.md)",
            },
          ]}
        >
          <Cell label="360px · changes">
            <VariantB {...props("populated", 360)} />
          </Cell>
          <Cell label="520px · changes">
            <VariantB {...props("populated", 520)} />
          </Cell>
          <Cell label="360px · clean">
            <VariantB {...props("clean", 360)} />
          </Cell>
          <Cell label="360px · git failed">
            <VariantB {...props("error", 360)} />
          </Cell>
          <Cell label="360px · collapsed">
            <VariantB {...props("populated", 360)} collapsed />
          </Cell>
        </Card>

        <Card
          id="c"
          name="C · “changed only” filter on the root row"
          note="a fifth 17px control prunes the tree to changed files and their folders"
          amends={[
            { rule: "DL-19.9", text: "five controls on the root row at 360px" },
            {
              rule: "DL-21.8",
              text: "the filter paints its on state; a toggle that opens nothing has no readout but itself",
              fork: true,
            },
            {
              rule: "spec",
              text: "contradicts decision 1 (no git markers on tree rows) and Out of scope (filter-in-tree); both need rewording if C wins",
              fork: true,
            },
          ]}
        >
          <Cell label="360px · filter on">
            <VariantC {...props("populated", 360)} />
          </Cell>
          <Cell label="520px · filter on">
            <VariantC {...props("populated", 520)} />
          </Cell>
          <Cell label="360px · clean">
            <VariantC {...props("clean", 360)} />
          </Cell>
          <Cell label="360px · git failed">
            <VariantC {...props("error", 360)} />
          </Cell>
          <Cell label="360px · filter off">
            <VariantC {...props("populated", 360)} filter={false} />
          </Cell>
        </Card>
      </div>
    </section>
  );
}
