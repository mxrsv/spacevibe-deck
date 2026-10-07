import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { DECK_DARK_ID, DECK_LIGHT_ID, resolveTheme } from "../../settings/themes";
import type { RepositoryScan } from "../../repositories/repository-client";
import { AttentionChip } from "../../ui/attention/attention-chip";
import { AttentionPanel } from "../../ui/attention/attention-panel";
import type { AttentionList } from "../../ui/attention-list-model";
import { MINUTE, NOW, list, pane, repo, tab } from "../../ui/attention-list-fixtures";
import { SectionHead, Specimen, StateLabel } from "../specimen";
import { StripAtWidth } from "./attention-strip-specimen";
import "./attention-section.css";

/**
 * The strip's needs-you chip and its popover (DL-27.26, amended 2026-10-06).
 *
 * Every list below is built by the real `buildAgentRail` and
 * `buildAttentionList` from fixture tabs, so a specimen cannot show an entry
 * the model would not produce. Five states, each in light and dark: empty (the
 * chip is absent), one, many, inferred, and failed (the dot goes red).
 *
 * The popover is drawn in flow (`floating` off) inside a theme scope, because
 * the real one is `position: fixed` and portalled to `<body>`, where two of
 * them would sit on top of each other. The last specimen is the real thing,
 * opened by its own chip.
 */

const NOOP = (): void => {};

const WORK = "/work";
const SCANS = new Map<string, RepositoryScan>(
  [
    repo("/work/deck/.git", [
      { path: `${WORK}/deck`, branch: "main" },
      { path: `${WORK}/deck-hero`, branch: "hero-rewrite" },
    ]),
    repo("/work/board/.git", [{ path: `${WORK}/board`, branch: "main" }]),
  ].flatMap((scan) =>
    scan.kind === "repository" ? scan.worktrees.map((entry) => [entry.path, scan] as const) : [],
  ),
);
const HISTORY = [...SCANS.keys(), `${WORK}/scratch`];

function listOf(...tabs: Parameters<typeof list>[0]): AttentionList {
  return list(tabs, { scans: SCANS, workspaceHistoryPaths: HISTORY });
}

const QUIET = tab(1, `${WORK}/deck`, {
  panes: [pane(1, { phase: "working" }), pane(2, { agent: "codex" })],
});

interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly list: AttentionList;
}

const SCENARIOS: readonly Scenario[] = [
  { id: "empty", label: "empty — nothing needs you, so no chip", list: listOf(QUIET) },
  {
    id: "one",
    label: "one — an explicit ask, with what it waits on",
    list: listOf(
      tab(1, `${WORK}/deck`, {
        panes: [
          pane(1, {
            attention: "requested",
            detail: "permission prompt",
            changedAt: NOW - 3 * MINUTE,
          }),
          pane(2, { agent: "codex", phase: "working" }),
          pane(3, { agent: "gemini" }),
        ],
      }),
    ),
  },
  {
    id: "many",
    label: "many — failed first, then asks, then inferred asks; a long name truncates",
    list: listOf(
      tab(1, `${WORK}/deck`, {
        panes: [
          pane(1, { attention: "requested", changedAt: NOW - 42 * MINUTE }),
          pane(2, { agent: "codex", attention: "warning", changedAt: NOW - 7 * MINUTE }),
          pane(3, { agent: "gemini", phase: "working" }),
        ],
      }),
      tab(2, `${WORK}/deck-hero`, {
        name: "landing page hero rewrite for launch week",
        panes: [
          pane(4, { attention: "error", changedAt: NOW - 90 * MINUTE }),
          pane(5, { agent: "opencode", attention: "completed", confidence: "inferred" }),
        ],
      }),
      tab(3, `${WORK}/board`, {
        panes: [
          pane(6, { attention: "completed", confidence: "inferred", changedAt: NOW - 2 * MINUTE }),
        ],
      }),
      tab(4, `${WORK}/scratch`, {
        panes: [pane(7, { agent: "codex", attention: "requested", changedAt: 0 })],
      }),
    ),
  },
  {
    id: "inferred",
    label: "inferred — Deck read it off output timing, and says so",
    list: listOf(
      tab(1, `${WORK}/deck`, {
        panes: [
          pane(1, { attention: "completed", confidence: "inferred", changedAt: NOW - 11 * MINUTE }),
          pane(2, { agent: "codex", attention: "completed", confidence: "inferred" }),
        ],
      }),
    ),
  },
  {
    id: "failed",
    label: "failed — the dot is red once anything failed",
    list: listOf(
      tab(1, `${WORK}/deck`, {
        panes: [
          pane(1, { attention: "error", changedAt: NOW - 5 * MINUTE }),
          pane(2, { agent: "codex", attention: "requested", changedAt: NOW - 20 * MINUTE }),
        ],
      }),
    ),
  },
];

