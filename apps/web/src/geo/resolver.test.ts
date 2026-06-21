import { describe, it, expect, vi } from 'vitest';
import type { Place } from '@genealogy/core';
import { createGeocoder } from './resolver.js';

const place = (raw: string): Place => ({
  raw,
  normalized: raw.toLowerCase(),
  parts: raw.split(',').map((s) => s.trim()),
});

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

function nominatimResponse(lat: number, lon: number) {
  return new Response(
    JSON.stringify([
      { lat: String(lat), lon: String(lon), display_name: 'X', importance: 0.6 },
    ]),
    { status: 200 },
  );
}

describe('createGeocoder (the injected map resolver)', () => {
  it('geocodes a miss via fetch, then serves repeats from cache (one network call)', async () => {
    const fetchImpl = vi.fn(async () => nominatimResponse(37.5, -82.8));
    const storage = fakeStorage();
    const geocoder = createGeocoder({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
      minIntervalMs: 0,
    });

    const first = await geocoder.resolve(place('Floyd, Kentucky, United States'));
    expect(first).toMatchObject({ lat: 37.5, lon: -82.8, source: 'nominatim' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await geocoder.resolve(place('Floyd, Kentucky, United States'));
    expect(second).toMatchObject({ lat: 37.5, lon: -82.8 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // served from cache, no new call
  });

  it('persists resolved coordinates to storage', async () => {
    const fetchImpl = vi.fn(async () => nominatimResponse(10, 20));
    const storage = fakeStorage();
    const geocoder = createGeocoder({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
      minIntervalMs: 0,
    });
    await geocoder.resolve(place('Somewhere'));
    expect(storage._map.get('genealogy:placeCache')).toContain('somewhere');
  });

  it('returns null when the place cannot be geocoded', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 }));
    const geocoder = createGeocoder({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: fakeStorage(),
      minIntervalMs: 0,
    });
    expect(await geocoder.resolve(place('Nowhere'))).toBeNull();
  });
});
