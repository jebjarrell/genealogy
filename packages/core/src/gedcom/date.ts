import type { GenealogicalDate } from '../types/dates.js';

// Parser for the GEDCOM 5.5.1 DATE line value (TRD §5.2/§7.2). GEDCOM dates are
// messy: qualifiers (ABT/BEF/AFT/EST/CAL), ranges (BET x AND y, FROM x TO y),
// double-dated years (1745/46), partial dates, B.C. years, and non-Gregorian
// calendar escapes (@#DJULIAN@ ...). This is a pure, deterministic, defensive
// function: it NEVER throws and it ALWAYS preserves `raw` verbatim, even when it
// cannot extract anything useful.

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

// Calendar-escape token -> normalized calendar name. Gregorian is the default
// and is represented by `undefined` (we deliberately omit it from this map).
const CALENDARS: Readonly<Record<string, string>> = {
  JULIAN: 'julian',
  HEBREW: 'hebrew',
  'FRENCH R': 'french republican',
  ROMAN: 'roman',
  UNKNOWN: 'unknown',
};

/** The known year/month/day fields parsed out of one date token. */
interface DateParts {
  year?: number;
  month?: number;
  day?: number;
}

/**
 * Parse one GEDCOM date token (e.g. "12 JUN 1840", "JUN 1840", "1840",
 * "1745/46", "44 B.C."). Returns an empty object when no year can be found.
 */
function parseDateParts(token: string): DateParts {
  const parts: DateParts = {};
  const trimmed = token.trim();
  if (trimmed === '') return parts;

  // Detect and strip a B.C./BC suffix; we record B.C. years as negative numbers
  // (a simple, lossless-enough convention — `raw` still holds the original).
  let working = trimmed;
  let isBc = false;
  const bcMatch = /\s*\b(B\.?\s*C\.?)$/i.exec(working);
  if (bcMatch) {
    isBc = true;
    working = working.slice(0, bcMatch.index).trim();
  }

  const tokens = working.split(/\s+/).filter((t) => t.length > 0);

  for (const tok of tokens) {
    const upper = tok.toUpperCase();

    // Month abbreviation.
    const monthNum = MONTHS[upper];
    if (monthNum !== undefined) {
      parts.month = monthNum;
      continue;
    }

    // Double-dated year, e.g. "1745/46" or "1745/1746" (Old Style / New Style).
    // Before the 1752 calendar reform the year began in March, so a date in
    // Jan–Mar was written with both years. Convention: resolve to the SECOND
    // (New Style) year. "1745/46" -> 1746; a two-digit second part is grafted
    // onto the first year's century, handling rollover ("1699/00" -> 1700).
    const dbl = /^(\d{3,})\/(\d{1,4})$/.exec(tok);
    if (dbl && dbl[1] !== undefined && dbl[2] !== undefined) {
      const first = Number.parseInt(dbl[1], 10);
      const secondRaw = dbl[2];
      let second: number;
      if (secondRaw.length <= 2) {
        const century = Math.floor(first / 100) * 100;
        const candidate = century + Number.parseInt(secondRaw, 10);
        // If the two-digit suffix is not after the first year, it rolled into
        // the next century (e.g. 1699/00 -> 1700).
        second = candidate > first ? candidate : candidate + 100;
      } else {
        second = Number.parseInt(secondRaw, 10);
      }
      parts.year = second;
      continue;
    }

    // A plain run of digits is either a day (when we still need one and it is in
    // range) or a year. A 3+ digit number is always a year; a 1–2 digit number
    // is a day if 1–31 and we don't yet have one, otherwise a year.
    if (/^\d+$/.test(tok)) {
      const value = Number.parseInt(tok, 10);
      if (tok.length <= 2 && parts.day === undefined && value >= 1 && value <= 31) {
        parts.day = value;
      } else {
        parts.year = value;
      }
      continue;
    }
    // Anything else in the token (stray punctuation/words) is ignored.
  }

  // A lone "12" with no month/year reads as a day but means nothing on its own;
  // without a year there is no usable date, so promote a stray day to a year is
  // wrong — instead drop a dangling day so callers see "no year" => unknown.
  if (
    parts.year === undefined &&
    parts.month === undefined &&
    parts.day !== undefined
  ) {
    delete parts.day;
  }

  if (isBc && parts.year !== undefined) {
    parts.year = -parts.year;
  }

  return parts;
}

/** True when a parsed token yielded no usable date field. */
function isEmptyParts(parts: DateParts): boolean {
  return (
    parts.year === undefined && parts.month === undefined && parts.day === undefined
  );
}

/** Zero-pad a positive integer to a minimum width for ISO formatting. */
function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

/**
 * Parse the raw value of a GEDCOM DATE line into a normalized GenealogicalDate.
 * Pure and total: never throws; `result.raw` always equals the input exactly.
 */
