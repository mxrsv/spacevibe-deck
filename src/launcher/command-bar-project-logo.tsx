import { WorkspaceIcon } from "../ui/workspace-icon";

/** The 16px box of a project's logo, the size the project rail draws it at. */
const LOGO_PX = 16;

/**
 * A project's mark in the command bar: the same logo or favicon the project rail shows, and the
 * folder glyph when the folder has none, never two letters of its name.
 */
export function CommandBarProjectLogo(props: { readonly path: string }) {
  return (
    <WorkspaceIcon
      key={props.path}
      path={props.path}
      marks
      size={LOGO_PX}
      className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) text-(--text-muted) [&>img]:size-full [&>img]:object-cover!"
    />
  );
}
