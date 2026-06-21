import { describe, it, expect } from 'vitest';
import type { Place } from '@genealogy/core';
import { placeQueryCandidates } from '../src/place-query.js';

function place(raw: string, parts?: string[]): Place {
  return {
    raw,
    normalized: raw.toLowerCase(),
    ...(parts ? { parts } : {}),
  };
}

describe('placeQueryCandidates', () => {
  it('keeps an already-clean place verbatim as the first candidate', () => {
    const c = placeQueryCandidates(place('Floyd, Kentucky, United States'));
    expect(c[0]).toBe('Floyd, Kentucky, United States');
  });

  it('expands abbreviations and collapses a duplicated state code', () => {
    // The motivating real-world bug: "Fleming Co., KY, Kentucky, USA".
    const c = placeQueryCandidates(
      place('Fleming Co., KY, Kentucky, USA', [
        'Fleming Co.',
        'KY',
        'Kentucky',
        'USA',
      ]),
    );
    expect(c[0]).toBe('Fleming County, Kentucky, United States');
  });

  it('emits progressively coarser fallbacks (drop most-specific first)', () => {
    const c = placeQueryCandidates(
      place('Fleming Co., KY, Kentucky, USA', [
        'Fleming Co.',
        'KY',
        'Kentucky',
        'USA',
      ]),
    );
    expect(c).toEqual([
      'Fleming County, Kentucky, United States',
      'Kentucky, United States',
      'United States',
      // raw verbatim safety net last
      'Fleming Co., KY, Kentucky, USA',
    ]);
  });

  it('expands a bare two-letter state code', () => {
    const c = placeQueryCandidates(place('Boone, WV, USA', ['Boone', 'WV', 'USA']));
    expect(c[0]).toBe('Boone, West Virginia, United States');
  });

  it('treats "Co." (with period) as County, not Colorado', () => {
    const c = placeQueryCandidates(place('Floyd Co., Kentucky', ['Floyd Co.', 'Kentucky']));
    expect(c[0]).toBe('Floyd County, Kentucky');
  });

  it('keeps a genuine repeat like "New York, New York" intact', () => {
    const c = placeQueryCandidates(
      place('New York, New York, United States', [
        'New York',
        'New York',
        'United States',
      ]),
    );
    expect(c[0]).toBe('New York, New York, United States');
  });

  it('falls back to splitting raw when parts are absent', () => {
    const c = placeQueryCandidates(place('Floyd, Kentucky, United States'));
    expect(c).toContain('Kentucky, United States');
    expect(c).toContain('United States');
  });

  it('returns an empty list for a blank place', () => {
    expect(placeQueryCandidates(place(''))).toEqual([]);
  });
});
