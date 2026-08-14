// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomAgent } from "../lib/agent-catalog";
import { AgentQuickPicker } from "./agent-quick-picker";

const DETECTED = [
  { name: "claude", path: "/usr/local/bin/claude" },
  { name: "codex", path: "/usr/local/bin/codex" },
];

const CUSTOM: readonly CustomAgent[] = [
  { id: "custom:aider", label: "Aider", command: "aider --model gpt-4" },
];

let host: HTMLDivElement;

function mount(
  overrides: {
    detected?: typeof DETECTED;
    customAgents?: readonly CustomAgent[];
  } = {},
): { onSelect: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    render(
      <AgentQuickPicker
        detected={overrides.detected ?? DETECTED}
        customAgents={overrides.customAgents ?? CUSTOM}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
      host,
    );
  });
  return { onSelect, onCancel };
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
  it("renders one chip per agentOptions() entry plus Shell only, digit-keyed in order", () => {
    mount();

    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".achip"),
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "1Claude Code",
      "2Codex",
      "3AAider",
      "0$Shell only",
    ]);
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

    expect(onSelect).toHaveBeenCalledWith("codex");
  });

  it("clicking Shell only selects null", () => {
    const { onSelect } = mount();

    host.querySelectorAll<HTMLButtonElement>(".achip")[3].click();

    expect(onSelect).toHaveBeenCalledWith(null);
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
    expect(onSelect).toHaveBeenLastCalledWith("codex");

    act(() => {
      container.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
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
    expect(chips[0].textContent).toBe("0$Shell only");
  });
});
