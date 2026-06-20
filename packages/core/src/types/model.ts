import type { Person } from './persons.js';
import type { Family } from './families.js';
import type { Event } from './events.js';
import type { Place } from './places.js';

export interface ParseWarning {
  severity: 'warning' | 'info';
  message: string;
  /** e.g. the offending line or xref. */
  context?: string;
}

export interface GenealogyModel {
  persons: Map<string, Person>;
  families: Map<string, Family>;
  events: Map<string, Event>;
  /** Keyed by Place.normalized. */
  places: Map<string, Place>;
  warnings: ParseWarning[];
  /** GEDCOM HEAD metadata, when present. */
  header?: {
    sourceSystem?: string;
    gedcomVersion?: string;
    /** If the file declares a root/home person. */
    rootPersonId?: string;
    charset?: string;
  };
}
