import { describe, it, expect } from 'vitest';
import type { Place } from '@genealogy/core';
import { NoOpResolver } from '../src/noop.js';

const place: Place = {
  raw: 'Floyd, Kentucky, United States',
  normalized: 'floyd, kentucky, united states',
};

describe('NoOpResolver', () => {
  it('always returns null', async () => {
    const resolver = new NoOpResolver();
    await expect(resolver.resolve(place)).resolves.toBeNull();
  });
});
