/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface */
/**
 * Packaged Monaco smoke harness — the page a PACKAGED build uses to prove
 * Monaco, its worker and its assets still survive electron-builder.
 *
 * It mounts the real pieces, not doubles: the shipping `FileEditor` against a
 * one-file `createFileSurfaceController()` backed by the real file host, and
 * one real xterm pane through `createTerminalManager` + `defaultPtyClient`.
 * Named focus controls move focus to Monaco and to xterm so the packaged
 * verifier can type into both and assert which surface received each marker.
 *
 * This is a permanent regression artifact referenced by
 * `electron:package:monaco-smoke` / `electron:verify:monaco-smoke`, not a product route:
 * only `vite.monaco-smoke.config.mjs` builds this graph, only the
 * `DECK_MONACO_SMOKE=1` branch in `electron/main.ts` loads it, and
 * `scripts/monaco-smoke-entry.test.ts`
 * proves the application renderer never imports it.
 */
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "@xterm/xterm/css/xterm.css";
import "../styles.css";
import { initializeDesktopEnvironmentFromBackend } from "../lib/platform";
import { parentDirectory } from "../lib/path-name";
import { initSettings, settings } from "../settings/settings-store";
import { defaultPtyClient, type PtyClient } from "../terminal/pty-client";
import { createTerminalManager } from "../terminal/terminal-manager";
import type { UnlistenFn } from "../host/bridge";
import {
  createFileSurfaceController,
  editorSettings,
  type FileSurfaceController,
} from "./file-surface-controller";
import { FileEditor } from "./ui/file-editor";

interface MonacoSmokeState {
  readonly terminalInput: string;
  readonly terminalOutput: string;
}

type MonacoSmokeGlobal = typeof globalThis & {
  __deckMonacoSmoke?: MonacoSmokeState;
};

const EMPTY_SMOKE_STATE: MonacoSmokeState = {
  terminalInput: "",
  terminalOutput: "",
};

function smokeState(): MonacoSmokeState {
  return (globalThis as MonacoSmokeGlobal).__deckMonacoSmoke ?? EMPTY_SMOKE_STATE;
}

function updateSmokeState(patch: Partial<MonacoSmokeState>): void {
  const target = globalThis as MonacoSmokeGlobal;
  target.__deckMonacoSmoke = { ...smokeState(), ...patch };
}

const smokePtyClient: PtyClient = {
  ...defaultPtyClient,
  writePty(id, data) {
    updateSmokeState({ terminalInput: smokeState().terminalInput + data });
    return defaultPtyClient.writePty(id, data);
  },
};

/** The fixture the launcher passed; the harness edits exactly this file. */
function fixturePath(): string {
  const value = new URLSearchParams(window.location.search).get("file") ?? "";
  if (value === "") {
    throw new Error("Packaged Monaco smoke needs ?file= — launch through the verifier");
  }
  return value;
}

interface HarnessProps {
  readonly path: string;
  readonly workspace: string;
  readonly controller: FileSurfaceController;
  readonly focusEditor: () => void;
}

function Harness(props: HarnessProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<ReturnType<typeof createTerminalManager> | null>(null);

  useEffect(() => {
    const container = termRef.current;
    if (container === null) {
      return;
    }
    (globalThis as MonacoSmokeGlobal).__deckMonacoSmoke = EMPTY_SMOKE_STATE;
    const manager = createTerminalManager(container, { onLayoutChange() {} }, smokePtyClient);
    managerRef.current = manager;
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;
    void (async () => {
      // The real event routes, exactly as TabManager wires them — output and
      // exit reach the manager or the packaged proof proves nothing.
      unlistens.push(
        await defaultPtyClient.listenOutput((id, data) => {
          updateSmokeState({ terminalOutput: smokeState().terminalOutput + data });
          manager.handleOutput(id, data);
        }),
        await defaultPtyClient.listenExit((id) => manager.handleExit(id)),
      );
      if (cancelled) {
        return;
      }
      await manager.initFresh(props.workspace);
      manager.show({ focus: false });
      console.log("DECK_MONACO_SMOKE_TERMINAL_READY");
    })().catch((error: unknown) => {
      console.log(`DECK_MONACO_SMOKE_ERROR terminal: ${String(error)}`);
    });
    return () => {
      cancelled = true;
      for (const unlisten of unlistens) {
        unlisten();
      }
      manager.dispose();
      managerRef.current = null;
    };
  }, [props.workspace]);

  return (
    <div class="monaco-smoke">
      <div class="monaco-smoke__half">
        <div class="monaco-smoke__controls">
          <button
            type="button"
            id="monaco-smoke-focus-editor"
            class="filebar__btn"
            onClick={props.focusEditor}
          >
            Focus editor
          </button>
          <button
            type="button"
            id="monaco-smoke-save"
            class="filebar__btn filebar__btn--primary"
            onClick={() => void props.controller.savePath(props.path)}
          >
            Save
          </button>
        </div>
        <FileEditor path={props.path} controller={props.controller} />
      </div>
      <div class="monaco-smoke__half">
        <div class="monaco-smoke__controls">
          <button
            type="button"
            id="monaco-smoke-focus-terminal"
            class="filebar__btn"
            onClick={() => managerRef.current?.focusActive()}
          >
            Focus terminal
          </button>
        </div>
        <div class="monaco-smoke__term" ref={termRef} />
      </div>
    </div>
  );
}

async function main(): Promise<void> {
  const path = fixturePath();
  const workspace = parentDirectory(path);
  await initializeDesktopEnvironmentFromBackend();
  await initSettings();
  // The editor follows settings through the same signal `TabManager` fans
  // out to; the harness sets it once, standing in for `applySettings`.
  editorSettings.value = settings.value;

  const controller = createFileSurfaceController();
  // `FileEditor` registers its focus function with the controller; the
  // controller spends it on tab activation, which this one-file harness never
  // performs — so the harness keeps a copy for its named focus control.
  let focusEditor: (() => void) | null = null;
  const registerFocus = controller.setEditorFocus.bind(controller);
  controller.setEditorFocus = (focus) => {
    focusEditor = focus;
    registerFocus(focus);
  };
  await controller.init();
  await controller.openFile(workspace, path, true);

  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("#root element not found");
  }
  render(
    <Harness
      path={path}
      workspace={workspace}
      controller={controller}
      focusEditor={() => focusEditor?.()}
    />,
    root,
  );
  // The verifier waits for this exact line on stdout before it starts
  // driving the page; it is the "renderer-ready signal" the plan requires.
  console.log("DECK_MONACO_SMOKE_READY");
}

void main().catch((error: unknown) => {
  console.log(`DECK_MONACO_SMOKE_ERROR boot: ${String(error)}`);
});
