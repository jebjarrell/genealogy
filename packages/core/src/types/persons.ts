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
}
