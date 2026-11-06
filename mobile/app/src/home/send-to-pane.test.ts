import { describe, expect, it, vi } from "vitest";
import { choiceInput, parseChoices } from "@/choices/parse-choices";
import type { DesktopConnection } from "@/session/connection";
import { sendKeys } from "./send-to-pane";

describe("two-digit choices", () => {
  it("are one pane.input carrying both digits, not two", async () => {
    const request = vi.fn<(method: string, params: unknown) => Promise<object>>(async () => ({}));
    const connection = { rpc: { request } } as unknown as DesktopConnection;
    const screen = Array.from(
      { length: 12 },
      (_, i) => `  ${i === 0 ? "❯ " : ""}${i + 1}. Option ${i + 1}`,
    ).join("\n");
    const choices = parseChoices(screen);
    expect(choices).toHaveLength(12);
    const twelve = choices![11];
    expect(choiceInput(twelve)).toBe("12");
    await sendKeys(connection, 3, choiceInput(twelve));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("pane.input", { paneId: 3, data: "12" });
  });
});
