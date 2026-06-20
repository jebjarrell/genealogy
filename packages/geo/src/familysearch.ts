import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';

export interface FamilySearchPlacesResolverOptions {
  /** Injected FamilySearch application key (the hosted/commercial swap point). */
  appKey?: string;
}

/**
 * DOCUMENTED STUB (TRD §8.2 / §8.4). Always resolves to `null` in this build.
 *
 * Future implementation:
 * - Calls the FamilySearch Places API, a free, genealogy-aware standardization
 *   service covering roughly 6 million standardized historical locations
 *   (jurisdictions as they existed at a given date, not just modern centroids).
 * - Authenticates with an injected application key (`options.appKey`), obtained
 *   from a FamilySearch developer account, so the secret stays out of source.
 * - Implements the exact same {@link PlaceResolver} interface, so it can be
 *   slotted into the {@link CachingResolver} chain ahead of Nominatim without
 *   any other code change. This is the primary hosted/commercial swap point for
 *   the place-resolution layer.
 * - On a hit it would return a {@link ResolvedPlace} with `source:
 *   'familysearch'` and high confidence (its results are standardized and
 *   genealogy-aware, so they outrank a Nominatim modern-centroid guess).
 */
export class FamilySearchPlacesResolver implements PlaceResolver {
  private readonly appKey: string | undefined;

  constructor(options: FamilySearchPlacesResolverOptions = {}) {
    this.appKey = options.appKey;
  }

  async resolve(_place: Place): Promise<ResolvedPlace | null> {
    // Stub: integration deferred (TRD §8.4). `appKey` is retained so the future
    // implementation can authenticate without a constructor change.
    void this.appKey;
    return null;
  }
}
