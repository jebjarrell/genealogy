import { describe, it, expect } from 'vitest';
import type { Place } from '@genealogy/core';
import { FamilySearchPlacesResolver } from '../src/familysearch.js';

const place: Place = {
  raw: 'Floyd, Kentucky, United States',
  normalized: 'floyd, kentucky, united states',
};

describe('FamilySearchPlacesResolver', () => {
  it('always returns null (documented stub for this build)', async () => {
    const resolver = new FamilySearchPlacesResolver();
    await expect(resolver.resolve(place)).resolves.toBeNull();
  });

  it('accepts an optional appKey without changing behavior', async () => {
    const resolver = new FamilySearchPlacesResolver({ appKey: 'abc123' });
    await expect(resolver.resolve(place)).resolves.toBeNull();
  });
});
