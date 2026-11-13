import { describe, expect, it } from 'vitest';
import { brandColor, localBrandAsset } from './index';

describe('public branding configuration', () => {
  it('accepts only same-origin static asset paths', () => {
    expect(localBrandAsset('/brand/logo.svg')).toBe('/brand/logo.svg');
    for (const value of ['https://other.test/logo.svg', '//other.test/a', '/../../secret', '/logo.svg?token=secret', 'javascript:alert(1)']) {
      expect(localBrandAsset(value)).toBeUndefined();
    }
  });
  it('rejects CSS payloads and accepts hex colors', () => {
    expect(brandColor('#1a2B3c')).toBe('#1a2B3c');
    expect(brandColor('red; background:url(https://other.test)')).toBe('#7c3aed');
  });
});
