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

// ---- Graph construction & traversal (TRD §5.3, §6) ---------------------
export { buildGraph } from './graph/build.js';
export { getAncestors, getDescendants } from './graph/traversal.js';
export { computeGenerations } from './graph/generations.js';

// ---- Paths, collapse & common ancestors (centerpiece; TRD §6, §7.3) ----
export {
  enumeratePaths,
  enumerateRelationshipPaths,
  DEFAULT_MAX_PATHS,
  DEFAULT_MAX_DEPTH,
} from './graph/paths.js';
export type { EnumeratePathsOptions, PathEnumeration } from './graph/paths.js';
export { detectPedigreeCollapse } from './graph/collapse.js';
export type { CollapsePoint, DetectCollapseOptions } from './graph/collapse.js';
export { findCommonAncestors } from './graph/common-ancestors.js';
export type { CommonAncestor } from './graph/common-ancestors.js';

// ---- Place resolution seam (TRD §8.1) ----------------------------------
export type { PlaceResolver } from './geo/index.js';
