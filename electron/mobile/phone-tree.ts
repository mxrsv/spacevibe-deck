/**
 * The tree a phone sees (mobile design §6): projects → checkouts → panes, merged from every
 * window's report and overlaid with main's pane mirror, so phase and attention are the same
 * hook-backed state the rail draws and `deck pane wait` reads.
 *
 * Windows report their own projects (the rail's grouping lives in the renderer). Main merges them
 * by path, remembers which window holds which path (a callerless `open` goes to that window), and
 * polls every `TREE_POLL_MS` only while a phone is subscribed, pushing only when the merged tree
 * changed.
 */
import {
  parseAgentChoices,
  parseProjectChoices,
  parseTree,
  type ProjectChoice,
  type Tree,
  type TreeCheckout,
  type TreeProject,
} from "../../mobile/protocol/src/tree";
import type { PaneMirror } from "../control/pane-mirror";
import type { QueryBroker } from "./phone-queries";

export const TREE_POLL_MS = 2_000;

export interface TreeHub {
  /** A fresh merged tree. */
  snapshot(): Promise<Tree>;
  /** Starts polling while at least one listener is subscribed; `listener` gets changes only. */
  subscribe(listener: (tree: Tree) => void, current?: Tree): () => void;
  /** The project choices phones can open an agent in, merged across windows. */
  projects(): Promise<ProjectChoice[]>;
  agents(): Promise<{ id: string; label: string }[]>;
  /** The label of a window whose last report held this project or checkout path. */
  windowHolding(path: string): string | null;
  /** Whether `root` is a project or checkout path some window reported. */
  isKnownRoot(root: string): Promise<boolean>;
}

function mergeCheckouts(into: Map<string, TreeCheckout>, checkouts: readonly TreeCheckout[]): void {
  for (const checkout of checkouts) {
    const existing = into.get(checkout.path);
    into.set(
      checkout.path,
      existing === undefined
        ? checkout
        : { ...existing, panes: [...existing.panes, ...checkout.panes] },
    );
  }
}

export function createTreeHub(deps: {
  readonly broker: QueryBroker;
  readonly mirror: PaneMirror;
  readonly pollMs?: number;
}): TreeHub {
  const pollMs = deps.pollMs ?? TREE_POLL_MS;
  /** Window label → project paths and checkout paths it held at its last tree report. */
  const heldPaths = new Map<string, Set<string>>();
  const knownRoots = new Set<string>();
  const listeners = new Set<(tree: Tree) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = "";
  let polling = false;

  function overlay(pane: TreeCheckout["panes"][number]): TreeCheckout["panes"][number] {
    const state = deps.mirror.get(pane.paneId);
    if (state === null) return pane;
    const agent = state.agent ?? pane.agent;
    return {
      ...pane,
      agent,
      agentLabel: agent === pane.agent ? pane.agentLabel : agent,
      phase: state.phase,
      attention: state.attention,
      attentionSince: state.attention === "none" ? null : (pane.attentionSince ?? state.reportedAt),
    };
  }

  async function snapshot(): Promise<Tree> {
    const answers = await deps.broker.query("tree");
    const projects = new Map<string, { name: string; checkouts: Map<string, TreeCheckout> }>();
    for (const { label, payload } of answers) {
      const tree = parseTree(payload);
      if (tree === null) continue;
      const held = new Set<string>();
      for (const project of tree.projects) {
        held.add(project.path);
        for (const checkout of project.checkouts) held.add(checkout.path);
        const entry = projects.get(project.path) ?? { name: project.name, checkouts: new Map() };
        mergeCheckouts(entry.checkouts, project.checkouts);
        projects.set(project.path, entry);
      }
      heldPaths.set(label, held);
      for (const path of held) knownRoots.add(path);
    }
    const merged: TreeProject[] = [...projects.entries()].map(([path, entry]) => ({
      name: entry.name,
      path,
      checkouts: [...entry.checkouts.values()].map((checkout) => ({
        ...checkout,
        panes: checkout.panes.map(overlay),
      })),
    }));
    return { projects: merged };
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const tree = await snapshot();
      const serialized = JSON.stringify(tree);
      if (serialized === last) return;
      last = serialized;
      for (const listener of [...listeners]) listener(tree);
    } finally {
      polling = false;
    }
  }

  async function projects(): Promise<ProjectChoice[]> {
    const answers = await deps.broker.query("projects");
    const byPath = new Map<string, ProjectChoice>();
    for (const { payload } of answers) {
      const choices = parseProjectChoices(payload);
      if (choices === null) continue;
      for (const choice of choices) {
        if (!byPath.has(choice.path)) byPath.set(choice.path, choice);
        knownRoots.add(choice.path);
        for (const checkout of choice.checkouts) knownRoots.add(checkout.path);
      }
    }
    return [...byPath.values()];
  }

  return {
    snapshot,
    subscribe(listener, current) {
      listeners.add(listener);
      // A subscriber already holds `current` from its `tree.subscribe` response, so the first
      // poll only pushes if something moved since.
      if (timer === undefined) {
        last = current === undefined ? "" : JSON.stringify(current);
        timer = setInterval(() => void poll(), pollMs);
        timer.unref?.();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    projects,
    async agents() {
      const answers = await deps.broker.query("agents");
      for (const { payload } of answers) {
        const agents = parseAgentChoices(payload);
        if (agents !== null) return agents;
      }
      return [];
    },
    windowHolding(path) {
      for (const [label, held] of heldPaths) {
        if (held.has(path)) return label;
      }
      return null;
    },
    async isKnownRoot(root) {
      if (knownRoots.has(root)) return true;
      await projects();
      return knownRoots.has(root);
    },
  };
}
