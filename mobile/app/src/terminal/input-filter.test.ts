import { describe, expect, it } from "vitest";
import { filterInput } from "./input-filter";

const E = "\u001b";

describe("filterInput: what xterm generates by itself is dropped", () => {
  const replies: [string, string][] = [
    ["DA1", `${E}[?1;2c`],
    ["DA1 (vt220)", `${E}[?62;4c`],
    ["DA2", `${E}[>0;276;0c`],
    ["DA3", `${E}P!|00000000${E}\\`],
    ["CPR", `${E}[24;80R`],
    ["DEC CPR", `${E}[?24;80R`],
    ["DSR ok", `${E}[0n`],
    ["DECRPM", `${E}[?2004;2$y`],
    ["focus in", `${E}[I`],
    ["focus out", `${E}[O`],
    ["X10 mouse", `${E}[M !!`],
    ["SGR mouse press", `${E}[<0;12;5M`],
    ["SGR mouse release", `${E}[<0;12;5m`],
    ["OSC colour reply (BEL)", `${E}]11;rgb:1919/1c1c/2020${"\u0007"}`],
    ["OSC colour reply (ST)", `${E}]10;rgb:e7e7/e8e8/e9e9${E}\\`],
    ["OSC clipboard", `${E}]52;c;aGk=${"\u0007"}`],
    ["DECRQSS reply", `${E}P1$r0m${E}\\`],
    ["XTGETTCAP reply", `${E}P1+r544e=787465726d${E}\\`],
    ["window report", `${E}[8;24;80t`],
  ];
  for (const [name, sequence] of replies) {
    it(`drops ${name}`, () => {
      expect(filterInput(sequence)).toBe("");
    });
  }

  it("drops replies glued to a real key and keeps the key", () => {
    expect(filterInput(`a${E}[?1;2cb`)).toBe("ab");
    expect(filterInput(`${E}[24;80R\r`)).toBe("\r");
  });
});

describe("filterInput: real keys are kept", () => {
  const keys: [string, string][] = [
    ["up", `${E}[A`],
    ["down", `${E}[B`],
    ["right", `${E}[C`],
    ["left", `${E}[D`],
    ["home", `${E}[H`],
    ["end", `${E}[F`],
    ["shift tab", `${E}[Z`],
    ["F5", `${E}[15~`],
    ["F12", `${E}[24~`],
    ["page up", `${E}[5~`],
    ["delete", `${E}[3~`],
    ["F1", `${E}OP`],
    ["application up", `${E}OA`],
    ["ctrl right", `${E}[1;5C`],
    ["escape", E],
    ["alt-b", `${E}b`],
    ["enter", "\r"],
    ["ctrl-c", "\u0003"],
    ["text", "hello wörld ✓"],
    ["tab", "\t"],
  ];
  for (const [name, sequence] of keys) {
    it(`keeps ${name}`, () => {
      expect(filterInput(sequence)).toBe(sequence);
    });
  }
});
