import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { ArrowCounterClockwise, Minus, Plus, X } from "@phosphor-icons/react";
import type { ITheme } from "@xterm/xterm";
import { applyThemeVars } from "../../lib/theme-vars";
import { DECK_DARK_ID, DECK_LIGHT_ID, getPreset } from "../../settings/themes";
import { ConfigGroup, ConfigRow } from "../../ui/controls/config-row";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import type { CategoryId } from "../../ui/settings/active-category-store";
import { SETTINGS_CATEGORIES } from "../../ui/settings/settings-categories";
import { SectionHead } from "../specimen";

type ReviewMode = "light" | "dark";
type ReviewSize = "wide" | "compact";
type ReviewCategoryId = CategoryId;

interface ReviewCategory {
  readonly id: ReviewCategoryId;
  readonly label: string;
  readonly description: string;
}

/**
 * The rail, read off the shipping registry instead of retyped.
 *
 * This was eight hand-written entries until they were diffed against
 * `SETTINGS_CATEGORIES`: three descriptions had drifted, and the Terminal one
 * still promised "rendering" — a control the same change set deleted. A
 * specimen that describes settings the app does not have is worse than no
 * specimen, and it is the side-by-side against shipped Settings that this
 * proposal still owes. `Section` comes along unused; the shape below is
 * structurally the registry's minus that field.
 */
const REVIEW_CATEGORIES: readonly ReviewCategory[] = SETTINGS_CATEGORIES;

/**
 * The two canonical presets, taken from the shipping data rather than copied.
 *
 * These were 20 hand-written hex values each until they were compared against
 * `THEME_PRESETS`: eighteen matched and two had already drifted, which is the
 * whole argument. `gallery.tsx` and `matrix-section.tsx` already read the real
 * presets; this specimen now does too, so an edit to a palette reaches the
 * proposal it was reviewed as.
 *
 * `foreground` and `cursor` are pinned deliberately. The owner reviewed this
 * direction with the seed inks, and DL-3.6 replaced them at PORT time with
 * their luminance twins (`#e7e7e7` / `#272727`, contrast identical, hue gone).
 * Keeping the seeds is what makes this specimen a record of what was approved
 * rather than a second, drifting copy of what shipped.
 */
const DARK_REVIEW_THEME: Readonly<ITheme> = Object.freeze({
  ...getPreset(DECK_DARK_ID).theme,
  foreground: "#e5e7eb",
  cursor: "#e5e7eb",
});

const LIGHT_REVIEW_THEME: Readonly<ITheme> = Object.freeze({
  ...getPreset(DECK_LIGHT_ID).theme,
  foreground: "#25272c",
  cursor: "#25272c",
});

const REVIEW_THEMES: Readonly<Record<ReviewMode, Readonly<ITheme>>> = {
  light: LIGHT_REVIEW_THEME,
  dark: DARK_REVIEW_THEME,
};

interface ReviewState {
  readonly mode: Signal<ReviewMode>;
  readonly category: Signal<ReviewCategoryId>;
  readonly resetOpen: Signal<boolean>;
  readonly layout: Signal<"sidebar" | "top">;
  readonly showPaneBar: Signal<boolean>;
  readonly showStatusBar: Signal<boolean>;
  readonly fontFamily: Signal<string>;
  readonly fontSize: Signal<number>;
  readonly scrollback: Signal<string>;
  readonly banner: Signal<string>;
  readonly notifyAsked: Signal<boolean>;
  readonly notifyFinished: Signal<boolean>;
  readonly openLinksInDeck: Signal<boolean>;
  readonly fileEditor: Signal<string>;
  readonly externalLinks: Signal<string>;
}

interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent): void => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const currentIndex = options.findIndex((option) => option.value === value);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (currentIndex +
              (event.key === "ArrowRight" ? 1 : -1) +
              options.length) %
            options.length;
    onChange(options[nextIndex].value);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>("button")
      [nextIndex]?.focus();
  };

  return (
    <div
      ref={groupRef}
      class="gxs-segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            class={selected ? "is-selected" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SwitchControlProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

function SwitchControl({ label, checked, onChange }: SwitchControlProps) {
  return (
    <button
      type="button"
      class={`gxs-switch${checked ? " is-on" : ""}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

interface SelectControlProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: SelectControlProps) {
  return (
    <select
      class="gxs-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

interface NumberControlProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

function NumberControl({ value, min, max, onChange }: NumberControlProps) {
  const clamp = (next: number): void =>
    onChange(Math.min(max, Math.max(min, next)));
  return (
    <span class="gxs-number" role="group" aria-label="Font size">
      <button
        type="button"
        aria-label="Decrease font size"
        onClick={() => clamp(value - 1)}
      >
        <DeckIcon icon={Minus} size={ROW_ICON} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label="Font size in pixels"
        onInput={(event) => clamp(Number(event.currentTarget.value))}
      />
      <span aria-hidden="true">px</span>
      <button
        type="button"
        aria-label="Increase font size"
        onClick={() => clamp(value + 1)}
      >
        <DeckIcon icon={Plus} size={ROW_ICON} />
      </button>
    </span>
  );
}

function DraftInput({ errorId }: { readonly errorId: string }) {
  const saved = useSignal("https://example.com");
  const draft = useSignal(saved.value);
  const error = useSignal<string | null>(null);

  const commit = (): void => {
    try {
      const parsed = new URL(draft.value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new Error();
      saved.value = parsed.toString().replace(/\/$/, "");
      draft.value = saved.value;
      error.value = null;
    } catch {
      error.value = "Enter a complete http or https URL.";
    }
  };

  return (
    <div class="gxs-draft-field">
      <input
        type="url"
        value={draft.value}
        aria-label="Homepage URL"
        aria-invalid={error.value !== null}
        aria-describedby={error.value === null ? undefined : errorId}
        onInput={(event) => {
          draft.value = event.currentTarget.value;
          error.value = null;
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            draft.value = saved.value;
            error.value = null;
          }
        }}
      />
      {error.value !== null && (
        <span id={errorId} role="alert">
          {error.value}
        </span>
      )}
    </div>
  );
}

function AgentEditor() {
  const adding = useSignal(true);
  const name = useSignal("");
  const command = useSignal("");
  const error = useSignal<string | null>(null);
  const added = useSignal<string | null>(null);

  const cancel = (): void => {
    name.value = "";
    command.value = "";
    error.value = null;
    adding.value = false;
  };

  const add = (event: Event): void => {
    event.preventDefault();
    if (name.value.trim() === "" || command.value.trim() === "") {
      error.value = "Name and command are both required.";
      return;
    }
    added.value = name.value.trim();
    cancel();
  };

  return (
    <>
      <div class="gxs-agent-list">
        <span>
          <b>Claude Code</b>
          <small>Detected · claude</small>
        </span>
        <span>
          <b>{added.value ?? "Review agent"}</b>
          <small>
            {added.value === null ? "Custom · review" : "Custom · saved"}
          </small>
        </span>
      </div>
      {adding.value ? (
        <form class="gxs-agent-form" onSubmit={add}>
          <label>
            <span>Name</span>
            <input
              value={name.value}
              placeholder="My agent"
              onInput={(event) => {
                name.value = event.currentTarget.value;
                error.value = null;
              }}
            />
          </label>
          <label>
            <span>Command</span>
            <input
              value={command.value}
              placeholder="agent --flag"
              onInput={(event) => {
                command.value = event.currentTarget.value;
                error.value = null;
              }}
            />
          </label>
          {error.value !== null && <p role="alert">{error.value}</p>}
          <div class="gxs-form-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" class="is-primary">
              Add agent
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          class="gxs-action"
          onClick={() => {
            adding.value = true;
          }}
        >
          Add custom agent
        </button>
      )}
    </>
  );
}

function ShortcutRecorder() {
  const shortcut = useSignal("⌘T");
  const recording = useSignal(false);
  const conflict = useSignal<string | null>(null);

  return (
    <div class="gxs-shortcut-control">
      <button
        type="button"
        aria-label="Record shortcut for New agent"
        aria-pressed={recording.value}
        onClick={() => {
          recording.value = true;
          conflict.value = null;
        }}
        onKeyDown={(event) => {
          if (!recording.value) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            recording.value = false;
            return;
          }
          if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
          const modifier = event.metaKey
            ? "⌘"
            : event.ctrlKey
              ? "Ctrl+"
              : event.altKey
                ? "⌥"
                : "";
          const next = `${modifier}${event.key.toUpperCase()}`;
          if (next === "⌘W") {
            conflict.value =
              "Already used by Close surface. Nothing was saved.";
            return;
          }
          shortcut.value = next;
          conflict.value = null;
          recording.value = false;
        }}
      >
        {recording.value ? "Press keys…" : shortcut.value}
      </button>
      {conflict.value !== null && <span role="alert">{conflict.value}</span>}
    </div>
  );
}

function AboutActions() {
  const status = useSignal<"idle" | "checking" | "current">("idle");
  const check = (): void => {
    if (status.value !== "idle") return;
    status.value = "checking";
    window.setTimeout(() => {
      status.value = "current";
    }, 700);
  };
  return (
    <div class="gxs-action-status">
      <button
        type="button"
        class="gxs-action"
        disabled={status.value === "checking"}
        onClick={check}
      >
        {status.value === "checking" ? "Checking…" : "Check for updates"}
      </button>
      {status.value === "current" && (
        <span role="status">Deck is up to date.</span>
      )}
    </div>
  );
}

function AppearanceSection({ state }: { readonly state: ReviewState }) {
  return (
    <>
      <ConfigGroup label="Theme" />
      <ConfigRow
        label="Appearance"
        desc="Use a light or dark surface across Deck"
      >
        <SegmentedControl
          label="Appearance mode"
          value={state.mode.value}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(value) => {
            state.mode.value = value;
          }}
        />
      </ConfigRow>
      <ConfigGroup label="Layout" />
      <ConfigRow
        label="Tabs"
        desc="Place the tab strip beside or above the stage"
      >
        <SegmentedControl
          label="Tab position"
          value={state.layout.value}
          options={[
            { value: "sidebar", label: "Sidebar" },
            { value: "top", label: "Top" },
          ]}
          onChange={(value) => {
            state.layout.value = value;
          }}
        />
      </ConfigRow>
      <ConfigRow label="Show pane bar" desc="Pane name bar inside splits">
        <SwitchControl
          label="Show pane bar"
          checked={state.showPaneBar.value}
          onChange={(value) => {
            state.showPaneBar.value = value;
          }}
        />
      </ConfigRow>
      <ConfigRow
        label="Show status bar"
        desc="Branch, path and window readout along the bottom"
      >
        <SwitchControl
          label="Show status bar"
          checked={state.showStatusBar.value}
          onChange={(value) => {
            state.showStatusBar.value = value;
          }}
        />
      </ConfigRow>
      <ConfigGroup label="Branding" />
      <ConfigRow label="Logo">
        <button type="button" class="gxs-action">
          Choose logo…
        </button>
      </ConfigRow>
      <ConfigRow
        label="Banner"
        desc="Preset choice and file action stay separate"
      >
        <div class="gxs-inline-controls">
          <SelectControl
            label="Banner preset"
            value={state.banner.value}
            options={["None", "Compact", "Wide"]}
            onChange={(value) => {
              state.banner.value = value;
            }}
          />
          <button type="button" class="gxs-action">
            Choose image…
          </button>
        </div>
      </ConfigRow>
    </>
  );
}

function CategoryContents({
  category,
  state,
  size,
}: {
  readonly category: ReviewCategoryId;
  readonly state: ReviewState;
  readonly size: ReviewSize;
}) {
  if (category === "appearance") return <AppearanceSection state={state} />;
  if (category === "browser")
    return (
      <>
        <ConfigGroup label="Startup" />
        <ConfigRow
          label="Homepage"
          desc="Enter commits a valid URL; Escape restores the saved value"
        >
          <DraftInput errorId={`gxs-${size}-homepage-error`} />
        </ConfigRow>
        <ConfigRow label="Open links in Deck">
          <SwitchControl
            label="Open links in Deck"
            checked={state.openLinksInDeck.value}
            onChange={(value) => {
              state.openLinksInDeck.value = value;
            }}
          />
        </ConfigRow>
      </>
    );
  if (category === "terminal")
    return (
      <>
        <ConfigGroup label="Type" />
        <ConfigRow label="Font family">
          <SelectControl
            label="Font family"
            value={state.fontFamily.value}
            options={["Berkeley Mono", "JetBrains Mono", "System monospace"]}
            onChange={(value) => {
              state.fontFamily.value = value;
            }}
          />
        </ConfigRow>
        <ConfigRow
          label="Font size"
          desc="Type a value or step between 10 and 24"
        >
          <NumberControl
            value={state.fontSize.value}
            min={10}
            max={24}
            onChange={(value) => {
              state.fontSize.value = value;
            }}
          />
        </ConfigRow>
        <ConfigGroup label="Performance" />
        <ConfigRow label="Scrollback">
          <SelectControl
            label="Scrollback"
            value={state.scrollback.value}
            options={[
              "5,000 lines",
              "10,000 lines",
              "50,000 lines",
              "Unlimited",
            ]}
            onChange={(value) => {
              state.scrollback.value = value;
            }}
          />
        </ConfigRow>
      </>
    );
  if (category === "agents")
    return (
      <>
        <ConfigGroup label="Available agents" />
        <AgentEditor />
      </>
    );
  if (category === "links-editor")
    return (
      <>
        <ConfigGroup label="Open with" />
        <ConfigRow label="Files">
          <SelectControl
            label="File editor"
            value={state.fileEditor.value}
            options={["Visual Studio Code", "Cursor", "System default"]}
            onChange={(value) => {
              state.fileEditor.value = value;
            }}
          />
        </ConfigRow>
        <ConfigRow label="External links">
          <SelectControl
            label="External links"
            value={state.externalLinks.value}
            options={["System browser", "Deck browser"]}
            onChange={(value) => {
              state.externalLinks.value = value;
            }}
          />
        </ConfigRow>
      </>
    );
  if (category === "shortcuts")
    return (
      <>
        <ConfigGroup label="Tabs" />
        <ConfigRow label="New agent" desc="Click, then press a key combination">
          <ShortcutRecorder />
        </ConfigRow>
        <ConfigRow label="Close surface">
          <kbd>⌘W</kbd>
        </ConfigRow>
        <ConfigGroup label="Workspace" />
        <ConfigRow label="Toggle sidebar">
          <kbd>⌘⇧B</kbd>
        </ConfigRow>
      </>
    );
  if (category === "notifications")
    return (
      <>
        <ConfigGroup label="Agent activity" />
        <ConfigRow label="Agent asks a question">
          <SwitchControl
            label="Notify when an agent asks a question"
            checked={state.notifyAsked.value}
            onChange={(value) => {
              state.notifyAsked.value = value;
            }}
          />
        </ConfigRow>
        <ConfigRow label="Agent finishes a turn">
          <SwitchControl
            label="Notify when an agent finishes"
            checked={state.notifyFinished.value}
            onChange={(value) => {
              state.notifyFinished.value = value;
            }}
          />
        </ConfigRow>
      </>
    );
  return (
    <>
      <ConfigGroup label="Deck" />
      <ConfigRow label="Version">
        <span class="gxs-readonly-value">0.8.0 · Electron</span>
      </ConfigRow>
      <ConfigRow
        label="Updates"
        desc="Async actions report progress and result"
      >
        <AboutActions />
      </ConfigRow>
    </>
  );
}

function ResetContents({
  state,
  size,
}: {
  readonly state: ReviewState;
  readonly size: ReviewSize;
}) {
  const titleId = `gxs-${size}-reset-confirm-title`;
  const descriptionId = `gxs-${size}-reset-confirm-desc`;
  return (
    <div
      class="gxs-reset-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <h2 id={titleId}>Reset all settings?</h2>
      <p id={descriptionId}>
        Deck will restore application preferences. Workspaces and agent sessions
        stay intact.
      </p>
      <div class="gxs-form-actions">
        <button
          type="button"
          onClick={() => {
            state.resetOpen.value = false;
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          class="is-primary"
          onClick={() => {
            state.resetOpen.value = false;
          }}
        >
          Reset settings
        </button>
      </div>
    </div>
  );
}

function SettingsDirectionFrame({
  state,
  size,
}: {
  readonly state: ReviewState;
  readonly size: ReviewSize;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const category =
    REVIEW_CATEGORIES.find((item) => item.id === state.category.value) ??
    REVIEW_CATEGORIES[0];
  const title = state.resetOpen.value ? "Reset settings" : category.label;
  const description = state.resetOpen.value
    ? "Return application preferences to their defaults with a deliberate confirmation."
    : category.description;
  const titleId = `gxs-${size}-${state.resetOpen.value ? "reset" : category.id}-title`;

  useLayoutEffect(() => {
    if (frameRef.current !== null)
      applyThemeVars(frameRef.current.style, REVIEW_THEMES[state.mode.value]);
  }, [state.mode.value]);

  const selectCategory = (id: ReviewCategoryId): void => {
    state.category.value = id;
    state.resetOpen.value = false;
  };

  return (
    <article
      ref={frameRef}
      class={`gxs-settings-frame gxs-settings-frame--${size}`}
      aria-label={`${state.mode.value} ${size} Settings proposal`}
    >
      <header class="gxs-settings-head">
        <h2>
          <b>~</b>/deck/settings
        </h2>
        <button
          type="button"
          aria-label="Close settings"
          title="Close settings"
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </header>
      <div class="gxs-settings-grid">
        <nav class="gxs-settings-nav" aria-label="Settings categories">
          <div class="gxs-settings-nav__list">
            {REVIEW_CATEGORIES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                class={
                  !state.resetOpen.value && id === state.category.value
                    ? "is-active"
                    : ""
                }
                aria-current={
                  !state.resetOpen.value && id === state.category.value
                    ? "page"
                    : undefined
                }
                title={label}
                onClick={() => selectCategory(id)}
              >
                {/* Text only since 2026-08-19 (DL-11.3 retired) — the rail
                    carries no category icon at either width now. */}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            class={`gxs-settings-reset${state.resetOpen.value ? " is-active" : ""}`}
            aria-current={state.resetOpen.value ? "page" : undefined}
            aria-label="Reset settings"
            title={size === "compact" ? "Reset settings" : undefined}
            onClick={() => {
              state.resetOpen.value = true;
            }}
          >
            {/* The app's own reset icon, not the retired text arrow:
                `icon-system.test.ts` bans that glyph app-wide (in prose too,
                which is why this comment spells it out instead of quoting
                it), and a specimen drawing one proposes chrome the rulebook
                already rejected. */}
            <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
            <b>Reset settings</b>
          </button>
        </nav>
        <section class="gxs-settings-content" aria-labelledby={titleId}>
          <div class="gxs-settings-document">
            <header class="gxs-settings-intro">
              <h1 id={titleId}>{title}</h1>
              <p>{description}</p>
            </header>
            <div class="gxs-settings-surface">
              {state.resetOpen.value ? (
                <ResetContents state={state} size={size} />
              ) : (
                <CategoryContents
                  category={category.id}
                  state={state}
                  size={size}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}

export function SettingsDirectionSection() {
  const state: ReviewState = {
    mode: useSignal<ReviewMode>("dark"),
    category: useSignal<ReviewCategoryId>("appearance"),
    resetOpen: useSignal(false),
    layout: useSignal<"sidebar" | "top">("sidebar"),
    showPaneBar: useSignal(true),
    showStatusBar: useSignal(true),
    fontFamily: useSignal("Berkeley Mono"),
    fontSize: useSignal(13),
    scrollback: useSignal("10,000 lines"),
    banner: useSignal("None"),
    notifyAsked: useSignal(true),
    notifyFinished: useSignal(false),
    openLinksInDeck: useSignal(true),
    fileEditor: useSignal("Visual Studio Code"),
    externalLinks: useSignal("System browser"),
  };

  return (
    <>
      <SectionHead
        title="Settings interaction direction"
        blurb="Gallery-only review: neutral controls matched to each value shape, shown in the same category at wide and 480px application widths."
      />
      <div class="gxs-review-toolbar" aria-label="Settings review controls">
        <label>
          <span>Mode</span>
          <select
            value={state.mode.value}
            onChange={(event) => {
              state.mode.value = event.currentTarget.value as ReviewMode;
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          <span>Category</span>
          <select
            value={state.category.value}
            onChange={(event) => {
              state.category.value = event.currentTarget
                .value as ReviewCategoryId;
              state.resetOpen.value = false;
            }}
          >
            {REVIEW_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            state.resetOpen.value = true;
          }}
        >
          Review reset
        </button>
      </div>
      <div class="gxs-review-stack">
        <section class="gxs-review-case">
          <header>
            <strong>Wide · 960px</strong>
            <span>labels stay visible; content keeps a readable measure</span>
          </header>
          <div class="gxs-review-viewport">
            <SettingsDirectionFrame state={state} size="wide" />
          </div>
        </section>
        <section class="gxs-review-case">
          <header>
            <strong>Compact · 480px</strong>
            <span>the category rail collapses to accessible icons</span>
          </header>
          <div class="gxs-review-viewport">
            <SettingsDirectionFrame state={state} size="compact" />
          </div>
        </section>
      </div>
    </>
  );
}
