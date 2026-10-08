// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/worktree-host", () => ({ addWorktree: vi.fn(), available: true }));
vi.mock("../host/dialog-host", () => ({ open: vi.fn() }));
vi.mock("./rail-add-folder", () => ({ rememberOnRail: vi.fn(), addFolderToRail: vi.fn() }));
vi.mock("./worktree-card-row", () => ({ whereOf: () => "repo · main" }));
vi.mock("./controls/deck-icon", () => ({ CHROME_ICON: 13, DeckIcon: () => <span /> }));

import type { RailStreamGroup } from "./agent-rail-model";
import { RailCreate } from "./rail-create";

const STREAM = [
  {
    project: "repo",
    worktrees: [{ active: true, labelled: true, path: "/r/main", repositoryPath: "/r/main" }],
  },
] as unknown as readonly RailStreamGroup[];

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function mount(stream: readonly RailStreamGroup[]): void {
  act(() => {
    render(<RailCreate variant="column" stream={stream} onOpenBoard={() => {}} />, host);
  });
}

describe("RailCreate worktree target (ROW-C1, ROW-C7)", () => {
  it("names the focused project in the Worktree tooltip", () => {
    mount(STREAM);
    const button = host.querySelector('.rail-create__button[data-verb="worktree"]');

    expect(button?.getAttribute("aria-label") ?? button?.getAttribute("title")).toBe(
      "New worktree in repo",
    );
  });

  it("falls back to plain copy with no repository", () => {
    mount([]);
    const button = host.querySelector('.rail-create__button[data-verb="worktree"]');

    expect(button?.getAttribute("aria-label") ?? button?.getAttribute("title")).toBe(
      "New worktree",
    );
  });
});
