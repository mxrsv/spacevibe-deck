import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import {
  Columns2,
  FolderTree,
  Gauge,
  Globe,
  Maximize2,
  MessageSquareText,
  Rows2,
  Settings,
  SquareX,
} from "lucide-preact";
import { ACTION_REGISTRY, type ActionId } from "../../terminal/action-registry";
import {
  formatKeyChord,
  shortcutLabel,
  type KeyChord,
} from "../../lib/shortcut-label";
import type { DesktopPlatform } from "../../lib/platform";
import { FeatureToolbar } from "../../ui/toolbar/feature-toolbar";
import type {
  ToolbarItem,
  ToolbarItemState,
} from "../../ui/toolbar/toolbar-item";
import { UpdateAction } from "../../updater/update-action";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/**
 * The feature toolbar from docs/specs/2026-08-12-feature-toolbar-design.md,
 * as the design requires before any shipping chrome changes.
 *
 * Two things here are fixtures and nothing else: the platform switch, and the
 * Explorer / Browser / Usage entries. Those three actions are specified but
 * not built, so they are not in `ACTION_REGISTRY` yet — registering them now
 * would put a live `Ctrl+Shift+E` into the feature-frozen Tauri app. Their
 * chords are still formatted through `shortcut-label.ts` rather than written
 * out, because a hardcoded `⌘⇧E` is exactly the failure the design names: a
 * macOS label that survives onto Windows.
 *
 * Everything else is real. The controls, the tooltip, the overflow menu and
 * the fit calculation are the shipping components, and the five existing
 * actions read their labels and chords from the registry.
 */

type GalleryPlatform = Extract<DesktopPlatform, "macos" | "windows">;

const PLATFORMS: readonly GalleryPlatform[] = ["macos", "windows"];

/** Explorer matches VS Code on both platforms — the design's one hard chord. */
const EXPLORER_CHORD: Readonly<Record<GalleryPlatform, KeyChord>> =
  Object.freeze({
    macos: { key: "e", meta: true, shift: true },
    windows: { key: "e", ctrl: true, shift: true },
  });

const REGISTRY_LABELS: ReadonlyMap<string, string> = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.label]),
);

/**
 * The registry's labels are macOS menu labels, so a few carry the menu's
 * trailing ellipsis ("Settings…"). The ellipsis is menu grammar for "opens a
 * dialog" — on a toolbar control that job belongs to `aria-haspopup`, and the
 * tooltip wants the name.
 */
function actionLabel(id: ActionId): string {
  return (REGISTRY_LABELS.get(id) ?? id).replace(/…$/, "");
}

const IDLE: ToolbarItemState = { kind: "idle" };
const ACTIVE: ToolbarItemState = { kind: "active" };

const NOOP = (): void => {};

interface ItemOverrides {
  /** Keyed by item id — the states a specimen cannot reach by pointing at it. */
  readonly states?: Readonly<Record<string, ToolbarItemState>>;
}

function registryItem(
  id: ActionId,
  platform: GalleryPlatform,
  item: Omit<ToolbarItem, "label" | "shortcut" | "state" | "onActivate">,
  states: Readonly<Record<string, ToolbarItemState>>,
): ToolbarItem {
  return {
    ...item,
    label: actionLabel(id),
    shortcut: shortcutLabel(id, platform),
    state: states[item.id] ?? IDLE,
    onActivate: NOOP,
  };
}

function toolbarItems(
  platform: GalleryPlatform,
  { states = {} }: ItemOverrides = {},
): readonly ToolbarItem[] {
  return [
    {
      id: "toggle-explorer",
      label: "Explorer",
      icon: FolderTree,
      group: "tools",
      shortcut: formatKeyChord(EXPLORER_CHORD[platform], platform),
      state: states["toggle-explorer"] ?? ACTIVE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: NOOP,
    },
    {
      id: "toggle-browser",
      label: "Browser",
      icon: Globe,
      group: "tools",
      shortcut: null,
      state: states["toggle-browser"] ?? IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: NOOP,
    },
    {
      id: "toggle-usage",
      label: "Usage",
      icon: Gauge,
      group: "tools",
      shortcut: null,
      state: states["toggle-usage"] ?? IDLE,
      overflowOrder: 1,
      onActivate: NOOP,
    },
    registryItem(
      "split-row",
      platform,
      { id: "split-row", icon: Columns2, group: "pane", overflowOrder: 5 },
      states,
    ),
    registryItem(
      "split-column",
      platform,
      { id: "split-column", icon: Rows2, group: "pane", overflowOrder: 4 },
      states,
    ),
    registryItem(
      "toggle-expand",
      platform,
      {
        id: "toggle-expand",
        icon: Maximize2,
        group: "pane",
        overflowOrder: 2,
        toggles: "pressed",
      },
      states,
    ),
    registryItem(
      "close-pane",
      platform,
      { id: "close-pane", icon: SquareX, group: "pane", overflowOrder: 3 },
      states,
    ),
    registryItem(
      "toggle-prompts",
      platform,
      {
        id: "toggle-prompts",
        icon: MessageSquareText,
        group: "global",
        overflowOrder: null,
        toggles: "dialog",
      },
      states,
    ),
    registryItem(
      "toggle-settings",
      platform,
      {
        id: "toggle-settings",
        icon: Settings,
        group: "global",
        overflowOrder: null,
        toggles: "pressed",
      },
      states,
    ),
  ];
}

