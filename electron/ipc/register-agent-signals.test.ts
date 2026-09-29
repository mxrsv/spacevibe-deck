import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentSignals, type RegisterAgentSignalsDeps } from "./register-agent-signals";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));

const LAUNCH_CONFIG = { claudeSettingsPath: null, hookPort: 45123 };

function register(overrides: Partial<RegisterAgentSignalsDeps> = {}): void {
  registerAgentSignals({
    config: () => LAUNCH_CONFIG,
    opencode: {
      attach: vi.fn(),
      detach: vi.fn(),
    } as unknown as RegisterAgentSignalsDeps["opencode"],
    assertOwner: vi.fn(),
    labelOf: () => "main",
    ...overrides,
  });
}

function askConfig(): unknown {
  const handler = mocks.handlers.get("agent_signal_config");
  if (handler === undefined) {
    throw new Error("agent_signal_config was not registered");
  }
  return handler({ sender: {} });
}

beforeEach(() => {
  mocks.handlers.clear();
});

describe("agent_signal_config", () => {
  it("still answers the launch config it always did", () => {
    register();

    expect(askConfig()).toMatchObject(LAUNCH_CONFIG);
  });

  it("adds hooksSupported: false where the host ships no hooks", () => {
    register({ hooksSupported: () => false });

    expect(askConfig()).toEqual({ ...LAUNCH_CONFIG, hooksSupported: false });
  });

  it("adds hooksSupported: true where it does", () => {
    register({ hooksSupported: () => true });

    expect(askConfig()).toEqual({ ...LAUNCH_CONFIG, hooksSupported: true });
  });

  it("answers with the one platform function the integrations use by default", async () => {
    register();
    const { hooksSupported } = await import("../agent-hooks/hooks-supported");

    expect(askConfig()).toEqual({ ...LAUNCH_CONFIG, hooksSupported: hooksSupported() });
  });
});
