import { describe, expect, it } from 'vitest';
import {
  applyEol,
  BINARY_REFUSAL,
  decodeUtf8,
  detectEol,
  encodingLabel,
  eolLabel,
  INVALID_UTF8_REASON,
  looksBinary,
  MAX_EDITABLE_BYTES,
  normalizeEol,
  readFileContent,
} from './file-content';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('looksBinary', () => {
  it('refuses on a NUL byte in the first block', () => {
    expect(looksBinary(new Uint8Array([0x68, 0x00, 0x69]))).toBe(true);
    expect(looksBinary(encode('hello\n'))).toBe(false);
  });

  it('only inspects the first block, so a late NUL is not sniffed', () => {
    const bytes = new Uint8Array(9000);
    bytes.fill(0x61);
    bytes[8500] = 0;
    expect(looksBinary(bytes)).toBe(false);
  });
});

describe('detectEol', () => {
  it('keeps the dominant ending of a mixed file and records the mixing', () => {
    expect(detectEol('a\r\nb\r\nc\nd')).toEqual({ eol: 'crlf', mixed: true });
    expect(detectEol('a\nb\nc\r\nd')).toEqual({ eol: 'lf', mixed: true });
  });

  it('is LF for a file with no ending at all', () => {
    expect(detectEol('no newline')).toEqual({ eol: 'lf', mixed: false });
  });

  it('is CRLF only when CRLF is present', () => {
    expect(detectEol('a\r\nb')).toEqual({ eol: 'crlf', mixed: false });
    expect(detectEol('a\nb')).toEqual({ eol: 'lf', mixed: false });
  });
});

describe('normalizeEol / applyEol', () => {
  it('round-trips CRLF through the editor without rewriting it', () => {
    const onDisk = 'one\r\ntwo\r\n';
    const inEditor = normalizeEol(onDisk);
    expect(inEditor).toBe('one\ntwo\n');
    expect(applyEol(inEditor, 'crlf')).toBe(onDisk);
  });

  it('never doubles a carriage return when the text already has one', () => {
    expect(applyEol('a\r\nb', 'crlf')).toBe('a\r\nb');
  });

  it("normalizes to LF when the file's ending is LF", () => {
    expect(applyEol('a\r\nb', 'lf')).toBe('a\nb');
  });
});

describe('decodeUtf8', () => {
  it('reports valid UTF-8 as valid', () => {
    expect(decodeUtf8(encode('héllo — ok'))).toEqual({
      text: 'héllo — ok',
      encoding: 'utf-8',
    });
  });

  it('flags invalid UTF-8 and still returns readable text', () => {
    const result = decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]));
    expect(result.encoding).toBe('invalid-utf-8');
    expect(result.text).toContain('a');
    expect(result.text).toContain('b');
  });
});

describe('readFileContent', () => {
  it('returns editable text for an ordinary UTF-8 file', () => {
    const result = readFileContent(encode('const a = 1;\n'));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.content).toBe('const a = 1;\n');
    expect(result.file.readOnly).toBe(false);
    expect(result.file.reason).toBeNull();
    expect(result.file.eol).toBe('lf');
    expect(result.file.encoding).toBe('utf-8');
  });

  it('refuses binary content with a stated reason', () => {
    const result = readFileContent(new Uint8Array([0x50, 0x4b, 0x00, 0x01]));
    expect(result).toEqual({ kind: 'refused', reason: BINARY_REFUSAL });
  });

  it('opens an oversize file read-only with a stated reason', () => {
    const bytes = new Uint8Array(MAX_EDITABLE_BYTES + 1);
    bytes.fill(0x61);
    const result = readFileContent(bytes);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.readOnly).toBe(true);
    expect(result.file.reason).toContain('read-only');
    expect(result.file.reason).toContain('MB');
  });

  it('opens invalid UTF-8 read-only with a stated reason', () => {
    const result = readFileContent(new Uint8Array([0x61, 0xff]));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.readOnly).toBe(true);
    expect(result.file.reason).toBe(INVALID_UTF8_REASON);
  });

  it('checks binary BEFORE decoding, so entropy is never decoded', () => {
    // A NUL alongside invalid UTF-8: the refusal wins, which is what keeps a
    // 40 MB binary from being decoded to be rejected afterwards.
    const result = readFileContent(new Uint8Array([0xff, 0x00, 0xfe]));
    expect(result.kind).toBe('refused');
  });

  it('records a mixed-ending decision rather than guessing silently', () => {
    const result = readFileContent(encode('a\r\nb\r\nc\n'));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.mixedEol).toBe(true);
    expect(result.file.eol).toBe('crlf');
  });
});

describe('status labels', () => {
  it('spells encoding and ending for the status bar', () => {
    const result = readFileContent(encode('a\r\n'));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(eolLabel(result.file)).toBe('CRLF');
    expect(encodingLabel(result.file)).toBe('UTF-8');
    const invalid = readFileContent(new Uint8Array([0xff]));
    if (invalid.kind !== 'ok') throw new Error('expected ok');
    expect(encodingLabel(invalid.file)).toBe('UTF-8 (invalid)');
  });
});
