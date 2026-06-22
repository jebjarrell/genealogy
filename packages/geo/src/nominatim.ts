import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';
import { placeQueryCandidates, type QueryResult } from './place-query.js';
import { globalFetch } from './fetch.js';

export interface NominatimResolverOptions {
  /** Required by the Nominatim usage policy; identifies this application. */
  userAgent: string;
  /** Injectable for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Search endpoint. Defaults to the public OSM Nominatim instance. */
  baseUrl?: string;
  /** Minimum spacing between requests (usage policy: ~1 req/sec). */
  minIntervalMs?: number;
}

/** Shape of the fields we read from a Nominatim `jsonv2` search result. */
interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  importance?: number;
}

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_CONFIDENCE = 0.5;

/**
 * Resolves free-text places via OpenStreetMap Nominatim (TRD §8.2). This is a
 * fallback for places not in the static table.
 *
 * NOTE: Nominatim resolves a historical jurisdiction (e.g. an antebellum county
 * boundary) to the *modern* centroid of the matched name, so resolutions here
 * are reported with a deliberately low confidence (~0.5).
 *
 * The Nominatim usage policy requires a descriptive `User-Agent` and at most
 * ~1 request/second; both are enforced here.
 */
export class NominatimResolver implements PlaceResolver {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;

  /** Promise chain that serializes requests and spaces them out. */
  private gate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: NominatimResolverOptions) {
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl ?? globalFetch();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  async resolve(place: Place): Promise<ResolvedPlace | null> {
    // Try cleaned, progressively coarser queries until one resolves; messy real
    // PLAC strings ("Fleming Co., KY, Kentucky, USA") rarely match verbatim.
    // Coarsen on a genuine MISS (200 + no results); bail on a provider ERROR
    // (HTTP/network) so the caller's fallback chain runs without wading through
    // every candidate against an unavailable service.
    const candidates = placeQueryCandidates(place);
    if (candidates.length === 0) candidates.push(place.normalized);
    for (const query of candidates) {
      const r = await this.resolveQuery(query);
      if (r.kind === 'hit') return r.place;
      if (r.kind === 'error') return null;
    }
    return null;
  }

  /** Geocode a single free-text query string (one throttled request). */
  private async resolveQuery(query: string): Promise<QueryResult> {
    try {
      await this.throttle();

      const url = new URL(this.baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');

      const response = await this.fetchImpl(url.toString(), {
        headers: { 'User-Agent': this.userAgent },
      });

      if (!response.ok) {
        return { kind: 'error' };
      }

      const body: unknown = await response.json();
      if (!Array.isArray(body) || body.length === 0) {
        return { kind: 'miss' };
      }

      const first = body[0] as NominatimResult;
      if (first.lat === undefined || first.lon === undefined) {
        return { kind: 'miss' };
      }

      const lat = Number.parseFloat(first.lat);
      const lon = Number.parseFloat(first.lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return { kind: 'miss' };
      }

      const confidence =
        typeof first.importance === 'number' &&
        first.importance >= 0 &&
        first.importance <= 1
          ? first.importance
          : DEFAULT_CONFIDENCE;

      return {
        kind: 'hit',
        place: {
          lat,
          lon,
          source: 'nominatim',
          confidence,
          resolvedName: first.display_name,
        },
      };
    } catch {
      // Never throw out of resolve: a network failure is a provider error.
      return { kind: 'error' };
    }
  }

  /**
   * Serialize requests through a promise chain and ensure at least
   * `minIntervalMs` elapses between consecutive calls.
   */
  private throttle(): Promise<void> {
    const wait = this.gate.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestAt;
      const remaining = this.minIntervalMs - elapsed;
      if (remaining > 0) {
        await delay(remaining);
      }
      this.lastRequestAt = Date.now();
    });
    // Swallow rejections on the gate so one failure can't poison the chain.
    this.gate = wait.catch(() => undefined);
    return wait;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
