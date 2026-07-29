import { useSignal, type Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";
import { leafIds, type Path, type TreeNode } from "../lib/split-tree";
import { hasPrimaryModifier } from "../lib/platform";
import {
  canRemove,
  createMockModel,
  moveSelection,
  nudgeSelected,
  removeSelected,
  selectPane,
  setMockRatio,
  setSelectedCwd,
  splitSelected,
  toPresetArtifact,
  type MockModel,
  type PresetArtifact,
} from "./mock-model";

export interface PresetEditorProps {
  onCancel(): void;
  onCreate(name: string, artifact: PresetArtifact): void;
}

const NUDGE_STEP = 0.05;

interface MockNodeProps {
  node: TreeNode;
  path: Path;
  model: Signal<MockModel>;
}

function MockNode({ node, path, model }: MockNodeProps) {
  if (node.kind === "leaf") {
    const index = leafIds(model.value.tree).indexOf(node.paneId);
    const cwd = model.value.cwds.get(node.paneId);
    return (
      <div
        class={`mock-pane ${node.paneId === model.value.selectedId ? "is-selected" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          model.value = selectPane(model.value, node.paneId);
        }}
      >
        <span class="mock-pane__cwd">
          ● {cwd ?? "↑ inherit"}
        </span>
        <span class="mock-pane__label">pane {index + 1}</span>
      </div>
    );
  }
  const row = node.dir === "row";
  function startDrag(event: PointerEvent): void {
    event.preventDefault();
    const box = (
      event.currentTarget as HTMLElement
    ).parentElement?.getBoundingClientRect();
    if (!box) {
      return;
    }
    const { left, top, width, height } = box;
    function onMove(move: PointerEvent): void {
      const ratio = row
        ? (move.clientX - left) / width
        : (move.clientY - top) / height;
      model.value = setMockRatio(model.value, path, ratio);
    }
    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  return (
    <div class={`mock-split ${row ? "is-row" : "is-column"}`}>
      <div class="mock-branch" style={{ flex: node.ratio }}>
        <MockNode node={node.a} path={[...path, "a"]} model={model} />
      </div>
      <div
        class={`mock-divider ${row ? "is-row" : "is-column"}`}
        onPointerDown={startDrag}
      />
      <div class="mock-branch" style={{ flex: 1 - node.ratio }}>
        <MockNode node={node.b} path={[...path, "b"]} model={model} />
      </div>
    </div>
  );
}

export function PresetEditor({ onCancel, onCreate }: PresetEditorProps) {
  const model = useSignal<MockModel>(createMockModel());
  const name = useSignal("");
  const paneCount = leafIds(model.value.tree).length;
  const selectedCwd = model.value.cwds.get(model.value.selectedId);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  async function pickCwd(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        model.value = setSelectedCwd(model.value, picked);
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
    }
  }

  function confirmCreate(): void {
    const trimmed = name.value.trim();
    if (trimmed !== "") {
      onCreate(trimmed, toPresetArtifact(model.value));
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "Enter") {
        confirmCreate();
      }
      if (event.key === "Escape") {
        onCancel();
      }
      return;
    }
    switch (event.key) {
      case "ArrowRight":
        if (hasPrimaryModifier(event)) {
          model.value = splitSelected(model.value, "row");
        } else {
          model.value = moveSelection(model.value, 1);
        }
        break;
      case "ArrowDown":
        if (hasPrimaryModifier(event)) {
          model.value = splitSelected(model.value, "column");
        } else {
          model.value = moveSelection(model.value, 1);
        }
        break;
      case "ArrowLeft":
      case "ArrowUp":
        model.value = moveSelection(model.value, -1);
        break;
      case "Backspace":
        model.value = removeSelected(model.value);
        break;
      case "[":
        model.value = nudgeSelected(model.value, -NUDGE_STEP);
        break;
      case "]":
        model.value = nudgeSelected(model.value, NUDGE_STEP);
        break;
      case "Enter":
        confirmCreate();
        break;
      case "Escape":
        onCancel();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim">
      <div
        class="preset-editor"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={containerRef}
      >
        <header class="preset-editor__toolbar">
          <h1>▦ New layout preset</h1>
          <div class="preset-editor__tools">
            <button
              onClick={() => {
                model.value = splitSelected(model.value, "row");
              }}
            >
              Split right
            </button>
            <button
              onClick={() => {
                model.value = splitSelected(model.value, "column");
              }}
            >
              Split down
            </button>
            <button
              disabled={!canRemove(model.value)}
              onClick={() => {
                model.value = removeSelected(model.value);
              }}
            >
              Remove
            </button>
            <button onClick={() => void pickCwd()}>Set CWD</button>
            {selectedCwd !== undefined ? (
              <button
                onClick={() => {
                  model.value = setSelectedCwd(model.value, null);
                }}
              >
                Clear CWD
              </button>
            ) : null}
          </div>
        </header>
        <div class="preset-editor__stage">
          <MockNode node={model.value.tree} path={[]} model={model} />
        </div>
        <footer class="preset-editor__footer">
          <input
            class="preset-editor__name"
            placeholder="Preset name"
            value={name.value}
            onInput={(event) => {
              name.value = (event.target as HTMLInputElement).value;
            }}
          />
          <span class="preset-editor__meta">
            {paneCount} {paneCount === 1 ? "pane" : "panes"} · drag dividers
          </span>
          <div class="preset-editor__actions">
            <button onClick={onCancel}>Cancel</button>
            <button
              class="is-primary"
              disabled={name.value.trim() === ""}
              onClick={confirmCreate}
            >
              Create tab
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
