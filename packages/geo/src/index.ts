// @genealogy/geo — resolver implementations behind core's PlaceResolver
// interface. Network-touching place-resolution layer (TRD §8.2).

export { StaticTableResolver } from './static-table.js';
export type { StaticTableEntry } from './static-table.js';
export { NominatimResolver } from './nominatim.js';
export { FamilySearchPlacesResolver } from './familysearch.js';
export { CachingResolver } from './caching.js';
export { NoOpResolver } from './noop.js';

// Re-export the core interface for convenience.
export type { PlaceResolver } from '@genealogy/core';
