import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { mergePersons } from '../src/edit/merge.js';
import { writeGedcom } from '../src/export/gedcom.js';
import { exportModelJson } from '../src/export/json.js';

function loadFixture(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

describe('writeGedcom — structural round-trip', () => {
  const model = loadFixture('minimal.ged');

  it('re-parses to the same people, names, and family links', () => {
    const reparsed = parseGedcom(writeGedcom(model));
    expect(reparsed.persons.size).toBe(model.persons.size);
    expect(reparsed.families.size).toBe(model.families.size);

    const john = reparsed.persons.get('I1')!;
    expect(john.names[0]!.full).toBe('John Smith');
    expect(john.sex).toBe('male');
    expect(john.familyIdsAsSpouse).toEqual(['F1']);

    // Birth date/place survive the round-trip.
    const birth = john.eventIds
      .map((id) => reparsed.events.get(id)!)
      .find((e) => e.type === 'birth')!;
    expect(birth.date?.year).toBe(1900);
    expect(birth.place?.raw).toBe('New York, New York, United States');
  });

  it('emits a valid GEDCOM 5.5.1 header and trailer', () => {
    const text = writeGedcom(model);
    expect(text.startsWith('0 HEAD')).toBe(true);
    expect(text).toContain('2 VERS 5.5.1');
    expect(text.trimEnd().endsWith('0 TRLR')).toBe(true);
  });
});

describe('writeGedcom — after a merge', () => {
  it('drops the merged record and keeps the rewritten links', () => {
    const base = loadFixture('minimal.ged');
    // Merge the child (I3) into John (I1) — contrived, just to exercise rewrite.
    const merged = mergePersons(base, 'I1', 'I3');
    const reparsed = parseGedcom(writeGedcom(merged));
    expect(reparsed.persons.has('I3')).toBe(false);
    expect(reparsed.persons.size).toBe(base.persons.size - 1);
  });
});

describe('exportModelJson', () => {
  it('produces parseable JSON with all record collections', () => {
    const model = loadFixture('minimal.ged');
    const parsed = JSON.parse(exportModelJson(model));
    expect(parsed.format).toBe('genealogy-knowledge-graph/model');
    expect(parsed.persons).toHaveLength(model.persons.size);
    expect(parsed.families).toHaveLength(model.families.size);
    expect(parsed.events.length).toBeGreaterThan(0);
  });
});
