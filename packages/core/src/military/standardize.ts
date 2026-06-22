import type { Event } from '../types/events.js';
import type { GenealogyModel } from '../types/model.js';
import { classifyWar, militaryServiceOf } from './wars.js';

// Military-service standardization (#10): a normalization domain parallel to
// places. From a free-text military event ("Pvt., Co. B, 7th Virginia Infantry,
// CSA") we derive structured { war, branch, unit, rank, serviceDates }. The raw
// description is always preserved alongside (raw data is sacred). Heuristic and
// best-effort — every derived field is optional.

export interface MilitaryServiceRecord {
  eventId: string;
  /** Verbatim event description, when present. */
  raw?: string;
  war?: string;
  branch?: string;
  unit?: string;
  rank?: string;
  serviceDates?: { raw?: string; startYear?: number; endYear?: number };
}

// Ordered longest/most-specific first so multi-word branches win.
const BRANCHES: ReadonlyArray<[RegExp, string]> = [
  [/\bcontinental army\b/i, 'Continental Army'],
  [/\bair force\b|\barmy air\b/i, 'Air Force'],
  [/\bcoast guard\b/i, 'Coast Guard'],
  [/\bmarine(?:s| corps)?\b/i, 'Marine Corps'],
  [/\bconfederate\b|\bc\.?s\.?a\.?\b/i, 'Confederate'],
  [/\bunion army\b|\bunion\b/i, 'Union'],
  [/\bnav(?:y|al)\b/i, 'Navy'],
  [/\bmilitia\b/i, 'Militia'],
  [/\barmy\b/i, 'Army'],
];

// Ordered so two-word ranks match before their single-word component.
const RANKS: ReadonlyArray<[RegExp, string]> = [
  [/\bbrigadier general\b|\bbrig\.? gen\.?\b/i, 'Brigadier General'],
  [/\bgeneral\b|\bgen\.?\b/i, 'General'],
  [/\bcolonel\b|\bcol\.?\b/i, 'Colonel'],
  [/\bmajor\b|\bmaj\.?\b/i, 'Major'],
  [/\bcaptain\b|\bcapt?\.?\b|\bcpt\.?\b/i, 'Captain'],
  [/\blieutenant\b|\b(?:1st |2nd )?lt\.?\b/i, 'Lieutenant'],
  [/\bsergeant\b|\bsgt\.?\b/i, 'Sergeant'],
  [/\bcorporal\b|\bcpl\.?\b/i, 'Corporal'],
  [/\bprivate\b|\bpvt\.?\b/i, 'Private'],
  [/\bensign\b/i, 'Ensign'],
  [/\badmiral\b/i, 'Admiral'],
  [/\bseaman\b/i, 'Seaman'],
];

// War keyword fallback when the event date doesn't place it (or is absent).
const WAR_KEYWORDS: ReadonlyArray<[RegExp, string]> = [
  [/\brevolution(?:ary)?\b/i, 'American Revolution'],
  [/\bwar of 1812\b/i, 'War of 1812'],
  [/\bmexican[- ]american\b|\bmexican war\b/i, 'Mexican–American War'],
  [/\bcivil war\b/i, 'Civil War'],
  [/\bspanish[- ]american\b/i, 'Spanish–American War'],
  [/\bworld war (?:i|1)\b|\bww[i1]\b|\bgreat war\b/i, 'World War I'],
  [/\bworld war (?:ii|2)\b|\bww(?:ii|2)\b/i, 'World War II'],
  [/\bkorean? war\b|\bkorea\b/i, 'Korean War'],
  [/\bvietnam\b/i, 'Vietnam War'],
];

const UNIT_RE =
  /\b(\d+(?:st|nd|rd|th)?\s+(?:[A-Za-z.][\w.]*\s+)*?(?:Infantry|Cavalry|Artillery|Regiment|Volunteers|Militia|Dragoons|Brigade|Battalion|Division))\b/i;

function firstMatch(text: string, table: ReadonlyArray<[RegExp, string]>): string | undefined {
  for (const [re, canonical] of table) {
    if (re.test(text)) return canonical;
  }
  return undefined;
}

/** Derive structured service details from one military event. */
export function standardizeMilitaryEvent(event: Event): MilitaryServiceRecord {
  const text = event.description ?? '';
  const record: MilitaryServiceRecord = { eventId: event.id };
  if (event.description) record.raw = event.description;

  // War: prefer the event date, then keywords in the text.
  const war = classifyWar(event.date?.year)?.name ?? firstMatch(text, WAR_KEYWORDS);
  if (war) record.war = war;

  const branch = firstMatch(text, BRANCHES);
  if (branch) record.branch = branch;

  const rank = firstMatch(text, RANKS);
  if (rank) record.rank = rank;

  const unit = UNIT_RE.exec(text)?.[1]?.replace(/\s+/g, ' ').trim();
  if (unit) record.unit = unit;

  if (event.date) {
    const serviceDates: NonNullable<MilitaryServiceRecord['serviceDates']> = {};
    if (event.date.raw) serviceDates.raw = event.date.raw;
    if (event.date.year !== undefined) serviceDates.startYear = event.date.year;
    if (event.date.rangeEnd?.year !== undefined) {
      serviceDates.endYear = event.date.rangeEnd.year;
    }
    if (Object.keys(serviceDates).length > 0) record.serviceDates = serviceDates;
  }

  return record;
}

/** Structured military service records for a person, one per military event. */
export function militaryServiceRecords(
  model: GenealogyModel,
  personId: string,
): MilitaryServiceRecord[] {
  return militaryServiceOf(model, personId).events.map(standardizeMilitaryEvent);
}
