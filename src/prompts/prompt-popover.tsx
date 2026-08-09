import { Fragment } from "preact";
import {
  ChevronDown,
  ClipboardPaste,
  Plus,
  Send,
  Trash2,
} from "lucide-preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { settings, updateSettings } from "../settings/settings-store";
import { tabViews } from "../terminal/tabs-store";
import { reportChromeMessage } from "../chrome/events";
import { ConfigRow } from "../ui/controls/config-row";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { CommitInput } from "../ui/controls/commit-input";
import { CommitTextarea } from "../ui/controls/commit-textarea";
import {
  createPromptTemplateId,
  TEMPLATE_BODY_MAX,
  TEMPLATE_LABEL_MAX,
  type PromptTemplate,
} from "./prompt-templates";
import {
  composePromptText,
  isPromptAgentId,
  type PromptAssetKind,
  type PromptAssetPick,
} from "./snippet-format";
import {
  EMPTY_PROMPT_ASSETS,
  type PromptAsset,
  type PromptAssets,
} from "./prompt-assets-client";
import type { InjectOutcome, PromptTarget } from "./inject";

interface PromptPopoverProps {
  /** Snapshots the focused pane; null closes the popover with a message. */
  capture(): Promise<PromptTarget | null>;
  /** Fetches detected assets; rejection degrades the pickers, not the list. */
  loadAssets(target: PromptTarget): Promise<PromptAssets>;
  /** Paste (+ maybe submit) into the captured pane. */
  inject(
    target: PromptTarget,
    text: string,
    autoSend: boolean,
  ): Promise<InjectOutcome>;
  /** Whether the captured pane is still in some tab's layout. */
  isAlive(paneId: number): boolean;
  onClose(): void;
}


function labelProblem(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  return trimmed.length > TEMPLATE_LABEL_MAX
    ? `names stay under ${TEMPLATE_LABEL_MAX} characters`
    : null;
}

function bodyProblem(body: string): string | null {
  if (body.trim() === "") {
    return "a body is required";
  }
  return body.length > TEMPLATE_BODY_MAX
    ? `bodies stay under ${TEMPLATE_BODY_MAX} characters`
    : null;
}

/** One `<select>` of detected assets — the DL-6 `menu` value kind (DL-1.4). */
function AssetPicker({
  label,
  assets,
  chosen,
  onPick,
}: {
  label: string;
  assets: readonly PromptAsset[];
  chosen: string;
  onPick: (name: string) => void;
}) {
  return (
    <ConfigRow label={label}>
      <span class="cfg-btn cfg-btn--overlay">
        <span class="cfg-btn__text">{chosen === "" ? "none" : chosen}</span>
        <span class="cfg-btn__hint">
          <DeckIcon icon={ChevronDown} size={ROW_ICON} />
        </span>
        <select
          value={chosen}
          aria-label={label}
          onChange={(event) => onPick(event.currentTarget.value)}
        >
          <option value="">none</option>
          {assets.map((asset) => (
            <option
              key={asset.name}
              value={asset.name}
              title={asset.description}
            >
              {asset.name}
            </option>
          ))}
        </select>
      </span>
    </ConfigRow>
  );
}

/**
 * The Prompt Board: templates the user declared, and one click that pastes one
 * into the pane captured when this opened (DL §12 rows inside a DL §13
 * popover).
 *
 * Everything that touches a pane arrives as a prop, so this component is a
 * pure surface over the settings signal and can be driven by fakes in tests.
 */