/**
 * A theme scope: `applyThemeVars` takes a `CSSStyleDeclaration`, so pointing it
 * at one element publishes a whole theme to that subtree only, which is how a
 * light column and a dark one share a page (the state matrix's own technique).
 */
function ThemeScope({ themeId, children }: { themeId: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) {
      applyThemeVars(
        ref.current.style,
        resolveTheme({ ...settings.peek(), themeId, colorOverrides: {} }),
      );
    }
  }, [themeId]);
  return (
    <div ref={ref} class="gx-attn-scope">
      <span class="gx-attn-scope__name">{themeId}</span>
      {children}
    </div>
  );
}

function Case({ scenario }: { scenario: Scenario }) {
  return (
    <div class="gx-attn-case">
      <StateLabel>{scenario.label}</StateLabel>
      <div class="gx-attn-strip">
        <AttentionChip list={scenario.list} onFocusPane={NOOP} />
      </div>
      {scenario.list.entries.length > 0 ? (
        <AttentionPanel list={scenario.list} onChoose={NOOP} />
      ) : (
        <p class="gx-attn-none">No chip, so nothing to open.</p>
      )}
    </div>
  );
}

export function AttentionSection() {
  const many = SCENARIOS.find((scenario) => scenario.id === "many")?.list ?? SCENARIOS[0].list;
  return (
    <>
      <SectionHead
        title="needs-you chip"
        blurb="A count chip at the strip's trailing end opens a short list of the panes that need you: failed, asked and finished-unchecked, each with its reason, place and age. Choosing one focuses that pane and nothing else; the list answers nothing on the agent's behalf."
      />
      <Specimen
        name="AttentionChip"
        note="The real chip, in the gallery's own theme (use the picker above): press it to open the real popover, then arrows, Enter, Esc, or a press outside. Choosing logs nothing — the gallery has no panes."
        surface="chrome-1"
      >
        <div class="gx-attn-strip">
          <AttentionChip list={many} onFocusPane={NOOP} />
        </div>
      </Specimen>
      <Specimen
        name="in the strip"
        note="The shipping strip with the chip mounted before the toolbar's controls, seeded with the gallery's own tabs. 205px is a 480px window beside the default 275px sidebar (Tauri's minWidth; Electron sets none); 480px is the same window with the sidebar hidden. The marks row scrolls inside itself, so the chip costs it width and never pushes a mark out of the frame."
        surface="bg"
      >
        <div class="gx-attn-strips">
          {[205, 320, 480, 760].map((width) => (
            <StripAtWidth key={width} width={width} withChip />
          ))}
        </div>
      </Specimen>
      <div class="gx-attn-themes">
        {[DECK_LIGHT_ID, DECK_DARK_ID].map((themeId) => (
          <ThemeScope key={themeId} themeId={themeId}>
            {SCENARIOS.map((scenario) => (
              <Case key={scenario.id} scenario={scenario} />
            ))}
          </ThemeScope>
        ))}
      </div>
    </>
  );
}
