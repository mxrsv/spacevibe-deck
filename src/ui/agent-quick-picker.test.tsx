// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomAgent } from "../lib/agent-catalog";
import type { QuickDestination } from "../repositories/worktree-destinations";
import { AgentQuickPicker } from "./agent-quick-picker";

const DETECTED = [
  { name: "claude", path: "/usr/local/bin/claude" },
  { name: "codex", path: "/usr/local/bin/codex" },
];

const CUSTOM: readonly CustomAgent[] = [
  { id: "custom:aider", label: "Aider", command: "aider --model gpt-4" },
];

let host: HTMLDivElement;

const DESTINATIONS: readonly QuickDestination[] = [
  { path: "/dev/deck", name: "deck", branch: "main", primary: true },
  {
    path: "/dev/deck-modal",
    name: "deck-modal",
    branch: "feat/modal-shell",
    primary: false,
  },
];

function mount(
  overrides: {
    detected?: typeof DETECTED;
    customAgents?: readonly CustomAgent[];
    destinations?: readonly QuickDestination[];
    initialDestination?: string | null;
  } = {},
): { onSelect: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    render(
      <AgentQuickPicker
        detected={overrides.detected ?? DETECTED}
        customAgents={overrides.customAgents ?? CUSTOM}
        destinations={overrides.destinations}
        initialDestination={overrides.initialDestination}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
      host,
    );
  });
  return { onSelect, onCancel };
}

