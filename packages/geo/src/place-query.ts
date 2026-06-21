import type { Place } from '@genealogy/core';

// Turning a free-text GEDCOM place into queries Nominatim can actually match.
//
// Real-world PLAC strings are messy: abbreviated ("Fleming Co."), with postal
// state codes AND the full state name ("KY, Kentucky"), and assorted country
// spellings ("USA"). Nominatim matches the verbatim string poorly, so we:
//   1. expand common abbreviations and US state/country codes,
//   2. drop a token that only duplicates an adjacent one *because of* expansion
//      (e.g. "KY" → "Kentucky" sitting next to a literal "Kentucky"),
//   3. emit progressively coarser candidates (full → drop most-specific → … →
//      country) so a miss on the precise locality can still resolve the region.
// All pure; no DOM, no network — unit-tested directly.

const STATE_BY_CODE: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

// Country aliases → a canonical name Nominatim recognises.
const COUNTRY_ALIASES = new Map<string, string>([
  ['usa', 'United States'],
  ['us', 'United States'],
  ['u.s.', 'United States'],
  ['u.s.a.', 'United States'],
  ['united states of america', 'United States'],
  ['uk', 'United Kingdom'],
  ['u.k.', 'United Kingdom'],
  ['england', 'England'],
]);

// Word-level abbreviations expanded inside a token ("Fleming Co." → "Fleming
// County"). A trailing period disambiguates "Co." (County) from "CO" (Colorado).
const WORD_ABBREV = new Map<string, string>([
  ['co', 'County'],
  ['cnty', 'County'],
  ['twp', 'Township'],
  ['ft', 'Fort'],
  ['mt', 'Mount'],
  ['par', 'Parish'],
]);

interface Token {
  cleaned: string;
  /** True when produced by expanding a code/abbreviation (drives dedup). */
  expanded: boolean;
}

function stripTrailingPeriod(word: string): string {
  return word.replace(/\.+$/, '');
}

/** Normalise one comma-delimited place part. */
function cleanPart(rawPart: string): Token {
  const trimmed = rawPart.trim();
  if (trimmed === '') return { cleaned: '', expanded: false };

  // Whole-token country alias (e.g. "USA").
  const country = COUNTRY_ALIASES.get(trimmed.toLowerCase());
  if (country) return { cleaned: country, expanded: true };

  // Whole-token US state postal code, two letters with NO period ("KY"); a
  // period ("Co.") means it is an abbreviation handled word-by-word below.
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const state = STATE_BY_CODE[trimmed.toUpperCase()];
    if (state) return { cleaned: state, expanded: true };
  }

  // Expand abbreviated words inside the token ("Fleming Co." → "Fleming County").
  const words = trimmed.split(/\s+/);
  const expandedWords = words.map((w) => {
    const key = stripTrailingPeriod(w).toLowerCase();
    return WORD_ABBREV.get(key) ?? w;
  });
  const cleaned = expandedWords.join(' ');
  return { cleaned, expanded: cleaned !== trimmed };
}

function splitParts(place: Place): string[] {
  if (place.parts && place.parts.length > 0) return place.parts;
  return place.raw.split(',');
}

/**
 * Ordered list of Nominatim query candidates for a place, most-precise first.
 * The resolver tries each until one resolves. The first candidate equals the
 * cleaned full hierarchy, so already-clean places query exactly as before.
 */
export function placeQueryCandidates(place: Place): string[] {
  const tokens = splitParts(place)
    .map(cleanPart)
    .filter((t) => t.cleaned.length > 0);

  // Drop a token only duplicating an adjacent one because of expansion
  // ("KY"→"Kentucky" next to a literal "Kentucky"); keep genuine repeats like
  // "New York, New York" where neither side was expanded.
  const kept: Token[] = [];
  for (const t of tokens) {
    const prev = kept[kept.length - 1];
    if (
      prev &&
      prev.cleaned.toLowerCase() === t.cleaned.toLowerCase() &&
      (prev.expanded || t.expanded)
    ) {
      // Prefer keeping the literal over the expansion artifact; they are equal
      // strings, so simply skip the incoming duplicate.
      continue;
    }
    kept.push(t);
  }

  const parts = kept.map((t) => t.cleaned);
  const candidates: string[] = [];
  for (let start = 0; start < parts.length; start++) {
    candidates.push(parts.slice(start).join(', '));
  }
  // Verbatim raw as a final safety net (in case cleaning ever over-trims).
  const raw = place.raw.trim();
  if (raw) candidates.push(raw);

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (c && !seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}
