import { describe, it, expect } from 'vitest';
import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';
import { CachingResolver } from '../src/caching.js';
import { StaticTableResolver } from '../src/static-table.js';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    raw: 'Floyd, Kentucky, United States',
    normalized: 'floyd, kentucky, united states',
    ...overrides,
  };
}

/** A downstream resolver that returns a canned result and counts its calls. */
class CountingResolver implements PlaceResolver {
  calls = 0;
  constructor(private readonly result: ResolvedPlace | null) {}
  async resolve(_place: Place): Promise<ResolvedPlace | null> {
    this.calls += 1;
    return this.result;
  }
}

describe('CachingResolver', () => {
  it('serves a cache hit first without touching the chain', async () => {
    const cache = new StaticTableResolver({
      'floyd, kentucky, united states': { lat: 37.5, lon: -82.7 },
    });
    const downstream = new CountingResolver({
      lat: 1,
      lon: 2,
      source: 'nominatim',
      confidence: 0.5,
    });

    const resolver = new CachingResolver(cache, [downstream]);
    const result = await resolver.resolve(makePlace());

    expect(result?.source).toBe('manual');
    expect(result?.lat).toBe(37.5);
    expect(downstream.calls).toBe(0);
  });

  it('returns the first non-null hit from the chain in order', async () => {
    const cache = new StaticTableResolver();
    const miss = new CountingResolver(null);
    const hit = new CountingResolver({
      lat: 5,
      lon: 6,
      source: 'nominatim',
      confidence: 0.5,
      resolvedName: 'Somewhere',
    });
    const never = new CountingResolver({
      lat: 9,
      lon: 9,
      source: 'manual',
      confidence: 1,
    });

    const resolver = new CachingResolver(cache, [miss, hit, never]);
    const result = await resolver.resolve(makePlace());

    expect(result?.lat).toBe(5);
    expect(miss.calls).toBe(1);
    expect(hit.calls).toBe(1);
    expect(never.calls).toBe(0);
  });

  it('writes downstream resolutions back into the cache (resolved once, ever)', async () => {
    const cache = new StaticTableResolver();
    const downstream = new CountingResolver({
      lat: 12.34,
      lon: 56.78,
      source: 'nominatim',
      confidence: 0.5,
      resolvedName: 'Resolved Name',
    });

    const resolver = new CachingResolver(cache, [downstream]);

    const first = await resolver.resolve(makePlace());
    const second = await resolver.resolve(makePlace());

    // Downstream consulted exactly once across two resolves.
    expect(downstream.calls).toBe(1);

    // The cache now holds the normalized key.
    expect(cache.has('floyd, kentucky, united states')).toBe(true);

    // Both calls returned equal coordinates.
    expect(first?.lat).toBe(12.34);
    expect(first?.lon).toBe(56.78);
    expect(second?.lat).toBe(first?.lat);
    expect(second?.lon).toBe(first?.lon);

    // The cached read is reported as a manual (cache) hit on the second call.
    expect(second?.source).toBe('manual');
    expect(second?.resolvedName).toBe('Resolved Name');
  });

  it('writes back the entry with the downstream confidence and name', async () => {
    const cache = new StaticTableResolver();
    const downstream = new CountingResolver({
      lat: 1,
      lon: 2,
      source: 'nominatim',
      confidence: 0.42,
      resolvedName: 'Backed Up',
    });

    const resolver = new CachingResolver(cache, [downstream]);
    await resolver.resolve(makePlace());

    const entry = cache.getTable()['floyd, kentucky, united states'];
    expect(entry).toEqual({
      lat: 1,
      lon: 2,
      confidence: 0.42,
      resolvedName: 'Backed Up',
    });
  });

  it('returns null and writes nothing when nothing resolves', async () => {
    const cache = new StaticTableResolver();
    const a = new CountingResolver(null);
    const b = new CountingResolver(null);

    const resolver = new CachingResolver(cache, [a, b]);
    const result = await resolver.resolve(makePlace());

    expect(result).toBeNull();
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
    expect(cache.has('floyd, kentucky, united states')).toBe(false);
  });
});
