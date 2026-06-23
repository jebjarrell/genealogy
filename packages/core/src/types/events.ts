import type { GenealogicalDate } from './dates.js';
import type { Place } from './places.js';
import type { SourceCitation } from './sources.js';

// Events are first-class entities, NOT edges on people (TRD §5.2).

export type EventType =
  | 'birth'
  | 'death'
  | 'marriage'
  | 'burial'
  | 'baptism'
  | 'census'
  | 'residence'
  | 'immigration'
  | 'emigration'
  | 'military'
  | 'occupation'
  | 'other';

export interface Event {
  id: string;
  type: EventType;
  /** Original GEDCOM tag (BIRT, MARR, RESI, ...). */
  rawTag: string;
  date?: GenealogicalDate;
  place?: Place;
  /** Person ids; 1 for births/deaths, 2 for marriages, etc. */
  participants: string[];
  description?: string;
  sources: SourceCitation[];
  /** True when added/edited by the user (edit layer); never set by the parser. */
  userSupplied?: boolean;
}
