import type { Place } from '../types/places.js';

// GEDCOM PLAC is a free-text, comma-delimited hierarchy, MOST-SPECIFIC FIRST,
// e.g. "Floyd, Kentucky, United States" (TRD §5.2 / §7.2). These helpers build
// a normalized Place for lookup/dedup. No coordinate resolution is performed
// here — `resolved` is deliberately left unset.

/**
 * Split a raw PLAC string into its trimmed, whitespace-collapsed, non-empty
 * components, most-specific first, preserving original case.
 */
function splitParts(raw: string): string[] {
  const parts: string[] = [];
  for (const component of raw.split(',')) {
    // Collapse internal runs of whitespace to a single space and trim ends.
    const cleaned = component.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) {
      parts.push(cleaned);
    }
  }
  return parts;
}

/**
 * Build a normalized {@link Place} from a raw GEDCOM PLAC string.
 *
 * - `raw` is preserved verbatim (the cache key); never dropped.
 * - `parts` are the trimmed, whitespace-collapsed, non-empty components in
 *   original order (most-specific first), preserving original case.
 * - `normalized` is the parts re-joined with ", " and lowercased — a lookup
 *   key that collapses incidental spacing and case differences.
 *
 * Defensive: never throws. Empty / all-whitespace / all-comma input yields
 * `{ raw, normalized: '', parts: [] }`. Does not set `resolved`.
 */
export function parsePlace(raw: string): Place {
  const parts = splitParts(raw);
  const normalized = parts.join(', ').toLowerCase();
  return { raw, normalized, parts };
}

/**
 * Deduplicate places into a shared map keyed by {@link Place.normalized}.
 *
 * If a place with the same `normalized` key already exists, the existing
 * instance is returned unchanged (never overwritten); otherwise the freshly
 * parsed place is inserted and returned. This guarantees exactly one shared
 * `Place` instance per unique normalized key.
 */
export function internPlace(places: Map<string, Place>, raw: string): Place {
  const place = parsePlace(raw);
  const existing = places.get(place.normalized);
  if (existing !== undefined) {
    return existing;
  }
  places.set(place.normalized, place);
  return place;
}
