import { describe, expect, it } from 'vitest';
import { generatedFilePath, generatedTextMatches, rustfmtArguments } from './generated-text';

describe('generatedTextMatches', () => {
  it('treats LF and CRLF as the same generated content', () => {
    expect(generatedTextMatches('first\nsecond\n', 'first\r\nsecond\r\n')).toBe(true);
  });

  it('still detects real generated content drift', () => {
    expect(generatedTextMatches('first\nsecond\n', 'first\nchanged\n')).toBe(false);
  });

  it('formats generated Rust with the crate edition', () => {
    expect(rustfmtArguments('fresh-menu_registry.rs', 'committed-menu_registry.rs')).toEqual([
      '--edition',
      '2021',
      'fresh-menu_registry.rs',
      'committed-menu_registry.rs',
    ]);
  });

  it('converts a Windows file URL to a native drive path', () => {
    expect(generatedFilePath(new URL('file:///D:/repo/src-tauri/src/menu_registry.rs'), true)).toBe(
      'D:\\repo\\src-tauri\\src\\menu_registry.rs',
    );
  });
});
