import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_BANNER,
  resolveSidebarBannerCustomImage,
  validateSidebarBannerState,
} from './sidebar-banner-store';

describe('validateSidebarBannerState', () => {
  it('keeps a valid built-in selection without mutating the input', () => {
    const raw = {
      enabled: true,
      selection: 'japan',
      customImage: '',
    } as const;

    expect(validateSidebarBannerState(raw)).toEqual(raw);
    expect(raw).toEqual({
      enabled: true,
      selection: 'japan',
      customImage: '',
    });
  });

  it('falls back when the persisted shape or selection is invalid', () => {
    expect(validateSidebarBannerState(null)).toEqual(DEFAULT_SIDEBAR_BANNER);
    expect(
      validateSidebarBannerState({
        enabled: 'yes',
        selection: 'unknown',
        customImage: 'https://example.com/banner.png',
      }),
    ).toEqual(DEFAULT_SIDEBAR_BANNER);
  });

  it('keeps custom only when it has an embedded image', () => {
    const customImage = 'data:image/png;base64,AAAA';
    expect(
      validateSidebarBannerState({
        enabled: true,
        selection: 'custom',
        customImage,
      }),
    ).toEqual({ enabled: true, selection: 'custom', customImage });

    expect(
      validateSidebarBannerState({
        enabled: true,
        selection: 'custom',
        customImage: '',
      }).selection,
    ).toBe('vietnam');
  });
});

describe('resolveSidebarBannerCustomImage', () => {
  it('returns data only for imported artwork', () => {
    expect(
      resolveSidebarBannerCustomImage({
        enabled: true,
        selection: 'vietnam',
        customImage: '',
      }),
    ).toBe('');
    expect(
      resolveSidebarBannerCustomImage({
        enabled: true,
        selection: 'custom',
        customImage: 'data:image/webp;base64,BBBB',
      }),
    ).toBe('data:image/webp;base64,BBBB');
  });
});
