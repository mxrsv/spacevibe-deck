// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { RailStatusMark } from "./rail-status-mark";

describe("RailStatusMark", () => {
  it("draws the spinner for working and a data-state dot otherwise", () => {
    const host = document.createElement("div");
    act(() => {
      render(<RailStatusMark state="working" />, host);
    });
    expect(host.querySelector(".asr-row__mark--spinner[data-state='working']")).not.toBeNull();
    act(() => {
      render(<RailStatusMark state="asked" />, host);
    });
    expect(host.querySelector(".asr-row__mark[data-state='asked']")).not.toBeNull();
    expect(host.querySelector(".asr-row__mark--spinner")).toBeNull();
  });
});
