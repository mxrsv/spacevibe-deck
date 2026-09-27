import { useSignal, type Signal } from "@preact/signals";
import { ArrowLeft, Minus, Plus } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { applyThemeVars } from "../../lib/theme-vars";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { DECK_DARK_ID, DECK_LIGHT_ID, getPreset } from "../../settings/themes";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { SETTINGS_CATEGORIES } from "../../ui/settings/settings-categories";
import type { CategoryId } from "../../ui/settings/active-category-store";
import { SectionHead } from "../specimen";
import "./settings-native-mock.css";

type PreviewWidth = "wide" | "compact";
type ThemeChoice = "dark" | "light";
type TabBarChoice = "left" | "top";

interface MockState {
  readonly category: Signal<CategoryId>;
  readonly width: Signal<PreviewWidth>;
  readonly theme: Signal<ThemeChoice>;
  readonly tabBar: Signal<TabBarChoice>;
  readonly fontSize: Signal<number>;
  readonly fontFamily: Signal<string>;
  readonly showPaneBar: Signal<boolean>;
  readonly showStatusBar: Signal<boolean>;
  readonly notifyAgents: Signal<boolean>;
  readonly restoreSessions: Signal<boolean>;
  readonly scrollback: Signal<string>;
  readonly browserHome: Signal<string>;
  readonly agentDraftOpen: Signal<boolean>;
  readonly agentName: Signal<string>;
  readonly agentCommand: Signal<string>;
  readonly customAgents: Signal<readonly { name: string; command: string }[]>;
}

const NAV_GROUPS: readonly { label: string; ids: readonly CategoryId[] }[] = [
  { label: "Look and feel", ids: ["appearance", "terminal"] },
  {
    label: "Workflow",
    ids: ["agents", "browser", "links-editor", "shortcuts", "notifications"],
  },
  { label: "Deck", ids: ["about", "privacy", "reset"] },
];

function PreviewGroup({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="snm-group">
      <h3>{title}</h3>
      <div class="snm-group__body">{children}</div>
    </section>
  );
}

function PreviewRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="snm-row">
      <div class="snm-row__copy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div class="snm-row__control">{children}</div>
    </div>
  );
}

function PreviewSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      class={`snm-switch ${value ? "is-on" : ""}`}
      role="switch"
      aria-label={label}
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}

function PreviewSegment<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      class="snm-segment"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = choices.findIndex((choice) => choice.value === value);
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = (current + step + choices.length) % choices.length;
        onChange(choices[next].value);
        event.currentTarget.querySelectorAll("button")[next]?.focus();
      }}
    >
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          tabIndex={value === choice.value ? 0 : -1}
          class={value === choice.value ? "is-selected" : ""}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function AppearanceContent({ state }: { state: MockState }) {
  return (
    <>
      <PreviewGroup title="Theme">
        <div class="snm-theme-pair" role="group" aria-label="Theme">
          {(["dark", "light"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              class={`snm-theme snm-theme--${choice} ${state.theme.value === choice ? "is-selected" : ""}`}
              aria-pressed={state.theme.value === choice}
              onClick={() => {
                state.theme.value = choice;
              }}
            >
              <span class="snm-theme__mini" aria-hidden="true">
                <i />
                <b>
                  <em />
                  <em />
                  <em />
                </b>
              </span>
              <span class="snm-theme__caption">
                <strong>{choice === "dark" ? "Dark" : "Light"}</strong>
                <small>
                  {choice === "dark" ? "Quiet, low-glare chrome" : "Clear, bright chrome"}
                </small>
              </span>
              <span class="snm-theme__mark" aria-hidden="true">
                ✓
              </span>
            </button>
          ))}
        </div>
      </PreviewGroup>
      <PreviewGroup title="Typography">
        <PreviewRow label="Terminal font" detail="Used inside terminal panes">
          <select
            class="snm-select"
            aria-label="Terminal font"
            value={state.fontFamily.value}
            onChange={(event) => {
              state.fontFamily.value = event.currentTarget.value;
            }}
          >
            <option>SF Mono</option>
            <option>Menlo</option>
            <option>JetBrains Mono</option>
          </select>
        </PreviewRow>
        <PreviewRow label="Font size" detail="Applies to every pane">
          <div class="snm-stepper" role="group" aria-label="Font size">
            <button
              type="button"
              aria-label="Decrease font size"
              disabled={state.fontSize.value <= 10}
              onClick={() => {
                state.fontSize.value = state.fontSize.value - 1;
              }}
            >
              <DeckIcon icon={Minus} size={ROW_ICON} />
            </button>
            <output>{state.fontSize.value} px</output>
            <button
              type="button"
              aria-label="Increase font size"
              disabled={state.fontSize.value >= 24}
              onClick={() => {
                state.fontSize.value = state.fontSize.value + 1;
              }}
            >
              <DeckIcon icon={Plus} size={ROW_ICON} />
            </button>
          </div>
        </PreviewRow>
      </PreviewGroup>
      <PreviewGroup title="Window layout">
        <PreviewRow label="Tab bar position" detail="Where your open tabs appear">
          <PreviewSegment
            label="Tab bar position"
            value={state.tabBar.value}
            choices={[
              { value: "left", label: "Sidebar" },
              { value: "top", label: "Top" },
            ]}
            onChange={(next) => {
              state.tabBar.value = next;
            }}
          />
        </PreviewRow>
        <PreviewRow label="Show pane bar" detail="Pane name inside splits">
          <PreviewSwitch
            label="Show pane bar"
            value={state.showPaneBar.value}
            onChange={(next) => {
              state.showPaneBar.value = next;
            }}
          />
        </PreviewRow>
        <PreviewRow label="Show status bar" detail="Branch, path and window details">
          <PreviewSwitch
            label="Show status bar"
            value={state.showStatusBar.value}
            onChange={(next) => {
              state.showStatusBar.value = next;
            }}
          />
        </PreviewRow>
      </PreviewGroup>
    </>
  );
}

