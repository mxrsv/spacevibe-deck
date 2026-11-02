import { useEffect } from "preact/hooks";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { CommitInput } from "../../ui/controls/commit-input";
import { CommitTextarea } from "../../ui/controls/commit-textarea";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  Badge,
  Button,
  Chip,
  Input,
  Kbd,
  KbdGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/controls/preset-controls";
import { FORCE_CLASS, installForcedStates } from "../force-states";
import { SectionHead, Specimen } from "../specimen";
import { installControlStateForcing } from "./control-states-force";
import { Grid, Group, type Row, type State } from "./control-states-grid";
import "./control-states-section.css";

/**
 * The small UI of the composition spec (CMP-2, CMP-5 to CMP-7, CMP-9, CMP-13) drawn from the
 * real components in dark and light. Hover, focus and pressed are forced onto a cell by the
 * wrapper class of `force-states.ts`, over rules read back from the controls' own stylesheet;
 * selected, disabled and invalid are props of the real control.
 */

const BUTTON_STATES: readonly State[] = [
  "rest",
  "hover",
  "focus",
  "pressed",
  "selected",
  "disabled",
];
const CHIP_STATES: readonly State[] = ["rest", "hover", "focus", "pressed", "disabled"];
const FIELD_STATES: readonly State[] = ["rest", "hover", "focus", "disabled", "invalid"];

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive"] as const;
/** The variants that paint `aria-expanded` as a background step (CMP-13 selected). */
const SELECTABLE = new Set<(typeof VARIANTS)[number]>(["outline", "ghost"]);
const TEXT_SIZES = ["sm", "default", "lg", "xl"] as const;
const ICON_SIZES = ["icon", "icon-sm", "icon-xs"] as const;
const CHIPS = [
  { label: "24", size: 24, quiet: false },
  { label: "20", size: 20, quiet: false },
  { label: "24 quiet", size: 24, quiet: true },
  { label: "20 quiet", size: 20, quiet: true },
] as const;
const SHELLS = [
  { value: "zsh", label: "zsh" },
  { value: "bash", label: "bash" },
];

const plus = <DeckIcon icon={Plus} size={ROW_ICON} />;

function ButtonGroups() {
  const stateRows: Row[] = VARIANTS.map((variant) => ({
    label: variant,
    cells: BUTTON_STATES.map((state) =>
      state === "selected" && !SELECTABLE.has(variant)
        ? null
        : {
            state,
            node: (
              <Button
                variant={variant}
                disabled={state === "disabled"}
                aria-expanded={state === "selected" ? true : undefined}
              >
                Save
              </Button>
            ),
          },
    ),
  }));
  const sizeColumns = [...TEXT_SIZES, ...ICON_SIZES];
  const sizeRows: Row[] = (["default", "outline"] as const).map((variant) => ({
    label: variant,
    cells: sizeColumns.map((size) => ({
      state: "rest" as const,
      node: (
        <Button variant={variant} size={size} aria-label={size}>
          {size.startsWith("icon") ? plus : "Save"}
        </Button>
      ),
    })),
  }));
  return (
    <>
      <Group name="Button">
        <Grid columns={BUTTON_STATES} rows={stateRows} />
      </Group>
      <Group name="Button sizes">
        <Grid columns={sizeColumns} rows={sizeRows} first="4rem" />
      </Group>
    </>
  );
}

function ChipGroups() {
  const rows: Row[] = CHIPS.map(({ label, size, quiet }) => ({
    label,
    cells: CHIP_STATES.map((state) => ({
      state,
      node: (
        <Chip size={size} quiet={quiet} disabled={state === "disabled"}>
          main
        </Chip>
      ),
    })),
  }));
  return (
    <>
      <Group name="Chip">
        <Grid columns={CHIP_STATES} rows={rows} />
      </Group>
      <Group name="Badge · Kbd">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </div>
      </Group>
    </>
  );
}

function FieldGroups() {
  const rows: Row[] = FIELD_STATES.map((state) => ({
    label: state,
    cells: [
      {
        state,
        node: (
          <Input
            aria-label="Input"
            defaultValue="feature/rail"
            disabled={state === "disabled"}
            aria-invalid={state === "invalid" ? true : undefined}
          />
        ),
      },
      {
        state,
        node: (
          <Select items={SHELLS} defaultValue="zsh" disabled={state === "disabled"}>
            <SelectTrigger
              aria-label="Select"
              className="w-full"
              aria-invalid={state === "invalid" ? true : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHELLS.map((shell) => (
                <SelectItem key={shell.value} value={shell.value}>
                  {shell.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ],
  }));
  return (
    <Group name="Input · Select">
      <Grid columns={["Input", "Select"]} rows={rows} />
    </Group>
  );
}

/** The controls in one theme: the root class carries the tokens, as it does in the app. */
function Panel({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      className={cn(
        "ui-preset flex min-w-0 flex-col gap-7 rounded-lg border p-5",
        theme === "dark" ? "dark" : "preset-light",
      )}
    >
      <span className="text-sm font-medium">{theme === "dark" ? "Dark" : "Light"}</span>
      <ButtonGroups />
      <ChipGroups />
      <FieldGroups />
    </div>
  );
}

export function ControlStatesSection() {
  useEffect(installControlStateForcing, []);
  // The legacy fields below read `styles.css`, which the other forcing does not reach.
  useEffect(() => installForcedStates().dispose, []);

  return (
    <>
      <SectionHead title="small UI" blurb="Button, Chip, Badge, Kbd and fields, dark and light." />
      <div className="grid grid-cols-2 gap-4">
        <Panel theme="dark" />
        <Panel theme="light" />
      </div>
      <div className="mt-6">
        <Specimen
          name="CommitInput · CommitTextarea"
          note="legacy fields, gallery theme"
          surface="bg"
        >
          <div className="grid w-80 gap-3">
            <div>
              <CommitInput
                value="feature/rail"
                placeholder="Name"
                ariaLabel="Name"
                onCommit={noop}
              />
            </div>
            <div className={FORCE_CLASS.focus}>
              <CommitInput
                value="feature/rail"
                placeholder="Name"
                ariaLabel="Name"
                onCommit={noop}
              />
            </div>
            <div>
              <CommitInput
                value="feature/rail"
                placeholder="Name"
                ariaLabel="Name"
                invalid
                onCommit={noop}
              />
            </div>
            <div className={FORCE_CLASS.focus}>
              <CommitTextarea
                value="Review the diff"
                placeholder="Prompt"
                ariaLabel="Prompt"
                onCommit={noop}
              />
            </div>
          </div>
        </Specimen>
      </div>
    </>
  );
}

function noop(): void {}
