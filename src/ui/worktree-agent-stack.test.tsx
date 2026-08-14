// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorktreeAgentStack } from "./worktree-agent-stack";

describe("WorktreeAgentStack", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("renders nothing when no recognized agent is present", () => {
    render(<WorktreeAgentStack agents={[]} />, host);
    expect(host.childElementCount).toBe(0);
  });

  it("uses built-in marks and a letter avatar for a declared agent", () => {
    render(
      <WorktreeAgentStack agents={["claude", "codex", "Review Bot"]} />,
      host,
    );

    expect(host.querySelectorAll(".worktree-agents__logo")).toHaveLength(2);
    expect(host.querySelector(".worktree-agents__letter")?.textContent).toBe(
      "R",
    );
    expect(
      host.querySelector(".worktree-agents")?.getAttribute("aria-label"),
    ).toBe("Agents in this worktree: Claude Code, Codex, Review Bot");
    expect(host.querySelector(".worktree-agents")?.getAttribute("role")).toBe(
      "img",
    );
  });

  it("caps visible identities at three and summarizes the remainder", () => {
    render(
      <WorktreeAgentStack
        agents={["claude", "codex", "gemini", "opencode", "agy"]}
      />,
      host,
    );

    expect(host.querySelectorAll(".worktree-agents__item")).toHaveLength(3);
    expect(host.querySelector(".worktree-agents__more")?.textContent).toBe(
      "+2",
    );
  });
});
