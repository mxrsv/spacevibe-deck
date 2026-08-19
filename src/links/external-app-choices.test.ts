import { describe, expect, it } from "vitest";
import { externalAppChoices, groupExternalApps } from "./external-app-choices";
import { EXTERNAL_APPS } from "../lib/external-app-catalog";
import type { InstalledExternalApp } from "../host/external-apps-host";

const INSTALLED: readonly InstalledExternalApp[] = [
  {
    id: "vscode",
    label: "VS Code",
    group: "editor",
    iconDataUrl: "data:image/png;base64,AA",
  },
  { id: "finder", label: "Finder", group: "files", iconDataUrl: null },
];

describe("externalAppChoices", () => {
  it("prints what the host reported, icons and all", () => {
    const choices = externalAppChoices(INSTALLED, true);
    expect(choices.map((choice) => choice.id)).toEqual(["vscode", "finder"]);
    expect(choices[0].iconDataUrl).toMatch(/^data:/);
  });

  it("falls back to the catalog when no host answered", () => {
    // This fallback belongs to the SETTINGS picker, which has to stay usable
    // on Tauri — a screen offering nothing would leave a migrated `custom`
    // editor with no way back to a working selection (design §5). The toolbar
    // button deliberately does NOT use it: it passes an empty list on such a
    // host and therefore renders nothing at all (design §4.1).
    const choices = externalAppChoices([], true);
    expect(choices).toHaveLength(EXTERNAL_APPS.length);
    expect(choices.every((choice) => choice.iconDataUrl === null)).toBe(true);
  });

  it("shows the catalog before the first scan has answered", () => {
    expect(externalAppChoices([], false)).toHaveLength(EXTERNAL_APPS.length);
  });
});

describe("groupExternalApps", () => {
  it("keeps catalog group order and drops empty groups", () => {
    expect(
      groupExternalApps(externalAppChoices(INSTALLED, true)).map(
        (view) => view.group,
      ),
    ).toEqual(["editor", "files"]);
  });

  it("loses no app on the way into groups", () => {
    const choices = externalAppChoices([], true);
    const grouped = groupExternalApps(choices).flatMap((view) => view.items);
    expect(grouped.map((choice) => choice.id).sort()).toEqual(
      choices.map((choice) => choice.id).sort(),
    );
  });
});
