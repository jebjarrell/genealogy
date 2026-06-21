import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';
import {
  CachingResolver,
  NominatimResolver,
  PhotonResolver,
  StaticTableResolver,
  type StaticTableEntry,
} from '@genealogy/geo';

// The injected place resolver (TRD §8.3), now activated for the migration map.
// Chain: a persistent local cache (StaticTableResolver backed by localStorage) →
// OpenStreetMap Nominatim. Each unique place is geocoded over the network at most
// once, ever; results are written back into the cache and persisted.
//
// Privacy note (logged in DEVIATIONS.md): geocoding sends PLACE NAMES (not the
// file) to OpenStreetMap. Browsers drop the User-Agent header, so Nominatim
// identifies the app via Origin/Referer; we honour the usage policy with a ≥1s
// rate limit and aggressive caching.

const CACHE_KEY = 'genealogy:placeCache';
const USER_AGENT = 'GenealogyKnowledgeGraphViewer/1.0 (local desktop tool)';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function loadTable(storage: StorageLike | undefined): Record<string, StaticTableEntry> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StaticTableEntry>) : {};
  } catch {
    return {};
  }
}

function saveTable(
  storage: StorageLike | undefined,
  table: Record<string, StaticTableEntry>,
): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(table));
  } catch {
    /* quota or unavailable — ignore */
  }
}

export interface GeocoderOptions {
  fetchImpl?: typeof fetch;
  storage?: StorageLike;
  minIntervalMs?: number;
}

/**
 * Build a persistent, caching geocoder. Injectable for tests (fake fetch +
 * in-memory storage); the default export uses the global fetch and localStorage.
 */
export function createGeocoder(options: GeocoderOptions = {}): PlaceResolver {
  const storage = options.storage ?? getDefaultStorage();
  const cache = new StaticTableResolver(loadTable(storage));
  const nominatim = new NominatimResolver({
    userAgent: USER_AGENT,
    fetchImpl: options.fetchImpl,
    minIntervalMs: options.minIntervalMs ?? 1100,
  });
  // Photon (komoot) is CORS-friendly and needs no User-Agent, so it resolves
  // from the browser even when the public Nominatim rate-limits or blocks us.
  const photon = new PhotonResolver({
    fetchImpl: options.fetchImpl,
    minIntervalMs: options.minIntervalMs ?? 1100,
  });
  const chain = new CachingResolver(cache, [nominatim, photon]);

  return {
    async resolve(place: Place): Promise<ResolvedPlace | null> {
      const cachedBefore = cache.has(place.normalized);
      const result = await chain.resolve(place);
      // Persist only when the cache actually grew (a fresh downstream hit).
      if (!cachedBefore && result) saveTable(storage, cache.getTable());
      return result;
    },
  };
}

export const placeResolver: PlaceResolver = createGeocoder();
