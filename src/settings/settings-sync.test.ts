import { describe, expect, it } from "vitest";
import { createMemorySettingsSync } from "./settings-sync";

describe("createMemorySettingsSync", () => {
  it("records every patch in order", async () => {
    const sync = createMemorySettingsSync();
    await sync.sendPatch({ fontSize: 15 });
    await sync.sendPatch({ scrollback: 5000 });
    expect(sync.patches).toEqual([{ fontSize: 15 }, { scrollback: 5000 }]);
  });

  it("delivers a merged broadcast to the registered listener", async () => {
    const sync = createMemorySettingsSync();
    const seen: unknown[] = [];
    await sync.listenMerged((merged) => void seen.push(merged));
    sync.broadcast({ fontSize: 21 });
    expect(seen).toEqual([{ fontSize: 21 }]);
  });
});
