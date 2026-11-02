import { cn } from "@/lib/cn";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ComponentChildren } from "preact";
import type { AttentionIssue, CommandAreaId, CommandHit } from "../../settings/command-hits";
import { SETTINGS_PAGES, type SettingsPage } from "../../settings/settings-registry";
import { Button } from "../controls/button";
import { DeckIcon, GLYPH_ROW } from "../controls/deck-icon";
import { LogoRow } from "../controls/logo-row";
import { PageResetBar } from "../settings/page-reset-bar";
import { SETTINGS_CATEGORIES } from "../settings/settings-categories";
import { SettingsGroup } from "../settings/settings-group";
import { ThemeGallery } from "../settings/theme-gallery";
import { AboutRows } from "./command-settings-about";
import { AddCommandRow } from "./command-settings-add-command";
import { AgentsRefresh } from "./command-settings-agent-row";
import { AddAgentRow } from "./command-settings-identities";
import { PrivacyRow } from "./command-settings-privacy";
import { ResetRows } from "./command-settings-reset";
import { UsageRow } from "./command-settings-usage";
import { rowDomId } from "./command-settings-live";
import { commandActiveKey } from "./command-settings-state";
import type { LegacyPiece } from "./command-settings-view";

const SEVERITY_DOT = {
  error: "bg-red-600 dark:bg-red-500",
  warning: "bg-amber-500 dark:bg-amber-400",
  info: "bg-muted-foreground",
} as const;

/** The areas whose section is drawn with the Studio treatment (Appearance and Agents). */
const STUDIO_AREAS: ReadonlySet<CommandAreaId> = new Set(["appearance", "agents"]);

function isSettingsPage(area: CommandAreaId): area is SettingsPage {
  return (SETTINGS_PAGES as readonly string[]).includes(area);
}

interface RowProps {
  readonly itemKey: string;
  readonly active: boolean;
  readonly onOpen: () => void;
  readonly children: ComponentChildren;
}

/** One list row: the whole line is the target. Arrows and Enter drive it from the search field. */
function Row({ itemKey, active, onOpen, children }: RowProps) {
  return (
    <li>
      {/* raw-control: a whole-row click target; no Button variant spans a row of two columns */}
      <button
        type="button"
        id={rowDomId(itemKey)}
        tabIndex={-1}
        data-active={active || undefined}
        aria-current={active || undefined}
        className={cn(
          "grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-3 py-1 text-left text-sm text-foreground outline-none",
          active && "bg-muted",
        )}
        onPointerMove={() => {
          if (commandActiveKey.peek() !== itemKey) commandActiveKey.value = itemKey;
        }}
        onClick={onOpen}
      >
        {children}
      </button>
    </li>
  );
}

export function Head({ title }: { readonly title: string }) {
  return (
    <li role="presentation">
      <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
    </li>
  );
}

interface HitRowProps {
  readonly itemKey: string;
  readonly hit: CommandHit;
  readonly value: string;
  /** The area's name, shown where no heading names it. */
  readonly crumb: string | null;
  readonly active: boolean;
  readonly onOpen: () => void;
}

export function HitRow({ itemKey, hit, value, crumb, active, onOpen }: HitRowProps) {
  return (
    <Row itemKey={itemKey} active={active} onOpen={onOpen}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{hit.label}</span>
        {crumb ? <span className="shrink-0 text-xs text-muted-foreground">{crumb}</span> : null}
      </span>
      {hit.kind === "area" ? (
        <DeckIcon icon={ArrowRight01Icon} size={GLYPH_ROW} class="text-muted-foreground" />
      ) : (
        <span className="max-w-64 truncate text-muted-foreground">{value}</span>
      )}
    </Row>
  );
}

interface AttentionRowProps {
  readonly itemKey: string;
  readonly issue: AttentionIssue;
  readonly text: string;
  readonly crumb: string;
  readonly active: boolean;
  readonly onOpen: () => void;
}

export function AttentionRow({ itemKey, issue, text, crumb, active, onOpen }: AttentionRowProps) {
  return (
    <Row itemKey={itemKey} active={active} onOpen={onOpen}>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[issue.severity])}
        />
        <span className="truncate">{text}</span>
      </span>
      <span className="text-xs text-muted-foreground">{crumb}</span>
    </Row>
  );
}

export function EmptyRow({
  query,
  onClear,
}: {
  readonly query: string;
  readonly onClear: () => void;
}) {
  return (
    <li className="flex flex-col items-center gap-2 px-6 py-6 text-sm text-foreground">
      <span>
        Nothing matches <span className="font-medium">“{query}”</span>
      </span>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear search
      </Button>
    </li>
  );
}

/**
 * The legacy markup around a section or a piece of one: the classes the old screen gave it, so
 * it reads the way it always did until a later slice replaces it.
 */
function LegacyBox({
  area,
  label,
  head,
  children,
}: {
  readonly area: CommandAreaId;
  readonly label: string;
  readonly head?: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  const studio = STUDIO_AREAS.has(area);
  return (
    <li className={cn("px-1 pb-3", studio && "settings-screen__doc--studio")}>
      <section aria-label={label}>
        {head}
        <div className={cn("settings-screen__fields", studio && "settings-screen__fields--studio")}>
          {children}
        </div>
      </section>
    </li>
  );
}

/** An area's own Settings section, mounted as is. */
export function SectionMount({ area }: { readonly area: CommandAreaId }) {
  const category = SETTINGS_CATEGORIES.find((entry) => entry.id === area);
  if (category === undefined) {
    return null;
  }
  const Section = category.Section;
  return (
    <LegacyBox
      area={area}
      label={category.label}
      head={isSettingsPage(area) ? <PageResetBar page={area} label={category.label} /> : null}
    >
      <Section />
    </LegacyBox>
  );
}

export function PieceMount({
  area,
  piece,
  locked,
}: {
  readonly area: CommandAreaId;
  readonly piece: LegacyPiece;
  /** The settings snapshot is still loading. */
  readonly locked: boolean;
}) {
  switch (piece) {
    case "reset":
      return (
        <li className="px-3 empty:hidden">
          {isSettingsPage(area) ? (
            <PageResetBar
              page={area}
              label={SETTINGS_CATEGORIES.find((entry) => entry.id === area)?.label ?? area}
            />
          ) : null}
        </li>
      );
    case "theme":
      return (
        <LegacyBox area={area} label="Theme">
          <SettingsGroup settingKey="themeId">
            <ThemeGallery />
          </SettingsGroup>
        </LegacyBox>
      );
    case "logo":
      return (
        <LegacyBox area={area} label="Identity">
          <SettingsGroup title="Identity">
            <LogoRow />
          </SettingsGroup>
        </LegacyBox>
      );
    case "refresh":
      return <AgentsRefresh />;
    case "commands":
      return <AddCommandRow locked={locked} />;
    case "identities":
      return <AddAgentRow locked={locked} />;
    case "about":
      return <AboutRows />;
    case "resets":
      return <ResetRows />;
    case "usage":
      return <UsageRow />;
    case "privacy":
      return <PrivacyRow open />;
  }
}
