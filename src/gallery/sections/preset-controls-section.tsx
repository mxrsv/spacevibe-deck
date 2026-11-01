import { useEffect, useState } from "preact/hooks";
import { Button } from "../../ui/controls/preset-controls";
import { SectionHead } from "../specimen";
import { ButtonsAndBadges, FieldsAndToggles, Overlays } from "./preset-controls-groups";
import "./preset-controls-section.css";

/**
 * The Base UI controls of the migration (preset b1a09kDGF, shadcn@4.22.1 base-mira), every
 * variant, size and state, in the gallery document itself. The legacy chrome stylesheet is
 * loaded around them on purpose: this is the "inside Deck" check (UI-11), and the rest of
 * the gallery must look the same with the preset's stylesheet loaded as without it.
 * Dark mode is the `.dark` class on the root element, so portalled popups follow it.
 */
export function PresetControlsSection() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => root.classList.remove("dark");
  }, [dark]);

  return (
    <>
      <SectionHead
        title="shared controls"
        blurb="Base UI · shadcn Mira, Stone and Blue. Stock variants, no Deck tokens."
      />
      <div className="ui-preset flex flex-col gap-8 rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Preset b1a09kDGF</span>
          <Button variant="outline" size="sm" onClick={() => setDark(!dark)}>
            {dark ? "Dark" : "Light"}
          </Button>
        </div>
        <ButtonsAndBadges />
        <FieldsAndToggles />
        <Overlays />
      </div>
    </>
  );
}
