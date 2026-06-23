import type { GenealogicalDate } from '../types/dates.js';
import type { Place } from '../types/places.js';

// SAR (Sons of the American Revolution) display formatting (handoff §5a).
//
// SAR applications require specific date and place forms. These helpers are pure
// and total: they never throw and degrade gracefully on partial/odd input. They
// are used wherever dates/places appear in an SAR context (checklist, exports).

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** US state / territory name → two-letter postal abbreviation (lookup is lower-cased). */
const STATE_ABBR: Readonly<Record<string, string>> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const ABBR_SET = new Set(Object.values(STATE_ABBR));

/**
 * Map a place segment to a two-letter state abbreviation, or null when it is not
 * recognizable as a US state. Already-abbreviated input ("KY", "ky") is accepted.
 */
export function toStateAbbr(segment: string | undefined): string | null {
  if (segment === undefined) return null;
  const trimmed = segment.trim();
  if (trimmed === '') return null;
  const byName = STATE_ABBR[trimmed.toLowerCase()];
  if (byName !== undefined) return byName;
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && ABBR_SET.has(upper)) return upper;
  return null;
}

/** True when a segment names a county explicitly ("Boone County", "Boone Co."). */
function looksLikeCounty(segment: string): boolean {
  return /\bcounty\b\s*$/i.test(segment) || /\bco\.?\s*$/i.test(segment);
}

/** Strip a trailing "County" / "Co." token: "Jefferson County" → "Jefferson". */
function stripCounty(segment: string): string {
  return segment
    .replace(/\s*\bcounty\b\s*$/i, '')
    .replace(/\s*\bco\.?\s*$/i, '')
    .trim();
}

/**
 * Format a {@link GenealogicalDate} in SAR style: `04 Jul 1776` — two-digit day,
 * three-letter month, four-digit-ish year, single spaces, no hyphens/slashes/
 * periods. Partial dates degrade: `Jul 1776`, `1776`. Returns '' when no year is
 * known. B.C. years render as `44 BC`.
 */
export function formatSarDate(date: GenealogicalDate | undefined): string {
  if (date === undefined || date.year === undefined) return '';
  const isBc = date.year < 0;
  const year = Math.abs(date.year);
  const yearStr = isBc ? `${year} BC` : String(year);

  const month = date.month;
  const day = date.day;
  if (month !== undefined && month >= 1 && month <= 12) {
    const mon = MONTH_ABBR[month - 1]!;
    if (day !== undefined && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${mon} ${yearStr}`;
    }
    return `${mon} ${yearStr}`;
  }
  return yearStr;
}

/**
 * Format a {@link Place} in SAR style: `City/County/ST`. The two-letter state
 * abbreviation is used; the word "County" is stripped; empty segments are
 * preserved (`Louisville//KY`, `/Jefferson/KY`, `//KY`).
 *
 * The raw PLAC string is parsed positionally with empty segments preserved
 * (the normalized `parts` drop them, which would lose City vs County position).
 * The state is located by recognition; the segment before it is the county and
 * everything before that is the city. When no US state is recognized the third
 * comma-segment is assumed to be the state slot.
 */
export function formatSarPlace(place: Place | undefined): string {
  if (place === undefined) return '';
  const segs = place.raw.split(',').map((s) => s.trim());
  if (segs.length === 0 || (segs.length === 1 && segs[0] === '')) return '';

  // Locate the state segment.
  let stateIdx = segs.findIndex((s) => toStateAbbr(s) !== null);
  if (stateIdx < 0) stateIdx = Math.min(2, segs.length - 1);

  const state = toStateAbbr(segs[stateIdx]) ?? (segs[stateIdx] ?? '').trim();

  // Position City and County relative to the located state, preserving empties.
  // - state at index 0      → no city, no county (state only)
  // - state at index 1      → the single pre-state segment is the CITY
  // - state at index ≥ 2     → segment before state is the County; the rest, City
  let city = '';
  let county = '';
  if (stateIdx === 1) {
    // One pre-state segment: a "…County" label is the county; otherwise the city.
    const seg = (segs[0] ?? '').trim();
    if (looksLikeCounty(seg)) county = stripCounty(seg);
    else city = seg;
  } else if (stateIdx >= 2) {
    county = stripCounty(segs[stateIdx - 1] ?? '');
    city = segs.slice(0, stateIdx - 1).join(', ').trim();
  }

  return `${city}/${county}/${state}`;
}
