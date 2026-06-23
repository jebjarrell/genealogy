import type { PersonName } from './names.js';
import type { SourceCitation } from './sources.js';

export type Sex = 'male' | 'female' | 'unknown';

export interface Person {
  /** xref without @, e.g. "I123". */
  id: string;
  /** full xref, e.g. "@I123@". */
  externalId: string;
  /** names[0] is primary. */
  names: PersonName[];
  sex: Sex;
  /** Events this person participates in. */
  eventIds: string[];
  /** FAMS — families where they are a spouse/parent. */
  familyIdsAsSpouse: string[];
  /** FAMC — the family they are a child in. */
  familyIdAsChild?: string;
  sources: SourceCitation[];
  notes?: string[];
  /**
   * Ids of person records merged into this one (provenance for the edit layer).
   * Present only on records that are the result of one or more merges.
   */
  mergedFromIds?: string[];
  /**
   * Provenance marker for the edit layer: true when this record was added or
   * edited by the user (manual entry) rather than coming verbatim from the
   * parsed GEDCOM. Drives the "user-supplied" badge in the UI. Additive: never
   * set by the parser, only by op-log replay (TRD §1.3 extension).
   */
  userSupplied?: boolean;
}