function selectEl(): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>(".cfg-row select");
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe("AgentQuickPicker", () => {
  // The chips carry no digit badge since 2026-08-16 — the digit
  // keys below still pick, so order is still the contract, it just is not
  // printed on the chip any more.
  it("renders one chip per agentOptions() entry plus Shell only, in digit-key order", () => {
    mount();

    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".achip"),
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Claude Code",
      "Codex",
      "AAider",
      "$Shell only",
    ]);
    expect(host.querySelector(".achip kbd")).toBeNull();
  });

  it("marks a declared agent whose binary was not detected as missing", () => {
    mount();

    const aider = host.querySelectorAll<HTMLButtonElement>(".achip")[2];
    expect(aider.className).toContain("is-missing");
    expect(aider.title).toBe("aider --model gpt-4 — not on $PATH");
  });

  it("does not mark a detected built-in as missing", () => {
    mount();

    const claude = host.querySelectorAll<HTMLButtonElement>(".achip")[0];
    expect(claude.className).not.toContain("is-missing");
  });

  it("clicking a chip selects its agent id", () => {
    const { onSelect } = mount();

    host.querySelectorAll<HTMLButtonElement>(".achip")[1].click();

    // Second argument is the destination: null when the surface offered none.
    expect(onSelect).toHaveBeenCalledWith("codex", null);
  });

  it("clicking Shell only selects null", () => {
    const { onSelect } = mount();

    host.querySelectorAll<HTMLButtonElement>(".achip")[3].click();

    expect(onSelect).toHaveBeenCalledWith(null, null);
  });

  it("digit keys 1-9 select the matching chip, and 0 selects Shell only", () => {
    const { onSelect } = mount();
    const container = host.querySelector(
      ".agent-quick-picker",
    ) as HTMLDivElement;

    act(() => {
      container.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenLastCalledWith("codex", null);

    act(() => {
      container.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenLastCalledWith(null, null);
  });

  it("an out-of-range digit key is a no-op", () => {
    const { onSelect } = mount();
    const container = host.querySelector(
      ".agent-quick-picker",
    ) as HTMLDivElement;

    act(() => {
      container.dispatchEvent(
        new KeyboardEvent("keydown", { key: "9", bubbles: true }),
      );
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape cancels without selecting", () => {
    const { onSelect, onCancel } = mount();
    const container = host.querySelector(
      ".agent-quick-picker",
    ) as HTMLDivElement;

    act(() => {
      container.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // DL-29.3, the default half of it: a picker holds no draft, so clicking
  // the stage behind it is a way out.
  it("a click on the scrim cancels", () => {
    const { onSelect, onCancel } = mount();
    const scrim = host.querySelector(".modal-scrim") as HTMLDivElement;

    act(() => {
      scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking the card itself does not cancel", () => {
    const { onCancel } = mount();
    const card = host.querySelector(".agent-quick-picker") as HTMLDivElement;

    act(() => {
      card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("focuses the card on mount so digit keys work immediately", () => {
    mount();

    expect(document.activeElement?.className).toBe("agent-quick-picker");
  });

  it("degrades to Shell only when nothing was detected and nothing is declared", () => {
    mount({ detected: [], customAgents: [] });

    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".achip"),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("$Shell only");
  });
});

// DL-29.7. The destination is stated once above the rows, and it is one
// choice even though it prints as `folder · branch` — see
// `worktree-destinations.ts` for why git makes those one thing.
describe("AgentQuickPicker destination", () => {
  it("offers no row at all when the workspace is not a repository", () => {
    mount();

    expect(selectEl()).toBeNull();
    expect(host.querySelector(".cfg-row")).toBeNull();
    expect(host.querySelector(".agent-quick-picker__hint")).not.toBeNull();
  });

  it("lists every worktree as folder · branch", () => {
    mount({ destinations: DESTINATIONS });

    expect(
      Array.from(selectEl()!.options).map((option) => [
        option.value,
        option.textContent,
      ]),
    ).toEqual([
      ["/dev/deck", "deck · main"],
      ["/dev/deck-modal", "deck-modal · feat/modal-shell"],
    ]);
  });

  it("opens on initialDestination and passes it with the pick", () => {
    const { onSelect } = mount({
      destinations: DESTINATIONS,
      initialDestination: "/dev/deck-modal",
    });

    expect(selectEl()!.value).toBe("/dev/deck-modal");
    expect(host.querySelector(".cfg-btn__text")?.textContent).toBe(
      "deck-modal · feat/modal-shell",
    );

    host.querySelectorAll<HTMLButtonElement>(".achip")[0].click();

    expect(onSelect).toHaveBeenCalledWith("claude", "/dev/deck-modal");
  });

  it("falls back to the repository's own checkout when the preference is unknown", () => {
    const { onSelect } = mount({
      destinations: DESTINATIONS,
      initialDestination: "/somewhere/else",
    });

    host.querySelectorAll<HTMLButtonElement>(".achip")[0].click();

    expect(onSelect).toHaveBeenCalledWith("claude", "/dev/deck");
  });

  it("changing the select changes what the pick carries", () => {
    const { onSelect } = mount({
      destinations: DESTINATIONS,
      initialDestination: "/dev/deck",
    });

    const select = selectEl()!;
    act(() => {
      select.value = "/dev/deck-modal";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(host.querySelector(".cfg-btn__text")?.textContent).toBe(
      "deck-modal · feat/modal-shell",
    );
    host.querySelectorAll<HTMLButtonElement>(".achip")[1].click();
    expect(onSelect).toHaveBeenCalledWith("codex", "/dev/deck-modal");
  });

  // The scan is async, so the picker normally mounts with an empty list and
  // is handed the worktrees a render later. Seeding state at mount would
  // freeze the empty answer.
  it("adopts destinations that arrive after mount", () => {
    const onSelect = vi.fn();
    const props = {
      detected: DETECTED,
      customAgents: CUSTOM,
      onSelect,
      onCancel: vi.fn(),
    };
    act(() => {
      render(<AgentQuickPicker {...props} destinations={[]} />, host);
    });
    expect(selectEl()).toBeNull();

    act(() => {
      render(
        <AgentQuickPicker
          {...props}
          destinations={DESTINATIONS}
          initialDestination="/dev/deck-modal"
        />,
        host,
      );
    });

    expect(selectEl()!.value).toBe("/dev/deck-modal");
  });

  // One worktree is not a choice — DL-17.3's readout, not a control that
  // opens a menu with a single row in it.
  it("prints a single worktree as a readout instead of a menu", () => {
    mount({ destinations: [DESTINATIONS[0]] });

    expect(selectEl()).toBeNull();
    expect(host.querySelector(".cfg-readout")?.textContent).toBe("deck · main");
  });

  // The native select's own type-to-select uses digits; a launch fired from
  // inside it would open a tab the user never asked for.
  it("ignores a digit typed while the select has focus", () => {
    const { onSelect } = mount({ destinations: DESTINATIONS });

    act(() => {
      selectEl()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", bubbles: true }),
      );
    });

    expect(onSelect).not.toHaveBeenCalled();
  });
});
