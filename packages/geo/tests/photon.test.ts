import { describe, it, expect, vi } from 'vitest';
import type { Place } from '@genealogy/core';
import { PhotonResolver } from '../src/photon.js';

function place(raw: string, parts?: string[]): Place {
  return { raw, normalized: raw.toLowerCase(), ...(parts ? { parts } : {}) };
}

function featureCollection(lon: number, lat: number, props = {}) {
  return new Response(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [{ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props }],
    }),
    { status: 200 },
  );
}

describe('PhotonResolver', () => {
  it('parses GeoJSON [lon, lat] into a photon ResolvedPlace', async () => {
    const fetchImpl = vi.fn(async () =>
      featureCollection(-83.6, 37.8, { name: 'Fleming County', state: 'Kentucky', country: 'United States' }),
    );
    const resolver = new PhotonResolver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(place('Fleming County, Kentucky, United States'));
    expect(result).toMatchObject({ lat: 37.8, lon: -83.6, source: 'photon' });
    expect(result?.resolvedName).toBe('Fleming County, Kentucky, United States');
  });

  it('coarsens on a miss (empty features), then hits the state', async () => {
    const queries: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q') ?? '';
      queries.push(q);
      if (q.startsWith('Fleming County')) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      return featureCollection(-84, 37.5);
    });
    const resolver = new PhotonResolver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(
      place('Fleming Co., KY, Kentucky, USA', ['Fleming Co.', 'KY', 'Kentucky', 'USA']),
    );
    expect(result).not.toBeNull();
    expect(queries[0]).toBe('Fleming County, Kentucky, United States');
    expect(queries[1]).toBe('Kentucky, United States');
  });

  it('returns null on an HTTP error without coarsening (provider unavailable)', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const resolver = new PhotonResolver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    const result = await resolver.resolve(
      place('Fleming Co., KY, Kentucky, USA', ['Fleming Co.', 'KY', 'Kentucky', 'USA']),
    );
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // bailed, did not try coarser queries
  });

  it('never throws when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const resolver = new PhotonResolver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    await expect(resolver.resolve(place('Anywhere'))).resolves.toBeNull();
  });
});
