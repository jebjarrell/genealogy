import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';
import { placeQueryCandidates, type QueryResult } from './place-query.js';
import { globalFetch } from './fetch.js';

export interface PhotonResolverOptions {
  /** Injectable for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Search endpoint. Defaults to the public komoot Photon instance. */
  baseUrl?: string;
  /** Minimum spacing between requests. */
  minIntervalMs?: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; city?: string; state?: string; country?: string };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

const DEFAULT_BASE_URL = 'https://photon.komoot.io/api';
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_CONFIDENCE = 0.45;

/**
 * Geocodes free-text places via komoot's Photon (an OSM-based search geocoder).
 * Unlike the main OSM Nominatim instance, Photon is CORS-friendly and does not
 * require a `User-Agent`, so it works reliably from the browser — making it a
 * good fallback when Nominatim is rate-limited or blocked.
 *
 * Like Nominatim here, it tries progressively coarser query candidates and
 * reports coordinates with a deliberately modest confidence (historical
 * jurisdictions resolve to a modern centroid).
 */
export class PhotonResolver implements PlaceResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;

  private gate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: PhotonResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalFetch();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  async resolve(place: Place): Promise<ResolvedPlace | null> {
    const candidates = placeQueryCandidates(place);
    if (candidates.length === 0) candidates.push(place.normalized);
    for (const query of candidates) {
      const r = await this.resolveQuery(query);
      if (r.kind === 'hit') return r.place;
      if (r.kind === 'error') return null;
    }
    return null;
  }

  private async resolveQuery(query: string): Promise<QueryResult> {
    try {
      await this.throttle();

      const url = new URL(this.baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '1');

      const response = await this.fetchImpl(url.toString());
      if (!response.ok) {
        return { kind: 'error' };
      }

      const body = (await response.json()) as PhotonResponse;
      const feature = body.features?.[0];
      const coords = feature?.geometry?.coordinates;
      if (!coords || coords.length < 2) {
        return { kind: 'miss' };
      }

      const [lon, lat] = coords;
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return { kind: 'miss' };
      }

      return {
        kind: 'hit',
        place: {
          lat,
          lon,
          source: 'photon',
          confidence: DEFAULT_CONFIDENCE,
          resolvedName: photonName(feature),
        },
      };
    } catch {
      return { kind: 'error' };
    }
  }

  private throttle(): Promise<void> {
    const wait = this.gate.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      const remaining = this.minIntervalMs - elapsed;
      if (remaining > 0) await delay(remaining);
      this.lastRequestAt = Date.now();
    });
    this.gate = wait.catch(() => undefined);
    return wait;
  }
}

function photonName(feature: PhotonFeature): string | undefined {
  const p = feature.properties ?? {};
  const parts = [p.name ?? p.city, p.state, p.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
