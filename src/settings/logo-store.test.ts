import { describe, expect, it } from 'vitest';
import { isSupportedImagePath, pickImagePath, validateLogoDataUrl } from './logo-store';

describe('isSupportedImagePath', () => {
  it('accepts allowlisted extensions, case-insensitively', () => {
    expect(isSupportedImagePath('/a/logo.png')).toBe(true);
    expect(isSupportedImagePath('/a/logo.PNG')).toBe(true);
    expect(isSupportedImagePath('/a/pic.JPEG')).toBe(true);
    expect(isSupportedImagePath('/a/mark.svg')).toBe(true);
    expect(isSupportedImagePath('/a/mark.webp')).toBe(true);
  });

  it('rejects other or missing extensions', () => {
    expect(isSupportedImagePath('/a/anim.gif')).toBe(false);
    expect(isSupportedImagePath('/a/README')).toBe(false);
    expect(isSupportedImagePath('/a/archive.png.zip')).toBe(false);
  });
});

describe('pickImagePath', () => {
  it('returns the first supported image in the list', () => {
    expect(pickImagePath(['/a.txt', '/b.jpg', '/c.png'])).toBe('/b.jpg');
  });

  it('returns null when nothing qualifies', () => {
    expect(pickImagePath(['/a.txt', '/b.pdf'])).toBeNull();
    expect(pickImagePath([])).toBeNull();
  });
});

describe('validateLogoDataUrl', () => {
  it('keeps a real image data URL', () => {
    expect(validateLogoDataUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('rejects anything that is not an image data URL', () => {
    expect(validateLogoDataUrl('http://example.com/x.png')).toBe('');
    expect(validateLogoDataUrl('data:text/plain;base64,AAAA')).toBe('');
    expect(validateLogoDataUrl(null)).toBe('');
    expect(validateLogoDataUrl(123)).toBe('');
  });
});
