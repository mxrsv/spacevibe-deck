import {
  Article,
  ChatText,
  ClipboardText,
  File,
  FileCode,
  FileImage,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSimple,
  Gauge,
  Gear,
  GithubLogo,
  PaperPlaneTilt,
  Play,
  PushPin,
  PushPinSlash,
  Robot,
  SidebarSimple,
  Stop,
  TerminalWindow,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * The one place icon presentation is set (`DL-14.1`). It draws two kinds of source: a Hugeicons
 * glyph (`DeckGlyph`, the new shell) and a Phosphor `Icon` (surfaces not yet cut over). The
 * rest of this comment is about Phosphor's half.
 *
 * Presentation defaults of the Phosphor half (`DL-14.1`). Surfaces
 * choose *which* icon means what and own the accessible name on the button
 * around it; this component owns only how every icon is drawn.
 *
 * Phosphor has no `strokeWidth`: weight is a discrete family. Since 2026-10-09
 * (owner) the family is `bold` for every icon except the bodies in
 * `SOLID_ICONS` below and the surface-scoped `filled` treatment requested by a
 * caller. `regular` draws a 16/256 stroke, about 0.8px at the 13px chrome size
 * and thinner than the 11px label beside it; `bold` draws 24/256, about 1.2px.
 *
 * The app spent 2026-08-19 at `fill` for everything, and the owner reversed it
 * the same day after seeing it run. The reason is in the shapes. Phosphor's
 * `fill` does three different things depending on the icon — a body goes solid
 * (folder, trash, robot), a stroke figure merely thickens (`ArrowLeft`,
 * `GitBranch`), and a bare glyph CHANGES SHAPE: `X`, `Plus`, `Minus` and
 * `Check` become a solid square with the mark knocked out, a caret becomes a
 * solid triangle, and a split layout reads as a pause button. So only bodies
 * go solid; everything else takes the heavier outline.
 */

/**
 * The icons that draw solid everywhere: objects with a body, whose silhouette
 * survives filling — the project folder in the rail is the reference. Kept as
 * a SET OF COMPONENTS rather than an open `weight` prop on `DeckIcon`: the
 * separate `filled` boolean is reserved for owner-approved, surface-scoped
 * treatments and cannot introduce a third weight. Identity, not `displayName`:
 * a minifier may drop the name (see `iconModifier`), and a silently-empty match
 * here would quietly turn every body back into an outline.
 *
 * Left out on purpose: glyphs, arrows, carets and layout pictures (they change
 * shape, see above), stroke figures (`GitBranch`, `TreeView`), `Globe` and
 * `Info` (fill leaves a half-solid disc), and `Star`, whose solid form reads as
 * "already starred" on the GitHub star button.
 *
 * `SidebarSimple` covers BOTH panel toggles — the navigation sidebar's and the
 * dock's, which draws the same icon mirrored (DL-14.1's `mirrored` clause).
 */
const SOLID_ICONS: ReadonlySet<Icon> = new Set<Icon>([
  Article,
  ChatText,
  ClipboardText,
  File,
  FileCode,
  FileImage,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSimple,
  Gauge,
  Gear,
  GithubLogo,
  PaperPlaneTilt,
  Play,
  PushPin,
  PushPinSlash,
  Robot,
  SidebarSimple,
  Stop,
  TerminalWindow,
  Trash,
]);

/** The component type every surface passes in — one import, not the library's. */
export type DeckIconComponent = Icon;

/** The sizes chrome draws at: chrome 13, compact row 14, feature/board 15, rail 16. */
export type DeckIconSize = 13 | 14 | 15 | 16;

/** Window chrome — the tab bar and the titlebar's action cluster. */
export const CHROME_ICON: DeckIconSize = 13;
/** Compact actions inside a config row or a popover row. */
export const ROW_ICON: DeckIconSize = 14;
/** Prominent feature entry points, kept visibly larger than their row text. */
export const FEATURE_ICON: DeckIconSize = 15;
/** Open Board rows, which sit one step larger than a settings row. */
export const BOARD_ICON: DeckIconSize = 15;
/** The settings rail, the largest icon the chrome draws. */
export const RAIL_ICON: DeckIconSize = 16;

/**
 * `.deck-icon` is the class the stylesheet targets, and it is emitted
 * unconditionally — the app's one icon rule (`display: block; flex: none`)
 * hangs off it, so an icon that lost its class would leave a descender-sized
 * gap inside every button in the app.
 *
 * The per-icon modifier beside it is derived from Phosphor's `displayName`
 * (`GearIcon` → `deck-icon--gear`) and exists so a test can name the icon it
 * expects. Nothing in CSS may depend on it: a minifier is entitled to drop a
 * `displayName`, and the layout rule must not be the thing that discovers it.
 */
function iconModifier(icon: Icon): string {
  const displayName = icon.displayName ?? "";
  const bare = displayName.endsWith("Icon") ? displayName.slice(0, -"Icon".length) : displayName;
  if (bare === "") {
    return "";
  }
  const slug = bare.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return ` deck-icon--${slug}`;
}

/** A Hugeicons glyph: the type the new shell's maps and props carry, apart from `DeckIconComponent`. */
export type DeckGlyph = IconSvgElement;

/** The sizes a glyph draws at outside a control: Nova's 12/14/16 ladder. */
export type DeckGlyphSize = 12 | 14 | 16;

/** Beside text, where the mark supports a label: disclosure carets, a lens inside a field. */
export const GLYPH_INLINE: DeckGlyphSize = 12;
/** A standalone action or mark that sits in a row without a control around it. */
export const GLYPH_ROW: DeckGlyphSize = 14;
/** A standalone mark with its own weight in the layout. */
export const GLYPH_FEATURE: DeckGlyphSize = 16;

/**
 * The stroke every glyph draws with, the layout mocks' value. Stroke width lives in one place so
 * a surface cannot thicken one icon by hand.
 */
const GLYPH_STROKE = 2;

interface DeckIconBaseProps {
  readonly class?: string;
}

export interface PhosphorIconProps extends DeckIconBaseProps {
  /** A named import from `@phosphor-icons/react` — never a locally drawn SVG. */
  readonly icon: Icon;
  readonly size?: DeckIconSize;
  /** A surface-scoped solid treatment; omitted icons keep their shared weight. */
  readonly filled?: boolean;
  /**
   * Phosphor draws the one-sided marks facing left only. The dock's toggle
   * points at a panel on the right, so it flips the same icon rather than the
   * set gaining a second drawing of it.
   */
  readonly mirrored?: boolean;
}

export interface GlyphIconProps extends DeckIconBaseProps {
  /** A named import from `@hugeicons/core-free-icons`. */
  readonly icon: DeckGlyph;
  /**
   * Only an icon that stands outside a control passes a size. Inside one the control's
   * `[&_svg:not([class*='size-'])]:size-*` rule wins over this attribute, which stays as the
   * fallback (DL-14.3).
   */
  readonly size?: DeckGlyphSize;
}

export type DeckIconProps = PhosphorIconProps | GlyphIconProps;

function isGlyph(props: DeckIconProps): props is GlyphIconProps {
  return Array.isArray(props.icon);
}

/** True for a Hugeicons glyph, false for a Phosphor component: a list that carries either. */
export function isDeckGlyph(icon: DeckGlyph | DeckIconComponent): icon is DeckGlyph {
  return Array.isArray(icon);
}

function GlyphIcon({ icon, size = 16, class: className }: GlyphIconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={GLYPH_STROKE}
      aria-hidden="true"
      focusable="false"
      className={`deck-icon${className === undefined ? "" : ` ${className}`}`}
    />
  );
}

