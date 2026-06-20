import type { Place, ResolvedPlace } from '../types/places.js';

// The PlaceResolver interface lives in core (types only). Core defines it and
// NEVER calls it during graph work. The app owns when (if ever, in Step One)
// resolution runs. This is the single network seam (TRD §4.3, §8.1).

export interface PlaceResolver {
  resolve(place: Place): Promise<ResolvedPlace | null>;
}
