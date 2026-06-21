// GEDCOM PLAC is a free-text, comma-delimited hierarchy, e.g.
// "Floyd, Kentucky, United States". Resolution to coordinates is OPTIONAL
// and, in Step One, not performed during graph work (TRD §5.2, §8).

export type PlaceResolutionSource =
  | 'manual'
  | 'familysearch'
  | 'nominatim'
  | 'photon';

export interface ResolvedPlace {
  lat: number;
  lon: number;
  source: PlaceResolutionSource;
  /**
   * 0–1; a Nominatim guess on a historical jurisdiction is worth less than a
   * verified or FamilySearch-standardized hit.
   */
  confidence: number;
  /** The canonical name the resolver matched. */
  resolvedName?: string;
}

export interface Place {
  /** Verbatim PLAC string (the cache key). Never dropped. */
  raw: string;
  /** Trimmed/case-folded form used for lookup. */
  normalized: string;
  /** Split hierarchy, most-specific first. */
  parts?: string[];
  /** Present only once a resolver has run. */
  resolved?: ResolvedPlace;
}
