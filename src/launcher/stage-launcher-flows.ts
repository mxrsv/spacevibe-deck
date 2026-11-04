import { rememberOnRail } from "../ui/rail-add-folder";
import { closeStageForm, stageForm } from "./stage-launcher-form-store";

/**
 * Folders dropped on the window (spec LCH-7): each joins the rail, the first-listed ends as the
 * newest, and the launcher is aimed at it. A form that was up gives way, because the drop is the
 * newest instruction.
 */
export function dropIntoStageLauncher(
  path: string,
  paths: readonly string[],
  showLauncherAt: (path: string) => void,
): void {
  for (const root of [...paths].reverse()) rememberOnRail(root);
  closeStageForm();
  showLauncherAt(path);
}

/**
 * A clone finished (LCH-8). With its form up and nothing to read, the form closes and the launcher
 * is aimed at the new workspace; a warning keeps the form up to be read, and a clone that ends
 * while the form is shut only aims the bar.
 */
export function cloneFinished(
  path: string,
  warned: boolean,
  actions: { aim(path: string): void; leaveForm(path: string): void },
): void {
  if (stageForm.value?.kind === "clone" && !warned) actions.leaveForm(path);
  else actions.aim(path);
}
