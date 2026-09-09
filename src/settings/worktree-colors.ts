/** Theme-aware identity colors; agent status colors remain independent (DL-27.25). */
export const WORKTREE_COLORS = [
  { id: "green", label: "Green", value: "var(--green)" },
  { id: "cyan", label: "Cyan", value: "var(--cyan)" },
  { id: "purple", label: "Purple", value: "var(--magenta)" },
  { id: "amber", label: "Amber", value: "var(--yellow)" },
  { id: "rose", label: "Rose", value: "var(--red)" },
  { id: "gray", label: "Gray", value: "var(--text-muted)" },
] as const;

export type WorktreeColor = (typeof WORKTREE_COLORS)[number]["id"];
export type WorktreeColors = Readonly<Record<string, WorktreeColor>>;

export function isWorktreeColor(value: unknown): value is WorktreeColor {
  return WORKTREE_COLORS.some((color) => color.id === value);
}

export function validateWorktreeColors(raw: unknown): WorktreeColors {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([path, color]) => path.trim() !== "" && isWorktreeColor(color)),
  );
}

export function worktreeColorStyle(colors: WorktreeColors, path: string): Record<string, string> {
  const color = WORKTREE_COLORS.find((entry) => entry.id === colors[path]);
  return color === undefined ? {} : { "--worktree-color": color.value };
}

/** Default removes only this checkout's override, retaining all other paths. */
export function withWorktreeColor(
  colors: WorktreeColors,
  path: string,
  color: WorktreeColor | null,
): WorktreeColors {
  if (path.trim() === "") return colors;
  if (color === null)
    return Object.fromEntries(Object.entries(colors).filter(([key]) => key !== path));
  return isWorktreeColor(color) ? { ...colors, [path]: color } : colors;
}