function OtherContent({ state }: { state: MockState }) {
  switch (state.category.value) {
    case "terminal":
      return (
        <PreviewGroup title="History">
          <PreviewRow label="Scrollback" detail="Lines kept in each pane">
            <select
              class="snm-select"
              aria-label="Scrollback"
              value={state.scrollback.value}
              onChange={(event) => {
                state.scrollback.value = event.currentTarget.value;
              }}
            >
              {["1,000 lines", "5,000 lines", "10,000 lines", "50,000 lines", "100,000 lines"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </PreviewRow>
        </PreviewGroup>
      );
    case "notifications":
      return (
        <PreviewGroup title="Agent activity">
          <PreviewRow
            label="Agent notifications"
            detail="Alert when a background agent finishes or needs you"
          >
            <PreviewSwitch
              label="Agent notifications"
              value={state.notifyAgents.value}
              onChange={(next) => {
                state.notifyAgents.value = next;
              }}
            />
          </PreviewRow>
          <PreviewRow
            label="Restore sessions on launch"
            detail="Reopen tabs and resume conversations"
          >
            <PreviewSwitch
              label="Restore sessions on launch"
              value={state.restoreSessions.value}
              onChange={(next) => {
                state.restoreSessions.value = next;
              }}
            />
          </PreviewRow>
        </PreviewGroup>
      );
    case "browser":
      return (
        <PreviewGroup title="Start page">
          <PreviewRow label="Home address" detail="Opened when the browser has no page yet">
            <input
              class="snm-input"
              aria-label="Home address"
              value={state.browserHome.value}
              onInput={(event) => {
                state.browserHome.value = event.currentTarget.value;
              }}
            />
          </PreviewRow>
        </PreviewGroup>
      );
    case "links-editor":
      return (
        <PreviewGroup title="External paths">
          <PreviewRow label="Open with" detail="For paths outside your open workspaces">
            <select class="snm-select" aria-label="Open with">
              <option>Visual Studio Code</option>
              <option>Finder</option>
              <option>System default</option>
            </select>
          </PreviewRow>
        </PreviewGroup>
      );
    case "agents":
      return (
        <>
          <PreviewGroup title="Built-in agents">
            {BUILTIN_AGENTS.map((agent) => (
              <PreviewRow
                key={agent.id}
                label={agent.label}
                detail={agent.defaultCommand ?? agent.id}
              >
                <span class="snm-status">Built in</span>
              </PreviewRow>
            ))}
          </PreviewGroup>
          <PreviewGroup title="Custom agents">
            {state.customAgents.value.length === 0 ? (
              <div class="snm-group__empty">Add a command to launch another tool from Deck.</div>
            ) : (
              state.customAgents.value.map((agent) => (
                <PreviewRow key={agent.name} label={agent.name} detail={agent.command}>
                  <span class="snm-status">Custom</span>
                </PreviewRow>
              ))
            )}
            {state.agentDraftOpen.value ? (
              <form
                class="snm-agent-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = state.agentName.value.trim();
                  const command = state.agentCommand.value.trim();
                  if (!name || !command) return;
                  state.customAgents.value = [...state.customAgents.value, { name, command }];
                  state.agentName.value = "";
                  state.agentCommand.value = "";
                  state.agentDraftOpen.value = false;
                }}
              >
                <label>
                  Name
                  <input
                    required
                    value={state.agentName.value}
                    onInput={(event) => {
                      state.agentName.value = event.currentTarget.value;
                    }}
                  />
                </label>
                <label>
                  Command
                  <input
                    required
                    value={state.agentCommand.value}
                    onInput={(event) => {
                      state.agentCommand.value = event.currentTarget.value;
                    }}
                  />
                </label>
                <div>
                  <button type="submit">Add</button>
                  <button
                    type="button"
                    onClick={() => {
                      state.agentDraftOpen.value = false;
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                class="snm-inline-action"
                onClick={() => {
                  state.agentDraftOpen.value = true;
                }}
              >
                Add agent
              </button>
            )}
          </PreviewGroup>
        </>
      );
    case "shortcuts":
      return (
        <PreviewGroup title="Common actions">
          <PreviewRow label="Open Settings" detail="Change Deck preferences">
            <kbd>⌘ ,</kbd>
          </PreviewRow>
          <PreviewRow label="New Agent…" detail="Choose an agent to launch">
            <kbd>⌘ T</kbd>
          </PreviewRow>
        </PreviewGroup>
      );
    case "about":
      return (
        <PreviewGroup title="SpaceVibe Deck">
          <PreviewRow label="Updates" detail="Keep Deck current automatically">
            <span class="snm-status">
              <i /> Up to date
            </span>
          </PreviewRow>
        </PreviewGroup>
      );
    case "privacy":
      return (
        <PreviewGroup title="Usage stats">
          <p class="snm-disclosure">
            Deck sends first-party usage stats. They are always on in this build. Code, paths,
            prompts and terminal output are never included.
          </p>
        </PreviewGroup>
      );
    case "reset":
      return (
        <PreviewGroup title="Start fresh">
          <PreviewRow label="Reset preferences" detail="Return settings to their initial values">
            <button
              type="button"
              class="snm-reset"
              onClick={() => {
                if (!window.confirm("Reset the sample controls in this preview?")) return;
                state.theme.value = "dark";
                state.tabBar.value = "left";
                state.fontSize.value = 13;
                state.fontFamily.value = "SF Mono";
                state.showPaneBar.value = true;
                state.showStatusBar.value = true;
                state.notifyAgents.value = false;
                state.restoreSessions.value = true;
                state.scrollback.value = "10,000 lines";
                state.browserHome.value = "http://localhost:3000";
              }}
            >
              Reset…
            </button>
          </PreviewRow>
        </PreviewGroup>
      );
    case "appearance":
      return <AppearanceContent state={state} />;
  }
}

function SettingsPreview({ state }: { state: MockState }) {
  const active = SETTINGS_CATEGORIES.find((category) => category.id === state.category.value)!;
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (frameRef.current) {
      const id = state.theme.value === "dark" ? DECK_DARK_ID : DECK_LIGHT_ID;
      applyThemeVars(frameRef.current.style, getPreset(id).theme);
    }
  }, [state.theme.value]);
  return (
    <div ref={frameRef} class={`snm-frame snm-frame--${state.width.value}`}>
      <header class="snm-frame__bar">
        <span class="snm-frame__lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span class="snm-frame__back" aria-hidden="true">
          <DeckIcon icon={ArrowLeft} size={ROW_ICON} /> Back
        </span>
        <span class="snm-frame__bar-title">Settings</span>
      </header>
      <div class="snm-frame__layout">
        <nav class="snm-nav" aria-label="Settings categories">
          <div class="snm-nav__title">Settings</div>
          {NAV_GROUPS.map((group) => (
            <div class="snm-nav__group" key={group.label}>
              <div class="snm-nav__group-label">{group.label}</div>
              {group.ids.map((id) => {
                const category = SETTINGS_CATEGORIES.find((item) => item.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    class={`snm-nav__item ${id === state.category.value ? "is-active" : ""}`}
                    aria-current={id === state.category.value ? "page" : undefined}
                    title={category.label}
                    onClick={() => {
                      state.category.value = id;
                    }}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <main class="snm-content" key={active.id}>
          <div class="snm-content__inner">
            <div class="snm-content__heading">
              <h2>{active.label}</h2>
              <p>{active.description}</p>
            </div>
            <OtherContent state={state} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function SettingsNativeMockSection() {
  const state: MockState = {
    category: useSignal<CategoryId>("appearance"),
    width: useSignal<PreviewWidth>("wide"),
    theme: useSignal<ThemeChoice>("dark"),
    tabBar: useSignal<TabBarChoice>("left"),
    fontSize: useSignal(13),
    fontFamily: useSignal("SF Mono"),
    showPaneBar: useSignal(true),
    showStatusBar: useSignal(true),
    notifyAgents: useSignal(false),
    restoreSessions: useSignal(true),
    scrollback: useSignal("10,000 lines"),
    browserHome: useSignal("http://localhost:3000"),
    agentDraftOpen: useSignal(false),
    agentName: useSignal(""),
    agentCommand: useSignal(""),
    customAgents: useSignal<readonly { name: string; command: string }[]>([]),
  };

  return (
    <>
      <SectionHead
        title="Settings · native form proposal"
        blurb="Concept A · grouped navigation, clear control states, and compact macOS-style forms. Sample controls change only this preview."
      />
      <div class="snm-toolbar" role="group" aria-label="Preview width">
        <span>Preview width</span>
        <PreviewSegment
          label="Preview width"
          value={state.width.value}
          choices={[
            { value: "wide", label: "Wide · 960 px" },
            { value: "compact", label: "Compact · 480 px" },
          ]}
          onChange={(next) => {
            state.width.value = next;
          }}
        />
      </div>
      <div class="snm-stage">
        <SettingsPreview state={state} />
      </div>
    </>
  );
}
