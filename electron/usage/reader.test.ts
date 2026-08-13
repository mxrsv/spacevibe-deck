import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSync, closeSync } from "node:fs";
import {
  LineReader,
  MAX_LINE_BYTES,
  daysFromCivil,
  parseRfc3339Ms,
  type LineEvent,
} from "./reader";

/**
 * Mirrors `src-tauri/src/usage/reader.rs`'s tests: committed offsets, the
 * byte cap, and the Zulu-only timestamp parser — the exact behaviors the
 * parity gate relies on the two implementations agreeing about.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readAll(data: string | Buffer, start: number, cap: number): LineEvent[] {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-reader-"));
  temps.push(dir);
  const file = path.join(dir, "lines");
  writeFileSync(file, data);
  const fd = openSync(file, "r");
  try {
    const reader = new LineReader(fd, start, cap, 64 * 1024);
    const events: LineEvent[] = [];
    for (;;) {
      const event = reader.nextLine();
      events.push(event);
      if (event.kind === "end") {
        return events;
      }
    }
  } finally {
    closeSync(fd);
  }
}

function text(event: LineEvent): string | null {
  return event.kind === "line" ? event.bytes.toString("utf8") : null;
}

describe("LineReader", () => {
  it("reads complete lines and commits the offset past each newline", () => {
    const events = readAll("one\ntwo\n", 0, 64);
    expect(events).toHaveLength(3);
    expect(text(events[0])).toBe("one");
    expect(text(events[1])).toBe("two");
    expect(events[0]).toMatchObject({ kind: "line", offset: 4 });
    expect(events[1]).toMatchObject({ kind: "line", offset: 8 });
    expect(events[2].kind).toBe("end");
  });

  it("discards a partial trailing line without committing it", () => {
    const events = readAll("one\ntwo", 0, 64);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "line", offset: 4 });
    expect(events[1].kind).toBe("end");
  });

  it("treats an empty line as a line, not an end", () => {
    const events = readAll("\na\n", 0, 64);
    expect(text(events[0])).toBe("");
    expect(text(events[1])).toBe("a");
    expect(events[2].kind).toBe("end");
  });

  it("keeps a line of exactly the cap and skips one byte over", () => {
    const atCap = readAll("12345678\n", 0, 8);
    expect(text(atCap[0])).toBe("12345678");

    const overCap = readAll("123456789\n", 0, 8);
    expect(overCap[0]).toMatchObject({ kind: "oversized", offset: 10 });
  });

  it("skips an oversized line and still reads the next one", () => {
    const events = readAll("123456789\nkept\n", 0, 8);
    expect(events[0]).toMatchObject({ kind: "oversized", offset: 10 });
    expect(text(events[1])).toBe("kept");
    expect(events[1]).toMatchObject({ kind: "line", offset: 15 });
  });

  it("keeps an oversized line spanning several buffer fills as one event", () => {
    const bufferBytes = 64 * 1024;
    const long = Buffer.concat([
      Buffer.alloc(bufferBytes + 500, "x"),
      Buffer.from("\nkept\n"),
    ]);
    const dir = mkdtempSync(path.join(tmpdir(), "usage-reader-"));
    temps.push(dir);
    const file = path.join(dir, "lines");
    writeFileSync(file, long);
    const fd = openSync(file, "r");
    try {
      const reader = new LineReader(fd, 0, 16, bufferBytes);
      const expected = bufferBytes + 500 + 1;
      expect(reader.nextLine()).toMatchObject({
        kind: "oversized",
        offset: expected,
      });
      expect(reader.nextLine()).toMatchObject({
        kind: "line",
        offset: expected + 5,
      });
    } finally {
      closeSync(fd);
    }
  });

  it("resumes offsets from the start it was handed", () => {
    // A reader started at 4 reads the same file from byte 4.
    const dir = mkdtempSync(path.join(tmpdir(), "usage-reader-"));
    temps.push(dir);
    const file = path.join(dir, "lines");
    writeFileSync(file, "one\ntwo\n");
    const fd = openSync(file, "r");
    try {
      const reader = new LineReader(fd, 4, 64, 64 * 1024);
      expect(reader.nextLine()).toMatchObject({ kind: "line", offset: 8 });
    } finally {
      closeSync(fd);
    }
  });

  it("freezes the production cap", () => {
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("parseRfc3339Ms", () => {
  it("parses the two timestamp shapes both CLIs actually write", () => {
    expect(parseRfc3339Ms("2026-08-10T04:45:59.358Z")).toBe(1_786_337_159_358);
    expect(parseRfc3339Ms("2026-08-10T05:06:00.351Z")).toBe(1_786_338_360_351);
  });

  it("parses the epoch and a leap day", () => {
    expect(parseRfc3339Ms("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseRfc3339Ms("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(parseRfc3339Ms("2024-02-29T12:00:00Z")).toBe(1_709_208_000_000);
    expect(parseRfc3339Ms("2023-02-29T12:00:00Z")).toBeNull();
  });

  it("truncates fractional seconds past milliseconds and pads short ones", () => {
    expect(parseRfc3339Ms("2026-08-10T04:45:59.3589999Z")).toBe(
      1_786_337_159_358,
    );
    expect(parseRfc3339Ms("2026-08-10T04:45:59.5Z")).toBe(1_786_337_159_500);
  });

  it("refuses anything that is not Zulu UTC", () => {
    expect(parseRfc3339Ms("2026-08-10T04:45:59+07:00")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10T04:45:59")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10T04:45:59.358")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10 04:45:59Z")).toBeNull();
    expect(parseRfc3339Ms("not a timestamp")).toBeNull();
    expect(parseRfc3339Ms("")).toBeNull();
  });

  it("refuses out-of-range fields, leap seconds and pre-epoch dates", () => {
    expect(parseRfc3339Ms("2026-13-01T00:00:00Z")).toBeNull();
    expect(parseRfc3339Ms("2026-00-01T00:00:00Z")).toBeNull();
    expect(parseRfc3339Ms("2026-08-32T00:00:00Z")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10T24:00:00Z")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10T00:60:00Z")).toBeNull();
    expect(parseRfc3339Ms("2026-08-10T00:00:60Z")).toBeNull();
    expect(parseRfc3339Ms("1969-12-31T23:59:59Z")).toBeNull();
  });

  it("anchors days_from_civil to the known dates", () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(1969, 12, 31)).toBe(-1);
    expect(daysFromCivil(2000, 3, 1)).toBe(11_017);
    expect(daysFromCivil(2024, 2, 29)).toBe(19_782);
  });
});
