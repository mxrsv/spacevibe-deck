import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AiChat02Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  ChartHistogramIcon,
  CheckmarkCircle02Icon,
  CodeIcon,
  ComputerTerminal01Icon,
  DashboardSquare01Icon,
  FileEditIcon,
  Folder01Icon,
  GitBranchIcon,
  Moon02Icon,
  MoreHorizontalIcon,
  Search01Icon,
  Settings02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";

const ICONS = {
  add: Add01Icon,
  agent: AiChat02Icon,
  arrow: ArrowRight01Icon,
  external: ArrowUpRight01Icon,
  usage: ChartHistogramIcon,
  check: CheckmarkCircle02Icon,
  code: CodeIcon,
  terminal: ComputerTerminal01Icon,
  workbench: DashboardSquare01Icon,
  changes: FileEditIcon,
  folder: Folder01Icon,
  branch: GitBranchIcon,
  moon: Moon02Icon,
  more: MoreHorizontalIcon,
  search: Search01Icon,
  settings: Settings02Icon,
  sun: Sun03Icon,
} as const;

export function PreviewIcon({ name }: { name: keyof typeof ICONS }) {
  return <HugeiconsIcon icon={ICONS[name]} size={16} strokeWidth={1.8} aria-hidden="true" />;
}