export function PromptPopover(props: PromptPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const target = useSignal<PromptTarget | null>(null);
  const assets = useSignal<PromptAssets>(EMPTY_PROMPT_ASSETS);
  const assetsFailed = useSignal(false);
  const expanded = useSignal<string | null>(null);
  const rowError = useSignal<{ id: string; message: string } | null>(null);
  const skill = useSignal("");
  const subagent = useSignal("");
  const draftOpen = useSignal(false);
  const draftLabel = useSignal("");
  const draftBody = useSignal("");
  const draftError = useSignal<string | null>(null);
  const injecting = useSignal(false);
  const mounted = useRef(true);

  const templates = settings.value.promptTemplates;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Capture first, then scan with what was captured (spec §7). Both are
  // one-shot: transient state never survives an open (DL-13.6).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const captured = await props.capture();
      if (cancelled) {
        return;
      }
      if (captured === null) {
        reportChromeMessage("No pane to paste into.");
        props.onClose();
        return;
      }
      target.value = captured;
      if (!isPromptAgentId(captured.agent)) {
        return; // bare shell or an unverified CLI — pickers stay hidden
      }
      try {
        const found = await props.loadAssets(captured);
        if (!cancelled) {
          assets.value = found;
        }
      } catch {
        if (!cancelled) {
          assetsFailed.value = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dismiss on any pointerdown outside the anchor (which contains both the
  // trigger and this surface, so the trigger's own toggle still works).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const node = event.target as Element | null;
      if (node?.closest(".prompts-anchor") === null) {
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    rootRef.current?.focus();
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  // The captured pane can exit or have its tab closed while this is open;
  // `tabViews` is what `syncViews` bumps on every layout change, poll and
  // exit, so reading it here is the subscription (spec §7, §12).
  useSignalEffect(() => {
    tabViews.value;
    const captured = target.value;
    if (captured !== null && !props.isAlive(captured.paneId)) {
      props.onClose();
    }
  });

  const replace = (next: readonly PromptTemplate[]): void => {
    updateSettings({ promptTemplates: next });
  };

  const patch = (id: string, change: Partial<PromptTemplate>): void => {
    replace(
      templates.map((entry) =>
        entry.id === id ? { ...entry, ...change } : entry,
      ),
    );
  };

  const renameTemplate = (id: string, label: string): void => {
    const problem = labelProblem(label);
    if (problem !== null) {
      rowError.value = { id, message: problem };
      return;
    }
    rowError.value = null;
    patch(id, { label: label.trim() });
  };

  const retypeBody = (id: string, body: string): void => {
    const problem = bodyProblem(body);
    if (problem !== null) {
      rowError.value = { id, message: problem };
      return;
    }
    rowError.value = null;
    patch(id, { body });
  };

  const removeTemplate = (id: string): void => {
    replace(templates.filter((entry) => entry.id !== id));
    if (expanded.value === id) {
      expanded.value = null;
    }
  };

  const commitDraft = (): void => {
    const problem =
      labelProblem(draftLabel.value) ?? bodyProblem(draftBody.value);
    if (problem !== null) {
      draftError.value = problem;
      return;
    }
    replace([
      ...templates,
      {
        id: createPromptTemplateId(draftLabel.value, templates),
        label: draftLabel.value.trim(),
        body: draftBody.value,
        autoSend: false,
      },
    ]);
    draftOpen.value = false;
    draftLabel.value = "";
    draftBody.value = "";
    draftError.value = null;
  };

  const picks = (): readonly PromptAssetPick[] => {
    const chosen: PromptAssetPick[] = [];
    if (skill.value !== "") {
      chosen.push({ kind: "skill" as PromptAssetKind, name: skill.value });
    }
    if (subagent.value !== "") {
      chosen.push({
        kind: "subagent" as PromptAssetKind,
        name: subagent.value,
      });
    }
    return chosen;
  };

  const injectTemplate = async (template: PromptTemplate): Promise<void> => {
    if (injecting.value) {
      return;
    }
    const captured = target.value;
    if (captured === null) {
      return;
    }
    injecting.value = true;
    try {
      const text = composePromptText(template.body, captured.agent, picks());
      const outcome = await props.inject(captured, text, template.autoSend);
      if (!mounted.current) {
        return;
      }
      if (outcome === "failed") {
        reportChromeMessage("Couldn't paste into the terminal.");
        return;
      }
      if (outcome === "busy") {
        reportChromeMessage("A prompt is already being pasted into this pane.");
        return;
      }
      if (outcome === "no-target") {
        reportChromeMessage("The pane is gone — nothing was pasted.");
      } else if (template.autoSend && outcome === "pasted") {
        reportChromeMessage("Pasted — not sent");
      }
      props.onClose();
    } catch {
      if (mounted.current) {
        reportChromeMessage("Couldn't paste into the terminal.");
      }
    } finally {
      if (mounted.current) {
        injecting.value = false;
      }
    }
  };

  const showPickers =
    target.value !== null && isPromptAgentId(target.value.agent);

  return (
    <div
      ref={rootRef}
      class="prompt-popover"
      role="dialog"
      aria-label="Prompts"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      {templates.length === 0 && !draftOpen.value ? (
        <div class="cfg-custom prompt-popover__empty">no templates yet</div>
      ) : null}

      {templates.map((template) => (
        <Fragment key={template.id}>
          <div class="cfg-row cfg-row--item">
            <div class="cfg-row__key">
              <button
                type="button"
                class="cfg-row__label cfg-row__label--edit"
                aria-expanded={expanded.value === template.id}
                title="Edit"
                onClick={() => {
                  expanded.value =
                    expanded.value === template.id ? null : template.id;
                  rowError.value = null;
                }}
              >
                {template.label}
              </button>
            </div>
            <div class="cfg-row__value">
              {template.autoSend ? (
                <span class="prompt-row__auto" aria-hidden="true">
                  auto
                </span>
              ) : null}
              <button
                type="button"
                class="cfg-btn"
                aria-label={`${template.autoSend ? "Send" : "Paste"} ${template.label}`}
                title={
                  template.autoSend
                    ? "Send to the focused pane"
                    : "Paste into the focused pane"
                }
                disabled={injecting.value}
                onClick={() => void injectTemplate(template)}
              >
                <DeckIcon
                  icon={template.autoSend ? Send : ClipboardPaste}
                  size={ROW_ICON}
                />
              </button>
            </div>
          </div>
          {expanded.value === template.id ? (
            <div class="cfg-custom prompt-editor">
              <CommitInput
                value={template.label}
                placeholder="name"
                ariaLabel={`Name for ${template.label}`}
                autoFocus
                onCommit={(label) => renameTemplate(template.id, label)}
              />
              <CommitTextarea
                value={template.body}
                placeholder="the prompt to paste"
                ariaLabel={`Body for ${template.label}`}
                onCommit={(body) => retypeBody(template.id, body)}
              />
              <div class="prompt-editor__foot">
                <button
                  type="button"
                  role="switch"
                  aria-checked={template.autoSend}
                  aria-label={`Auto send ${template.label}`}
                  class={`cfg-btn ${template.autoSend ? "cfg-btn--on" : "cfg-btn--off"}`}
                  title="Press Enter after pasting, when it is provably safe"
                  onClick={() =>
                    patch(template.id, { autoSend: !template.autoSend })
                  }
                >
                  {template.autoSend ? "auto send on" : "auto send off"}
                </button>
                <button
                  type="button"
                  class="cfg-row__remove"
                  aria-label={`Remove ${template.label}`}
                  title={`Remove ${template.label}`}
                  onClick={() => removeTemplate(template.id)}
                >
                  <DeckIcon icon={Trash2} size={ROW_ICON} />
                </button>
              </div>
            </div>
          ) : null}
          {rowError.value?.id === template.id ? (
            <div class="cfg-custom--error" role="status">
              {rowError.value.message}
            </div>
          ) : null}
        </Fragment>
      ))}

      {draftOpen.value ? (
        <>
          <div class="cfg-custom prompt-editor">
            <input
              type="text"
              class="text-input text-input--small"
              placeholder="name"
              aria-label="New template name"
              value={draftLabel.value}
              onInput={(event) => {
                draftLabel.value = event.currentTarget.value;
                draftError.value = null;
              }}
            />
            <textarea
              class="text-input prompt-textarea"
              rows={3}
              placeholder="the prompt to paste"
              aria-label="New template body"
              value={draftBody.value}
              onInput={(event) => {
                draftBody.value = event.currentTarget.value;
                draftError.value = null;
              }}
            />
          </div>
          {draftError.value !== null ? (
            <div class="cfg-custom--error" role="status">
              {draftError.value}
            </div>
          ) : null}
        </>
      ) : null}

      <ConfigRow label="New template" desc="a name and the prompt body">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            if (draftOpen.value) {
              commitDraft();
              return;
            }
            draftOpen.value = true;
          }}
        >
          {draftOpen.value ? "add" : <DeckIcon icon={Plus} size={ROW_ICON} />}
        </button>
      </ConfigRow>

      {showPickers ? (
        <div class="prompt-picker">
          {assetsFailed.value ? (
            <div class="cfg-custom prompt-picker__unavailable">
              skills unavailable
            </div>
          ) : (
            <>
              <AssetPicker
                label="skill"
                assets={assets.value.skills}
                chosen={skill.value}
                onPick={(name) => {
                  skill.value = name;
                }}
              />
              <AssetPicker
                label="subagent"
                assets={assets.value.subagents}
                chosen={subagent.value}
                onPick={(name) => {
                  subagent.value = name;
                }}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
