import { describe, it, expect } from 'vitest';
import { parseGedcomDate } from '../src/gedcom/date.js';
import { parsePlace } from '../src/gedcom/place.js';
import { formatSarDate, formatSarPlace, toStateAbbr } from '../src/sar/format.js';

describe('formatSarDate — "04 Jul 1776" form', () => {
  it('formats a full date with two-digit day and three-letter month', () => {
    expect(formatSarDate(parseGedcomDate('4 JUL 1776'))).toBe('04 Jul 1776');
  });
  it('keeps a two-digit day as-is', () => {
    expect(formatSarDate(parseGedcomDate('14 SEP 1820'))).toBe('14 Sep 1820');
  });
  it('degrades to month+year and year-only', () => {
    expect(formatSarDate(parseGedcomDate('JUL 1776'))).toBe('Jul 1776');
    expect(formatSarDate(parseGedcomDate('1776'))).toBe('1776');
  });
  it('drops qualifiers down to the underlying date number', () => {
    expect(formatSarDate(parseGedcomDate('ABT 1776'))).toBe('1776');
  });
  it('renders B.C. years and empty for unknown', () => {
    expect(formatSarDate(parseGedcomDate('44 B.C.'))).toBe('44 BC');
    expect(formatSarDate(parseGedcomDate(''))).toBe('');
    expect(formatSarDate(undefined)).toBe('');
  });
});

describe('formatSarPlace — "City/County/ST" with empty segments preserved', () => {
  const sar = (raw: string) => formatSarPlace(parsePlace(raw));

  it('uses a two-letter state and strips the word County', () => {
    expect(sar('Louisville, Jefferson County, Kentucky, USA')).toBe(
      'Louisville/Jefferson/KY',
    );
  });
  it('preserves an empty county segment (county unknown)', () => {
    expect(sar('Louisville,,Kentucky')).toBe('Louisville//KY');
  });
  it('preserves an empty city segment (city unknown)', () => {
    expect(sar(',Jefferson,Kentucky')).toBe('/Jefferson/KY');
  });
  it('handles state-only', () => {
    expect(sar(',,Kentucky')).toBe('//KY');
    expect(sar('Kentucky')).toBe('//KY');
  });
  it('treats a single pre-state segment as the city (City, State)', () => {
    expect(sar('Louisville, KY')).toBe('Louisville//KY');
  });
  it('accepts an already-abbreviated state', () => {
    expect(sar('Boone County, WV')).toBe('/Boone/WV');
    expect(toStateAbbr('wv')).toBe('WV');
    expect(toStateAbbr('West Virginia')).toBe('WV');
    expect(toStateAbbr('Atlantis')).toBeNull();
  });
});