export function parseGedcomDate(raw: string): GenealogicalDate {
  const result: GenealogicalDate = { raw, qualifier: 'unknown' };

  // Work on a trimmed copy; storage of `raw` stays verbatim.
  let working = typeof raw === 'string' ? raw.trim() : '';
  if (working === '') return result;

  // Strip a leading calendar escape like "@#DJULIAN@". Gregorian stays the
  // default (calendar left undefined). The escape may precede a qualifier and
  // may sit at the front of a BET…AND / FROM…TO expression.
  const escapeMatch = /^@#D([^@]*)@\s*/.exec(working);
  if (escapeMatch && escapeMatch[1] !== undefined) {
    const name = escapeMatch[1].trim().toUpperCase();
    const calendar = CALENDARS[name];
    if (calendar !== undefined) {
      result.calendar = calendar;
    }
    // GREGORIAN and any unrecognized escape both leave calendar undefined.
    working = working.slice(escapeMatch[0].length).trim();
  }

  if (working === '') return result;

  // Range form: BET <date> AND <date>.
  const betMatch = /^BET\b\.?\s+(.*?)\s+AND\s+(.*)$/i.exec(working);
  if (betMatch && betMatch[1] !== undefined && betMatch[2] !== undefined) {
    return finalizeRange(
      result,
      parseDateParts(betMatch[1]),
      parseDateParts(betMatch[2]),
    );
  }

  // Range form: FROM <date> TO <date>, plus the lone FROM/TO variants.
  // - FROM x TO y  -> range (x is start, y is rangeEnd)
  // - FROM x       -> range with start only, no rangeEnd
  // - TO x         -> range with rangeEnd only
  const fromToMatch = /^FROM\b\s+(.*?)\s+TO\s+(.*)$/i.exec(working);
  if (fromToMatch && fromToMatch[1] !== undefined && fromToMatch[2] !== undefined) {
    return finalizeRange(
      result,
      parseDateParts(fromToMatch[1]),
      parseDateParts(fromToMatch[2]),
    );
  }
  const fromMatch = /^FROM\b\s+(.*)$/i.exec(working);
  if (fromMatch && fromMatch[1] !== undefined) {
    const start = parseDateParts(fromMatch[1]);
    if (isEmptyParts(start)) return result; // "FROM" with nothing usable.
    result.qualifier = 'range';
    assignParts(result, start);
    return result;
  }
  const toMatch = /^TO\b\s+(.*)$/i.exec(working);
  if (toMatch && toMatch[1] !== undefined) {
    const end = parseDateParts(toMatch[1]);
    if (isEmptyParts(end)) return result;
    result.qualifier = 'range';
    result.rangeEnd = end;
    return result;
  }

  // Single-date qualifiers. Each keyword is matched case-insensitively and may
  // carry a trailing dot (e.g. "ABT.").
  const qualifiers: Array<[RegExp, GenealogicalDate['qualifier']]> = [
    [/^ABT\b\.?\s+(.*)$/i, 'about'],
    [/^BEF\b\.?\s+(.*)$/i, 'before'],
    [/^AFT\b\.?\s+(.*)$/i, 'after'],
    [/^EST\b\.?\s+(.*)$/i, 'estimated'],
    [/^CAL\b\.?\s+(.*)$/i, 'calculated'],
  ];
  for (const [pattern, qualifier] of qualifiers) {
    const m = pattern.exec(working);
    if (m && m[1] !== undefined) {
      const parts = parseDateParts(m[1]);
      if (isEmptyParts(parts)) return result; // keyword but no usable date.
      result.qualifier = qualifier;
      assignParts(result, parts);
      return result; // qualified dates never get iso.
    }
  }

  // No keyword: a plain, possibly partial, date.
  const parts = parseDateParts(working);
  if (isEmptyParts(parts)) return result; // unparseable => unknown.

  result.qualifier = 'exact';
  assignParts(result, parts);

  // iso is set ONLY for a confident, full, plain-Gregorian exact date: all of
  // year/month/day known, no calendar escape, positive (A.D.) year.
  if (
    result.calendar === undefined &&
    result.year !== undefined &&
    result.year > 0 &&
    result.month !== undefined &&
    result.day !== undefined
  ) {
    result.iso = `${pad(result.year, 4)}-${pad(result.month, 2)}-${pad(result.day, 2)}`;
  }

  return result;
}

/** Copy known year/month/day fields from parsed parts onto the result. */
function assignParts(result: GenealogicalDate, parts: DateParts): void {
  if (parts.year !== undefined) result.year = parts.year;
  if (parts.month !== undefined) result.month = parts.month;
  if (parts.day !== undefined) result.day = parts.day;
}

/**
 * Finalize a two-endpoint range. The expression is a range when at least one
 * endpoint is usable; an entirely empty pair (e.g. "BET AND") stays unknown.
 */
function finalizeRange(
  result: GenealogicalDate,
  start: DateParts,
  end: DateParts,
): GenealogicalDate {
  if (isEmptyParts(start) && isEmptyParts(end)) return result;
  result.qualifier = 'range';
  assignParts(result, start);
  if (!isEmptyParts(end)) {
    result.rangeEnd = {};
    if (end.year !== undefined) result.rangeEnd.year = end.year;
    if (end.month !== undefined) result.rangeEnd.month = end.month;
    if (end.day !== undefined) result.rangeEnd.day = end.day;
  }
  return result;
}
