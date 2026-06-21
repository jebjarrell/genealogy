import { describe, it, expect, vi } from 'vitest';
import type { Place } from '@genealogy/core';
import { NominatimResolver } from '../src/nominatim.js';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    raw: 'Floyd, Kentucky, United States',
    normalized: 'floyd, kentucky, united states',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NominatimResolver', () => {
  it('returns a nominatim ResolvedPlace on a hit', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          lat: '37.5',
          lon: '-82.7',
          display_name: 'Floyd County, Kentucky, USA',
          importance: 0.42,
        },
      ]),
    );

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(makePlace());

    expect(result).not.toBeNull();
    expect(result?.source).toBe('nominatim');
    expect(result?.lat).toBeCloseTo(37.5);
    expect(result?.lon).toBeCloseTo(-82.7);
    expect(result?.confidence).toBeCloseTo(0.42);
    expect(result?.resolvedName).toBe('Floyd County, Kentucky, USA');
  });

  it('falls back to 0.5 confidence when no importance is present', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ lat: '1', lon: '2', display_name: 'Somewhere' }]),
    );

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(makePlace());
    expect(result?.confidence).toBe(0.5);
  });

  it('returns null on an empty result array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(makePlace());
    expect(result).toBeNull();
  });

  it('returns null on an HTTP error status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 500));

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve(makePlace());
    expect(result).toBeNull();
  });

  it('returns null when fetch rejects (never throws out of resolve)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    await expect(resolver.resolve(makePlace())).resolves.toBeNull();
  });

  it('sends a custom User-Agent header and the expected query params', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse([{ lat: '1', lon: '2', display_name: 'X' }]);
    });

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      baseUrl: 'https://example.test/search',
    });

    await resolver.resolve(makePlace());

    expect(capturedUrl).toContain('https://example.test/search');
    expect(capturedUrl).toContain('format=jsonv2');
    expect(capturedUrl).toContain('limit=1');
    // URLSearchParams form-encodes spaces as '+', which Nominatim accepts.
    expect(capturedUrl).toContain('Floyd%2C+Kentucky%2C+United+States');

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('User-Agent')).toBe('genealogy-test/1.0');
  });

  it('joins parts when raw is absent-ish but parts exist', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse([{ lat: '1', lon: '2', display_name: 'X' }]);
    });

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    await resolver.resolve(
      makePlace({ raw: '', parts: ['Floyd', 'Kentucky', 'United States'] }),
    );

    expect(capturedUrl).toContain('Floyd%2C+Kentucky%2C+United+States');
  });

  it('coarsens the query when a precise locality misses', async () => {
    const queries: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q') ?? '';
      queries.push(q);
      // Miss on the county; hit only once it falls back to the state.
      if (q.startsWith('Fleming County')) return jsonResponse([]);
      return jsonResponse([{ lat: '37.8', lon: '-83.6', display_name: q }]);
    });

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
    });

    const result = await resolver.resolve({
      raw: 'Fleming Co., KY, Kentucky, USA',
      normalized: 'fleming co., ky, kentucky, usa',
      parts: ['Fleming Co.', 'KY', 'Kentucky', 'USA'],
    });

    expect(result?.resolvedName).toBe('Kentucky, United States');
    expect(queries[0]).toBe('Fleming County, Kentucky, United States');
    expect(queries[1]).toBe('Kentucky, United States');
  });

  it('enforces the minimum interval between requests', async () => {
    const calls: number[] = [];
    const fetchImpl = vi.fn(async () => {
      calls.push(Date.now());
      return jsonResponse([{ lat: '1', lon: '2', display_name: 'X' }]);
    });

    const resolver = new NominatimResolver({
      userAgent: 'genealogy-test/1.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 30,
    });

    await resolver.resolve(makePlace());
    await resolver.resolve(makePlace());

    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(25);
  });
});
