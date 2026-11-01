import { AGENTS, placeOf, type MockAgent, type MockState } from "./layout-fixture";

export type InboxSectionId = "needs" | "unread" | "working" | "quiet";

export const SECTION_LABEL: Readonly<Record<InboxSectionId, string>> = {
  needs: "Needs you",
  unread: "Unread",
  working: "Working",
  quiet: "Quiet",
};

const SECTION_OF: Readonly<Record<MockState, InboxSectionId>> = {
  failed: "needs",
  "needs-you": "needs",
  unchecked: "unread",
  working: "working",
  done: "quiet",
  ended: "quiet",
  idle: "quiet",
};

export const SECTION_ORDER: readonly InboxSectionId[] = ["needs", "unread", "working", "quiet"];

export function sectionOf(agent: MockAgent): InboxSectionId {
  return SECTION_OF[agent.state];
}

/** Fixture order inside a section: only a state change moves a row. */
export function agentsInSection(section: InboxSectionId, projectId: string | null): MockAgent[] {
  return AGENTS.filter(
    (agent) =>
      sectionOf(agent) === section &&
      (projectId === null || placeOf(agent).project.id === projectId),
  );
}

/** `project / branch`, the branch dropped for a plain folder. */
export function placeLine(agent: MockAgent): string {
  const { project, checkout } = placeOf(agent);
  return checkout.branch === null ? project.name : `${project.name} / ${checkout.branch}`;
}
