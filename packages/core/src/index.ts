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
export { getAncestors, getDescendants, getSiblings } from './graph/traversal.js';
export { computeGenerations } from './graph/generations.js';

// ---- Paths, collapse & common ancestors (centerpiece; TRD §6, §7.3) ----
export {
  enumeratePaths,
  enumerateRelationshipPaths,
  enumerateAncestralPaths,
  DEFAULT_MAX_PATHS,
  DEFAULT_MAX_DEPTH,
} from './graph/paths.js';
export type { EnumeratePathsOptions, PathEnumeration } from './graph/paths.js';
export { detectPedigreeCollapse } from './graph/collapse.js';
export type { CollapsePoint, DetectCollapseOptions } from './graph/collapse.js';
export { findCommonAncestors } from './graph/common-ancestors.js';
export type { CommonAncestor } from './graph/common-ancestors.js';

// ---- View construction (TRD §6, §10) -----------------------------------
export { getEgoNetwork } from './graph/ego-network.js';
export type { EgoNetworkOptions } from './graph/ego-network.js';
export { expandPerson } from './graph/expand.js';
export { pickDefaultFocalPerson } from './graph/focal.js';
export { extractEventSequence } from './graph/event-sequence.js';
export type { LocatedEvent } from './graph/event-sequence.js';

// ---- Relationship description (TRD §9) ----------------------------------
export {
  describeRelationship,
  describeAncestorByGenerations,
  describeDescendantByGenerations,
} from './relationship/describe.js';
export {
  ordinal,
  ordinalWord,
  removalWord,
  greatPrefix,
} from './relationship/ordinals.js';

// ---- Military service & war classification (profile + analytics) ---------
export { WAR_ERAS, classifyWar, militaryServiceOf } from './military/wars.js';
export type { WarEra, MilitaryService } from './military/wars.js';
export {
  standardizeMilitaryEvent,
  militaryServiceRecords,
} from './military/standardize.js';
export type { MilitaryServiceRecord } from './military/standardize.js';

// ---- Edit layer: non-destructive person merge (op-log overlay) -----------
export { mergePersons, applyMerges } from './edit/merge.js';
export type { MergeOp } from './edit/merge.js';

// ---- Edit layer: unified op-log (merge + manual add/edit; op-log fidelity) ----
export { applyOp, applyOps } from './edit/ops.js';
export type {
  EditOp,
  MergeEditOp,
  AddPersonOp,
  EditPersonOp,
  AddEventOp,
  EditEventOp,
  LinkRelationshipOp,
  UnlinkRelationshipOp,
} from './edit/ops.js';

// ---- SAR proof checklist + lineage-society rules + SAR formatting ----------
export { SAR_RULES, SOCIETY_RULES } from './sar/rules.js';
export type { SocietyRules, ProofStatus } from './sar/rules.js';
export {
  SERVICE_KEY,
  linkKey,
  serviceCitation,
  generateChecklistStructure,
  evaluateChecklist,
} from './sar/checklist.js';
export type {
  LineageLink,
  ChecklistStructure,
  DocumentProof,
  RecordCopyProof,
  Proof,
  RecordCopyRef,
  LinkEvaluation,
  ServiceEvaluation,
  ChecklistEvaluation,
} from './sar/checklist.js';
export { formatSarDate, formatSarPlace, toStateAbbr } from './sar/format.js';

// ---- Locality research report (where to dig next; collapse-safe) -----------
export { buildLocalityReport, localityReportToMarkdown } from './research/locality.js';
export type {
  CitationStatus,
  LocalityFact,
  LocalityRow,
  LocalityReport,
} from './research/locality.js';

// ---- Data export (derived GEDCOM + lossless JSON) ------------------------
export { writeGedcom } from './export/gedcom.js';
export { exportModelJson } from './export/json.js';
export type { ExportedModelJson } from './export/json.js';

// ---- Profile bio sketch -------------------------------------------------
export { personSketch } from './profile/sketch.js';
export type { PersonSketch, SketchEvent, SketchSpouse } from './profile/sketch.js';

// ---- Family analytics ---------------------------------------------------
export { computeFamilyStats } from './analytics/family-stats.js';
export type {
  FamilyStats,
  Longevity,
  RegionTally,
  FamilySize,
  WarTally,
} from './analytics/family-stats.js';

// ---- Place resolution seam (TRD §8.1) ----------------------------------
export type { PlaceResolver } from './geo/index.js';
export {
  findParentChildFamily,
  coParentsOf,
  findSpouseFamily,
} from './graph/family-link.js';
export {
  candidateFamiliesForChild,
  candidateFamiliesForParent,
} from './edit/link-targets.js';
export type { FamilyCandidate } from './edit/link-targets.js';
export { checkParentChildLink, checkSpouseLink } from './edit/link-validation.js';
export type { LinkIssue, LinkSeverity } from './edit/link-validation.js';
export { firstEvent, eventYear } from './model/person-events.js';