function PhosphorIcon({
  icon: Icon,
  size = 16,
  class: className,
  filled = false,
  mirrored = false,
}: PhosphorIconProps) {
  return (
    <Icon
      size={size}
      color="currentColor"
      weight={filled || SOLID_ICONS.has(Icon) ? "fill" : "bold"}
      mirrored={mirrored}
      aria-hidden="true"
      focusable="false"
      className={`deck-icon${iconModifier(Icon)}${className === undefined ? "" : ` ${className}`}`}
    />
  );
}

export function DeckIcon(props: DeckIconProps) {
  return isGlyph(props) ? <GlyphIcon {...props} /> : <PhosphorIcon {...props} />;
}

/**
 * An icon from a list that carries either library (`ToolbarItem.icon`): a Phosphor icon draws at
 * `size`, a glyph at the step of the glyph ladder its box holds (RCP-4), 14 for a 14 and 16
 * otherwise.
 */
export function ListIcon({
  icon,
  size,
  filled,
}: {
  readonly icon: DeckGlyph | DeckIconComponent;
  readonly size: DeckIconSize;
  readonly filled?: boolean;
}) {
  return isDeckGlyph(icon) ? (
    <GlyphIcon icon={icon} size={size === 14 ? GLYPH_ROW : GLYPH_FEATURE} />
  ) : (
    <PhosphorIcon icon={icon} size={size} filled={filled} />
  );
}
