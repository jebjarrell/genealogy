import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../src/gedcom/parse.js';
import {
  standardizeMilitaryEvent,
  militaryServiceRecords,
} from '../src/military/standardize.js';
import type { Event } from '../src/types/events.js';

function militaryEvent(description: string, year?: number, endYear?: number): Event {
  return {
    id: 'E1',
    type: 'military',
    rawTag: 'MILI',
    participants: ['I1'],
    sources: [],
    description,
    ...(year !== undefined
      ? {
          date: {
            raw: endYear ? `BET ${year} AND ${endYear}` : String(year),
            qualifier: endYear ? ('range' as const) : ('exact' as const),
            year,
            ...(endYear ? { rangeEnd: { year: endYear } } : {}),
          },
        }
      : {}),
  };
}

describe('standardizeMilitaryEvent', () => {
  it('parses a Civil War Confederate infantry record', () => {
    const r = standardizeMilitaryEvent(
      militaryEvent('Pvt., Co. B, 7th Virginia Infantry, CSA', 1863),
    );
    expect(r.war).toBe('Civil War');
    expect(r.rank).toBe('Private');
    expect(r.branch).toBe('Confederate');
    expect(r.unit).toBe('7th Virginia Infantry');
    expect(r.serviceDates?.startYear).toBe(1863);
    expect(r.raw).toBe('Pvt., Co. B, 7th Virginia Infantry, CSA');
  });

  it('parses a Revolutionary War Continental Army record', () => {
    const r = standardizeMilitaryEvent(
      militaryEvent('Sergeant, 5th Regiment, Continental Army', 1778),
    );
    expect(r.war).toBe('American Revolution');
    expect(r.rank).toBe('Sergeant');
    expect(r.branch).toBe('Continental Army');
    expect(r.unit).toBe('5th Regiment');
  });

  it('reads a Navy rank and captures a date range', () => {
    const r = standardizeMilitaryEvent(militaryEvent('Captain, US Navy', 1942, 1945));
    expect(r.branch).toBe('Navy');
    expect(r.rank).toBe('Captain');
    expect(r.war).toBe('World War II');
    expect(r.serviceDates).toEqual({ raw: 'BET 1942 AND 1945', startYear: 1942, endYear: 1945 });
  });

  it('falls back to war keywords when there is no date', () => {
    const r = standardizeMilitaryEvent(militaryEvent('Served in the Vietnam War'));
    expect(r.war).toBe('Vietnam War');
    expect(r.serviceDates).toBeUndefined();
  });

  it('leaves fields undefined when nothing is recognizable', () => {
    const r = standardizeMilitaryEvent(militaryEvent('Served honorably'));
    expect(r.branch).toBeUndefined();
    expect(r.rank).toBeUndefined();
    expect(r.unit).toBeUndefined();
    expect(r.war).toBeUndefined();
  });
});

describe('militaryServiceRecords', () => {
  it('returns one structured record per military event', () => {
    const ged = `0 HEAD
0 @I1@ INDI
1 NAME Sol /Dier/
1 SEX M
1 MILI Corporal, 12th Kentucky Cavalry
2 DATE 1864
0 TRLR
`;
    const records = militaryServiceRecords(parseGedcom(ged), 'I1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      war: 'Civil War',
      rank: 'Corporal',
      unit: '12th Kentucky Cavalry',
    });
  });
});
