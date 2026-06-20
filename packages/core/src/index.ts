// Public API of @genealogy/core (TRD §6). All functions are synchronous and
// pure unless noted. Place resolution is the only asynchronous, side-effecting
// concern and is handled via the injected PlaceResolver (TRD §8).
//
// Implementations are added phase by phase (TRD §12 build order). This barrel
// grows as each unit lands green.

// ---- Types (TRD §5) ----------------------------------------------------
export type * from './types/index.js';

// ---- Place resolution seam (TRD §8.1) ----------------------------------
export type { PlaceResolver } from './geo/index.js';
