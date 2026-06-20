// Public API of @genealogy/core (TRD §6). All functions are synchronous and
// pure unless noted. Place resolution is the only asynchronous, side-effecting
// concern and is handled via the injected PlaceResolver (TRD §8).
//
// Implementations are added phase by phase (TRD §12 build order). This barrel
// grows as each unit lands green.

// ---- Types (TRD §5) ----------------------------------------------------
export type * from './types/index.js';

// ---- Parsing (TRD §6, §7) ----------------------------------------------
// Adapter over the third-party GEDCOM parser. Produces the normalized model.
// Never throws on malformed input; collects warnings instead.
export { parseGedcom } from './gedcom/parse.js';

// ---- Place resolution seam (TRD §8.1) ----------------------------------
export type { PlaceResolver } from './geo/index.js';
