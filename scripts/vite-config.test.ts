import { describe, expect, it } from 'vitest';
import configExport from '../vite.config';

describe('production minification', () => {
  it("uses Terser to preserve xterm's requestMode enum binding", async () => {
    if (typeof configExport !== 'function') {
      throw new TypeError('Expected vite.config.ts to export a config factory');
    }
    const config = await configExport({
      command: 'build',
      mode: 'production',
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.build?.minify).toBe('terser');
  });
});
