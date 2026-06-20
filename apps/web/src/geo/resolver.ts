import { NoOpResolver } from '@genealogy/geo';
import type { PlaceResolver } from '@genealogy/core';

// The single injected place resolver (TRD §8.3). In Step One this is a no-op
// (always resolves to null) — the graph view ignores coordinates entirely. The
// point of wiring it now is that Step Two swaps in a real resolver (static
// table → FamilySearch → Nominatim, via CachingResolver) and a map renderer
// WITHOUT touching anything built here: the seam is already in place.
//
// To activate place resolution later, replace this single binding, e.g.:
//   const table = new StaticTableResolver(seed);
//   export const placeResolver = new CachingResolver(table, [
//     new FamilySearchPlacesResolver({ appKey }),
//     new NominatimResolver({ userAgent }),
//   ]);
export const placeResolver: PlaceResolver = new NoOpResolver();
