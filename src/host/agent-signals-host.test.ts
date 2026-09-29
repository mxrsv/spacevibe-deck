import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bridge", () => ({ invoke: vi.fn(), listen: vi.fn() }));

/** A fresh facade over a host that answers `answer`, or throws when it is an Error. */
async function facadeAnswering(answer: unknown) {
  vi.resetModules();
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
  const bridge = await import("./bridge");
  if (answer instanceof Error) {
    vi.mocked(bridge.invoke).mockRejectedValue(answer);
  } else {
    vi.mocked(bridge.invoke).mockResolvedValue(answer);
  }
  return { bridge, host: await import("./agent-signals-host") };
}

describe("agent-signals-host launch config", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps parsing the settings path and the hook port as before", async () => {
    const { bridge, host } = await facadeAnswering({
      claudeSettingsPath: "/deck/claude.json",
      hookPort: 45999,
      hooksSupported: true,
    });

    await expect(host.agentSignalConfig()).resolves.toMatchObject({
      claudeSettingsPath: "/deck/claude.json",
      hookPort: 45999,
    });
    expect(bridge.invoke).toHaveBeenCalledWith("agent_signal_config");
  });

  it("still nulls a malformed path or port", async () => {
    const { host } = await facadeAnswering({ claudeSettingsPath: "", hookPort: -1 });

    await expect(host.agentSignalConfig()).resolves.toMatchObject({
      claudeSettingsPath: null,
      hookPort: null,
    });
  });

  it("reads an explicit hooksSupported: true", async () => {
    const { host } = await facadeAnswering({ hookPort: 1, hooksSupported: true });

    expect((await host.agentSignalConfig()).hooksSupported).toBe(true);
  });

  it("reads an explicit hooksSupported: false", async () => {
    const { host } = await facadeAnswering({ hookPort: 1, hooksSupported: false });

    expect((await host.agentSignalConfig()).hooksSupported).toBe(false);
  });

  it.each([
    ["absent (a host that predates the field)", {}],
    ["a string", { hooksSupported: "false" }],
    ["a number", { hooksSupported: 0 }],
    ["null", { hooksSupported: null }],
  ])("defaults hooksSupported to true when it is %s", async (_case, answer) => {
    const { host } = await facadeAnswering(answer);

    expect((await host.agentSignalConfig()).hooksSupported).toBe(true);
  });

  it("defaults to true when the host answers with something that is not an object", async () => {
    const { host } = await facadeAnswering("nope");

    const config = await host.agentSignalConfig();

    expect(config).toBe(host.NO_SIGNAL_CONFIG);
    expect(config.hooksSupported).toBe(true);
  });

  it("defaults to true when the call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = await facadeAnswering(new Error("bridge closed"));

    const config = await host.agentSignalConfig();

    expect(config).toBe(host.NO_SIGNAL_CONFIG);
    expect(config.hooksSupported).toBe(true);
  });

  it("answers the no-host default without calling anything when there is no bridge", async () => {
    vi.resetModules();
    vi.stubGlobal("__deckHost", undefined);
    const bridge = await import("./bridge");
    const host = await import("./agent-signals-host");

    await expect(host.agentSignalConfig()).resolves.toBe(host.NO_SIGNAL_CONFIG);
    expect(host.NO_SIGNAL_CONFIG.hooksSupported).toBe(true);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
