import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  AGENTS,
  CHECKOUTS,
  PROJECTS,
  placeOf,
  wantsUser,
  type AgentKind,
  type Confidence,
  type MockAgent,
  type MockProject,
  type MockState,
} from "../../layout-fixture";

/** One agent session as the rail keeps it; copies, never the fixture objects. */
export interface Thread {
  readonly id: string;
  readonly kind: AgentKind;
  readonly state: MockState;
  readonly confidence: Confidence;
  readonly title: string;
  readonly ask: string | null;
  readonly projectId: string;
  readonly branch: string | null;
  readonly path: string;
  readonly since: string;
  /** Minutes in the current state: the newest-first sort key. */
  readonly mins: number;
  readonly pinned: boolean;
  readonly archived: boolean;
}

export interface RailProject extends MockProject {
  readonly collapsed: boolean;
  readonly hidden: boolean;
}

const NOTE_MS = 2000;

/** Loudest first; only these four speak on a collapsed project. */
const ROLL_RANK: Readonly<Partial<Record<MockState, number>>> = {
  failed: 4,
  "needs-you": 3,
  working: 2,
  unchecked: 1,
};

function minutesOf(since: string): number {
  const value = Number.parseFloat(since);
  if (Number.isNaN(value)) return 0;
  return since.endsWith("s") ? value / 60 : since.endsWith("h") ? value * 60 : value;
}

function seedThread(agent: MockAgent): Thread {
  const { checkout, project } = placeOf(agent);
  return {
    id: agent.id,
    kind: agent.kind,
    state: agent.state,
    confidence: agent.confidence,
    title: agent.sentence ?? "New session",
    ask: agent.ask,
    projectId: project.id,
    branch: checkout.branch,
    path: checkout.path,
    since: agent.since,
    mins: minutesOf(agent.since),
    pinned: false,
    archived: false,
  };
}

export type Grouping = "project" | "status" | "time";
export type Sorting = "recent" | "priority";

/** Pinned first, then newest first or loudest first. */
export function ordered(threads: readonly Thread[], sorting: Sorting = "recent"): Thread[] {
  return threads
    .filter((thread) => !thread.archived)
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sorting === "priority" ? (ROLL_RANK[b.state] ?? 0) - (ROLL_RANK[a.state] ?? 0) : 0) ||
        a.mins - b.mins,
    );
}

