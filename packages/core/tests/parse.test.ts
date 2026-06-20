import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import type { GenealogyModel } from '../src/types/index.js';

function load(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8');
}
function loadBytes(name: string): Uint8Array {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

const warningsOf = (m: GenealogyModel, sev: 'warning' | 'info') =>
  m.warnings.filter((w) => w.severity === sev);

describe('parseGedcom — minimal.ged (happy path)', () => {
  const model = parseGedcom(load('minimal.ged'));

  it('parses persons and families with ids stripped of @', () => {
    expect(model.persons.size).toBe(3);
    expect(model.families.size).toBe(1);
    const i1 = model.persons.get('I1')!;
    expect(i1.externalId).toBe('@I1@');
    expect(i1.id).toBe('I1');
  });

  it('maps names and sex', () => {
    const i1 = model.persons.get('I1')!;
    expect(i1.names[0]!.full).toBe('John Smith');
    expect(i1.names[0]!.surname).toBe('Smith');
    expect(i1.names[0]!.isPrimary).toBe(true);
    expect(i1.names[0]!.raw).toBe('John /Smith/');
    expect(i1.sex).toBe('male');
    expect(model.persons.get('I2')!.sex).toBe('female');
  });

  it('wires FAMS/FAMC family membership', () => {
    expect(model.persons.get('I1')!.familyIdsAsSpouse).toEqual(['F1']);
    expect(model.persons.get('I1')!.familyIdAsChild).toBeUndefined();
    expect(model.persons.get('I3')!.familyIdAsChild).toBe('F1');
    const f1 = model.families.get('F1')!;
    expect(f1.spouseIds).toEqual(['I1', 'I2']);
    expect(f1.childIds).toEqual(['I3']);
  });

  it('creates individual events with dates and places, preserving raw', () => {
    const i1 = model.persons.get('I1')!;
    const events = i1.eventIds.map((id) => model.events.get(id)!);
    const birth = events.find((e) => e.type === 'birth')!;
    expect(birth.date!.raw).toBe('12 JAN 1900');
    expect(birth.date!.iso).toBe('1900-01-12');
    expect(birth.place!.raw).toBe('New York, New York, United States');
    expect(birth.place!.normalized).toBe('new york, new york, united states');
    expect(events.some((e) => e.type === 'death')).toBe(true);
  });

  it('creates a marriage event with both spouses as participants', () => {
    const f1 = model.families.get('F1')!;
    expect(f1.marriageEventIds.length).toBe(1);
    const marr = model.events.get(f1.marriageEventIds[0]!)!;
    expect(marr.type).toBe('marriage');
    expect(marr.participants.sort()).toEqual(['I1', 'I2']);
    expect(marr.date!.raw).toBe('14 JUN 1924');
  });

  it('preserves source citations with pointer and page', () => {
    const i1 = model.persons.get('I1')!;
    expect(i1.sources.length).toBe(1);
    expect(i1.sources[0]!.sourceId).toBe('S1');
    expect(i1.sources[0]!.page).toBe('p. 42');
    expect(i1.sources[0]!.raw).toContain('@S1@');
  });

  it('deduplicates places into shared instances keyed by normalized', () => {
    const i1 = model.persons.get('I1')!;
    const f1 = model.families.get('F1')!;
    const birth = i1.eventIds
      .map((id) => model.events.get(id)!)
      .find((e) => e.type === 'birth')!;
    const marr = model.events.get(f1.marriageEventIds[0]!)!;
    // Same "New York, ..." string in birth and marriage → one shared Place.
    expect(birth.place).toBe(marr.place);
    expect(model.places.get('new york, new york, united states')).toBe(birth.place);
  });

  it('reads header metadata', () => {
    expect(model.header?.gedcomVersion).toBe('5.5.1');
    expect(model.header?.sourceSystem).toBe('GenealogyTRD');
    expect(model.header?.charset).toBe('UTF-8');
  });

  it('produces no warning-severity issues on a clean file', () => {
    expect(warningsOf(model, 'warning')).toEqual([]);
  });
});

describe('parseGedcom — messy-places.ged (dedup)', () => {
  const model = parseGedcom(load('messy-places.ged'));
  it('collapses spacing/case variants of one place into a single shared Place', () => {
    const i1 = model.persons.get('I1')!;
    const places = i1.eventIds
      .map((id) => model.events.get(id)!)
      .filter((e) => e.place)
      .map((e) => e.place!);
    expect(places.length).toBe(3); // birth, residence, death
    // All three Floyd variants are the same interned instance.
    expect(places[0]).toBe(places[1]);
    expect(places[1]).toBe(places[2]);
    expect(model.places.get('floyd, kentucky, united states')).toBe(places[0]);
  });
  it('keeps a deep hierarchy and a historical jurisdiction', () => {
    const deep = model.places.get(
      '12 main street, pikeville, floyd, kentucky, united states',
    );
    expect(deep!.parts).toEqual([
      '12 Main Street',
      'Pikeville',
      'Floyd',
      'Kentucky',
      'United States',
    ]);
    expect([...model.places.keys()]).toContain('st. petersburg, russian empire');
  });
});

describe('parseGedcom — unicode-names.ged', () => {
  const model = parseGedcom(load('unicode-names.ged'));
  it('round-trips non-ASCII names unchanged (string path)', () => {
    expect(model.persons.get('I1')!.names[0]!.full).toBe('José Müller');
    expect(model.persons.get('I3')!.names[0]!.given).toBe('田中');
    expect(model.persons.get('I3')!.names[0]!.surname).toBe('花子');
  });
  it('round-trips non-ASCII names unchanged (bytes path)', () => {
    const m2 = parseGedcom(loadBytes('unicode-names.ged'));
    expect(m2.persons.get('I4')!.names[0]!.full).toBe('Šárka Dvořák');
  });
});

describe('parseGedcom — multiple-marriages.ged', () => {
  const model = parseGedcom(load('multiple-marriages.ged'));
  it('records two FAMS for the twice-married person', () => {
    expect(model.persons.get('I1')!.familyIdsAsSpouse).toEqual(['F1', 'F2']);
  });
  it('keeps children in their respective families', () => {
    expect(model.families.get('F1')!.childIds).toEqual(['I4', 'I5']);
    expect(model.families.get('F2')!.childIds).toEqual(['I6']);
  });
});

describe('parseGedcom — messy-dates.ged (raw always preserved)', () => {
  const model = parseGedcom(load('messy-dates.ged'));
  const birthOf = (pid: string) => {
    const p = model.persons.get(pid)!;
    return p.eventIds
      .map((id) => model.events.get(id)!)
      .find((e) => e.type === 'birth')!.date!;
  };
  it('maps qualifiers while keeping raw', () => {
    expect(birthOf('I1')).toMatchObject({
      raw: 'ABT 1798',
      qualifier: 'about',
      year: 1798,
    });
    expect(birthOf('I2')).toMatchObject({ raw: 'AFT 1800', qualifier: 'after' });
    expect(birthOf('I3')).toMatchObject({
      raw: 'BET 1810 AND 1815',
      qualifier: 'range',
    });
    expect(birthOf('I5')).toMatchObject({ raw: '12 FEB 1745/46', year: 1746 });
    expect(birthOf('I6')).toMatchObject({ raw: '@#DJULIAN@ 1700', calendar: 'julian' });
  });
  it('keeps raw and flags unknown for an unparseable date', () => {
    const d = birthOf('I7');
    expect(d.raw).toBe('sometime in the old days');
    expect(d.qualifier).toBe('unknown');
  });
});

describe('parseGedcom — broken.ged (never throws; surfaces warnings)', () => {
  const model = parseGedcom(load('broken.ged'));

  it('produces a usable model from malformed input', () => {
    expect(model.persons.size).toBe(3);
    expect(model.families.size).toBe(2);
    expect(model.persons.get('I1')!.names[0]!.full).toBe('Valid Person');
  });

  it('surfaces warning-severity issues for dangling pointers', () => {
    const warns = warningsOf(model, 'warning');
    expect(warns.length).toBeGreaterThan(0);
    const blob = warns.map((w) => `${w.message} ${w.context ?? ''}`).join('\n');
    // Missing family @F99@ (FAMC), missing child @I98@, missing husband @I97@.
    expect(blob).toMatch(/F99|I98|I97/);
  });

  it('keeps an unparseable date verbatim with qualifier unknown', () => {
    const i2 = model.persons.get('I2')!;
    const birth = i2.eventIds
      .map((id) => model.events.get(id)!)
      .find((e) => e.type === 'birth')!;
    expect(birth.date!.raw).toBe('not a real date at all');
    expect(birth.date!.qualifier).toBe('unknown');
  });

  it('handles an individual with no NAME without throwing', () => {
    const i3 = model.persons.get('I3')!;
    expect(i3.names.length).toBe(0);
    expect(i3.sex).toBe('unknown');
  });
});
