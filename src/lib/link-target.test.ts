import { describe, expect, it } from "vitest";
import {
  decideLinkTarget,
  externalAppLabel,
  resolveExternalApp,
} from "./link-target";
import {
  editorIdOf,
  EXTERNAL_APPS,
  type ExternalApp,
  type ExternalAppId,
} from "./external-app-catalog";

// Widened from the `as const` tuple: these assertions compare rule values
// across apps, and the literal types would make each comparison provably
// false one app at a time.
const APPS: readonly ExternalApp[] = EXTERNAL_APPS;

const FILE = "/repo/src/foo.ts";

describe("decideLinkTarget", () => {
  it("opens in Deck when a workspace answered", () => {
    expect(
      decideLinkTarget({
        path: FILE,
        line: 12,
        column: 5,
        workspaceRoot: "/repo",
        appId: "vscode",
      }),
    ).toEqual({
      kind: "deck",
      workspacePath: "/repo",
      path: FILE,
      line: 12,
      column: 5,
    });
  });

  it("prefers Deck even when an app is selected — there is no kill switch", () => {
    // Design §5: a path inside an open workspace ALWAYS opens in Deck in v1.
    const target = decideLinkTarget({
      path: FILE,
      line: null,
      column: null,
      workspaceRoot: "/repo",
      appId: "finder",
    });
    expect(target.kind).toBe("deck");
  });

  it("sends an out-of-workspace file to the selected editor's CLI", () => {
    expect(
      decideLinkTarget({
        path: "/elsewhere/x.ts",
        line: 3,
        column: 9,
        workspaceRoot: null,
        appId: "zed",
      }),
    ).toEqual({
      kind: "editor",
      editor: "zed",
      path: "/elsewhere/x.ts",
      line: 3,
      column: 9,
    });
  });

  it("sends an out-of-workspace file to a non-editor app", () => {
    expect(
      decideLinkTarget({
        path: "/elsewhere/x.ts",
        line: null,
        column: null,
        workspaceRoot: null,
        appId: "github-desktop",
      }),
    ).toEqual({
      kind: "app",
      appId: "github-desktop",
      path: "/elsewhere/x.ts",
      line: 1,
      column: 1,
    });
  });

  it("says so when nothing can open the file", () => {
    const target = decideLinkTarget({
      path: "/elsewhere/x.ts",
      line: null,
      column: null,
      workspaceRoot: null,
      appId: null,
    });
    expect(target).toMatchObject({ kind: "unavailable" });
  });

  it("treats a missing or nonsense position as the top of the file", () => {
    const target = decideLinkTarget({
      path: FILE,
      line: 0,
      column: -4,
      workspaceRoot: "/repo",
      appId: null,
    });
    expect(target).toMatchObject({ line: 1, column: 1 });
  });
});

describe("resolveExternalApp", () => {
  it("keeps a selection that is installed", () => {
    expect(resolveExternalApp("zed", ["vscode", "zed"])).toBe("zed");
  });

  it("falls back to the first installed app in catalog order", () => {
    // This is where a migrated `custom` editor command lands (design §5), and
    // where an app uninstalled while Deck runs lands too.
    expect(resolveExternalApp("gitkraken", ["vscode", "finder"])).toBe(
      "vscode",
    );
    expect(resolveExternalApp(null, ["finder"])).toBe("finder");
  });

  it("answers null when nothing is installed", () => {
    expect(resolveExternalApp("vscode", [])).toBeNull();
  });

  // Design §5 — the Tauri rule. A host that cannot ANSWER is not a machine
  // with nothing on it: reading its silence as "no app can open this" would
  // turn a ⌘+click that opened VS Code yesterday into an error bar on the
  // host users are still running.
  it("takes the selection at its word when the host cannot answer", () => {
    expect(resolveExternalApp("zed", [], false)).toBe("zed");
    expect(resolveExternalApp("cursor", [], false)).toBe("cursor");
  });

  it("falls a non-editor selection back to VS Code's template there", () => {
    // `open -a` does not exist on that host; the validated `open_editor`
    // template is the only thing it can launch.
    expect(resolveExternalApp("finder", [], false)).toBe("vscode");
    expect(resolveExternalApp("github-desktop", [], false)).toBe("vscode");
    expect(resolveExternalApp(null, [], false)).toBe("vscode");
  });

  it("never leaves that host with nothing, so ⌘+click still opens", () => {
    for (const app of APPS) {
      const resolved = resolveExternalApp(app.id as ExternalAppId, [], false);
      expect(resolved, app.id).not.toBeNull();
      expect(editorIdOf(resolved as ExternalAppId), app.id).not.toBeNull();
    }
  });
});

describe("the catalog", () => {
  it("declares an open rule for a file and for a folder on every app", () => {
    // Design §7: no app may be unreachable, and none may be half-declared —
    // the ⌘+click fallback and the toolbar button read these two fields and
    // must never disagree about what an app does.
    for (const app of APPS) {
      expect(app.opensFile, app.id).toBeTruthy();
      expect(app.opensFolder, app.id).toBeTruthy();
      expect(externalAppLabel(app.id as ExternalAppId)).toBe(app.label);
    }
  });

  it("has unique ids", () => {
    const ids = APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only the git group resolves a target to a repository", () => {
    for (const app of APPS) {
      const usesRepo =
        app.opensFile === "repository" || app.opensFolder === "repository";
      expect(usesRepo, app.id).toBe(app.group === "git");
    }
  });
});
