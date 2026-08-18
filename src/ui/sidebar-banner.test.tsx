// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SIDEBAR_BANNER, sidebarBanner } from '../settings/sidebar-banner-store';
import { SidebarBanner } from './sidebar-banner';

describe('SidebarBanner', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    sidebarBanner.value = DEFAULT_SIDEBAR_BANNER;
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    sidebarBanner.value = DEFAULT_SIDEBAR_BANNER;
  });

  it('does not occupy the rail when the feature is off', () => {
    act(() => render(<SidebarBanner />, host));
    expect(host.querySelector('.sidebar-banner')).toBeNull();
  });

  it('renders a built-in flag as non-interactive CSS artwork', () => {
    sidebarBanner.value = {
      enabled: true,
      selection: 'japan',
      customImage: '',
    };
    act(() => render(<SidebarBanner />, host));

    const banner = host.querySelector('.sidebar-banner');
    const artwork = banner?.querySelector<HTMLElement>('.sidebar-banner__art');
    expect(banner?.getAttribute('aria-hidden')).toBe('true');
    expect(banner?.classList.contains('sidebar-banner--woven')).toBe(true);
    expect(artwork?.style.background).toBe('rgb(255, 255, 255)');
    expect(banner?.querySelector('.sidebar-banner__mark--sun')).not.toBeNull();
    expect(banner?.querySelector('img')).toBeNull();
  });

  it('renders an imported image as non-draggable decoration', () => {
    sidebarBanner.value = {
      enabled: true,
      selection: 'custom',
      customImage: 'data:image/png;base64,AAAA',
    };
    act(() => render(<SidebarBanner />, host));

    const banner = host.querySelector('.sidebar-banner');
    const image = banner?.querySelector('img');
    expect(banner?.classList.contains('sidebar-banner--woven')).toBe(true);
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(image?.getAttribute('draggable')).toBe('false');
  });
});
