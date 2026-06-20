import { describe, it, expect } from 'vitest';
import type { Place } from '@genealogy/core';
import { placeResolver } from './resolver.js';

// The Step Two seam (TRD §8.3): the app injects a resolver behind the interface.
// In Step One it is a no-op, so resolution returns null and the graph ignores it.
describe('injected place resolver', () => {
  it('is wired and resolves to null in Step One (no-op)', async () => {
    const place: Place = {
      raw: 'Floyd, Kentucky, United States',
      normalized: 'floyd, kentucky, united states',
    };
    await expect(placeResolver.resolve(place)).resolves.toBeNull();
  });
});
