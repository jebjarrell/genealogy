import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';
import type { StaticTableResolver } from './static-table.js';

/**
 * Composes an ordered chain of resolvers and returns the FIRST non-null hit
 * (TRD §8.2). A {@link StaticTableResolver} acts as the cache and is always
 * checked first; on a hit from a DOWNSTREAM resolver, the result is written
 * back into that cache so each unique place is resolved over the network at
 * most once, ever.
 *
 * The caller composes `chain`; the recommended order per the TRD is
 * FamilySearch → Nominatim (the static table is the `cache`, checked first).
 */
export class CachingResolver implements PlaceResolver {
  constructor(
    private readonly cache: StaticTableResolver,
    private readonly chain: PlaceResolver[],
  ) {}

  async resolve(place: Place): Promise<ResolvedPlace | null> {
    // 1. Cache first. A hit is already persisted, so no write-back is needed.
    const cached = await this.cache.resolve(place);
    if (cached !== null) {
      return cached;
    }

    // 2. Walk the chain in order; first non-null wins.
    for (const resolver of this.chain) {
      const result = await resolver.resolve(place);
      if (result !== null) {
        // 3. Write back so the next resolve of this place is served from cache
        //    without re-consulting any downstream resolver.
        this.cache.set(place.normalized, {
          lat: result.lat,
          lon: result.lon,
          confidence: result.confidence,
          resolvedName: result.resolvedName,
        });
        return result;
      }
    }

    return null;
  }
}
