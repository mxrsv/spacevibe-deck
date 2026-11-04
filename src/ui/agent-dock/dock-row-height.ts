/**
 * The one height of a list row in the dock: the Changes list's rows, a Changes card's sticky
 * header and the Explorer's tree rows. They sit side by side, so a row and a header at different
 * heights read as misaligned rows. `DockColumn` writes it to `--dock-row-h` for the classes, and
 * the tree's virtual list reads the number directly, because it computes each row's offset.
 */
export const DOCK_ROW_HEIGHT = 24;
