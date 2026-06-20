// GEDCOM dates are messy: ABT/BEF/AFT/EST/CAL qualifiers, ranges
// (BET x AND y), double-dated years (1745/46), partial dates, and
// non-Gregorian calendars. The raw string is ALWAYS preserved (TRD §5.2).

export type DateQualifier =
  | 'exact'
  | 'about' // ABT
  | 'before' // BEF
  | 'after' // AFT
  | 'estimated' // EST
  | 'calculated' // CAL
  | 'range' // BET ... AND ...
  | 'unknown';

export interface GenealogicalDate {
  /** Verbatim from the file, e.g. "ABT 1798". Never dropped. */
  raw: string;
  qualifier: DateQualifier;
  year?: number;
  /** 1–12 */
  month?: number;
  /** 1–31 */
  day?: number;
  /** YYYY-MM-DD when fully and confidently known. */
  iso?: string;
  /** Populated only when qualifier === 'range'. */
  rangeEnd?: {
    year?: number;
    month?: number;
    day?: number;
  };
  /** e.g. "julian" when not Gregorian; default Gregorian. */
  calendar?: string;
}