/** A strip of the real tab bar, at a width the window could actually give it. */
function BarFrame({
  width,
  children,
}: {
  width: number;
  children: ComponentChildren;
}) {
  return (
    <div class="gx-bar" style={{ width: `${width}px` }}>
      <div class="tabbar gx-bar__inner">
        <span class="tab is-active gx-bar__tab">
          <span class="tab__dot" style={{ background: "var(--cyan)" }} />
          <span class="tab__label">deck</span>
        </span>
        {children}
      </div>
    </div>
  );
}

export function ToolbarSection() {
  const platform = useSignal<GalleryPlatform>("macos");

  return (
    <>
      <SectionHead
        title="Feature toolbar"
        blurb="Tools · Pane · Global, with the tooltip and the overflow menu the design asks for. Hover and focus are both live."
      />

      <div class="gx-pick" role="group" aria-label="Shortcut platform">
        {PLATFORMS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            class={`gx-pick__opt ${
              platform.value === candidate ? "is-active" : ""
            }`}
            aria-pressed={platform.value === candidate}
            onClick={() => {
              platform.value = candidate;
            }}
          >
            {candidate}
          </button>
        ))}
        <span class="gx-pick__hint">
          every chord below is formatted for this platform — Explorer reads ⌘⇧E
          on macOS and Ctrl+Shift+E on Windows
        </span>
      </div>

      <Specimen
        name="FeatureToolbar — room for everything"
        note="Explorer active · Browser and Usage have no chord · the update pill rides in the global group"
        surface="bg"
      >
        <div class="gx-barpad">
          <BarFrame width={720}>
            <FeatureToolbar
              items={toolbarItems(platform.value)}
              updateAction={
                <UpdateAction
                  view={{
                    phase: "available",
                    currentVersion: "0.12.2",
                    availableVersion: "0.12.3",
                    notes: "Fixes the thing.",
                  }}
                  onDownload={NOOP}
                  onInstall={NOOP}
                  onRelaunch={NOOP}
                />
              }
            />
          </BarFrame>
        </div>
      </Specimen>

      <Specimen
        name="FeatureToolbar — minimum width"
        note="Usage, Focus expand, Close pane and the splits move into More, in that order; click More to open it"
        surface="bg"
      >
        <div class="gx-barpad gx-barpad--menu">
          <StateLabel>420px — the splits still fit</StateLabel>
          <BarFrame width={420}>
            <FeatureToolbar items={toolbarItems(platform.value)} />
          </BarFrame>
          <StateLabel>
            240px — the pane group is gone, its hairline with it
          </StateLabel>
          <BarFrame width={240}>
            <FeatureToolbar items={toolbarItems(platform.value)} />
          </BarFrame>
        </div>
      </Specimen>

      <Specimen
        name="FeatureToolbar — unavailable actions"
        note="focusable, not disabled: tab to one and the tooltip says why, instead of a control that swallows the click"
        surface="bg"
      >
        <div class="gx-barpad">
          <BarFrame width={720}>
            <FeatureToolbar
              items={toolbarItems(platform.value, {
                states: {
                  "toggle-explorer": IDLE,
                  "close-pane": {
                    kind: "unavailable",
                    reason: "only one pane is open",
                  },
                  "toggle-prompts": {
                    kind: "unavailable",
                    reason: "no pane to paste into",
                  },
                },
              })}
            />
          </BarFrame>
        </div>
      </Specimen>
    </>
  );
}
