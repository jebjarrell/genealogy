import { describe, it, expect } from 'vitest';
import type { Place } from '@genealogy/core';
import { StaticTableResolver } from '../src/static-table.js';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    raw: 'Floyd, Kentucky, United States',
    normalized: 'floyd, kentucky, united states',
    ...overrides,
  };
}

describe('StaticTableResolver', () => {
  it('returns a manual ResolvedPlace on a hit', async () => {
    const resolver = new StaticTableResolver({
      'floyd, kentucky, united states': {
        lat: 37.55,
        lon: -82.75,
        resolvedName: 'Floyd County, Kentucky, USA',
      },
    });

    const result = await resolver.resolve(makePlace());

    expect(result).not.toBeNull();
    expect(result).toEqual({
      lat: 37.55,
      lon: -82.75,
      source: 'manual',
      confidence: 1,
      resolvedName: 'Floyd County, Kentucky, USA',
    });
  });

  it('honors a per-entry confidence override', async () => {
    const resolver = new StaticTableResolver({
      x: { lat: 1, lon: 2, confidence: 0.8 },
    });

    const result = await resolver.resolve(makePlace({ normalized: 'x', raw: 'X' }));

    expect(result?.confidence).toBe(0.8);
  });

  it('falls back to place.raw when entry has no resolvedName', async () => {
    const resolver = new StaticTableResolver({
      x: { lat: 1, lon: 2 },
    });

    const result = await resolver.resolve(
      makePlace({ normalized: 'x', raw: 'Raw Name' }),
    );

    expect(result?.resolvedName).toBe('Raw Name');
  });

  it('returns null on a miss', async () => {
    const resolver = new StaticTableResolver();
    const result = await resolver.resolve(makePlace());
    expect(result).toBeNull();
  });

  it('defaults to an empty table', async () => {
    const resolver = new StaticTableResolver();
    expect(resolver.has('anything')).toBe(false);
  });

  it('supports set/has write-back used by the cache', async () => {
    const resolver = new StaticTableResolver();

    expect(resolver.has('paris, france')).toBe(false);
    resolver.set('paris, france', { lat: 48.85, lon: 2.35, resolvedName: 'Paris' });
    expect(resolver.has('paris, france')).toBe(true);

    const result = await resolver.resolve(
      makePlace({ normalized: 'paris, france', raw: 'Paris, France' }),
    );
    expect(result).toEqual({
      lat: 48.85,
      lon: 2.35,
      source: 'manual',
      confidence: 1,
      resolvedName: 'Paris',
    });
  });

  it('getTable returns a shallow copy that does not mutate internal state', () => {
    const resolver = new StaticTableResolver({ x: { lat: 1, lon: 2 } });

    const copy = resolver.getTable();
    expect(copy).toEqual({ x: { lat: 1, lon: 2 } });

    copy['y'] = { lat: 3, lon: 4 };
    expect(resolver.has('y')).toBe(false);
  });

  it('does not share the constructor table reference', () => {
    const seed = { x: { lat: 1, lon: 2 } };
    const resolver = new StaticTableResolver(seed);

    seed['x'] = { lat: 99, lon: 99 };
    expect(resolver.getTable()['x']).toEqual({ lat: 1, lon: 2 });
  });
});