/** Subsequence match: "tkrf" finds "token refresh". */
export function fuzzy(needle: string, hay: string): boolean {
  const text = hay.toLowerCase();
  let at = 0;
  for (const char of needle.toLowerCase().replaceAll(/\s+/g, "")) {
    at = text.indexOf(char, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** The state a collapsed project speaks with, or null when all is quiet. */
export function rollup(threads: readonly Thread[]): Thread | null {
  let top: Thread | null = null;
  for (const thread of threads) {
    const rank = ROLL_RANK[thread.state] ?? 0;
    if (rank > (top ? (ROLL_RANK[top.state] ?? 0) : 0)) top = thread;
  }
  return top;
}

export function initials(name: string): string {
  const parts = name.replace(/^spacevibe-/, "").split(/[-_\s]+/);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function folderName(path: string): string {
  return path.split("/").pop() ?? path;
}

function freshThread(kind: AgentKind, project: RailProject, branch: string | null, path: string) {
  return {
    id: `new-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    state: "idle",
    confidence: "explicit",
    title: "New session",
    ask: null,
    projectId: project.id,
    branch,
    path,
    since: "now",
    mins: 0,
    pinned: false,
    archived: false,
  } satisfies Thread;
}

export function useRailState(onSelect?: (id: string) => void) {
  const projects = useSignal<readonly RailProject[]>(
    PROJECTS.map((item) => ({ ...item, collapsed: false, hidden: false })),
  );
  const threads = useSignal<readonly Thread[]>(AGENTS.map(seedThread));
  const query = useSignal("");
  const grouping = useSignal<Grouping>("project");
  const sorting = useSignal<Sorting>("recent");
  const selectedId = useSignal<string | null>(AGENTS[0]?.id ?? null);
  const editingId = useSignal<string | null>(null);
  const menuFor = useSignal<string | null>(null);
  const note = useSignal<string | null>(null);
  const archivedOpen = useSignal(false);
  const hiddenOpen = useSignal(false);
  const shelf = useRef<{ project: RailProject; threads: readonly Thread[] }[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const say = (text: string) => {
    note.value = text;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      note.value = null;
    }, NOTE_MS);
  };
  const patch = (id: string, change: Partial<Thread>) => {
    threads.value = threads.value.map((item) => (item.id === id ? { ...item, ...change } : item));
  };
  const patchProject = (id: string, change: Partial<RailProject>) => {
    projects.value = projects.value.map((item) => (item.id === id ? { ...item, ...change } : item));
  };
  const projectOf = (id: string) => projects.value.find((item) => item.id === id);
  const homePath = (projectId: string) =>
    CHECKOUTS.find((item) => item.projectId === projectId && !item.worktree)?.path ??
    `~/dev/${projectOf(projectId)?.name ?? "project"}`;

  const state = {
    projects,
    threads,
    query,
    grouping,
    sorting,
    selectedId,
    editingId,
    menuFor,
    note,
    archivedOpen,
    hiddenOpen,
    say,
    projectOf,
    select(id: string) {
      selectedId.value = id;
      onSelect?.(id);
      const thread = threads.value.find((item) => item.id === id);
      if (thread?.state === "unchecked") patch(id, { state: "done" });
    },
    rename(id: string, text: string) {
      const clean = text.trim();
      if (clean !== "") patch(id, { title: clean });
      editingId.value = null;
    },
    togglePin(id: string) {
      const thread = threads.value.find((item) => item.id === id);
      if (thread) patch(id, { pinned: !thread.pinned });
    },
    toggleUnread(id: string) {
      const thread = threads.value.find((item) => item.id === id);
      if (thread) patch(id, { state: thread.state === "unchecked" ? "done" : "unchecked" });
    },
    setArchived(id: string, archived: boolean) {
      patch(id, { archived, pinned: false });
      if (archived && selectedId.value === id) selectedId.value = null;
    },
    toggleCollapsed(id: string) {
      const project = projectOf(id);
      if (project) patchProject(id, { collapsed: !project.collapsed });
    },
    expand(id: string) {
      patchProject(id, { collapsed: false });
    },
    move(id: string, by: -1 | 1) {
      const list = [...projects.value];
      const at = list.findIndex((item) => item.id === id);
      const to = at + by;
      if (at === -1 || to < 0 || to >= list.length) return;
      const [item] = list.splice(at, 1);
      if (item) list.splice(to, 0, item);
      projects.value = list;
    },
    setHidden(id: string, hidden: boolean) {
      patchProject(id, { hidden });
      if (!hidden) hiddenOpen.value = projects.value.some((item) => item.hidden && item.id !== id);
    },
    removeProject(id: string) {
      const project = projectOf(id);
      if (!project) return;
      shelf.current.push({ project, threads: threads.value.filter((t) => t.projectId === id) });
      projects.value = projects.value.filter((item) => item.id !== id);
      threads.value = threads.value.filter((item) => item.projectId !== id);
      say(`Removed ${project.name}`);
    },
    addAgent(projectId: string, kind: AgentKind = "claude") {
      const project = projectOf(projectId);
      if (!project) return;
      const branch = CHECKOUTS.find((c) => c.projectId === projectId && !c.worktree)?.branch;
      const thread = freshThread(kind, project, branch ?? null, homePath(projectId));
      threads.value = [...threads.value, thread];
      patchProject(projectId, { collapsed: false });
      selectedId.value = thread.id;
      editingId.value = thread.id;
    },
    createWorktree(projectId: string, branch: string) {
      const project = projectOf(projectId);
      if (!project) return;
      const slug = branch.replaceAll(/[^\w-]+/g, "-");
      const path = `${homePath(projectId)}/.claude/worktrees/${slug}`;
      const thread = freshThread("claude", project, branch, path);
      threads.value = [...threads.value, thread];
      patchProject(projectId, { collapsed: false });
      selectedId.value = thread.id;
      say(`Created ${branch}`);
    },
    /** Brings back the last removed project, else opens an empty folder. */
    openFolder() {
      const back = shelf.current.pop();
      if (back) {
        projects.value = [...projects.value, back.project];
        threads.value = [...threads.value, ...back.threads];
        return;
      }
      const id = `folder-${projects.value.length + 1}`;
      const item: RailProject = {
        id,
        name: `folder-${projects.value.length + 1}`,
        kind: "folder",
        collapsed: false,
        hidden: false,
      };
      projects.value = [...projects.value, item];
    },
  };
  return state;
}

export type RailState = ReturnType<typeof useRailState>;

/** Whether a thread passes the search box. */
export function matchesQuery(thread: Thread, state: RailState): boolean {
  const needle = state.query.value.trim();
  if (needle === "") return true;
  const project = state.projectOf(thread.projectId);
  return fuzzy(needle, `${thread.title} ${thread.branch ?? ""} ${project?.name ?? ""}`);
}

/** Visible threads of a project: the search applied, archived left out. */
export function threadsOf(state: RailState, projectId: string): Thread[] {
  return ordered(
    state.threads.value.filter((item) => item.projectId === projectId),
    state.sorting.value,
  ).filter((item) => matchesQuery(item, state));
}

/** On-screen order of every shown project's threads, for the attention cycle. */
export function displayOrder(state: RailState): Thread[] {
  return state.projects.value
    .filter((item) => !item.hidden)
    .flatMap((item) =>
      ordered(
        state.threads.value.filter((t) => t.projectId === item.id),
        state.sorting.value,
      ),
    );
}

export function attentionCount(state: RailState): number {
  return displayOrder(state).filter((item) => wantsUser(item.state)).length;
}

/** The next thread that wants the user after the selected one, wrapping around. */
export function nextAttention(state: RailState): Thread | null {
  const list = displayOrder(state);
  const at = list.findIndex((item) => item.id === state.selectedId.value);
  for (let step = 1; step <= list.length; step += 1) {
    const item = list[(at + step + list.length) % list.length];
    if (item && wantsUser(item.state)) return item;
  }
  return null;
}
