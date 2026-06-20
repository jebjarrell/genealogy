import { describe, it, expect } from 'vitest';
import { parsePlace, internPlace } from '../src/gedcom/place.js';
import type { Place } from '../src/types/places.js';

// TRD §5.2 / §7.2: GEDCOM PLAC is a free-text, comma-delimited hierarchy,
// MOST-SPECIFIC FIRST. parsePlace builds a normalized Place; internPlace
// deduplicates by normalized key into a shared map.

describe('parsePlace', () => {
  it('parses a basic 3-level hierarchy into parts + normalized', () => {
    const place = parsePlace('Floyd, Kentucky, United States');
    expect(place.raw).toBe('Floyd, Kentucky, United States');
    expect(place.parts).toEqual(['Floyd', 'Kentucky', 'United States']);
    expect(place.normalized).toBe('floyd, kentucky, united states');
    expect(place.resolved).toBeUndefined();
  });

  it('parses a deep (4+ level) hierarchy', () => {
    const place = parsePlace('Prestonsburg, Floyd, Kentucky, United States, Earth');
    expect(place.parts).toEqual([
      'Prestonsburg',
      'Floyd',
      'Kentucky',
      'United States',
      'Earth',
    ]);
    expect(place.normalized).toBe(
      'prestonsburg, floyd, kentucky, united states, earth',
    );
  });

  it('preserves raw and parts case for a historical jurisdiction string', () => {
    const place = parsePlace('St. Petersburg, Russian Empire');
    expect(place.raw).toBe('St. Petersburg, Russian Empire');
    expect(place.parts).toEqual(['St. Petersburg', 'Russian Empire']);
    expect(place.normalized).toBe('st. petersburg, russian empire');
  });

  it('handles a single component with no commas', () => {
    const place = parsePlace('Kentucky');
    expect(place.raw).toBe('Kentucky');
    expect(place.parts).toEqual(['Kentucky']);
    expect(place.normalized).toBe('kentucky');
  });

  it('returns empty normalized and empty parts for an empty string', () => {
    const place = parsePlace('');
    expect(place.raw).toBe('');
    expect(place.normalized).toBe('');
    expect(place.parts).toEqual([]);
  });

  it('returns empty normalized and empty parts for all-whitespace input', () => {
    const place = parsePlace('   ');
    expect(place.raw).toBe('   ');
    expect(place.normalized).toBe('');
    expect(place.parts).toEqual([]);
  });

  it('returns empty normalized and empty parts for an all-commas string', () => {
    const place = parsePlace(', , ,');
    expect(place.raw).toBe(', , ,');
    expect(place.normalized).toBe('');
    expect(place.parts).toEqual([]);
  });

  it('drops empty components and collapses internal whitespace runs', () => {
    const place = parsePlace('Floyd,  Kentucky,   United  States, ,');
    expect(place.parts).toEqual(['Floyd', 'Kentucky', 'United States']);
    expect(place.normalized).toBe('floyd, kentucky, united states');
  });

  it('keeps parts in original (lowercased only in normalized) case', () => {
    const place = parsePlace('FLOYD, kentucky, United States');
    // parts preserve original case verbatim (after trim/collapse)
    expect(place.parts).toEqual(['FLOYD', 'kentucky', 'United States']);
    // normalized is fully lowercased
    expect(place.normalized).toBe('floyd, kentucky, united states');
  });

  it('always returns raw exactly equal to the input', () => {
    const inputs = [
      'Floyd, Kentucky, United States',
      '  weird ,, spacing  ',
      '',
      'Kentucky',
    ];
    for (const input of inputs) {
      expect(parsePlace(input).raw).toBe(input);
    }
  });

  it('never sets resolved', () => {
    expect(parsePlace('Floyd, Kentucky, United States').resolved).toBeUndefined();
  });
});

describe('internPlace', () => {
  it('returns the SAME instance for strings differing only in spacing and case', () => {
    const places = new Map<string, Place>();
    const a = internPlace(places, 'Floyd, Kentucky, United States');
    const b = internPlace(places, 'floyd,  kentucky,   united states');
    // Same normalized key => same shared instance, map has exactly one entry.
    expect(b).toBe(a);
    expect(places.size).toBe(1);
    expect(a.normalized).toBe('floyd, kentucky, united states');
  });

  it('does not overwrite the existing instance on a later intern', () => {
    const places = new Map<string, Place>();
    const first = internPlace(places, 'Floyd, Kentucky, United States');
    const second = internPlace(places, 'FLOYD, KENTUCKY, UNITED STATES');
    expect(second).toBe(first);
    // The stored instance is still the very first one (raw preserved from first).
    expect(places.get('floyd, kentucky, united states')).toBe(first);
    expect(first.raw).toBe('Floyd, Kentucky, United States');
  });

  it('inserts and returns a new instance for a distinct normalized key', () => {
    const places = new Map<string, Place>();
    const a = internPlace(places, 'Floyd, Kentucky, United States');
    const b = internPlace(places, 'St. Petersburg, Russian Empire');
    expect(b).not.toBe(a);
    expect(places.size).toBe(2);
  });

  it('stores the place under its normalized key', () => {
    const places = new Map<string, Place>();
    const place = internPlace(places, 'Kentucky');
    expect(places.get('kentucky')).toBe(place);
  });

  it('dedups empty/whitespace-only inputs under the empty key', () => {
    const places = new Map<string, Place>();
    const a = internPlace(places, '');
    const b = internPlace(places, '   ');
    expect(b).toBe(a);
    expect(places.size).toBe(1);
    expect(places.get('')).toBe(a);
  });
});
